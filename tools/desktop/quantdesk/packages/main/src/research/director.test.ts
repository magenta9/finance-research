import Database from 'better-sqlite3';
import { describe, expect, test, vi } from 'vitest';

import type { ResearcherOutput } from '@quantdesk/shared';

import { runMigrations } from '../db/database';
import { createRepositories } from '../db/repositories';
import { ResearchDirector } from './director';
import type { ResearchExecutorInput } from './executor';

const flushQueuedResearch = async () => {
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
};

const waitForRequestStatus = async (
    repositories: ReturnType<typeof createRepositories>,
    requestId: string,
    status: 'cancelled' | 'completed' | 'failed',
) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await flushQueuedResearch();
        const request = repositories.researchArtifactRepository.getRequestById(requestId);

        if (request?.status === status) {
            return request;
        }
    }

    throw new Error(`Timed out waiting for research request ${requestId} to become ${status}.`);
};

const createResearcherOutput = (input: Pick<ResearcherOutput, 'requestId' | 'role'>): ResearcherOutput => ({
    actionRecommendation: 'observe',
    assumptions: ['测试执行器输出。'],
    confidence: 'medium',
    conclusion: '保持观察。',
    dataGaps: [],
    dataProvenance: [],
    direction: 'neutral',
    edgeStrength: 'none',
    edgeTypes: [],
    evidence: [],
    invalidationConditions: ['数据变化。'],
    needsSecondReview: false,
    payoffGrade: 'none',
    requestId: input.requestId,
    risks: ['缺少外部验证。'],
    role: input.role,
    timeHorizon: '1-3 months',
    winRateGrade: 'none',
});

describe('ResearchDirector', () => {
    test('cancels an in-flight queued research run', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const director = new ResearchDirector({
                executor: {
                    runResearcher: ({ signal }) => new Promise<never>((_resolve, reject) => {
                        signal?.addEventListener('abort', () => {
                            reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
                        }, { once: true });
                    }),
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '观察组合风险' });
            await flushQueuedResearch();

            expect(director.cancelResearch(request.id)).toEqual({ cancelled: true });
            await flushQueuedResearch();

            expect(repositories.researchArtifactRepository.getRequestById(request.id)?.status).toBe('cancelled');
        } finally {
            database.close();
        }
    });

    test('does not mark a request running after cancellation during executor preflight', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            let releasePreflight!: () => void;
            const preflight = new Promise<void>((resolve) => {
                releasePreflight = resolve;
            });
            let preflightStarted!: () => void;
            const preflightStartedPromise = new Promise<void>((resolve) => {
                preflightStarted = resolve;
            });
            const runResearcher = vi.fn(async ({ requestId, role }: { requestId: string; role: ResearcherOutput['role'] }) => createResearcherOutput({ requestId, role }));
            const director = new ResearchDirector({
                executorFactory: async () => {
                    preflightStarted();
                    await preflight;

                    return { runResearcher };
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '观察组合风险' });
            await preflightStartedPromise;

            expect(director.cancelResearch(request.id)).toEqual({ cancelled: true });
            releasePreflight();

            await waitForRequestStatus(repositories, request.id, 'cancelled');

            expect(repositories.researchArtifactRepository.getRequestById(request.id)?.status).toBe('cancelled');
            expect(runResearcher).not.toHaveBeenCalled();
        } finally {
            database.close();
        }
    });

    test('resolves missing local targets through market data before research runs', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const syncStatus = {
                activeTask: null,
                completedTasks: 1,
                failedTasks: 0,
                lastWarning: null,
                queuedTasks: 0,
                recentEvents: [],
                running: false,
            };
            const marketDataResolver = {
                ensure: vi.fn(async ({ assetId }: { assetId: string }) => {
                    repositories.priceRepository.insertMany([
                        {
                            adjustedClose: 4.2,
                            assetId,
                            close: 4.2,
                            date: '2026-04-28',
                            fetchedAt: '2026-04-28T00:00:00.000Z',
                            high: 4.3,
                            low: 4.1,
                            open: 4.15,
                            source: 'test',
                            volume: 1000,
                        },
                    ]);

                    return {
                        intent: 'asset-history',
                        priceSummary: {
                            fxPairs: [],
                            insertedRows: 1,
                            skippedAssetIds: [],
                            syncStatus,
                            synchronizedAssetIds: [assetId],
                            warnings: [],
                        },
                        syncStatus,
                        warnings: [],
                    };
                }),
                lookup: vi.fn(async ({ market }: { market?: string; query: string }) => (market === 'HK'
                    ? []
                    : [
                        {
                            assetClass: 'equity' as const,
                            currency: 'CNY' as const,
                            market: 'A' as const,
                            metadata: { underlyingMarket: 'HK' },
                            name: '恒生科技ETF',
                            source: 'test',
                            symbol: '513180',
                        },
                    ])),
            };
            const director = new ResearchDirector({
                marketDataResolver,
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '恒生科技' });
            const completed = await waitForRequestStatus(repositories, request.id, 'completed');

            expect(marketDataResolver.lookup).toHaveBeenNthCalledWith(1, { market: 'HK', query: '恒生科技' });
            expect(marketDataResolver.lookup).toHaveBeenNthCalledWith(2, { query: '恒生科技' });
            expect(marketDataResolver.ensure).toHaveBeenCalledWith(expect.objectContaining({ intent: 'asset-history', priority: 'interactive' }));
            expect(repositories.assetRepository.search('恒生科技')).toHaveLength(1);
            expect(completed.normalizedRequest?.assetScope).toBe('single_asset');
        } finally {
            database.close();
        }
    });

    test('runs multiple pi-backed researchers with isolated output artifacts', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'CNY',
                id: 'asset-hstech',
                market: 'A',
                metadata: {},
                name: '恒生科技ETF',
                symbol: '513180',
                tags: ['恒生科技'],
            });
            repositories.priceRepository.insertMany([
                {
                    adjustedClose: 0.62,
                    assetId: 'asset-hstech',
                    close: 0.62,
                    date: '2026-04-28',
                    fetchedAt: '2026-04-28T00:00:00.000Z',
                    high: 0.63,
                    low: 0.61,
                    open: 0.615,
                    source: 'akshare',
                    volume: 1000,
                },
            ]);
            const runResearcher = vi.fn(async ({ requestId, role }: { requestId: string; role: ResearcherOutput['role'] }) => createResearcherOutput({ requestId, role }));
            const director = new ResearchDirector({
                executor: {
                    runtimeMode: 'pi',
                    runResearcher,
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ assetIds: ['asset-hstech'], query: '研究一下恒生科技走势和风险，Authorization: Bearer secret-token apiKey=secret-key' });
            const completed = await waitForRequestStatus(repositories, request.id, 'completed');
            const artifacts = repositories.researchArtifactRepository.listArtifactsByRequest(request.id);
            const outputArtifacts = artifacts.filter((artifact) => artifact.artifactType === 'researcher_output');
            const promptSnapshots = artifacts.filter((artifact) => artifact.artifactType === 'prompt_snapshot');

            expect(completed.runtimeMode).toBe('pi');
            expect(completed.preflight).toEqual(expect.objectContaining({
                runtimeMode: 'pi',
                status: 'warn',
            }));
            expect(completed.preflight?.checks.map((check) => check.id)).toEqual([
                'runtime.researcher',
                'market_data.resolver',
                'data_sources.registry',
                'tools.allowlist',
            ]);
            expect(completed.route?.summonedResearchers.length).toBeGreaterThanOrEqual(2);
            expect(runResearcher.mock.calls.map(([input]) => input.role)).toEqual(completed.route?.summonedResearchers);
            expect(outputArtifacts.map((artifact) => artifact.role).sort()).toEqual([...(completed.route?.summonedResearchers ?? [])].sort());
            expect(promptSnapshots.map((artifact) => artifact.role).sort()).toEqual([...(completed.route?.summonedResearchers ?? [])].sort());
            expect(JSON.stringify(promptSnapshots)).not.toContain('secret-key');
            expect(JSON.stringify(promptSnapshots)).not.toContain('secret-token');
            expect(JSON.stringify(promptSnapshots)).toContain('[redacted]');
        } finally {
            database.close();
        }
    });

    test('converts researcher timeout into role-level failure without hanging request completion', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'CNY',
                id: 'asset-hstech',
                market: 'A',
                metadata: {},
                name: '恒生科技ETF',
                symbol: '513180',
                tags: ['恒生科技'],
            });
            repositories.priceRepository.insertMany([
                {
                    adjustedClose: 0.62,
                    assetId: 'asset-hstech',
                    close: 0.62,
                    date: '2026-04-28',
                    fetchedAt: '2026-04-28T00:00:00.000Z',
                    high: 0.63,
                    low: 0.61,
                    open: 0.615,
                    source: 'akshare',
                    volume: 1000,
                },
            ]);
            const director = new ResearchDirector({
                executor: {
                    runtimeMode: 'pi',
                    runResearcher: ({ signal }) => new Promise<ResearcherOutput>((_resolve, reject) => {
                        if (signal?.aborted) {
                            reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
                            return;
                        }

                        signal?.addEventListener('abort', () => {
                            reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
                        }, { once: true });
                    }),
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                researcherTimeoutMs: 1,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ assetIds: ['asset-hstech'], query: '研究一下恒生科技走势和风险' });
            await new Promise((resolve) => setTimeout(resolve, 10));
            const completed = await waitForRequestStatus(repositories, request.id, 'completed');
            const artifacts = repositories.researchArtifactRepository.listArtifactsByRequest(request.id);
            const failures = artifacts.filter((artifact) => artifact.artifactType === 'researcher_failure');

            expect(completed.runtimeMode).toBe('pi');
            expect(failures.length).toBeGreaterThan(0);
            expect(failures[0]?.payload.error).toContain('timed out after 1ms');
            expect(completed.decisionCard?.dataGaps.some((gap) => gap.includes('researcher failed'))).toBe(true);
        } finally {
            database.close();
        }
    });

    test('cancels the whole research request when total timeout expires', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'CNY',
                id: 'asset-hstech',
                market: 'A',
                metadata: {},
                name: '恒生科技ETF',
                symbol: '513180',
                tags: ['恒生科技'],
            });
            repositories.priceRepository.insertMany([
                {
                    adjustedClose: 0.62,
                    assetId: 'asset-hstech',
                    close: 0.62,
                    date: '2026-04-28',
                    fetchedAt: '2026-04-28T00:00:00.000Z',
                    high: 0.63,
                    low: 0.61,
                    open: 0.615,
                    source: 'akshare',
                    volume: 1000,
                },
            ]);
            const director = new ResearchDirector({
                executor: {
                    runtimeMode: 'pi',
                    runResearcher: ({ signal }) => new Promise<ResearcherOutput>((_resolve, reject) => {
                        signal?.addEventListener('abort', () => {
                            reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
                        }, { once: true });
                    }),
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
                totalTimeoutMs: 1,
            });

            const request = await director.startResearch({ assetIds: ['asset-hstech'], query: '研究一下恒生科技走势和风险' });
            await new Promise((resolve) => setTimeout(resolve, 10));
            const cancelled = await waitForRequestStatus(repositories, request.id, 'cancelled');

            expect(cancelled.completedAt).toBeTruthy();
            expect(cancelled.status).toBe('cancelled');
        } finally {
            database.close();
        }
    });

    test('blocks unresolved targeted research instead of falling back to all assets', async () => {
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
                tags: [],
            });
            const director = new ResearchDirector({
                marketDataResolver: {
                    ensure: vi.fn(),
                    lookup: vi.fn(async () => []),
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '恒生科技' });
            const completed = await waitForRequestStatus(repositories, request.id, 'completed');
            const contextArtifact = repositories.researchArtifactRepository.listArtifactsByRequest(request.id)
                .find((artifact) => artifact.artifactType === 'context_snapshot');

            expect(completed.decisionCard?.actionLevel).toBe('observe');
            expect(completed.decisionCard?.dataGaps).toContain('Requested asset was not found: 恒生科技');
            expect(contextArtifact?.payload).toEqual(expect.objectContaining({ assets: [] }));
        } finally {
            database.close();
        }
    });

    test('persists resolved runtime mode when target resolution fails after executor selection', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const runResearcher = vi.fn(async (input: ResearchExecutorInput) => createResearcherOutput({ requestId: input.requestId, role: input.role }));
            const director = new ResearchDirector({
                executor: {
                    runResearcher,
                    runtimeMode: 'pi',
                },
                marketDataResolver: {
                    ensure: vi.fn(),
                    lookup: vi.fn(async () => {
                        throw new Error('lookup failed');
                    }),
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '纳斯达克' });
            const failed = await waitForRequestStatus(repositories, request.id, 'failed');

            expect(runResearcher).not.toHaveBeenCalled();
            expect(failed.runtimeMode).toBe('pi');
            expect(failed.error).toBe('lookup failed');
        } finally {
            database.close();
        }
    });

    test('persists only a redacted risk profile audit snapshot in context artifacts', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const director = new ResearchDirector({
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => ({
                        baseCurrency: 'CNY',
                        maxDrawdown: 0.137,
                        maxSingleWeight: 0.083,
                        riskTolerance: 'medium',
                        singlePositionLossBudget: 0.019,
                        updatedAt: '2026-04-28T00:00:00.000Z',
                    }),
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '观察组合风险' });
            await waitForRequestStatus(repositories, request.id, 'completed');
            const contextArtifact = repositories.researchArtifactRepository.listArtifactsByRequest(request.id)
                .find((artifact) => artifact.artifactType === 'context_snapshot');

            if (!contextArtifact || contextArtifact.artifactType !== 'context_snapshot') {
                throw new Error('Expected a context_snapshot artifact.');
            }

            expect(contextArtifact.payload.riskProfile).toEqual({
                baseCurrency: 'CNY',
                hasPositionSizingRules: true,
                riskTolerance: 'medium',
                updatedAt: '2026-04-28T00:00:00.000Z',
            });
            expect(JSON.stringify(contextArtifact.payload)).not.toContain('0.137');
            expect(JSON.stringify(contextArtifact.payload)).not.toContain('0.083');
            expect(JSON.stringify(contextArtifact.payload)).not.toContain('0.019');
        } finally {
            database.close();
        }
    });

    test('persists runtime tool executions as research artifacts', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const director = new ResearchDirector({
                executor: {
                    runtimeMode: 'pi',
                    runResearcher: async ({ onRuntimeEvent, requestId, role }) => {
                        onRuntimeEvent?.({
                            args: { apiKey: 'secret-key', symbol: '513180' },
                            requestId,
                            role,
                            runId: 'run-1',
                            sessionId: 'session-1',
                            timestamp: '2026-04-28T00:00:00.000Z',
                            toolCallId: 'tool-1',
                            toolName: 'get_asset_snapshot',
                            type: 'research_tool_started',
                        });
                        onRuntimeEvent?.({
                            args: { apiKey: 'secret-key', symbol: '513180' },
                            partialResult: { phase: 'fetching' },
                            requestId,
                            role,
                            runId: 'run-1',
                            sessionId: 'session-1',
                            timestamp: '2026-04-28T00:00:01.000Z',
                            toolCallId: 'tool-1',
                            toolName: 'get_asset_snapshot',
                            type: 'research_tool_updated',
                        });
                        onRuntimeEvent?.({
                            args: { apiKey: 'secret-key', symbol: '513180' },
                            result: {
                                content: [{ text: '恒生科技快照', type: 'text' }],
                                details: {
                                    audit: { generatedAt: '2026-04-28T00:00:02.000Z', toolName: 'get_asset_snapshot' },
                                    citations: ['[asset:513180]', '[price-cache:local]'],
                                    dataProvenance: [{
                                        analysisWindow: { endDate: 'secret=end-date', startDate: '2026-04-01' },
                                        fetchedAt: 'Authorization: Bearer fetched-secret',
                                        qualityStatus: 'pass',
                                        rowsUsed: 7,
                                        sourceId: 'explicit-source',
                                        warnings: ['token=warning-secret'],
                                    }],
                                    jsonSecret: '{"token":"secret-json-token"}',
                                    note: 'Authorization: Bearer secret-token',
                                    ok: true,
                                    payload: { recentPrices: [{ date: '2026-04-28' }] },
                                    summary: '恒生科技快照',
                                    token: 'secret-token',
                                    xApiHeader: 'x-api-key: plain-secret-key',
                                },
                            },
                            requestId,
                            role,
                            runId: 'run-1',
                            sessionId: 'session-1',
                            timestamp: '2026-04-28T00:00:02.000Z',
                            toolCallId: 'tool-1',
                            toolName: 'get_asset_snapshot',
                            type: 'research_tool_completed',
                        });

                        return createResearcherOutput({ requestId, role });
                    },
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '观察组合风险' });
            const completed = await waitForRequestStatus(repositories, request.id, 'completed');
            const toolArtifact = repositories.researchArtifactRepository.listArtifactsByRequest(request.id)
                .find((artifact) => artifact.artifactType === 'tool_execution');

            if (!toolArtifact || toolArtifact.artifactType !== 'tool_execution') {
                throw new Error('Expected a tool_execution artifact.');
            }

            expect(toolArtifact.role).toBe(toolArtifact.payload.role);
            expect(toolArtifact.payload).toEqual(expect.objectContaining({
                args: { apiKey: '[redacted]', symbol: '513180' },
                completedAt: '2026-04-28T00:00:02.000Z',
                partialResults: [{ phase: 'fetching' }],
                result: {
                    content: [{ text: '恒生科技快照', type: 'text' }],
                    details: {
                        audit: { generatedAt: '2026-04-28T00:00:02.000Z', toolName: 'get_asset_snapshot' },
                        citations: ['[asset:513180]', '[price-cache:local]'],
                        dataProvenance: [{
                            analysisWindow: '[truncated:depth]',
                            fetchedAt: 'Authorization: [redacted]',
                            qualityStatus: 'pass',
                            rowsUsed: 7,
                            sourceId: 'explicit-source',
                            warnings: '[truncated:depth]',
                        }],
                        jsonSecret: '[redacted]',
                        note: 'Authorization: [redacted]',
                        ok: true,
                        payload: { recentPrices: ['[truncated:depth]'] },
                        summary: '恒生科技快照',
                        token: '[redacted]',
                        xApiHeader: 'x-api-key: [redacted]',
                    },
                },
                runId: 'run-1',
                sessionId: 'session-1',
                startedAt: '2026-04-28T00:00:00.000Z',
                toolCallId: 'tool-1',
                toolName: 'get_asset_snapshot',
            }));
            expect(toolArtifact.dataProvenance).toEqual([
                expect.objectContaining({
                    analysisWindow: { endDate: null, startDate: '2026-04-01' },
                    fetchedAt: null,
                    rowsUsed: 7,
                    sourceId: 'explicit-source',
                    warnings: ['token=[redacted]'],
                }),
                expect.objectContaining({ fetchedAt: '2026-04-28T00:00:02.000Z', rowsUsed: 1, sourceId: 'asset:513180' }),
                expect.objectContaining({ fetchedAt: '2026-04-28T00:00:02.000Z', rowsUsed: 1, sourceId: 'price-cache:local' }),
            ]);
            expect(completed.report?.sections).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    body: expect.stringContaining('risk/get_asset_snapshot completed'),
                    title: '工具证据',
                }),
            ]));
            expect(completed.report?.sections).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    body: expect.stringContaining('sources=explicit-source|asset:513180|price-cache:local'),
                    title: '工具证据',
                }),
            ]));
        } finally {
            database.close();
        }
    });

    test('persists role-level researcher failures and completes with a downgrade gate', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const director = new ResearchDirector({
                executor: {
                    runtimeMode: 'pi',
                    runResearcher: async ({ requestId, role }) => {
                        if (role === 'macro') {
                            throw new Error('macro model timed out Authorization: Bearer secret-token api_key=secret-key');
                        }

                        return createResearcherOutput({ requestId, role });
                    },
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '宏观观察' });
            const completed = await waitForRequestStatus(repositories, request.id, 'completed');
            const artifacts = repositories.researchArtifactRepository.listArtifactsByRequest(request.id);
            const failureArtifact = artifacts.find((artifact) => artifact.artifactType === 'researcher_failure');
            const failureGate = artifacts.find((artifact) => artifact.artifactType === 'review_gate'
                && artifact.payload.reasons.some((reason) => reason.includes('macro researcher failed')));

            expect(completed.status).toBe('completed');
            expect(failureArtifact).toEqual(expect.objectContaining({
                artifactType: 'researcher_failure',
                payload: expect.objectContaining({
                    error: 'macro model timed out Authorization: [redacted]',
                }),
                role: 'macro',
            }));
            expect(failureGate).toEqual(expect.objectContaining({
                artifactType: 'review_gate',
                payload: expect.objectContaining({ status: 'warn' }),
            }));
            expect(completed.report?.dataGaps).toContain('macro researcher failed: macro model timed out Authorization: [redacted]');
        } finally {
            database.close();
        }
    });

    test('creates a provider availability gate for data-source skipped researchers', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'CNY',
                id: 'asset-hstech',
                market: 'A',
                metadata: {},
                name: '恒生科技ETF',
                symbol: '513180',
                tags: [],
            });
            repositories.priceRepository.insertMany([
                {
                    adjustedClose: 0.62,
                    assetId: 'asset-hstech',
                    close: 0.62,
                    date: '2026-04-28',
                    fetchedAt: '2026-04-28T00:00:00.000Z',
                    high: 0.63,
                    low: 0.61,
                    open: 0.615,
                    source: 'test',
                    volume: 1000,
                },
            ]);
            const director = new ResearchDirector({
                executor: {
                    runResearcher: async ({ requestId, role }) => createResearcherOutput({ requestId, role }),
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ assetIds: ['asset-hstech'], query: '研究一下单股恒生科技基本面' });
            const completed = await waitForRequestStatus(repositories, request.id, 'completed');
            const providerGate = repositories.researchArtifactRepository.listArtifactsByRequest(request.id)
                .find((artifact) => artifact.artifactType === 'review_gate'
                    && artifact.payload.reasonCodes.includes('provider_degraded'));

            expect(completed.route?.summonedResearchers).toContain('fundamental');
            expect(providerGate).toEqual(expect.objectContaining({
                artifactType: 'review_gate',
                payload: expect.objectContaining({
                    status: 'warn',
                }),
            }));
            expect(completed.report?.remediationItems).toEqual(expect.arrayContaining([
                expect.objectContaining({ reasonCode: 'provider_degraded', sourceId: 'provider.fundamentals' }),
            ]));
        } finally {
            database.close();
        }
    });

    test('creates a second-review gate when researcher output requests review', async () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const director = new ResearchDirector({
                executor: {
                    runtimeMode: 'pi',
                    runResearcher: async ({ requestId, role }) => ({
                        ...createResearcherOutput({ requestId, role }),
                        needsSecondReview: role === 'macro',
                    }),
                },
                repositories,
                repository: repositories.researchArtifactRepository,
                riskProfileService: {
                    get: () => null,
                    save: (profile) => profile,
                },
            });

            const request = await director.startResearch({ query: '宏观观察' });
            await waitForRequestStatus(repositories, request.id, 'completed');
            const secondReviewGate = repositories.researchArtifactRepository.listArtifactsByRequest(request.id)
                .find((artifact) => artifact.artifactType === 'review_gate'
                    && artifact.role === 'devil_advocate'
                    && artifact.payload.reasons.some((reason) => reason === 'macro researcher requested second review.'));

            expect(secondReviewGate).toEqual(expect.objectContaining({
                artifactType: 'review_gate',
                payload: expect.objectContaining({
                    requiredDowngrades: ['Keep action at prepare or below until second review is cleared.'],
                    status: 'warn',
                }),
            }));
        } finally {
            database.close();
        }
    });
});