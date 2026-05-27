import Database from 'better-sqlite3';
import { describe, expect, test, vi } from 'vitest';

import type { PiRuntimeStatus, ResearcherOutput, ResearchStreamEvent } from '@quantdesk/shared';
import type { PiSendMessageInput, PiSendMessageResult, PiStreamEvent } from '../pi/types';

import { runMigrations } from '../db/database';
import { createRepositories, type Repositories } from '../db/repositories';
import { createRiskProfileService } from './risk-profile-service';
import { PiNativeResearchRunner } from './pi-native-runner';

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
    lastCheckedAt: '2026-05-05T00:00:00.000Z',
    lastError: null,
    lastStartedAt: '2026-05-05T00:00:00.000Z',
    model: { available: true, availableModels: ['test-model'], model: 'test-model', provider: 'test-provider', source: 'runtime' },
    pid: 123,
    sessionCount: 0,
    state: 'ready',
    wrapperVersion: 'test',
    ...patch,
});

const createResearcherOutput = (requestId: string, role: ResearcherOutput['role']): ResearcherOutput => ({
    actionRecommendation: 'observe',
    assumptions: ['fixture'],
    confidence: 'medium',
    conclusion: `${role} completed with Pi native evidence.`,
    dataGaps: [],
    dataProvenance: [{ fetchedAt: '2026-05-05T00:00:00.000Z', qualityStatus: 'pass', sourceId: `pi.${role}`, warnings: [] }],
    direction: 'neutral',
    edgeStrength: 'weak',
    edgeTypes: ['information'],
    evidence: [{ label: 'tool evidence', provenance: [], summary: 'Verified by a mocked Pi tool.' }],
    invalidationConditions: ['new data'],
    needsSecondReview: false,
    payoffGrade: 'weak',
    requestId,
    risks: ['fixture risk'],
    role,
    timeHorizon: 'weeks_to_months',
    winRateGrade: 'weak',
});

const extractPiNativeMetadata = (input: PiSendMessageInput) => {
    const requestId = /Research request id: ([^\n]+)/.exec(input.message)?.[1]?.trim() ?? 'request-unknown';
    const role = (/Research role: ([^\n]+)/.exec(input.message)?.[1]?.trim() ?? 'trend') as ResearcherOutput['role'];

    return { requestId, role };
};

const waitForTerminalResearchEvent = (subscribe: (listener: (event: ResearchStreamEvent) => void) => () => void) => new Promise<Extract<ResearchStreamEvent, { type: 'request_completed' | 'request_failed' | 'request_cancelled' }>>((resolve, reject) => {
    const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for Pi native research terminal event.'));
    }, 2_000);
    const unsubscribe = subscribe((event) => {
        if (event.type === 'request_completed' || event.type === 'request_failed' || event.type === 'request_cancelled') {
            clearTimeout(timeout);
            unsubscribe();
            resolve(event);
        }
    });
});

const createRepositoriesWithAsset = () => {
    const database = new Database(':memory:');
    runMigrations(database);
    const repositories = createRepositories(database);
    const now = '2026-05-05T00:00:00.000Z';

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
        fetchedAt: now,
        high: 502,
        low: 498,
        open: 499,
        source: 'test',
        volume: 1000,
    }]);

    return { database, repositories };
};

const createRunner = (input: {
    listeners: Set<(event: PiStreamEvent) => void>;
    marketDataResolver?: ConstructorParameters<typeof PiNativeResearchRunner>[0]['marketDataResolver'];
    repositories: Repositories;
    sendMessage: (input: PiSendMessageInput) => Promise<PiSendMessageResult>;
    cancelRun?: (runId: string, sessionId: string) => Promise<{ cancelled: boolean }>;
}) => new PiNativeResearchRunner({
    piRuntime: {
        cancelRun: input.cancelRun,
        ensureReady: async () => undefined,
        getStatus: async () => createPiStatus(),
        sendMessage: input.sendMessage,
        subscribe: (listener) => {
            input.listeners.add(listener);

            return () => {
                input.listeners.delete(listener);
            };
        },
    },
    marketDataResolver: input.marketDataResolver,
    repositories: input.repositories,
    repository: input.repositories.researchArtifactRepository,
    riskProfileService: createRiskProfileService(input.repositories.preferencesRepository),
    roleTimeoutMs: 2_000,
    skillTextLoader: async () => '# Skill marker\nUse tools first.',
    totalTimeoutMs: 4_000,
});

describe('PiNativeResearchRunner', () => {
    test('runs multiple Pi role sessions and saves minimal artifacts', async () => {
        const { database, repositories } = createRepositoriesWithAsset();
        const listeners = new Set<(event: PiStreamEvent) => void>();
        const ensure = vi.fn(async () => undefined);
        let index = 0;
        const sendMessage = vi.fn(async (input: PiSendMessageInput): Promise<PiSendMessageResult> => {
            index += 1;
            const run = { runId: `run-${index}`, sessionId: `session-${index}` };
            const { requestId, role } = extractPiNativeMetadata(input);

            expect(input.message).toContain('# Skill marker');
            expect(input.allowedToolNames?.length).toBeGreaterThan(0);

            setImmediate(() => {
                for (const listener of listeners) {
                    const output = createResearcherOutput(requestId, role);

                    output.dataProvenance = [{ fetchedAt: '2026-05-05T00:00:00.000Z', providerIds: ['token=researcher-provider-secret'], qualityStatus: 'pass', sourceId: 'Bearer researcher-source-secret', warnings: ['x-api-key: researcher-warning-secret'] }];
                    listener({ args: { symbol: 'SPY' }, runId: run.runId, sessionId: run.sessionId, timestamp: '2026-05-05T00:00:00.000Z', toolCallId: `tool-${index}`, toolName: 'get_asset_snapshot', type: 'tool_execution_start' });
                    listener({ args: { symbol: 'SPY' }, isError: false, result: { dataProvenance: [{ fetchedAt: '2026-05-05T00:00:00.000Z', providerIds: ['token=provider-secret'], qualityStatus: 'pass', sourceId: 'Authorization: Bearer source-secret', warnings: ['cookie: warning-secret'] }], summary: 'snapshot' }, runId: run.runId, sessionId: run.sessionId, timestamp: '2026-05-05T00:00:01.000Z', toolCallId: `tool-${index}`, toolName: 'get_asset_snapshot', type: 'tool_execution_end' });
                    listener({
                        runId: run.runId,
                        sessionId: run.sessionId,
                        timestamp: '2026-05-05T00:00:02.000Z',
                        transcript: {
                            cwd: '/tmp/quantdesk-pi',
                            messages: [{ content: `Summary\n\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``, id: `message-${index}`, role: 'assistant' }],
                            model: { modelId: 'test-model', provider: 'test-provider' },
                            path: `/tmp/session-${index}.json`,
                            sessionId: run.sessionId,
                            thinkingLevel: 'off',
                        },
                        type: 'run_completed',
                    });
                }
            });

            return run;
        });
        const runner = createRunner({
            listeners,
            marketDataResolver: { ensure, lookup: vi.fn(async () => []) },
            repositories,
            sendMessage,
        });
        const terminalEvent = waitForTerminalResearchEvent(runner.subscribe.bind(runner));

        const request = await runner.startResearch({ query: '研究 SPY 单股' });
        const event = await terminalEvent;
        const completed = repositories.researchArtifactRepository.getRequestById(request.id);
        const artifacts = repositories.researchArtifactRepository.listArtifactsByRequest(request.id);

        expect(event.type).toBe('request_completed');
        expect(completed?.status).toBe('completed');
        expect(completed?.runtimeMode).toBe('pi-native');
        expect(sendMessage).toHaveBeenCalledTimes(4);
        expect(ensure).toHaveBeenCalledWith({ assetId: 'asset-spy', horizon: '30y', intent: 'asset-history', priority: 'interactive' });
        expect(artifacts.some((artifact) => artifact.artifactType === 'route')).toBe(true);
        expect(artifacts.some((artifact) => artifact.artifactType === 'context_snapshot')).toBe(true);
        expect(artifacts.some((artifact) => artifact.artifactType === 'decision_card')).toBe(true);
        expect(artifacts.filter((artifact) => artifact.artifactType === 'researcher_output')).toHaveLength(4);
        expect(artifacts.filter((artifact) => artifact.artifactType === 'tool_execution')).toHaveLength(4);
        expect(JSON.stringify(artifacts.filter((artifact) => artifact.artifactType === 'tool_execution').flatMap((artifact) => artifact.dataProvenance))).not.toMatch(/source-secret|provider-secret|warning-secret/);
        expect(JSON.stringify(artifacts.filter((artifact) => artifact.artifactType === 'researcher_output').flatMap((artifact) => artifact.dataProvenance))).not.toMatch(/researcher-source-secret|researcher-provider-secret|researcher-warning-secret/);
        expect(artifacts.filter((artifact) => artifact.artifactType === 'prompt_snapshot').every((artifact) => artifact.payload.nativeSessionId && artifact.payload.nativeRunId)).toBe(true);
        expect(completed?.report?.sections.some((section) => section.body.includes('session=session-1'))).toBe(true);

        database.close();
    });

    test('completes with partial role failures and marks all-failed requests failed', async () => {
        const { database, repositories } = createRepositoriesWithAsset();
        const listeners = new Set<(event: PiStreamEvent) => void>();
        let index = 0;
        const sendMessage = vi.fn(async (input: PiSendMessageInput): Promise<PiSendMessageResult> => {
            index += 1;
            const run = { runId: `run-${index}`, sessionId: `session-${index}` };
            const { requestId, role } = extractPiNativeMetadata(input);
            const content = role === 'risk' ? 'not json' : JSON.stringify(createResearcherOutput(requestId, role));

            setImmediate(() => {
                for (const listener of listeners) {
                    listener({
                        runId: run.runId,
                        sessionId: run.sessionId,
                        timestamp: '2026-05-05T00:00:00.000Z',
                        transcript: {
                            cwd: '/tmp/quantdesk-pi',
                            messages: [{ content, id: `message-${index}`, role: 'assistant' }],
                            model: null,
                            path: `/tmp/session-${index}.json`,
                            sessionId: run.sessionId,
                            thinkingLevel: 'off',
                        },
                        type: 'run_completed',
                    });
                }
            });

            return run;
        });
        const runner = createRunner({ listeners, repositories, sendMessage });
        const terminalEvent = waitForTerminalResearchEvent(runner.subscribe.bind(runner));
        const request = await runner.startResearch({ assetIds: ['asset-spy'], query: '研究 SPY 单股' });

        await expect(terminalEvent).resolves.toMatchObject({ type: 'request_completed' });
        expect(repositories.researchArtifactRepository.getRequestById(request.id)?.status).toBe('completed');
        expect(repositories.researchArtifactRepository.listArtifactsByRequest(request.id).filter((artifact) => artifact.artifactType === 'researcher_failure')).toHaveLength(1);

        database.close();
    });

    test('fails the request when every Pi native role fails', async () => {
        const { database, repositories } = createRepositoriesWithAsset();
        const listeners = new Set<(event: PiStreamEvent) => void>();
        let index = 0;
        const sendMessage = vi.fn(async (): Promise<PiSendMessageResult> => {
            index += 1;
            const run = { runId: `run-${index}`, sessionId: `session-${index}` };

            setImmediate(() => {
                for (const listener of listeners) {
                    listener({
                        runId: run.runId,
                        sessionId: run.sessionId,
                        timestamp: '2026-05-05T00:00:00.000Z',
                        transcript: {
                            cwd: '/tmp/quantdesk-pi',
                            messages: [{ content: 'not json', id: `message-${index}`, role: 'assistant' }],
                            model: null,
                            path: `/tmp/session-${index}.json`,
                            sessionId: run.sessionId,
                            thinkingLevel: 'off',
                        },
                        type: 'run_completed',
                    });
                }
            });

            return run;
        });
        const runner = createRunner({ listeners, repositories, sendMessage });
        const terminalEvent = waitForTerminalResearchEvent(runner.subscribe.bind(runner));
        const request = await runner.startResearch({ assetIds: ['asset-spy'], query: '研究 SPY 单股' });

        await expect(terminalEvent).resolves.toMatchObject({
            error: expect.stringContaining('All Agent research roles failed.'),
            type: 'request_failed',
        });
        await expect(terminalEvent).resolves.toMatchObject({
            error: expect.stringContaining('schema_invalid - Agent researcher response did not contain a JSON object.'),
            type: 'request_failed',
        });
        expect(repositories.researchArtifactRepository.getRequestById(request.id)?.status).toBe('failed');
        expect(repositories.researchArtifactRepository.listArtifactsByRequest(request.id).filter((artifact) => artifact.artifactType === 'researcher_failure')).toHaveLength(4);

        database.close();
    });

    test('keeps aborted Pi roles degraded when tool evidence was saved', async () => {
        const { database, repositories } = createRepositoriesWithAsset();
        const listeners = new Set<(event: PiStreamEvent) => void>();
        let index = 0;
        const sendMessage = vi.fn(async (): Promise<PiSendMessageResult> => {
            index += 1;
            const run = { runId: `run-aborted-${index}`, sessionId: `session-aborted-${index}` };

            setImmediate(() => {
                for (const listener of listeners) {
                    listener({ args: { symbol: 'SPY' }, runId: run.runId, sessionId: run.sessionId, timestamp: '2026-05-05T00:00:00.000Z', toolCallId: `tool-${index}`, toolName: 'get_asset_snapshot', type: 'tool_execution_start' });
                    listener({ args: { symbol: 'SPY' }, isError: false, result: { dataProvenance: [{ fetchedAt: '2026-05-05T00:00:00.000Z', qualityStatus: 'pass', sourceId: `pi.snapshot.${index}`, warnings: [] }] }, runId: run.runId, sessionId: run.sessionId, timestamp: '2026-05-05T00:00:01.000Z', toolCallId: `tool-${index}`, toolName: 'get_asset_snapshot', type: 'tool_execution_end' });
                    listener({ error: 'Request was aborted.', runId: run.runId, sessionId: run.sessionId, timestamp: '2026-05-05T00:00:02.000Z', type: 'run_failed' });
                }
            });

            return run;
        });
        const runner = createRunner({ listeners, repositories, sendMessage });
        const terminalEvent = waitForTerminalResearchEvent(runner.subscribe.bind(runner));
        const request = await runner.startResearch({ assetIds: ['asset-spy'], query: '研究 SPY 单股' });

        await expect(terminalEvent).resolves.toMatchObject({ type: 'request_completed' });
        const completed = repositories.researchArtifactRepository.getRequestById(request.id);
        const artifacts = repositories.researchArtifactRepository.listArtifactsByRequest(request.id);
        const outputs = artifacts.filter((artifact) => artifact.artifactType === 'researcher_output');

        expect(completed?.status).toBe('completed');
        expect(outputs).toHaveLength(4);
        expect(outputs.every((artifact) => artifact.payload.confidence === 'low' && artifact.payload.needsSecondReview)).toBe(true);
        expect(outputs.every((artifact) => artifact.payload.dataGaps.some((gap) => gap.includes('ended before returning assistant JSON')))).toBe(true);

        database.close();
    });

    test('fails directly when Pi runtime is unavailable', async () => {
        const { database, repositories } = createRepositoriesWithAsset();
        const runner = new PiNativeResearchRunner({
            repositories,
            repository: repositories.researchArtifactRepository,
            riskProfileService: createRiskProfileService(repositories.preferencesRepository),
            skillTextLoader: async () => '# unused',
        });
        const terminalEvent = waitForTerminalResearchEvent(runner.subscribe.bind(runner));
        const request = await runner.startResearch({ query: '研究恒生科技' });

        await expect(terminalEvent).resolves.toMatchObject({
            error: 'Agent runtime unavailable for native research: Agent runtime is unavailable.',
            type: 'request_failed',
        });
        expect(repositories.researchArtifactRepository.getRequestById(request.id)?.status).toBe('failed');
        expect(repositories.researchArtifactRepository.getRequestById(request.id)?.runtimeMode).toBe('pi-native');

        database.close();
    });

    test('cancels active Pi runs', async () => {
        const { database, repositories } = createRepositoriesWithAsset();
        const listeners = new Set<(event: PiStreamEvent) => void>();
        const cancelRun = vi.fn(async () => ({ cancelled: true }));
        const sendMessage = vi.fn(async (): Promise<PiSendMessageResult> => ({ runId: 'run-cancel', sessionId: 'session-cancel' }));
        const runner = createRunner({ cancelRun, listeners, repositories, sendMessage });
        const terminalEvent = waitForTerminalResearchEvent(runner.subscribe.bind(runner));
        const request = await runner.startResearch({ assetIds: ['asset-spy'], query: '研究 SPY 单股' });

        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
        expect(runner.cancelResearch(request.id)).toEqual({ cancelled: true });
        await expect(terminalEvent).resolves.toMatchObject({ type: 'request_cancelled' });
        expect(cancelRun).toHaveBeenCalledWith('run-cancel', 'session-cancel');
        expect(repositories.researchArtifactRepository.getRequestById(request.id)?.status).toBe('cancelled');

        database.close();
    });

    test('waits for unauthorized tool cancellation before starting the next role', async () => {
        const { database, repositories } = createRepositoriesWithAsset();
        const listeners = new Set<(event: PiStreamEvent) => void>();
        let releaseCancel: () => void = () => {
            throw new Error('cancelRun was not called.');
        };
        const cancelRun = vi.fn(async () => await new Promise<{ cancelled: boolean }>((resolve) => {
            releaseCancel = () => resolve({ cancelled: true });
        }));
        let index = 0;
        const sendMessage = vi.fn(async (input: PiSendMessageInput): Promise<PiSendMessageResult> => {
            index += 1;
            const run = { runId: `run-unauthorized-${index}`, sessionId: `session-unauthorized-${index}` };
            const { requestId, role } = extractPiNativeMetadata(input);

            setImmediate(() => {
                for (const listener of listeners) {
                    if (index === 1) {
                        listener({ args: {}, runId: run.runId, sessionId: run.sessionId, timestamp: '2026-05-05T00:00:00.000Z', toolCallId: 'unauthorized-tool', toolName: 'search_quantdesk_docs', type: 'tool_execution_start' });
                        continue;
                    }

                    listener({
                        runId: run.runId,
                        sessionId: run.sessionId,
                        timestamp: '2026-05-05T00:00:00.000Z',
                        transcript: {
                            cwd: '/tmp/quantdesk-pi',
                            messages: [{ content: JSON.stringify(createResearcherOutput(requestId, role)), id: `message-${index}`, role: 'assistant' }],
                            model: null,
                            path: `/tmp/session-${index}.json`,
                            sessionId: run.sessionId,
                            thinkingLevel: 'off',
                        },
                        type: 'run_completed',
                    });
                }
            });

            return run;
        });
        const runner = createRunner({ cancelRun, listeners, repositories, sendMessage });
        const terminalEvent = waitForTerminalResearchEvent(runner.subscribe.bind(runner));

        await runner.startResearch({ assetIds: ['asset-spy'], query: '研究 SPY 单股' });
        await vi.waitFor(() => expect(cancelRun).toHaveBeenCalledWith('run-unauthorized-1', 'session-unauthorized-1'));
        expect(sendMessage).toHaveBeenCalledTimes(1);
        releaseCancel();

        await expect(terminalEvent).resolves.toMatchObject({ type: 'request_completed' });
        expect(sendMessage).toHaveBeenCalledTimes(4);

        database.close();
    });
});
