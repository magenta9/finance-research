import Database from 'better-sqlite3';
import { describe, expect, test, vi } from 'vitest';

import type { PiRuntimeStatus, ResearcherOutput, ResearchStreamEvent } from '@quantdesk/shared';
import type { PiRiskGatePreferences } from '../pi/preferences';
import type { PiSendMessageInput, PiSendMessageResult, PiStreamEvent } from '../pi/types';

import { runMigrations } from '../db/database';
import { createRepositories } from '../db/repositories';
import { createDataServices } from '../db/services';
import { createResearchHandlers } from './research';

class MemorySecretStore {
    isAvailable() {
        return true;
    }

    maskSecret(value?: string | null) {
        return value ? '***' : null;
    }

    async get() {
        return null;
    }

    async set() {
        return undefined;
    }

    async delete() {
        return undefined;
    }
}

const flushQueuedResearch = async () => {
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
};

const createPiStatus = (patch: Partial<PiRuntimeStatus> = {}): PiRuntimeStatus => ({
    currentSessionId: null,
    degraded: false,
    degradedReason: null,
    diagnostics: [],
    directories: {
        agentDir: '/tmp/quantdesk-pi/agent',
        sessionDir: '/tmp/quantdesk-pi/sessions',
        toolInvocationDir: '/tmp/quantdesk-pi/tools',
        workspaceDir: '/tmp/quantdesk-pi/workspace',
    },
    financeTools: { available: true, lastError: null, names: ['get_asset_snapshot'] },
    lastCheckedAt: '2026-04-28T00:00:00.000Z',
    lastError: null,
    lastStartedAt: '2026-04-28T00:00:00.000Z',
    model: { available: true, availableModels: ['test-model'], model: 'test-model', provider: 'test-provider', source: 'runtime' },
    pid: 123,
    sessionCount: 0,
    state: 'ready',
    wrapperVersion: 'test',
    ...patch,
});

const createRiskGatePreferences = (acknowledged: boolean, message = '请先确认 Pi Agent 高权限风险。'): PiRiskGatePreferences => ({
    acknowledgeHighPrivilegeRisk: vi.fn(() => ({
        acknowledged: true,
        acknowledgedAt: '2026-04-21T10:00:00.000Z',
        message,
        required: true,
        riskLevel: 'high' as const,
    })),
    getRiskGateState: vi.fn(() => ({
        acknowledged,
        acknowledgedAt: acknowledged ? '2026-04-21T10:00:00.000Z' : null,
        message,
        required: true,
        riskLevel: 'high' as const,
    })),
});

const createPiResearcherOutput = (requestId: string, role: ResearcherOutput['role']): ResearcherOutput => ({
    actionRecommendation: 'observe',
    assumptions: ['Pi runtime was started before research preflight diagnostics.'],
    confidence: 'medium',
    conclusion: `${role} Pi research completed.`,
    dataGaps: [],
    dataProvenance: [{
        fetchedAt: '2026-04-28T00:00:00.000Z',
        qualityStatus: 'pass',
        sourceId: `pi.${role}`,
        warnings: [],
    }],
    direction: 'neutral',
    edgeStrength: 'weak',
    edgeTypes: ['information'],
    evidence: [{ label: 'Pi runtime', provenance: [], summary: 'Pi researcher returned structured output.' }],
    invalidationConditions: ['New verified data contradicts the thesis.'],
    needsSecondReview: false,
    payoffGrade: 'weak',
    requestId,
    risks: ['This is a runtime lifecycle regression fixture.'],
    role,
    timeHorizon: 'weeks_to_months',
    winRateGrade: 'weak',
});

const extractPiResearchMetadata = (input: PiSendMessageInput) => {
    const requestId = /Research request id: ([^\n]+)/.exec(input.message)?.[1]?.trim() ?? 'request-unknown';
    const role = (/Research role: ([^\n]+)/.exec(input.message)?.[1]?.trim() ?? 'trend') as ResearcherOutput['role'];

    return { requestId, role };
};

const waitForTerminalResearchEvent = (subscribe: (listener: (event: ResearchStreamEvent) => void) => () => void) => new Promise<Extract<ResearchStreamEvent, { type: 'request_completed' | 'request_failed' }>>((resolve, reject) => {
    const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for research terminal event.'));
    }, 2_000);
    const unsubscribe = subscribe((event) => {
        if (event.type === 'request_completed' || event.type === 'request_failed') {
            clearTimeout(timeout);
            unsubscribe();
            resolve(event);
        }
    });
});

describe('createResearchHandlers', () => {
    test('runs a deterministic research request through IPC handlers', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const now = new Date().toISOString();
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'USD',
                id: 'asset-spy',
                market: 'US',
                metadata: {},
                name: 'SPY ETF',
                symbol: 'SPY',
                tags: ['core'],
            });
            repositories.priceRepository.insertMany([
                {
                    adjustedClose: 500,
                    assetId: 'asset-spy',
                    close: 500,
                    date: '2026-04-28',
                    fetchedAt: now,
                    high: 502,
                    low: 498,
                    open: 499,
                    source: 'test',
                    volume: 1000,
                },
            ]);
            const dataServices = createDataServices({
                database,
                repositories,
                secretStore: new MemorySecretStore(),
            });
            const handlers = createResearchHandlers({ dataServices, researchRuntimeMode: 'deterministic' });

            await handlers.saveRiskProfile({
                baseCurrency: 'CNY',
                maxDrawdown: 0.15,
                maxSingleWeight: 0.12,
                riskTolerance: 'medium',
                singlePositionLossBudget: 0.02,
                updatedAt: now,
            });
            const request = await handlers.startResearch({ query: '请给组合做配置建议' });
            await flushQueuedResearch();
            const completedRequest = handlers.getResearchRequest(request.id);

            expect(request.status).toBe('queued');
            expect(completedRequest?.status).toBe('completed');
            expect(completedRequest?.decisionCard?.actionLevel).toBeTruthy();
            expect(handlers.getResearchArtifacts(request.id).length).toBeGreaterThan(0);
            expect(handlers.listResearchRequests().items).toHaveLength(1);
        } finally {
            database.close();
        }
    });

    test('rejects invalid risk profile payloads before persistence', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const handlers = createResearchHandlers({
                dataServices: createDataServices({
                    database,
                    repositories,
                    secretStore: new MemorySecretStore(),
                }),
            });

            expect(() => handlers.saveRiskProfile({
                baseCurrency: 'CNY',
                maxDrawdown: Number.POSITIVE_INFINITY,
                maxSingleWeight: 0.12,
                riskTolerance: 'medium',
                singlePositionLossBudget: 0.02,
                updatedAt: '2026-04-28T00:00:00.000Z',
            })).toThrow('maxDrawdown');
        } finally {
            database.close();
        }
    });

    test('fails Pi research when Pi mode has no Pi runtime', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const handlers = createResearchHandlers({
                dataServices: createDataServices({
                    database,
                    repositories,
                    secretStore: new MemorySecretStore(),
                }),
                researchRuntimeMode: 'pi',
            });

            const request = await handlers.startResearch({ query: '研究恒生科技' });
            await flushQueuedResearch();
            const completedRequest = handlers.getResearchRequest(request.id);

            expect(completedRequest?.status).toBe('failed');
            expect(completedRequest?.runtimeMode).toBe('pi');
            expect(completedRequest?.error).toBe('Pi runtime is unavailable.');
        } finally {
            database.close();
        }
    });

    test('runs Pi native research by default without legacy deterministic fallback', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'USD',
                id: 'asset-spy',
                market: 'US',
                metadata: {},
                name: 'SPY ETF',
                symbol: 'SPY',
                tags: ['core'],
            });
            repositories.priceRepository.insertMany([{
                adjustedClose: 500,
                assetId: 'asset-spy',
                close: 500,
                date: '2026-05-04',
                fetchedAt: '2026-05-05T00:00:00.000Z',
                high: 502,
                low: 498,
                open: 499,
                source: 'test',
                volume: 1000,
            }]);
            const listeners = new Set<(event: PiStreamEvent) => void>();
            let runIndex = 0;
            const sendMessage = vi.fn(async (input: PiSendMessageInput): Promise<PiSendMessageResult> => {
                runIndex += 1;
                const run = { runId: `native-run-${runIndex}`, sessionId: `native-session-${runIndex}` };
                const { requestId, role } = extractPiResearchMetadata(input);

                expect(input.message).toContain('QuantDesk Research');

                setImmediate(() => {
                    for (const listener of listeners) {
                        listener({
                            runId: run.runId,
                            sessionId: run.sessionId,
                            timestamp: '2026-05-05T00:00:00.000Z',
                            transcript: {
                                cwd: '/tmp/quantdesk-pi',
                                messages: [{ content: JSON.stringify(createPiResearcherOutput(requestId, role)), id: `message-${runIndex}`, role: 'assistant' }],
                                model: { modelId: 'test-model', provider: 'test-provider' },
                                path: `/tmp/session-${runIndex}.json`,
                                sessionId: run.sessionId,
                                thinkingLevel: 'off',
                            },
                            type: 'run_completed',
                        });
                    }
                });

                return run;
            });
            const handlers = createResearchHandlers({
                dataServices: createDataServices({ database, repositories, secretStore: new MemorySecretStore() }),
                piRuntime: {
                    ensureReady: async () => undefined,
                    getStatus: async () => createPiStatus(),
                    sendMessage,
                    subscribe: (listener) => {
                        listeners.add(listener);

                        return () => {
                            listeners.delete(listener);
                        };
                    },
                },
            });
            const terminalEvent = waitForTerminalResearchEvent(handlers.subscribe);

            const request = await handlers.startResearch({ assetIds: ['asset-spy'], query: '研究 SPY 单股' });
            const event = await terminalEvent;
            const completedRequest = handlers.getResearchRequest(request.id);

            expect(event.type).toBe('request_completed');
            expect(completedRequest?.status).toBe('completed');
            expect(completedRequest?.runtimeMode).toBe('pi-native');
            expect(sendMessage).toHaveBeenCalledTimes(4);
            expect(handlers.getResearchArtifacts(request.id).some((artifact) => artifact.artifactType === 'route')).toBe(true);
            expect(handlers.getResearchArtifacts(request.id).some((artifact) => artifact.artifactType === 'context_snapshot')).toBe(true);
            expect(handlers.getResearchArtifacts(request.id).some((artifact) => artifact.artifactType === 'decision_card')).toBe(true);
        } finally {
            database.close();
        }
    });

    test('blocks Pi research until the Pi high-privilege risk is acknowledged', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const sendMessage = vi.fn(async () => {
                throw new Error('Pi sendMessage should not run before risk acknowledgement.');
            });
            const ensureReady = vi.fn(async () => undefined);
            const handlers = createResearchHandlers({
                dataServices: createDataServices({
                    database,
                    repositories,
                    secretStore: new MemorySecretStore(),
                }),
                piRuntime: {
                    ensureReady,
                    getStatus: async () => createPiStatus(),
                    sendMessage,
                    subscribe: () => () => undefined,
                },
                researchRuntimeMode: 'pi',
                riskGatePreferences: createRiskGatePreferences(false),
            });

            const request = await handlers.startResearch({ query: '研究纳斯达克' });
            await flushQueuedResearch();
            const completedRequest = handlers.getResearchRequest(request.id);

            expect(sendMessage).not.toHaveBeenCalled();
            expect(ensureReady).not.toHaveBeenCalled();
            expect(completedRequest?.status).toBe('failed');
            expect(completedRequest?.runtimeMode).toBe('pi');
            expect(completedRequest?.error).toBe('请先确认 Pi Agent 高权限风险。');
        } finally {
            database.close();
        }
    });

    test('starts a stopped Pi runtime before research preflight diagnostics', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const now = '2026-04-28T00:00:00.000Z';
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'USD',
                id: 'asset-spy',
                market: 'US',
                metadata: {},
                name: 'SPY ETF',
                symbol: 'SPY',
                tags: ['core'],
            });
            repositories.priceRepository.insertMany([{
                adjustedClose: 500,
                assetId: 'asset-spy',
                close: 500,
                date: '2026-04-28',
                fetchedAt: now,
                high: 502,
                low: 498,
                open: 499,
                source: 'test',
                volume: 1000,
            }]);

            let runtimeStarted = false;
            let runIndex = 0;
            const listeners = new Set<(event: PiStreamEvent) => void>();
            const ensureReady = vi.fn(async () => {
                runtimeStarted = true;
            });
            const getStatus = vi.fn(async () => runtimeStarted
                ? createPiStatus()
                : createPiStatus({
                    lastStartedAt: null,
                    model: { available: false, availableModels: [], model: null, provider: null, source: 'unknown' },
                    pid: null,
                    state: 'stopped',
                }));
            const sendMessage = vi.fn(async (input: PiSendMessageInput): Promise<PiSendMessageResult> => {
                runIndex += 1;
                const run = { runId: `run-${runIndex}`, sessionId: `session-${runIndex}` };
                const { requestId, role } = extractPiResearchMetadata(input);

                setImmediate(() => {
                    const event: PiStreamEvent = {
                        runId: run.runId,
                        sessionId: run.sessionId,
                        timestamp: now,
                        transcript: {
                            cwd: '/tmp/quantdesk-pi',
                            messages: [{ content: JSON.stringify(createPiResearcherOutput(requestId, role)), id: `message-${runIndex}`, role: 'assistant' }],
                            model: { modelId: 'test-model', provider: 'test-provider' },
                            path: `/tmp/quantdesk-pi/session-${runIndex}.json`,
                            sessionId: run.sessionId,
                            thinkingLevel: 'off',
                        },
                        type: 'run_completed',
                    };

                    for (const listener of listeners) {
                        listener(event);
                    }
                });

                return run;
            });
            const handlers = createResearchHandlers({
                dataServices: createDataServices({
                    database,
                    repositories,
                    secretStore: new MemorySecretStore(),
                }),
                piRuntime: {
                    ensureReady,
                    getStatus,
                    sendMessage,
                    subscribe: (listener) => {
                        listeners.add(listener);

                        return () => {
                            listeners.delete(listener);
                        };
                    },
                },
                researchRuntimeMode: 'pi',
            });
            const terminalEvent = waitForTerminalResearchEvent(handlers.subscribe);

            const request = await handlers.startResearch({ assetIds: ['asset-spy'], query: '研究 SPY ETF' });
            const event = await terminalEvent;
            const completedRequest = handlers.getResearchRequest(request.id);

            expect(event.type).toBe('request_completed');
            expect(ensureReady).toHaveBeenCalledTimes(1);
            expect(getStatus).toHaveBeenCalledTimes(1);
            expect(sendMessage).toHaveBeenCalled();
            expect(completedRequest?.status).toBe('completed');
            expect(completedRequest?.runtimeMode).toBe('pi');
            expect(completedRequest?.error).toBeNull();
        } finally {
            database.close();
        }
    });

    test('fails Pi research when Pi runtime startup hangs during preflight', async () => {
        vi.useFakeTimers();
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const runtimeEvents: ResearchStreamEvent[] = [];
            const getStatus = vi.fn(async () => createPiStatus());
            const sendMessage = vi.fn(async () => {
                throw new Error('Pi sendMessage should not run when startup hangs.');
            });
            const handlers = createResearchHandlers({
                dataServices: createDataServices({
                    database,
                    repositories,
                    secretStore: new MemorySecretStore(),
                }),
                piRuntime: {
                    ensureReady: async () => await new Promise<void>(() => undefined),
                    getStatus,
                    sendMessage,
                    subscribe: () => () => undefined,
                },
                researchRuntimeMode: 'pi',
            });

            handlers.subscribe((event) => {
                runtimeEvents.push(event);
            });

            const request = await handlers.startResearch({ query: '研究恒生科技' });
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(30_000);
            const completedRequest = handlers.getResearchRequest(request.id);

            expect(getStatus).not.toHaveBeenCalled();
            expect(sendMessage).not.toHaveBeenCalled();
            expect(completedRequest?.status).toBe('failed');
            expect(completedRequest?.runtimeMode).toBe('pi');
            expect(completedRequest?.error).toBe('Pi runtime status check failed: Pi runtime startup timed out after 30000ms.');
            expect(runtimeEvents).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    error: 'Pi runtime status check failed: Pi runtime startup timed out after 30000ms.',
                    type: 'request_failed',
                }),
            ]));
        } finally {
            vi.useRealTimers();
            database.close();
        }
    });

    test('fails Pi research when preflight has no available model', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const runtimeEvents: ResearchStreamEvent[] = [];
            const sendMessage = vi.fn(async () => {
                throw new Error('Pi sendMessage should not run when preflight degrades.');
            });
            const handlers = createResearchHandlers({
                dataServices: createDataServices({
                    database,
                    repositories,
                    secretStore: new MemorySecretStore(),
                }),
                piRuntime: {
                    ensureReady: async () => undefined,
                    getStatus: async () => createPiStatus({
                        model: { available: false, availableModels: [], model: null, provider: null, source: 'runtime' },
                    }),
                    sendMessage,
                    subscribe: () => () => undefined,
                },
                researchRuntimeMode: 'pi',
            });

            handlers.subscribe((event) => {
                runtimeEvents.push(event);
            });

            const request = await handlers.startResearch({ query: '研究恒生科技' });
            await flushQueuedResearch();
            const completedRequest = handlers.getResearchRequest(request.id);

            expect(sendMessage).not.toHaveBeenCalled();
            expect(completedRequest?.status).toBe('failed');
            expect(completedRequest?.runtimeMode).toBe('pi');
            expect(completedRequest?.error).toBe('Pi runtime is not ready for research: no model is available.');
            expect(runtimeEvents).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    error: 'Pi runtime is not ready for research: no model is available.',
                    type: 'request_failed',
                }),
            ]));
        } finally {
            database.close();
        }
    });

    test('redacts Pi preflight diagnostics before persisting failed requests', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const runtimeEvents: ResearchStreamEvent[] = [];
            const handlers = createResearchHandlers({
                dataServices: createDataServices({
                    database,
                    repositories,
                    secretStore: new MemorySecretStore(),
                }),
                piRuntime: {
                    ensureReady: async () => undefined,
                    getStatus: async () => createPiStatus({
                        lastError: 'Authorization: Bearer runtime-secret-token',
                        state: 'error',
                    }),
                    sendMessage: vi.fn(async () => {
                        throw new Error('Pi sendMessage should not run when preflight degrades.');
                    }),
                    subscribe: () => () => undefined,
                },
                researchRuntimeMode: 'pi',
            });

            handlers.subscribe((event) => {
                runtimeEvents.push(event);
            });

            const request = await handlers.startResearch({ query: '研究恒生科技' });
            await flushQueuedResearch();
            const completedRequest = handlers.getResearchRequest(request.id);
            const requestFailed = runtimeEvents.find((event): event is Extract<ResearchStreamEvent, { type: 'request_failed' }> => event.type === 'request_failed');

            expect(requestFailed?.error).toContain('Authorization: [redacted]');
            expect(requestFailed?.error).not.toContain('runtime-secret-token');
            expect(completedRequest?.error).toContain('Authorization: [redacted]');
            expect(completedRequest?.error).not.toContain('runtime-secret-token');
        } finally {
            database.close();
        }
    });
});