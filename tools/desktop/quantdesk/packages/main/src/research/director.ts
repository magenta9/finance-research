import crypto from 'node:crypto';

import type {
    AssetLookupResult,
    DataProvenance,
    DecisionCard,
    ResearchArtifactRecord,
    ResearchArtifactWriteInput,
    ResearchGateReasonCode,
    ResearchRemediationItem,
    ResearchPreflightCheck,
    ResearchPreflightSnapshot,
    ResearchPromptSnapshotArtifact,
    ResearchRequestInput,
    ResearchRequestRecord,
    ResearchRuntimeMode,
    ResearchStreamEvent,
    ResearchToolExecutionArtifact,
    ResearcherFailureArtifact,
    ResearcherOutput,
    ReviewGateResult,
} from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import { classifyResearchConflicts } from './conflict-classifier';
import { composeResearchPrompt } from './prompt-composer';
import { createResearchContextSnapshot, type ResearchContextSnapshot } from './context-snapshot';
import { createContextSnapshotArtifact } from './context-snapshot-artifact';
import { createDecisionCard } from './decision-engine';
import { createDeterministicResearchExecutor, type ResearchExecutor } from './executor';
import { ResearchEventBus } from './event-bus';
import { createGateExplanation } from './gate-explanation';
import { runDataQualityGate } from './data-quality-gate';
import { normalizeResearchRequest } from './task-normalizer';
import { routeResearchTask } from './router';
import { createResearchSchemaValidator, type ResearchSchemaValidator } from './schema-validator';
import { synthesizeResearchReport } from './report-synthesizer';
import type { RiskProfileService } from './risk-profile-service';
import { UnauthorizedResearchToolError } from './pi-executor';
import { buildResearchRemediationItems } from './research-remediation';
import { resolveResearchTarget } from './research-target-resolver';

type ResearchToolStartedEvent = Extract<ResearchStreamEvent, { type: 'research_tool_started' }>;
type ResearchToolUpdatedEvent = Extract<ResearchStreamEvent, { type: 'research_tool_updated' }>;
type ResearchToolCompletedEvent = Extract<ResearchStreamEvent, { type: 'research_tool_completed' }>;
type ResearchToolExecutionDraft = Omit<ResearchToolExecutionArtifact, 'completedAt' | 'result'>;

const createToolExecutionKey = (event: ResearchToolStartedEvent | ResearchToolUpdatedEvent | ResearchToolCompletedEvent) => [
    event.requestId,
    event.role,
    event.sessionId,
    event.toolCallId,
].join(':');

const sensitiveToolPayloadKeyPattern = /authorization|cookie|password|secret|token|api[_-]?key/i;
const sensitiveToolPayloadValuePatterns: Array<[RegExp, string]> = [
    [/(authorization:\s*)[^\r\n,;]+/gi, '$1[redacted]'],
    [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
    [/(x-api-key:\s*)[^\r\n,;]+/gi, '$1[redacted]'],
    [/("(?:api[_-]?key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2'],
    [/(\b(?:api[_-]?key|token|secret|password)\s*:\s*)[^\s,;}]+/gi, '$1[redacted]'],
    [/((?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]'],
    [/(cookie:\s*)[^\r\n]+/gi, '$1[redacted]'],
];
const maxToolPayloadArrayItems = 20;
const maxToolPayloadObjectKeys = 40;
const maxToolPayloadStringLength = 2_000;

const sanitizeToolPayloadString = (value: string) => {
    const redacted = sensitiveToolPayloadValuePatterns.reduce(
        (current, [pattern, replacement]) => current.replace(pattern, replacement),
        value,
    );

    return redacted.length > maxToolPayloadStringLength
        ? `${redacted.slice(0, maxToolPayloadStringLength)}... [truncated]`
        : redacted;
};

const sanitizeToolPayload = (value: unknown, depth = 0): unknown => {
    if (typeof value === 'string') {
        return sanitizeToolPayloadString(value);
    }

    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (depth >= 4) {
        return '[truncated:depth]';
    }

    if (Array.isArray(value)) {
        return value.slice(0, maxToolPayloadArrayItems).map((item) => sanitizeToolPayload(item, depth + 1));
    }

    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .slice(0, maxToolPayloadObjectKeys)
        .map(([key, item]) => [
            key,
            sensitiveToolPayloadKeyPattern.test(key) ? '[redacted]' : sanitizeToolPayload(item, depth + 1),
        ]));
};

const sanitizeToolArgs = (args: Record<string, unknown>) => sanitizeToolPayload(args) as Record<string, unknown>;
const sanitizeToolErrorMessage = (message: string | undefined) => (typeof message === 'string'
    ? sanitizeToolPayload(message) as string
    : undefined);
const sanitizeRuntimeErrorMessage = (error: unknown) => sanitizeToolPayload(
    error instanceof Error ? error.message : String(error),
) as string;

const inferResearcherFailureReasonCode = (error: unknown): ResearcherFailureArtifact['reasonCode'] => {
    if (error instanceof UnauthorizedResearchToolError) {
        return 'unauthorized_tool';
    }

    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes('timed out') || message.includes('timeout')) {
        return 'timeout';
    }

    if (message.includes('schema') || message.includes('validation')) {
        return 'schema_invalid';
    }

    if (message.includes('provider') && message.includes('unavailable')) {
        return 'provider_unavailable';
    }

    return 'runtime_failed';
};

const buildResearcherFailureArtifact = (input: {
    error: unknown;
    failedAt: string;
    message: string;
    requestId: string;
    role: ResearcherOutput['role'];
    runtimeMode: ResearchRuntimeMode;
}): ResearcherFailureArtifact => {
    const unauthorized = input.error instanceof UnauthorizedResearchToolError ? input.error : null;
    const reasonCode = inferResearcherFailureReasonCode(input.error);

    return {
        allowedToolNames: unauthorized?.allowedToolNames,
        attemptedToolName: unauthorized?.attemptedToolName,
        error: input.message,
        failedAt: input.failedAt,
        lastToolName: unauthorized?.attemptedToolName,
        reasonCode,
        recovered: false,
        remediation: unauthorized?.remediation ?? (reasonCode === 'timeout'
            ? `Rerun ${input.role} with a narrower request or increase the researcher timeout.`
            : reasonCode === 'provider_unavailable'
                ? `Connect the provider required by ${input.role} or keep the result degraded.`
                : `Inspect ${input.role} runtime logs and rerun the researcher.`),
        requestId: input.requestId,
        role: input.role,
        runtimeMode: input.runtimeMode,
    };
};

const getRuntimeModeFromError = (error: unknown): ResearchRuntimeMode | undefined => {
    const runtimeMode = typeof error === 'object' && error !== null && 'runtimeMode' in error
        ? (error as { runtimeMode?: unknown }).runtimeMode
        : undefined;

    return runtimeMode === 'pi' || runtimeMode === 'pi-native' || runtimeMode === 'deterministic' ? runtimeMode : undefined;
};

const sanitizePromptSnapshot = (prompt: string) => sanitizeToolPayloadString(prompt);

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeProvenanceQualityStatus = (value: unknown): DataProvenance['qualityStatus'] => (
    value === 'pass' || value === 'warn' || value === 'block' ? value : 'warn'
);

const normalizeNumberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const normalizeWarnings = (value: unknown) => (Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(sanitizeToolPayloadString)
    : []);

const normalizeStringList = (value: unknown) => (Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => sanitizeToolPayloadString(item.trim()))
    : []);

const normalizeCacheStatus = (value: unknown): DataProvenance['cacheStatus'] => (
    value === 'hit' || value === 'miss' || value === 'stale' ? value : undefined
);

const normalizeProvenanceDate = (value: unknown) => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return /^\d{4}-\d{2}-\d{2}(?:T[0-9:.+-]+Z?)?$/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))
        ? trimmed
        : null;
};

const normalizeExplicitProvenance = (value: unknown): DataProvenance | null => {
    if (!isRecord(value) || typeof value.sourceId !== 'string' || value.sourceId.trim().length === 0) {
        return null;
    }

    return {
        analysisWindow: isRecord(value.analysisWindow)
            ? {
                endDate: normalizeProvenanceDate(value.analysisWindow.endDate),
                startDate: normalizeProvenanceDate(value.analysisWindow.startDate),
            }
            : undefined,
        expectedRows: normalizeNumberOrNull(value.expectedRows),
        cacheStatus: normalizeCacheStatus(value.cacheStatus),
        fallbackProviderIds: normalizeStringList(value.fallbackProviderIds),
        fetchedAt: normalizeProvenanceDate(value.fetchedAt),
        providerIds: normalizeStringList(value.providerIds),
        qualityStatus: normalizeProvenanceQualityStatus(value.qualityStatus),
        rowsUsed: normalizeNumberOrNull(value.rowsUsed),
        sourceId: sanitizeToolPayloadString(value.sourceId.trim()),
        sourcePriority: normalizeStringList(value.sourcePriority),
        warnings: normalizeWarnings(value.warnings),
    };
};

const extractExplicitProvenance = (value: unknown) => {
    if (!isRecord(value)) {
        return [];
    }

    return [
        value.dataProvenance,
        value.provenance,
        isRecord(value.payload) ? value.payload.dataProvenance : undefined,
        isRecord(value.payload) ? value.payload.provenance : undefined,
    ]
        .filter(Array.isArray)
        .flatMap((items) => items.map(normalizeExplicitProvenance).filter((item): item is DataProvenance => item !== null));
};

const extractCitationStrings = (value: unknown) => {
    if (!isRecord(value) || !Array.isArray(value.citations)) {
        return [];
    }

    return value.citations
        .filter((citation): citation is string => typeof citation === 'string')
        .map((citation) => sanitizeToolPayloadString(citation.trim().replace(/^\[/, '').replace(/\]$/, '')))
        .filter((citation) => citation.length > 0);
};

const extractToolGeneratedAt = (value: unknown) => (isRecord(value) && isRecord(value.audit) && typeof value.audit.generatedAt === 'string'
    ? value.audit.generatedAt
    : null);

const extractToolRowsUsed = (value: unknown) => {
    if (!isRecord(value) || !isRecord(value.payload)) {
        return null;
    }

    if (Array.isArray(value.payload.recentPrices)) {
        return value.payload.recentPrices.length;
    }

    if (Array.isArray(value.payload.prices)) {
        return value.payload.prices.length;
    }

    return null;
};

const toolProvenanceSources = (value: unknown) => (isRecord(value) && isRecord(value.details)
    ? [value.details, value]
    : [value]);

const createCitationProvenance = (
    sourceId: string,
    result: unknown,
    isError: boolean | undefined,
): DataProvenance => ({
    fetchedAt: extractToolGeneratedAt(result),
    qualityStatus: isError || (isRecord(result) && result.ok === false) ? 'warn' : 'pass',
    rowsUsed: extractToolRowsUsed(result),
    sourceId,
    warnings: [],
});

const buildToolExecutionDataProvenance = (payload: ResearchToolExecutionArtifact): DataProvenance[] => {
    const sources = toolProvenanceSources(payload.result);
    const provenance = [
        ...sources.flatMap(extractExplicitProvenance),
        ...sources.flatMap((source) => extractCitationStrings(source).map((sourceId) => createCitationProvenance(sourceId, source, payload.isError))),
    ];
    const deduped = new Map<string, DataProvenance>();

    for (const item of provenance) {
        if (!deduped.has(item.sourceId)) {
            deduped.set(item.sourceId, item);
        }
    }

    return Array.from(deduped.values());
};

export interface ResearchArtifactRepositoryLike {
    createRequest: (input: {
        id: string;
        request: ResearchRequestInput;
        status: ResearchRequestRecord['status'];
    }) => ResearchRequestRecord;
    getRequestById: (id: string) => ResearchRequestRecord | null;
    listRequests: () => ResearchRequestRecord[];
    updateRequest: (id: string, patch: Partial<Pick<ResearchRequestRecord, 'completedAt' | 'decisionCard' | 'error' | 'normalizedRequest' | 'preflight' | 'report' | 'route' | 'runtimeMode' | 'status'>>) => ResearchRequestRecord;
    deleteRequest: (id: string) => boolean;
    saveArtifact: (input: ResearchArtifactWriteInput) => ResearchArtifactRecord;
    listArtifactsByRequest: (requestId: string) => ResearchArtifactRecord[];
}

export interface ResearchDirectorOptions {
    eventBus?: ResearchEventBus;
    executor?: ResearchExecutor;
    executorFactory?: () => Promise<ResearchExecutor> | ResearchExecutor;
    marketDataResolver?: {
        ensure: (request: { assetId: string; horizon?: '10y' | '30y' | 'full-known-history'; intent: 'asset-history'; priority?: 'background' | 'interactive' }) => Promise<unknown>;
        lookup: (request: { market?: string; query: string }) => Promise<AssetLookupResult[]>;
    };
    priceProviderIds?: Parameters<typeof createResearchContextSnapshot>[0]['priceProviderIds'];
    researcherTimeoutMs?: number;
    repositories: Repositories;
    repository: ResearchArtifactRepositoryLike;
    riskProfileService: RiskProfileService;
    schemaValidator?: ResearchSchemaValidator;
    totalTimeoutMs?: number;
}

const createDevilAdvocateGate = (input: {
    decisionCard: DecisionCard;
    outputs: ResearcherOutput[];
    requestId: string;
}): ReviewGateResult => {
    const lowConfidence = input.outputs.some((output) => output.confidence === 'low');
    const secondReviewRoles = input.outputs
        .filter((output) => output.needsSecondReview)
        .map((output) => output.role);
    const aggressiveAction = input.decisionCard.actionLevel === 'trading_plan' || input.decisionCard.actionLevel === 'suggested_operation';
    const reasons = [
        ...(lowConfidence ? ['At least one summoned researcher has low confidence.'] : []),
        ...secondReviewRoles.map((role) => `${role} researcher requested second review.`),
        ...(aggressiveAction ? ['Action intensity requires adversarial review before sizing up.'] : []),
    ];
    const reasonCodes: ResearchGateReasonCode[] = [
        ...(lowConfidence ? ['researcher_low_confidence' as const] : []),
        ...secondReviewRoles.map(() => 'researcher_second_review_requested' as const),
        ...(aggressiveAction ? ['aggressive_action_review_required' as const] : []),
    ];
    const requiredDowngrades = lowConfidence || secondReviewRoles.length > 0
        ? ['Keep action at prepare or below until second review is cleared.']
        : [];
    const status = lowConfidence || secondReviewRoles.length > 0 ? 'warn' : 'pass';

    return {
        dataProvenance: input.outputs.flatMap((output) => output.dataProvenance),
        explanation: createGateExplanation({ reasons, requiredDowngrades, reviewerRole: 'devil_advocate', status }),
        reasons,
        reasonCodes,
        requiredDowngrades,
        reviewerRole: 'devil_advocate',
        status,
        verdict: lowConfidence
            ? 'Maintain the thesis only as a scenario until low-confidence gaps are resolved.'
            : secondReviewRoles.length > 0
                ? 'Second review was requested by researcher output; keep action downgraded until reviewed.'
                : 'No fatal objection found in deterministic first-pass review.',
    };
};

const createResearcherFailureGate = (input: {
    failures: ResearcherFailureArtifact[];
    outputCount: number;
}): ReviewGateResult => {
    const status = input.outputCount === 0 ? 'block' : 'warn';
    const reasons = input.failures.map((failure) => `${failure.role} researcher failed: ${failure.error}`);
    const reasonCodes = input.failures.map((failure) => failure.reasonCode === 'unauthorized_tool'
        ? 'unauthorized_tool' as const
        : failure.reasonCode === 'schema_invalid'
            ? 'schema_invalid' as const
            : 'researcher_runtime_failure' as const);
    const requiredDowngrades = status === 'block'
        ? ['Block action because no researcher output was produced.']
        : ['Downgrade action intensity until failed researcher roles are rerun.'];

    return {
        dataProvenance: [],
        explanation: createGateExplanation({ reasons, requiredDowngrades, reviewerRole: 'data_quality', status }),
        reasons,
        reasonCodes,
        requiredDowngrades,
        reviewerRole: 'data_quality',
        status,
        verdict: status === 'block'
            ? 'No researcher output survived; keep the request blocked.'
            : 'Partial researcher failure requires action downgrade and follow-up review.',
    };
};

const createProviderAvailabilityGate = (input: {
    outputCount: number;
    route: ReturnType<typeof routeResearchTask>;
}): ReviewGateResult | null => {
    const reasons = input.route.notSummoned
        .filter((entry) => entry.reason.startsWith('Required data sources for '))
        .map((entry) => `${entry.role} researcher degraded: ${entry.reason}`);
    const reasonCodes = reasons.map(() => 'provider_source_unavailable' as const);

    if (reasons.length === 0) {
        return null;
    }

    const status = input.outputCount === 0 ? 'block' : 'warn';
    const requiredDowngrades = status === 'block'
        ? ['Block action because no requested researcher had usable source coverage.']
        : ['Downgrade action intensity until unavailable researcher data sources are connected or reviewed.'];

    return {
        dataProvenance: [],
        explanation: createGateExplanation({ reasons, requiredDowngrades, reviewerRole: 'data_quality', status }),
        reasons,
        reasonCodes,
        requiredDowngrades,
        reviewerRole: 'data_quality',
        status,
        verdict: status === 'block'
            ? 'Requested researcher coverage is unavailable; keep the request blocked.'
            : 'Some requested researcher roles were skipped because required data sources are unavailable or blocked.',
    };
};

const worstPreflightStatus = (statuses: ResearchPreflightCheck['status'][]): ResearchPreflightCheck['status'] => {
    if (statuses.includes('block')) {
        return 'block';
    }

    if (statuses.includes('warn')) {
        return 'warn';
    }

    return 'pass';
};

const countDataSourcesByStatus = (context: ResearchContextSnapshot) => context.dataSources.reduce((counts, source) => ({
    ...counts,
    [source.status]: counts[source.status] + 1,
}), {
    available: 0,
    contract: 0,
    degraded: 0,
    unavailable: 0,
});

const createResearchPreflightSnapshot = ({
    context,
    executor,
    hasMarketDataResolver,
    now,
}: {
    context: ResearchContextSnapshot;
    executor: ResearchExecutor;
    hasMarketDataResolver: boolean;
    now: string;
}): ResearchPreflightSnapshot => {
    const runtimeMode = executor.runtimeMode ?? 'deterministic';
    const dataSourceCounts = countDataSourcesByStatus(context);
    const unavailableSources = context.dataSources.filter((source) => source.status === 'unavailable');
    const contractSources = context.dataSources.filter((source) => source.status === 'contract');
    const availableToolNames = Array.from(new Set(context.dataSources
        .filter((source) => source.status === 'available' || source.status === 'degraded')
        .flatMap((source) => source.toolNames)));
    const checks: ResearchPreflightCheck[] = [
        {
            checkedAt: now,
            details: executor.runtimeDegradationReason
                ?? (runtimeMode === 'pi' ? 'Pi-backed researcher runtime is available.' : 'Deterministic fallback runtime is active.'),
            id: 'runtime.researcher',
            label: 'Research runtime',
            status: executor.runtimeDegradationReason || runtimeMode !== 'pi' ? 'warn' : 'pass',
        },
        {
            checkedAt: now,
            details: hasMarketDataResolver
                ? 'Market-data resolver is connected for lookup and history ensure.'
                : 'Market-data resolver is not connected; research can only use existing local cache.',
            id: 'market_data.resolver',
            label: 'Market-data resolver',
            status: hasMarketDataResolver ? 'pass' : 'warn',
        },
        {
            checkedAt: now,
            details: [
                `${dataSourceCounts.available} available`,
                `${dataSourceCounts.degraded} degraded`,
                `${dataSourceCounts.contract} legacy contract`,
                `${dataSourceCounts.unavailable} unavailable`,
                ...(contractSources.length > 0 ? [`contract=${contractSources.map((source) => source.id).join(',')}`] : []),
                ...(unavailableSources.length > 0 ? [`unavailable=${unavailableSources.map((source) => source.id).join(',')}`] : []),
            ].join('; '),
            id: 'data_sources.registry',
            label: 'Research data sources',
            status: unavailableSources.length > 0 ? 'block' : contractSources.length > 0 || dataSourceCounts.degraded > 0 ? 'warn' : 'pass',
        },
        {
            checkedAt: now,
            details: availableToolNames.length > 0
                ? `Allowed research tools available: ${availableToolNames.join(', ')}.`
                : 'No executable research tools are available for the scoped context.',
            id: 'tools.allowlist',
            label: 'Research tool allowlist',
            status: availableToolNames.length > 0 ? 'pass' : 'warn',
        },
    ];

    return {
        checkedAt: now,
        checks,
        runtimeMode,
        status: worstPreflightStatus(checks.map((check) => check.status)),
    };
};

export class ResearchDirector {
    private readonly contextSnapshot: ReturnType<typeof createResearchContextSnapshot>;

    private readonly eventBus: ResearchEventBus;

    private readonly executorFactory: () => Promise<ResearchExecutor>;

    private readonly inFlightRuns = new Map<string, AbortController>();

    private readonly marketDataResolver: ResearchDirectorOptions['marketDataResolver'];

    private readonly repository: ResearchArtifactRepositoryLike;

    private readonly repositories: Repositories;

    private readonly researcherTimeoutMs: number | null;

    private readonly riskProfileService: RiskProfileService;

    private readonly schemaValidator: ResearchSchemaValidator;

    private readonly totalTimeoutMs: number | null;

    private readonly toolExecutionDrafts = new Map<string, ResearchToolExecutionDraft>();

    constructor(options: ResearchDirectorOptions) {
        this.contextSnapshot = createResearchContextSnapshot({
            priceProviderIds: options.priceProviderIds,
            repositories: options.repositories,
        });
        this.eventBus = options.eventBus ?? new ResearchEventBus();
        const executor = options.executor ?? createDeterministicResearchExecutor();
        this.executorFactory = options.executorFactory
            ? async () => options.executorFactory!()
            : async () => executor;
        this.marketDataResolver = options.marketDataResolver;
        this.repository = options.repository;
        this.repositories = options.repositories;
        this.researcherTimeoutMs = options.researcherTimeoutMs && options.researcherTimeoutMs > 0 ? options.researcherTimeoutMs : null;
        this.riskProfileService = options.riskProfileService;
        this.schemaValidator = options.schemaValidator ?? createResearchSchemaValidator();
        this.totalTimeoutMs = options.totalTimeoutMs && options.totalTimeoutMs > 0 ? options.totalTimeoutMs : null;
    }

    subscribe(listener: Parameters<ResearchEventBus['subscribe']>[0]) {
        return this.eventBus.subscribe(listener);
    }

    async startResearch(input: ResearchRequestInput) {
        const requestId = crypto.randomUUID();
        const abortController = new AbortController();
        const request = this.repository.createRequest({
            id: requestId,
            request: input,
            status: 'queued',
        });

        this.inFlightRuns.set(requestId, abortController);
        this.eventBus.emit({ request, timestamp: new Date().toISOString(), type: 'request_started' });

        queueMicrotask(() => {
            void this.executeResearch(requestId, input, abortController);
        });

        return request;
    }

    cancelResearch(requestId: string) {
        const request = this.repository.getRequestById(requestId);

        if (!request || (request.status !== 'queued' && request.status !== 'running')) {
            return { cancelled: false };
        }

        this.inFlightRuns.get(requestId)?.abort(new Error('Research request was cancelled.'));

        const cancelledRequest = this.repository.updateRequest(requestId, {
            completedAt: new Date().toISOString(),
            status: 'cancelled',
        });

        this.eventBus.emit({ request: cancelledRequest, timestamp: new Date().toISOString(), type: 'request_cancelled' });

        return { cancelled: true };
    }

    private assertNotCancelled(requestId: string, signal: AbortSignal) {
        if (signal.aborted || this.repository.getRequestById(requestId)?.status === 'cancelled') {
            throw signal.reason instanceof Error ? signal.reason : new Error('Research request was cancelled.');
        }
    }

    private createResearcherAbortSignal(parentSignal: AbortSignal, role: ResearcherOutput['role']) {
        if (!this.researcherTimeoutMs) {
            return { cleanup: () => undefined, signal: parentSignal };
        }

        const controller = new AbortController();
        const abortFromParent = () => {
            controller.abort(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('Research request was cancelled.'));
        };
        const timeout = setTimeout(() => {
            controller.abort(new Error(`${role} researcher timed out after ${this.researcherTimeoutMs}ms.`));
        }, this.researcherTimeoutMs);

        if (parentSignal.aborted) {
            abortFromParent();
        } else {
            parentSignal.addEventListener('abort', abortFromParent, { once: true });
        }

        return {
            cleanup: () => {
                clearTimeout(timeout);
                parentSignal.removeEventListener('abort', abortFromParent);
            },
            signal: controller.signal,
        };
    }

    private async executeResearch(requestId: string, input: ResearchRequestInput, abortController: AbortController) {
        const signal = abortController.signal;
        const totalTimeout = this.totalTimeoutMs
            ? setTimeout(() => {
                abortController.abort(new Error(`Research request timed out after ${this.totalTimeoutMs}ms.`));
            }, this.totalTimeoutMs)
            : null;
        let resolvedRuntimeMode: ResearchRuntimeMode | undefined;

        try {
            this.assertNotCancelled(requestId, signal);
            const riskProfile = input.riskProfile ?? this.riskProfileService.get();
            const executor = await this.executorFactory();
            resolvedRuntimeMode = executor.runtimeMode ?? 'deterministic';
            this.repository.updateRequest(requestId, { runtimeMode: resolvedRuntimeMode });
            this.assertNotCancelled(requestId, signal);
            const scopedInput = await resolveResearchTarget({ input, marketDataResolver: this.marketDataResolver, repositories: this.repositories, signal });
            this.assertNotCancelled(requestId, signal);
            const normalizedRequest = normalizeResearchRequest(scopedInput);
            const context = this.contextSnapshot.build(scopedInput, riskProfile);
            const preflight = createResearchPreflightSnapshot({
                context,
                executor,
                hasMarketDataResolver: Boolean(this.marketDataResolver),
                now: new Date().toISOString(),
            });
            const route = routeResearchTask(normalizedRequest, { dataSources: context.dataSources });
            this.assertNotCancelled(requestId, signal);
            const routeRecord = this.repository.updateRequest(requestId, {
                normalizedRequest,
                preflight,
                route,
                runtimeMode: resolvedRuntimeMode,
                status: 'running',
            });

            if (executor.runtimeDegradationReason) {
                this.eventBus.emit({
                    reason: executor.runtimeDegradationReason,
                    requestId,
                    requestedRuntimeMode: executor.requestedRuntimeMode ?? executor.runtimeMode ?? 'pi',
                    runtimeMode: executor.runtimeMode ?? 'deterministic',
                    timestamp: new Date().toISOString(),
                    type: 'runtime_degraded',
                });
            }

            this.saveArtifact({ artifactType: 'route', dataProvenance: [], payload: route, promptVersionManifest: [], requestId, role: null });
            this.saveArtifact({
                artifactType: 'context_snapshot',
                dataProvenance: context.provenance,
                payload: createContextSnapshotArtifact(context),
                promptVersionManifest: [],
                requestId,
                role: null,
            });

            const outputs: ResearcherOutput[] = [];
            const failures: ResearcherFailureArtifact[] = [];
            const promptManifests: ResearchArtifactRecord['promptVersionManifest'] = [];

            for (const role of route.summonedResearchers) {
                this.assertNotCancelled(requestId, signal);

                this.eventBus.emit({
                    requestId,
                    role,
                    runtimeMode: executor.runtimeMode ?? 'deterministic',
                    timestamp: new Date().toISOString(),
                    type: 'researcher_started',
                });

                const prompt = composeResearchPrompt({
                    context,
                    normalizedRequest,
                    query: input.query,
                    riskProfile,
                    role,
                });
                const promptSnapshot: ResearchPromptSnapshotArtifact = {
                    allowedToolNames: prompt.allowedToolNames,
                    capturedAt: new Date().toISOString(),
                    policyTags: prompt.policyTags,
                    prompt: sanitizePromptSnapshot(prompt.prompt),
                    requestId,
                    role,
                    runtimeMode: executor.runtimeMode ?? 'deterministic',
                };

                this.saveArtifact({
                    artifactType: 'prompt_snapshot',
                    dataProvenance: [],
                    payload: promptSnapshot,
                    promptVersionManifest: prompt.manifest,
                    requestId,
                    role,
                });
                const researcherAbortSignal = this.createResearcherAbortSignal(signal, role);
                try {
                    const output = await executor.runResearcher({
                        context,
                        onRuntimeEvent: (event) => this.handleRuntimeEvent(event),
                        prompt,
                        query: scopedInput.query,
                        requestId,
                        role,
                        signal: researcherAbortSignal.signal,
                    });

                    this.assertNotCancelled(requestId, signal);
                    this.schemaValidator.assert('researcher-output', output);
                    outputs.push(output);
                    promptManifests.push(...prompt.manifest);
                    this.saveArtifact({
                        artifactType: 'researcher_output',
                        dataProvenance: output.dataProvenance,
                        payload: output,
                        promptVersionManifest: prompt.manifest,
                        requestId,
                        role,
                    });
                    this.eventBus.emit({ output, requestId, timestamp: new Date().toISOString(), type: 'researcher_completed' });
                } catch (error) {
                    this.assertNotCancelled(requestId, signal);
                    const timestamp = new Date().toISOString();
                    const message = sanitizeRuntimeErrorMessage(error);
                    const failure = buildResearcherFailureArtifact({
                        error,
                        failedAt: timestamp,
                        message,
                        requestId,
                        role,
                        runtimeMode: executor.runtimeMode ?? 'deterministic',
                    });

                    failures.push(failure);
                    promptManifests.push(...prompt.manifest);
                    this.saveArtifact({
                        artifactType: 'researcher_failure',
                        dataProvenance: [],
                        payload: failure,
                        promptVersionManifest: prompt.manifest,
                        requestId,
                        role,
                    });
                    this.eventBus.emit({
                        error: message,
                        requestId,
                        role,
                        runtimeMode: failure.runtimeMode,
                        timestamp,
                        type: 'researcher_failed',
                    });
                } finally {
                    researcherAbortSignal.cleanup();
                }
            }

            this.assertNotCancelled(requestId, signal);
            const gates = [runDataQualityGate(context)];
            const providerAvailabilityGate = createProviderAvailabilityGate({ outputCount: outputs.length, route });

            if (providerAvailabilityGate) {
                gates.push(providerAvailabilityGate);
            }

            if (failures.length > 0) {
                gates.push(createResearcherFailureGate({ failures, outputCount: outputs.length }));
            }

            const conflicts = classifyResearchConflicts(outputs);
            let decisionCard = createDecisionCard({ gates, outputs, riskProfile, route });

            if (route.reviewers.includes('devil_advocate') || outputs.some((output) => output.needsSecondReview)) {
                const devilAdvocateGate = createDevilAdvocateGate({ decisionCard, outputs, requestId });
                gates.push(devilAdvocateGate);
                decisionCard = createDecisionCard({ gates, outputs, riskProfile, route });
            }

            for (const gate of gates) {
                this.schemaValidator.assert('review-gate-result', gate);
                this.saveArtifact({
                    artifactType: 'review_gate',
                    dataProvenance: gate.dataProvenance,
                    payload: gate,
                    promptVersionManifest: [],
                    requestId,
                    role: gate.reviewerRole,
                });
                this.eventBus.emit({ gate, requestId, timestamp: new Date().toISOString(), type: 'review_gate_completed' });
            }

            this.schemaValidator.assert('decision-card', decisionCard);

            for (const conflict of conflicts) {
                this.saveArtifact({
                    artifactType: 'conflict',
                    dataProvenance: [],
                    payload: conflict,
                    promptVersionManifest: [],
                    requestId,
                    role: null,
                });
            }

            const toolExecutions = this.repository.listArtifactsByRequest(requestId)
                .filter((artifact) => artifact.artifactType === 'tool_execution')
                .map((artifact) => ({
                    ...artifact.payload,
                    dataProvenance: artifact.dataProvenance,
                }));
            const remediationItems: ResearchRemediationItem[] = buildResearchRemediationItems({
                context: createContextSnapshotArtifact(context),
                decisionCard,
                failures,
                gates,
                outputs,
                route,
                toolExecutions,
            });
            const report = synthesizeResearchReport({
                conflicts,
                decisionCard,
                failures,
                generatedAt: new Date().toISOString(),
                gates,
                outputs,
                remediationItems,
                route,
                toolExecutions,
            });
            const uniquePromptManifest = Array.from(
                new Map(promptManifests.map((entry) => [`${entry.id}:${entry.version}`, entry])).values(),
            );
            const reportWithManifest = {
                ...report,
                promptVersionManifest: uniquePromptManifest,
            };

            this.saveArtifact({
                artifactType: 'decision_card',
                dataProvenance: [],
                payload: decisionCard,
                promptVersionManifest: uniquePromptManifest,
                requestId,
                role: null,
            });
            this.saveArtifact({
                artifactType: 'report',
                dataProvenance: [],
                payload: reportWithManifest,
                promptVersionManifest: uniquePromptManifest,
                requestId,
                role: null,
            });

            const completedRequest = this.repository.updateRequest(routeRecord.id, {
                completedAt: new Date().toISOString(),
                decisionCard,
                normalizedRequest,
                report: reportWithManifest,
                route,
                status: 'completed',
            });

            this.eventBus.emit({ request: completedRequest, timestamp: new Date().toISOString(), type: 'request_completed' });
            return completedRequest;
        } catch (error) {
            if (signal.aborted || this.repository.getRequestById(requestId)?.status === 'cancelled') {
                const existingRequest = this.repository.getRequestById(requestId);

                if (existingRequest?.status === 'cancelled') {
                    return existingRequest;
                }

                const cancelledRequest = this.repository.updateRequest(requestId, {
                    completedAt: new Date().toISOString(),
                    status: 'cancelled',
                });

                this.eventBus.emit({ request: cancelledRequest, timestamp: new Date().toISOString(), type: 'request_cancelled' });
                return cancelledRequest;
            }

            const message = sanitizeRuntimeErrorMessage(error);
            const failedRequest = this.repository.updateRequest(requestId, {
                completedAt: new Date().toISOString(),
                error: message,
                runtimeMode: getRuntimeModeFromError(error) ?? resolvedRuntimeMode,
                status: 'failed',
            });

            this.eventBus.emit({ error: message, requestId, timestamp: new Date().toISOString(), type: 'request_failed' });
            return failedRequest;
        } finally {
            if (totalTimeout) {
                clearTimeout(totalTimeout);
            }
            this.clearToolExecutionDrafts(requestId);
            this.inFlightRuns.delete(requestId);
        }
    }

    private handleRuntimeEvent(event: ResearchStreamEvent) {
        if (event.type === 'research_tool_started') {
            const sanitizedEvent = { ...event, args: sanitizeToolArgs(event.args) };

            this.eventBus.emit(sanitizedEvent);
            this.toolExecutionDrafts.set(createToolExecutionKey(sanitizedEvent), {
                args: sanitizedEvent.args,
                isError: false,
                partialResults: [],
                role: sanitizedEvent.role,
                runId: sanitizedEvent.runId,
                sessionId: sanitizedEvent.sessionId,
                startedAt: sanitizedEvent.timestamp,
                toolCallId: sanitizedEvent.toolCallId,
                toolName: sanitizedEvent.toolName,
            });
            return;
        }

        if (event.type === 'research_tool_updated') {
            const sanitizedEvent = {
                ...event,
                args: sanitizeToolArgs(event.args),
                partialResult: sanitizeToolPayload(event.partialResult),
            };

            this.eventBus.emit(sanitizedEvent);
            const key = createToolExecutionKey(sanitizedEvent);
            const draft = this.toolExecutionDrafts.get(key) ?? {
                args: sanitizedEvent.args,
                isError: false,
                partialResults: [],
                role: sanitizedEvent.role,
                runId: sanitizedEvent.runId,
                sessionId: sanitizedEvent.sessionId,
                startedAt: sanitizedEvent.timestamp,
                toolCallId: sanitizedEvent.toolCallId,
                toolName: sanitizedEvent.toolName,
            };

            this.toolExecutionDrafts.set(key, {
                ...draft,
                args: sanitizedEvent.args,
                partialResults: [...draft.partialResults, sanitizedEvent.partialResult],
            });
            return;
        }

        if (event.type === 'research_tool_completed') {
            const sanitizedEvent = {
                ...event,
                args: sanitizeToolArgs(event.args),
                errorMessage: sanitizeToolErrorMessage(event.errorMessage),
                result: sanitizeToolPayload(event.result),
            };

            this.eventBus.emit(sanitizedEvent);
            const key = createToolExecutionKey(sanitizedEvent);
            const draft = this.toolExecutionDrafts.get(key) ?? {
                args: sanitizedEvent.args,
                isError: sanitizedEvent.isError ?? false,
                partialResults: [],
                role: sanitizedEvent.role,
                runId: sanitizedEvent.runId,
                sessionId: sanitizedEvent.sessionId,
                startedAt: sanitizedEvent.timestamp,
                toolCallId: sanitizedEvent.toolCallId,
                toolName: sanitizedEvent.toolName,
            };
            const payload: ResearchToolExecutionArtifact = {
                ...draft,
                args: sanitizedEvent.args,
                completedAt: sanitizedEvent.timestamp,
                errorCode: sanitizedEvent.errorCode,
                errorMessage: sanitizedEvent.errorMessage,
                isError: sanitizedEvent.isError ?? draft.isError,
                result: sanitizedEvent.result,
            };
            const provenancePayload: ResearchToolExecutionArtifact = {
                ...payload,
                result: event.result,
            };

            this.saveArtifact({
                artifactType: 'tool_execution',
                dataProvenance: buildToolExecutionDataProvenance(provenancePayload),
                payload,
                promptVersionManifest: [],
                requestId: sanitizedEvent.requestId,
                role: sanitizedEvent.role,
            });
            this.toolExecutionDrafts.delete(key);
            return;
        }

        this.eventBus.emit(event);
    }

    private clearToolExecutionDrafts(requestId: string) {
        for (const key of this.toolExecutionDrafts.keys()) {
            if (key.startsWith(`${requestId}:`)) {
                this.toolExecutionDrafts.delete(key);
            }
        }
    }

    private saveArtifact(input: ResearchArtifactWriteInput) {
        this.repository.saveArtifact(input);
    }

}