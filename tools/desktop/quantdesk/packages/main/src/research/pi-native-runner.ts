import crypto from 'node:crypto';

import type {
    ResearchArtifactWriteInput,
    ResearchRequestInput,
    ResearchRole,
    ResearcherFailureArtifact,
    ResearcherOutput,
    RiskProfileSnapshot,
} from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import type { PiRiskGatePreferences } from '../pi/preferences';
import type { PiSendMessageResult, PiStreamEvent } from '../pi/types';
import { getPriceProviderOrder } from '../sidecar/market-data-contracts';
import { createResearchContextSnapshot, type ResearchContextSnapshot } from './context-snapshot';
import { ResearchEventBus } from './event-bus';
import { createPiNativeRoute, savePiNativeFinalArtifacts, savePiNativeRouteArtifacts } from './pi-native-artifacts';
import { loadPiNativeResearchSkill } from './pi-native-skill-loader';
import { createPiNativePromptSnapshotArtifact } from './pi-native-prompt-snapshot';
import { getPiNativeResearchRoleDefinition, selectPiNativeResearchRoles } from './pi-native-roles';
import { createPiRuntimeDegradationReason } from './pi-runtime-preflight';
import { UnauthorizedResearchToolError, type PiResearchRuntime } from './pi-executor';
import {
    buildPreflight,
    buildResearcherFailureArtifact,
    createMinimalDecisionCard,
    createMinimalReport,
    createDegradedPiNativeOutputFromToolArtifacts,
    createRuntimeUnavailableError,
    handlePiNativeToolEvent,
    getPiRiskGateError,
    parsePiNativeResearcherOutput,
    piNativeRuntimeMode,
    sanitizeRuntimeErrorMessage,
    type PiNativeRunRef,
    type ResearchToolExecutionDraft,
} from './pi-native-support';
import type { RiskProfileService } from './risk-profile-service';
import { resolveResearchTarget, type ResearchTargetMarketDataResolver } from './research-target-resolver';
import { normalizeResearchRequest } from './task-normalizer';

export interface PiNativeResearchRunnerOptions {
    eventBus?: ResearchEventBus;
    marketDataResolver?: ResearchTargetMarketDataResolver;
    piRuntime?: PiResearchRuntime;
    repositories: Repositories;
    repository: Repositories['researchArtifactRepository'];
    riskGatePreferences?: PiRiskGatePreferences;
    riskProfileService: RiskProfileService;
    roleTimeoutMs?: number;
    skillTextLoader?: () => Promise<string>;
    totalTimeoutMs?: number;
}

const defaultRoleTimeoutMs = 120_000, defaultTotalTimeoutMs = 180_000;

const nowIso = () => new Date().toISOString();

const ignorePiCancelRunError = (error: unknown) => {
    void error;
    return undefined;
};

const summarizeRoleFailures = (failures: ResearcherFailureArtifact[]) => {
    if (failures.length === 0) {
        return 'Pi native research did not run any roles.';
    }

    const summary = failures
        .map((failure) => `${failure.role}: ${failure.reasonCode ?? 'runtime_failed'} - ${failure.error}`)
        .join('; ');

    return `All Pi native research roles failed. ${summary}`;
};

const isTerminalEventForRun = (
    event: PiStreamEvent,
    run: PiSendMessageResult,
): event is Extract<PiStreamEvent, { type: 'run_completed' | 'run_failed' | 'run_cancelled' }> => (
    (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled')
    && event.runId === run.runId
    && event.sessionId === run.sessionId
);

const isToolEventForRun = (
    event: PiStreamEvent,
    run: PiSendMessageResult,
): event is Extract<PiStreamEvent, { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }> => (
    (event.type === 'tool_execution_start' || event.type === 'tool_execution_update' || event.type === 'tool_execution_end')
    && event.runId === run.runId
    && event.sessionId === run.sessionId
);

export class PiNativeResearchRunner {
    private readonly contextSnapshot: ReturnType<typeof createResearchContextSnapshot>;
    private readonly eventBus: ResearchEventBus;
    private readonly inFlightRuns = new Map<string, { controller: AbortController; runs: Map<ResearchRole, PiSendMessageResult> }>();
    private readonly marketDataResolver: ResearchTargetMarketDataResolver | undefined;
    private readonly piRuntime: PiResearchRuntime | undefined;
    private readonly repositories: Repositories;
    private readonly repository: Repositories['researchArtifactRepository'];
    private readonly riskGatePreferences: PiRiskGatePreferences | undefined;
    private readonly riskProfileService: RiskProfileService;
    private readonly roleTimeoutMs: number;
    private readonly skillTextLoader: () => Promise<string>;
    private readonly toolExecutionDrafts = new Map<string, ResearchToolExecutionDraft>();
    private readonly totalTimeoutMs: number;

    constructor(options: PiNativeResearchRunnerOptions) {
        this.contextSnapshot = createResearchContextSnapshot({
            priceProviderIds: (asset) => getPriceProviderOrder({ market: asset.market, symbol: asset.symbol }),
            repositories: options.repositories,
        });
        this.eventBus = options.eventBus ?? new ResearchEventBus();
        this.marketDataResolver = options.marketDataResolver;
        this.piRuntime = options.piRuntime;
        this.repositories = options.repositories;
        this.repository = options.repository;
        this.riskGatePreferences = options.riskGatePreferences;
        this.riskProfileService = options.riskProfileService;
        this.roleTimeoutMs = options.roleTimeoutMs ?? defaultRoleTimeoutMs;
        this.skillTextLoader = options.skillTextLoader ?? loadPiNativeResearchSkill;
        this.totalTimeoutMs = options.totalTimeoutMs ?? defaultTotalTimeoutMs;
    }

    subscribe(listener: Parameters<ResearchEventBus['subscribe']>[0]) {
        return this.eventBus.subscribe(listener);
    }

    async startResearch(input: ResearchRequestInput) {
        const requestId = crypto.randomUUID();
        const controller = new AbortController();
        const request = this.repository.createRequest({ id: requestId, request: input, status: 'queued' });

        this.inFlightRuns.set(requestId, { controller, runs: new Map() });
        this.eventBus.emit({ request, timestamp: nowIso(), type: 'request_started' });

        queueMicrotask(() => {
            void this.executeResearch(requestId, input, controller);
        });

        return request;
    }

    cancelResearch(requestId: string) {
        const request = this.repository.getRequestById(requestId);

        if (!request || (request.status !== 'queued' && request.status !== 'running')) {
            return { cancelled: false };
        }

        const inFlight = this.inFlightRuns.get(requestId);
        inFlight?.controller.abort(new Error('Research request was cancelled.'));
        for (const run of inFlight?.runs.values() ?? []) {
            void this.piRuntime?.cancelRun?.(run.runId, run.sessionId).catch(ignorePiCancelRunError);
        }

        const cancelledRequest = this.repository.updateRequest(requestId, {
            completedAt: nowIso(),
            runtimeMode: piNativeRuntimeMode,
            status: 'cancelled',
        });

        this.eventBus.emit({ request: cancelledRequest, timestamp: nowIso(), type: 'request_cancelled' });

        return { cancelled: true };
    }

    private assertNotCancelled(requestId: string, signal: AbortSignal) {
        if (signal.aborted || this.repository.getRequestById(requestId)?.status === 'cancelled') {
            throw signal.reason instanceof Error ? signal.reason : new Error('Research request was cancelled.');
        }
    }

    private async ensureRuntimeReady() {
        const riskGateError = getPiRiskGateError(this.riskGatePreferences);

        if (riskGateError) {
            throw createRuntimeUnavailableError(riskGateError);
        }

        const reason = await createPiRuntimeDegradationReason(this.piRuntime);

        if (reason) {
            throw createRuntimeUnavailableError(reason);
        }

        if (!this.piRuntime) {
            throw createRuntimeUnavailableError('Pi runtime is unavailable.');
        }
    }

    private async executeResearch(requestId: string, input: ResearchRequestInput, controller: AbortController) {
        const signal = controller.signal;
        const totalTimeout = setTimeout(() => {
            controller.abort(new Error(`Pi native research request timed out after ${this.totalTimeoutMs}ms.`));
        }, this.totalTimeoutMs);

        try {
            this.repository.updateRequest(requestId, { runtimeMode: piNativeRuntimeMode, status: 'running' });
            this.assertNotCancelled(requestId, signal);
            await this.ensureRuntimeReady();
            this.assertNotCancelled(requestId, signal);

            const skillText = await this.skillTextLoader();
            const riskProfile = input.riskProfile ?? this.riskProfileService.get();
            const scopedInput = await resolveResearchTarget({ input, marketDataResolver: this.marketDataResolver, repositories: this.repositories, signal });
            this.assertNotCancelled(requestId, signal);
            const normalizedRequest = normalizeResearchRequest(scopedInput);
            const context = this.contextSnapshot.build(scopedInput, riskProfile);
            const roles = selectPiNativeResearchRoles(normalizedRequest);
            const route = createPiNativeRoute(normalizedRequest, roles);
            const preflight = buildPreflight({ context, now: nowIso(), roleCount: roles.length });

            this.repository.updateRequest(requestId, {
                normalizedRequest,
                preflight,
                route,
                runtimeMode: piNativeRuntimeMode,
                status: 'running',
            });
            savePiNativeRouteArtifacts({ context, repository: this.repository, requestId, route });

            const outputs: ResearcherOutput[] = [], failures: ResearcherFailureArtifact[] = [];
            const runRefs: PiNativeRunRef[] = [];

            for (const role of roles) {
                this.assertNotCancelled(requestId, signal);
                this.eventBus.emit({ requestId, role, runtimeMode: piNativeRuntimeMode, timestamp: nowIso(), type: 'researcher_started' });

                try {
                    const { output, run } = await this.runRole({ context, input: scopedInput, requestId, riskProfile, role, signal, skillText });

                    outputs.push(output);
                    runRefs.push({ role, runId: run.runId, sessionId: run.sessionId });
                    this.saveArtifact({
                        artifactType: 'researcher_output',
                        dataProvenance: output.dataProvenance,
                        payload: output,
                        promptVersionManifest: [{ id: 'quantdesk-research', layer: 'pi-native-skill', version: '1' }],
                        requestId,
                        role,
                    });
                    this.eventBus.emit({ output, requestId, timestamp: nowIso(), type: 'researcher_completed' });
                } catch (error) {
                    this.assertNotCancelled(requestId, signal);
                    const timestamp = nowIso();
                    const message = sanitizeRuntimeErrorMessage(error);
                    const failure = buildResearcherFailureArtifact({ error, failedAt: timestamp, message, requestId, role });

                    failures.push(failure);
                    this.saveArtifact({
                        artifactType: 'researcher_failure',
                        dataProvenance: [],
                        payload: failure,
                        promptVersionManifest: [{ id: 'quantdesk-research', layer: 'pi-native-skill', version: '1' }],
                        requestId,
                        role,
                    });
                    this.eventBus.emit({ error: message, requestId, role, runtimeMode: piNativeRuntimeMode, timestamp, type: 'researcher_failed' });
                }
            }

            this.assertNotCancelled(requestId, signal);

            if (outputs.length === 0) {
                throw new Error(summarizeRoleFailures(failures));
            }

            const decisionCard = createMinimalDecisionCard(outputs, failures);
            const report = createMinimalReport({ decisionCard, failures, generatedAt: nowIso(), outputs, runRefs });

            savePiNativeFinalArtifacts({ decisionCard, report, repository: this.repository, requestId });

            const completedRequest = this.repository.updateRequest(requestId, {
                completedAt: nowIso(),
                decisionCard,
                normalizedRequest,
                report,
                route,
                runtimeMode: piNativeRuntimeMode,
                status: 'completed',
            });

            this.eventBus.emit({ request: completedRequest, timestamp: nowIso(), type: 'request_completed' });
        } catch (error) {
            if (signal.aborted || this.repository.getRequestById(requestId)?.status === 'cancelled') {
                const existingRequest = this.repository.getRequestById(requestId);

                if (existingRequest?.status === 'cancelled') {
                    return;
                }

                const cancelledRequest = this.repository.updateRequest(requestId, {
                    completedAt: nowIso(),
                    runtimeMode: piNativeRuntimeMode,
                    status: 'cancelled',
                });

                this.eventBus.emit({ request: cancelledRequest, timestamp: nowIso(), type: 'request_cancelled' });
                return;
            }

            const message = sanitizeRuntimeErrorMessage(error);
            const failedRequest = this.repository.updateRequest(requestId, {
                completedAt: nowIso(),
                error: message,
                runtimeMode: piNativeRuntimeMode,
                status: 'failed',
            });

            this.eventBus.emit({ error: message, requestId, timestamp: nowIso(), type: 'request_failed' });
            void failedRequest;
        } finally {
            clearTimeout(totalTimeout);
            this.clearToolExecutionDrafts(requestId);
            this.inFlightRuns.delete(requestId);
        }
    }

    private buildRoleMessage(input: {
        context: ResearchContextSnapshot;
        request: ResearchRequestInput;
        requestId: string;
        riskProfile: RiskProfileSnapshot | null;
        role: ResearchRole;
        skillText: string;
    }) {
        const definition = getPiNativeResearchRoleDefinition(input.role);

        return [
            input.skillText,
            '',
            `Active role: ${input.role}`,
            definition.taskInstruction,
            '',
            `User query: ${input.request.query}`,
            `Research request id: ${input.requestId}`,
            `Research role: ${input.role}`,
            `Portfolio: ${input.request.portfolioName ?? input.context.portfolioName}`,
            `Risk profile: ${input.riskProfile ? JSON.stringify(input.riskProfile) : 'missing'}`,
            `Assets in current context: ${input.context.assets.map((asset) => `${asset.symbol}/${asset.market}`).join(', ') || 'none'}`,
            `Cached price signals: ${input.context.priceSignals.map((signal) => `${signal.symbol} latest=${signal.latestClose ?? 'n/a'} date=${signal.latestDate ?? 'n/a'}`).join('; ') || 'none'}`,
            '',
            'Return a short human-readable summary, then one JSON object. The JSON object must set requestId and role exactly as shown above.',
        ].join('\n');
    }

    private async runRole(input: {
        context: ResearchContextSnapshot;
        input: ResearchRequestInput;
        requestId: string;
        riskProfile: RiskProfileSnapshot | null;
        role: ResearchRole;
        signal: AbortSignal;
        skillText: string;
    }) {
        const piRuntime = this.piRuntime;

        if (!piRuntime) {
            throw createRuntimeUnavailableError('Pi runtime is unavailable.');
        }

        const definition = getPiNativeResearchRoleDefinition(input.role);
        const message = this.buildRoleMessage({
            context: input.context,
            request: input.input,
            requestId: input.requestId,
            riskProfile: input.riskProfile,
            role: input.role,
            skillText: input.skillText,
        });
        let activeRun: PiSendMessageResult | null = null;

        return await new Promise<{ output: ResearcherOutput; run: PiSendMessageResult }>((resolve, reject) => {
            const pendingEvents: PiStreamEvent[] = [];
            let settled = false;
            let timeout: NodeJS.Timeout | null = null;
            let unsubscribe: (() => void) | null = null;

            const settle = (callback: () => void) => {
                if (settled) {
                    return;
                }

                settled = true;
                if (timeout) {
                    clearTimeout(timeout);
                }
                unsubscribe?.();
                input.signal.removeEventListener('abort', handleAbort);
                callback();
            };

            const cancelActiveRun = async () => {
                if (activeRun && piRuntime.cancelRun) {
                    await piRuntime.cancelRun(activeRun.runId, activeRun.sessionId).catch(ignorePiCancelRunError);
                }
            };

            const handleAbort = () => {
                void cancelActiveRun();
                settle(() => reject(input.signal.reason instanceof Error ? input.signal.reason : new Error('Pi native research run was aborted.')));
            };

            const handleStreamEvent = (event: PiStreamEvent) => {
                if (!activeRun) {
                    pendingEvents.push(event);
                    return;
                }

                if (isToolEventForRun(event, activeRun)) {
                    if (!definition.allowedToolNames.includes(event.toolName)) {
                        void cancelActiveRun().then(() => {
                            settle(() => reject(new UnauthorizedResearchToolError({
                                allowedToolNames: definition.allowedToolNames,
                                attemptedToolName: event.toolName,
                                requestId: input.requestId,
                                role: input.role,
                                runId: event.runId,
                                sessionId: event.sessionId,
                            })));
                        });
                        return;
                    }

                    handlePiNativeToolEvent({
                        event,
                        eventBus: this.eventBus,
                        requestId: input.requestId,
                        role: input.role,
                        saveArtifact: (artifact) => this.saveArtifact(artifact),
                        toolExecutionDrafts: this.toolExecutionDrafts,
                    });
                    return;
                }

                if (!isTerminalEventForRun(event, activeRun)) {
                    return;
                }

                if (event.type === 'run_completed') {
                    settle(() => {
                        try {
                            resolve({ output: parsePiNativeResearcherOutput(event.transcript, input.requestId, input.role), run: activeRun as PiSendMessageResult });
                        } catch (error) {
                            reject(error instanceof Error ? error : new Error(String(error)));
                        }
                    });
                    return;
                }

                if (event.type === 'run_cancelled') {
                    settle(() => reject(new Error('Pi native research run was cancelled.')));
                    return;
                }

                const degradedOutput = createDegradedPiNativeOutputFromToolArtifacts({
                    error: event.error,
                    requestId: input.requestId,
                    role: input.role,
                    toolArtifacts: this.repository.listArtifactsByRequest(input.requestId),
                });

                if (degradedOutput) {
                    settle(() => resolve({ output: degradedOutput, run: activeRun as PiSendMessageResult }));
                    return;
                }

                settle(() => reject(new Error(event.error)));
            };

            timeout = setTimeout(() => {
                void cancelActiveRun();
                settle(() => reject(new Error(`Pi native ${input.role} role timed out after ${this.roleTimeoutMs}ms.`)));
            }, this.roleTimeoutMs);

            input.signal.addEventListener('abort', handleAbort, { once: true });
            unsubscribe = piRuntime.subscribe(handleStreamEvent);

            piRuntime.sendMessage({
                allowedToolNames: definition.allowedToolNames,
                message,
                startNewSession: true,
            })
                .then((run) => {
                    if (settled || input.signal.aborted) {
                        void piRuntime.cancelRun?.(run.runId, run.sessionId).catch(ignorePiCancelRunError);
                        return;
                    }

                    activeRun = run;
                    this.inFlightRuns.get(input.requestId)?.runs.set(input.role, run);
                    this.saveArtifact(createPiNativePromptSnapshotArtifact({
                        allowedToolNames: definition.allowedToolNames,
                        capturedAt: nowIso(),
                        message,
                        requestId: input.requestId,
                        role: input.role,
                        run,
                    }));
                    for (const event of pendingEvents.splice(0)) {
                        handleStreamEvent(event);
                    }
                })
                .catch((error: unknown) => {
                    settle(() => reject(error instanceof Error ? error : new Error(String(error))));
                });
        });
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
