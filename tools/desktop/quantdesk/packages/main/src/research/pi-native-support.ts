import type {
    DataProvenance,
    DecisionCard,
    ResearchArtifactRecord,
    ResearchActionLevel,
    ResearchArtifactWriteInput,
    ResearchPreflightCheck,
    ResearchPreflightSnapshot,
    ResearchRole,
    ResearchRuntimeMode,
    ResearchStreamEvent,
    ResearchToolExecutionArtifact,
    ResearcherFailureArtifact,
    ResearcherOutput,
    ResearchReport,
} from '@quantdesk/shared';

import type { PiWrapperSessionTranscript } from '../pi/types';
import type { ResearchEventBus } from './event-bus';
import { UnauthorizedResearchToolError } from './pi-executor';
import { repairResearcherOutput } from './research-output-repair';
import type { ResearchContextSnapshot } from './context-snapshot';
import {
    buildToolExecutionDataProvenance,
    sanitizeResearcherOutput,
    sanitizeToolArgs,
    sanitizeToolPayload,
    sanitizeToolPayloadString,
} from './pi-native-sanitizer';

export { sanitizePromptSnapshot, sanitizeRuntimeErrorMessage, sanitizeToolPayloadString } from './pi-native-sanitizer';

export type ResearchToolStartedEvent = Extract<ResearchStreamEvent, { type: 'research_tool_started' }>;
export type ResearchToolUpdatedEvent = Extract<ResearchStreamEvent, { type: 'research_tool_updated' }>;
export type ResearchToolCompletedEvent = Extract<ResearchStreamEvent, { type: 'research_tool_completed' }>;
export type ResearchToolExecutionDraft = Omit<ResearchToolExecutionArtifact, 'completedAt' | 'result'>;

export interface PiNativeRunRef { role: ResearchRole; runId: string; sessionId: string }

export const piNativeRuntimeMode: ResearchRuntimeMode = 'pi-native';

export const createToolExecutionKey = (event: ResearchToolStartedEvent | ResearchToolUpdatedEvent | ResearchToolCompletedEvent) => [
    event.requestId,
    event.role,
    event.sessionId,
    event.toolCallId,
].join(':');

const extractJsonObject = (content: string) => {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }

    const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);

    if (fencedMatch?.[1]?.trim().startsWith('{')) {
        return fencedMatch[1].trim();
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }

    throw new Error('Pi native researcher response did not contain a JSON object.');
};

const latestAssistantContent = (transcript: PiWrapperSessionTranscript) => {
    const message = [...transcript.messages]
        .reverse()
        .find((entry) => entry.role === 'assistant' && entry.phase !== 'thinking' && !entry.isError && entry.content.trim().length > 0);

    if (!message) {
        throw new Error('Pi native researcher completed without an assistant response.');
    }

    return message.content;
};

export const parsePiNativeResearcherOutput = (transcript: PiWrapperSessionTranscript, requestId: string, role: ResearchRole): ResearcherOutput => {
    const parsed = JSON.parse(extractJsonObject(latestAssistantContent(transcript))) as unknown;
    const output = sanitizeResearcherOutput(repairResearcherOutput(parsed, requestId, role), role);

    if (output.dataProvenance.length > 0) {
        return output;
    }

    return {
        ...output,
        confidence: 'low',
        dataGaps: Array.from(new Set([
            ...output.dataGaps,
            'Pi native researcher output did not include verifiable data provenance.',
        ])),
        needsSecondReview: true,
    };
};

const uniqueProvenance = (items: DataProvenance[]) => Array.from(new Map(items.map((item) => [
    [item.sourceId, item.fetchedAt, item.qualityStatus].join(':'),
    item,
])).values());

const toolSummary = (artifact: Extract<ResearchArtifactRecord, { artifactType: 'tool_execution' }>) => (
    artifact.payload.isError
        ? `${artifact.payload.toolName} failed: ${artifact.payload.errorMessage ?? artifact.payload.errorCode ?? 'tool error'}`
        : `${artifact.payload.toolName} completed with recorded provenance.`
);

export const createDegradedPiNativeOutputFromToolArtifacts = (input: {
    error: string;
    requestId: string;
    role: ResearchRole;
    toolArtifacts: ResearchArtifactRecord[];
}): ResearcherOutput | null => {
    const toolArtifacts = input.toolArtifacts.filter((artifact): artifact is Extract<ResearchArtifactRecord, { artifactType: 'tool_execution' }> => (
        artifact.artifactType === 'tool_execution'
        && artifact.role === input.role
    ));
    const successfulTools = toolArtifacts.filter((artifact) => !artifact.payload.isError);

    if (successfulTools.length === 0) {
        return null;
    }

    const provenance = uniqueProvenance(successfulTools.flatMap((artifact) => artifact.dataProvenance));

    return {
        actionRecommendation: 'observe',
        assumptions: [],
        confidence: 'low',
        conclusion: `${input.role} Pi native run aborted after collecting ${successfulTools.length} QuantDesk tool result(s); treat this as degraded evidence only.`,
        dataGaps: [
            `Pi native ${input.role} run ended before returning assistant JSON: ${sanitizeToolPayloadString(input.error)}`,
            'Rerun this role before increasing action intensity.',
        ],
        dataProvenance: provenance.length > 0
            ? provenance
            : successfulTools.map((artifact) => ({
                fetchedAt: artifact.payload.completedAt,
                qualityStatus: 'warn' as const,
                sourceId: `pi.${artifact.payload.toolName}`,
                warnings: ['Pi native role aborted before assistant synthesis.'],
            })),
        direction: 'neutral',
        edgeStrength: 'unknown',
        edgeTypes: ['information'],
        evidence: successfulTools.slice(0, 4).map((artifact) => ({
            label: artifact.payload.toolName,
            provenance: artifact.dataProvenance,
            summary: toolSummary(artifact),
        })),
        invalidationConditions: ['Assistant synthesis did not complete for this Pi native role.'],
        needsSecondReview: true,
        payoffGrade: 'unknown',
        requestId: input.requestId,
        risks: toolArtifacts.filter((artifact) => artifact.payload.isError).map((artifact) => toolSummary(artifact)),
        role: input.role,
        timeHorizon: 'unspecified',
        winRateGrade: 'unknown',
    };
};

export const createRuntimeUnavailableError = (reason: string) => new Error(`Pi runtime unavailable for native research: ${reason}`);

export const getPiRiskGateError = (riskGatePreferences: { getRiskGateState: () => { acknowledged: boolean; message?: string | null } } | undefined) => {
    const state = riskGatePreferences?.getRiskGateState();

    return state && !state.acknowledged
        ? state.message || 'Pi Agent high-privilege risk must be acknowledged before Pi native research.'
        : null;
};

const inferResearcherFailureReasonCode = (error: unknown): ResearcherFailureArtifact['reasonCode'] => {
    if (error instanceof UnauthorizedResearchToolError) {
        return 'unauthorized_tool';
    }

    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes('timed out') || message.includes('timeout')) {
        return 'timeout';
    }

    if (message.includes('schema') || message.includes('json') || message.includes('validation')) {
        return 'schema_invalid';
    }

    if (message.includes('provider') && message.includes('unavailable')) {
        return 'provider_unavailable';
    }

    return 'runtime_failed';
};

export const buildResearcherFailureArtifact = (input: {
    error: unknown;
    failedAt: string;
    message: string;
    requestId: string;
    role: ResearchRole;
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
            ? `Rerun ${input.role} with a narrower request or increase the Pi native role timeout.`
            : reasonCode === 'schema_invalid'
                ? `Inspect the Pi session transcript for ${input.role}; the role did not return a parseable JSON object.`
                : `Inspect the Pi session transcript and tool invocations for ${input.role}.`),
        requestId: input.requestId,
        role: input.role,
        runtimeMode: piNativeRuntimeMode,
    };
};

const rankAction: Record<ResearchActionLevel, number> = {
    avoid: 0,
    observe: 1,
    prepare: 2,
    suggested_operation: 3,
    trading_plan: 4,
};

const tightestAction = (outputs: ResearcherOutput[]): ResearchActionLevel => outputs
    .map((output) => output.actionRecommendation)
    .reduce((current, candidate) => (rankAction[candidate] < rankAction[current] ? candidate : current), 'trading_plan' as ResearchActionLevel);

export const createMinimalDecisionCard = (outputs: ResearcherOutput[], failures: ResearcherFailureArtifact[]): DecisionCard => {
    const dataGaps = Array.from(new Set([
        ...outputs.flatMap((output) => output.dataGaps),
        ...failures.map((failure) => `${failure.role}: ${failure.error}`),
    ]));
    const strongestOutput = outputs[0];

    return {
        actionLevel: outputs.length > 0 ? tightestAction(outputs) : 'avoid',
        dataGaps,
        edgeType: strongestOutput?.edgeTypes[0] ?? 'none',
        entryConditions: outputs.flatMap((output) => output.evidence.slice(0, 1).map((evidence) => evidence.summary)).slice(0, 4),
        invalidation: outputs.flatMap((output) => output.invalidationConditions).slice(0, 6),
        payoffGrade: strongestOutput?.payoffGrade ?? 'unknown',
        positionLevel: 'precise_unavailable',
        reviewTrigger: failures.length > 0 || dataGaps.length > 0 ? 'Review Pi role failures and data gaps before increasing action.' : 'Review when new verified data changes the thesis.',
        takeProfitOrExit: outputs.flatMap((output) => output.risks).slice(0, 4),
        timeHorizon: strongestOutput?.timeHorizon ?? 'unspecified',
        winRateGrade: strongestOutput?.winRateGrade ?? 'unknown',
    };
};

export const createMinimalReport = (input: {
    decisionCard: DecisionCard;
    failures: ResearcherFailureArtifact[];
    generatedAt: string;
    outputs: ResearcherOutput[];
    runRefs: PiNativeRunRef[];
}): ResearchReport => {
    const dataGaps = Array.from(new Set([
        ...input.outputs.flatMap((output) => output.dataGaps),
        ...input.failures.map((failure) => `${failure.role}: ${failure.error}`),
    ]));
    const consensus = input.outputs.map((output) => `${output.role}: ${output.conclusion}`);
    const failedSections = input.failures.map((failure) => ({
        body: `${failure.error}\nSession/run: unavailable.`,
        title: `${failure.role} failed`,
    }));

    return {
        conclusion: input.outputs.length > 0
            ? `Pi native research completed with ${input.outputs.length} role result(s) and ${input.failures.length} failure(s).`
            : 'Pi native research did not produce a successful role result.',
        consensus,
        dataGaps,
        decisionCard: input.decisionCard,
        disagreements: [],
        generatedAt: input.generatedAt,
        notSummoned: [],
        promptVersionManifest: [{ id: 'quantdesk-research', layer: 'pi-native-skill', version: '1' }],
        remediationItems: dataGaps.map((gap, index) => ({
            category: input.failures.some((failure) => gap.startsWith(`${failure.role}:`)) ? 'runtime_failure' : 'data_gap',
            id: `pi-native-gap-${index + 1}`,
            nextAction: 'Inspect the Pi role transcript and rerun with narrower scope or better data coverage.',
            reasonCode: input.failures.some((failure) => gap.startsWith(`${failure.role}:`)) ? 'runtime_failed' : 'missing_provenance',
            severity: input.failures.some((failure) => gap.startsWith(`${failure.role}:`)) ? 'warn' : 'info',
            summary: gap,
        })),
        reviewerGates: [],
        riskView: input.outputs.find((output) => output.role === 'risk')?.conclusion ?? 'No dedicated risk role result was produced.',
        sections: [
            ...input.outputs.map((output) => {
                const run = input.runRefs.find((ref) => ref.role === output.role);

                return {
                    body: [
                        output.conclusion,
                        `confidence=${output.confidence}; direction=${output.direction}; action=${output.actionRecommendation}`,
                        `session=${run?.sessionId ?? 'n/a'}; run=${run?.runId ?? 'n/a'}`,
                    ].join('\n'),
                    title: `${output.role} Pi native result`,
                };
            }),
            ...failedSections,
        ],
        summonedResearchers: input.outputs.map((output) => output.role),
        title: 'Pi Native Research Report',
    };
};

export const buildPreflight = (input: { context: ResearchContextSnapshot; now: string; roleCount: number }): ResearchPreflightSnapshot => {
    const dataSources = input.context.dataSources;
    const unavailable = dataSources.filter((source) => source.status === 'unavailable').length;
    const degraded = dataSources.filter((source) => source.status === 'degraded' || source.status === 'contract').length;
    const checks: ResearchPreflightCheck[] = [
        {
            checkedAt: input.now,
            details: 'Pi native runtime is available and deterministic fallback is disabled.',
            id: 'runtime.pi_native',
            label: 'Pi native runtime',
            status: 'pass',
        },
        {
            checkedAt: input.now,
            details: `${input.roleCount} Pi native role sessions will run with per-role tool allowlists.`,
            id: 'roles.pi_native',
            label: 'Pi native roles',
            status: input.roleCount > 0 ? 'pass' : 'block',
        },
        {
            checkedAt: input.now,
            details: `${dataSources.length} sources; degraded=${degraded}; unavailable=${unavailable}.`,
            id: 'data_sources.pi_native',
            label: 'Data source visibility',
            status: unavailable > 0 ? 'warn' : degraded > 0 ? 'warn' : 'pass',
        },
    ];

    return {
        checkedAt: input.now,
        checks,
        runtimeMode: piNativeRuntimeMode,
        status: checks.some((check) => check.status === 'block') ? 'block' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass',
    };
};

export const handlePiNativeToolEvent = (input: {
    event: {
        args: Record<string, unknown>;
        errorCode?: string;
        errorMessage?: string;
        isError?: boolean;
        partialResult?: unknown;
        result?: unknown;
        runId: string;
        sessionId: string;
        timestamp: string;
        toolCallId: string;
        toolName: string;
        type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end';
    };
    eventBus: ResearchEventBus;
    requestId: string;
    role: ResearchRole;
    saveArtifact: (input: ResearchArtifactWriteInput) => void;
    toolExecutionDrafts: Map<string, ResearchToolExecutionDraft>;
}) => {
    const { event, eventBus, requestId, role, saveArtifact, toolExecutionDrafts } = input;

    if (event.type === 'tool_execution_start') {
        const sanitizedEvent: ResearchToolStartedEvent = {
            args: sanitizeToolArgs(event.args),
            requestId,
            role,
            runId: event.runId,
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            type: 'research_tool_started',
        };

        eventBus.emit(sanitizedEvent);
        toolExecutionDrafts.set(createToolExecutionKey(sanitizedEvent), {
            args: sanitizedEvent.args,
            isError: false,
            partialResults: [],
            role,
            runId: event.runId,
            sessionId: event.sessionId,
            startedAt: event.timestamp,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
        });
        return;
    }

    if (event.type === 'tool_execution_update') {
        const sanitizedEvent: ResearchToolUpdatedEvent = {
            args: sanitizeToolArgs(event.args),
            partialResult: sanitizeToolPayload(event.partialResult),
            requestId,
            role,
            runId: event.runId,
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            type: 'research_tool_updated',
        };
        const key = createToolExecutionKey(sanitizedEvent);
        const draft = toolExecutionDrafts.get(key) ?? {
            args: sanitizedEvent.args,
            isError: false,
            partialResults: [],
            role,
            runId: event.runId,
            sessionId: event.sessionId,
            startedAt: event.timestamp,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
        };

        eventBus.emit(sanitizedEvent);
        toolExecutionDrafts.set(key, { ...draft, args: sanitizedEvent.args, partialResults: [...draft.partialResults, sanitizedEvent.partialResult] });
        return;
    }

    const sanitizedEvent: ResearchToolCompletedEvent = {
        args: sanitizeToolArgs(event.args),
        errorCode: event.errorCode,
        errorMessage: event.errorMessage ? sanitizeToolPayloadString(event.errorMessage) : undefined,
        isError: event.isError,
        requestId,
        result: sanitizeToolPayload(event.result),
        role,
        runId: event.runId,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        type: 'research_tool_completed',
    };
    const key = createToolExecutionKey(sanitizedEvent);
    const draft = toolExecutionDrafts.get(key) ?? {
        args: sanitizedEvent.args,
        isError: sanitizedEvent.isError ?? false,
        partialResults: [],
        role,
        runId: event.runId,
        sessionId: event.sessionId,
        startedAt: event.timestamp,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
    };
    const payload: ResearchToolExecutionArtifact = {
        ...draft,
        args: sanitizedEvent.args,
        completedAt: event.timestamp,
        errorCode: sanitizedEvent.errorCode,
        errorMessage: sanitizedEvent.errorMessage,
        isError: sanitizedEvent.isError ?? draft.isError,
        result: sanitizedEvent.result,
    };

    eventBus.emit(sanitizedEvent);
    saveArtifact({
        artifactType: 'tool_execution',
        dataProvenance: buildToolExecutionDataProvenance({ ...payload, result: event.result }),
        payload,
        promptVersionManifest: [],
        requestId,
        role,
    });
    toolExecutionDrafts.delete(key);
};