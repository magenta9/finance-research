import { describe, expect, test, vi } from 'vitest';

import type { ResearcherOutput, ResearchStreamEvent, StoredAsset } from '@quantdesk/shared';

import type { PiSendMessageInput, PiSendMessageResult, PiStreamEvent, PiWrapperSessionTranscript } from '../pi/types';
import { createPiResearchExecutor, parsePiResearcherOutput, UnauthorizedResearchToolError, type PiResearchRuntime } from './pi-executor';
import type { ResearchContextSnapshot } from './context-snapshot';

const asset: StoredAsset = {
    assetClass: 'equity',
    createdAt: '2026-04-28T00:00:00.000Z',
    currency: 'CNY',
    id: 'asset-hstech',
    market: 'A',
    metadata: {},
    name: '恒生科技ETF',
    symbol: '513180',
    tags: [],
    updatedAt: '2026-04-28T00:00:00.000Z',
};

const output: ResearcherOutput = {
    actionRecommendation: 'prepare',
    assumptions: ['Pi tools returned local evidence only.'],
    confidence: 'medium',
    conclusion: 'Trend evidence is constructive but still requires a trigger.',
    dataGaps: [],
    dataProvenance: [{
        fetchedAt: '2026-04-28T00:00:00.000Z',
        qualityStatus: 'pass',
        sourceId: 'daily_prices:asset-hstech',
        warnings: [],
    }],
    direction: 'neutral',
    edgeStrength: 'medium',
    edgeTypes: ['win_rate'],
    evidence: [{ label: 'tool evidence', provenance: [], summary: 'Local price cache was checked.' }],
    invalidationConditions: ['Breaks local support.'],
    needsSecondReview: false,
    payoffGrade: 'medium',
    requestId: 'request-1',
    risks: ['Model output requires review.'],
    role: 'trend',
    timeHorizon: 'days_to_weeks',
    winRateGrade: 'medium',
};

const transcriptWithContent = (content: string): PiWrapperSessionTranscript => ({
    cwd: '/tmp/quantdesk-pi',
    messages: [{ content, id: 'message-1', role: 'assistant' }],
    model: { modelId: 'test-model', provider: 'test-provider' },
    path: '/tmp/quantdesk-pi/session.json',
    sessionId: 'session-1',
    thinkingLevel: 'off',
});

const flushImmediate = async () => {
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
};

const context: ResearchContextSnapshot = {
    assets: [asset],
    dataSources: [{
        id: 'local.daily_prices',
        kind: 'local',
        label: 'Daily price history',
        providerIds: ['daily_prices'],
        qualityStatus: 'pass',
        roleAffinity: ['trend'],
        status: 'available',
        toolNames: ['get_asset_snapshot'],
        warnings: [],
    }],
    generatedAt: '2026-04-28T00:00:00.000Z',
    latestAllocationPlan: null,
    missingAssetIds: [],
    portfolioName: 'default',
    positions: [],
    priceCoverage: [],
    priceSignals: [{
        assetId: asset.id,
        latestClose: 0.6275,
        latestDate: '2026-04-27',
        returnOneMonth: 0.05,
        returnOneYear: -0.12,
        returnThreeMonths: -0.08,
        source: 'akshare-nav',
        symbol: asset.symbol,
    }],
    provenance: [],
    riskProfile: null,
};

class FakePiRuntime implements PiResearchRuntime {
    inputs: PiSendMessageInput[] = [];

    lastInput: PiSendMessageInput | null = null;

    cancelRun = vi.fn(async () => ({ cancelled: true }));

    ensureReady = vi.fn(async () => undefined);

    private runIndex = 0;

    private readonly completion: (run: PiSendMessageResult, input: PiSendMessageInput) => PiStreamEvent | PiStreamEvent[];

    private readonly listeners = new Set<(event: PiStreamEvent) => void>();

    constructor(completion: (run: PiSendMessageResult) => PiStreamEvent | PiStreamEvent[]) {
        this.completion = completion;
    }

    async sendMessage(input: PiSendMessageInput): Promise<PiSendMessageResult> {
        this.inputs.push(input);
        this.lastInput = input;
        this.runIndex += 1;
        const run = { runId: `run-${this.runIndex}`, sessionId: `session-${this.runIndex}` };

        setImmediate(() => {
            const events = this.completion(run, input);
            for (const event of Array.isArray(events) ? events : [events]) {
                for (const listener of this.listeners) {
                    listener(event);
                }
            }
        });

        return run;
    }

    subscribe(listener: (event: PiStreamEvent) => void) {
        this.listeners.add(listener);

        return () => {
            this.listeners.delete(listener);
        };
    }
}

describe('createPiResearchExecutor', () => {
    test('parses fenced JSON from a completed Pi transcript', () => {
        const parsed = parsePiResearcherOutput(
            transcriptWithContent(`Here is the result:\n\n\`\`\`json\n${JSON.stringify({ ...output, requestId: 'wrong', role: 'risk' })}\n\`\`\``),
            'request-1',
            'trend',
        );

        expect(parsed.requestId).toBe('request-1');
        expect(parsed.role).toBe('trend');
        expect(parsed.conclusion).toBe(output.conclusion);
    });

    test('runs a researcher through Pi runtime and returns structured output', async () => {
        const runtime = new FakePiRuntime((run) => ({
            runId: run.runId,
            sessionId: run.sessionId,
            timestamp: '2026-04-28T00:00:00.000Z',
            transcript: transcriptWithContent(JSON.stringify(output)),
            type: 'run_completed',
        }));
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 1_000 });
        const result = await executor.runResearcher({
            context,
            prompt: { allowedToolNames: ['get_asset_snapshot'], manifest: [], policyTags: [], prompt: 'Research prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
        });

        expect(result).toEqual(expect.objectContaining({
            actionRecommendation: output.actionRecommendation,
            conclusion: output.conclusion,
            confidence: output.confidence,
            requestId: output.requestId,
            role: output.role,
        }));
        expect(result.dataProvenance).toEqual([
            expect.objectContaining({ sourceId: 'daily_prices:asset-hstech', qualityStatus: 'pass' }),
        ]);
        expect(runtime.lastInput?.allowedToolNames).toEqual(['get_asset_snapshot']);
        expect(runtime.lastInput?.startNewSession).toBe(true);
        expect(runtime.lastInput?.message).toContain('Use the available QuantDesk finance tools');
        expect(runtime.lastInput?.message).toContain('Research role: trend');
    });

    test('starts a new Pi session for each researcher invocation', async () => {
        const runtime = new FakePiRuntime((run) => ({
            runId: run.runId,
            sessionId: run.sessionId,
            timestamp: '2026-04-28T00:00:00.000Z',
            transcript: transcriptWithContent(JSON.stringify(output)),
            type: 'run_completed',
        }));
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 1_000 });

        await executor.runResearcher({
            context,
            prompt: { allowedToolNames: ['get_asset_snapshot'], manifest: [], policyTags: [], prompt: 'Trend prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
        });
        await executor.runResearcher({
            context,
            prompt: { allowedToolNames: ['explain_risk'], manifest: [], policyTags: [], prompt: 'Risk prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'risk',
        });

        expect(runtime.inputs).toHaveLength(2);
        expect(runtime.inputs.map((input) => input.startNewSession)).toEqual([true, true]);
        expect(runtime.inputs[0].message).toContain('Research role: trend');
        expect(runtime.inputs[1].message).toContain('Research role: risk');
        expect(runtime.inputs[0].allowedToolNames).toEqual(['get_asset_snapshot']);
        expect(runtime.inputs[1].allowedToolNames).toEqual(['explain_risk']);
    });

    test('cancels the active Pi run when the research signal aborts', async () => {
        const runtime = new FakePiRuntime(() => []);
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 10_000 });
        const abortController = new AbortController();
        const promise = executor.runResearcher({
            context,
            prompt: { allowedToolNames: ['get_asset_snapshot'], manifest: [], policyTags: [], prompt: 'Research prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
            signal: abortController.signal,
        });

        await flushImmediate();
        abortController.abort(new Error('stop research'));

        await expect(promise).rejects.toThrow('stop research');
        expect(runtime.cancelRun).toHaveBeenCalledWith('run-1', 'session-1');
    });

    test('cancels a Pi run that resolves after the research signal already aborted', async () => {
        let resolveSend!: (run: PiSendMessageResult) => void;
        const sendMessage = vi.fn(async () => await new Promise<PiSendMessageResult>((resolve) => {
            resolveSend = resolve;
        }));
        const cancelRun = vi.fn(async () => ({ cancelled: true }));
        const runtime: PiResearchRuntime = {
            cancelRun,
            ensureReady: async () => undefined,
            sendMessage,
            subscribe: () => () => undefined,
        };
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 10_000 });
        const abortController = new AbortController();
        const promise = executor.runResearcher({
            context,
            prompt: { allowedToolNames: ['get_asset_snapshot'], manifest: [], policyTags: [], prompt: 'Research prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
            signal: abortController.signal,
        });

        await flushImmediate();
        abortController.abort(new Error('stop before run id'));
        await expect(promise).rejects.toThrow('stop before run id');

        resolveSend({ runId: 'late-run', sessionId: 'late-session' });
        await flushImmediate();

        expect(cancelRun).toHaveBeenCalledWith('late-run', 'late-session');
    });

    test('rejects failed Pi runs', async () => {
        const runtime = new FakePiRuntime((run) => ({
            error: 'model unavailable',
            runId: run.runId,
            sessionId: run.sessionId,
            timestamp: '2026-04-28T00:00:00.000Z',
            type: 'run_failed',
        }));
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 1_000 });

        await expect(executor.runResearcher({
            context,
            prompt: { allowedToolNames: [], manifest: [], policyTags: [], prompt: 'Research prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
        })).rejects.toThrow('model unavailable');
    });

    test('forwards Pi tool execution events as research runtime events', async () => {
        const runtime = new FakePiRuntime((run) => [
            {
                args: { symbol: '513180' },
                runId: run.runId,
                sessionId: run.sessionId,
                timestamp: '2026-04-28T00:00:00.000Z',
                toolCallId: 'tool-1',
                toolName: 'get_asset_snapshot',
                type: 'tool_execution_start',
            },
            {
                args: { symbol: '513180' },
                result: { summary: 'ok' },
                runId: run.runId,
                sessionId: run.sessionId,
                timestamp: '2026-04-28T00:00:01.000Z',
                toolCallId: 'tool-1',
                toolName: 'get_asset_snapshot',
                type: 'tool_execution_end',
            },
            {
                runId: run.runId,
                sessionId: run.sessionId,
                timestamp: '2026-04-28T00:00:02.000Z',
                transcript: transcriptWithContent(JSON.stringify(output)),
                type: 'run_completed',
            },
        ]);
        const events: ResearchStreamEvent[] = [];
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 1_000 });

        await executor.runResearcher({
            context,
            onRuntimeEvent: (event) => {
                events.push(event);
            },
            prompt: { allowedToolNames: ['get_asset_snapshot'], manifest: [], policyTags: [], prompt: 'Research prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
        });

        expect(events).toEqual([
            expect.objectContaining({ requestId: 'request-1', role: 'trend', toolName: 'get_asset_snapshot', type: 'research_tool_started' }),
            expect.objectContaining({ requestId: 'request-1', role: 'trend', toolName: 'get_asset_snapshot', type: 'research_tool_completed' }),
        ]);
    });

    test('waits for a terminal event after unauthorized tool execution before rejecting', async () => {
        let listener: ((event: PiStreamEvent) => void) | null = null;
        const cancelRun = vi.fn(async () => ({ cancelled: true }));
        const runtime: PiResearchRuntime = {
            cancelRun,
            ensureReady: async () => undefined,
            sendMessage: async () => ({ runId: 'run-1', sessionId: 'session-1' }),
            subscribe: (nextListener) => {
                listener = nextListener;

                return () => {
                    listener = null;
                };
            },
        };
        const emit = (event: PiStreamEvent) => {
            if (!listener) {
                throw new Error('Pi stream listener was not registered.');
            }

            listener(event);
        };
        const events: ResearchStreamEvent[] = [];
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 1_000, unauthorizedToolIdleWaitMs: 1_000 });
        const promise = executor.runResearcher({
            context,
            onRuntimeEvent: (event) => {
                events.push(event);
            },
            prompt: { allowedToolNames: ['get_asset_snapshot'], manifest: [], policyTags: [], prompt: 'Research prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
        });
        let settled = false;
        const observed = promise.then(
            () => {
                settled = true;
                throw new Error('Expected unauthorized tool rejection.');
            },
            (error: unknown) => {
                settled = true;
                return error;
            },
        );

        await flushImmediate();
        emit({
            args: {},
            runId: 'run-1',
            sessionId: 'session-1',
            timestamp: '2026-04-28T00:00:00.000Z',
            toolCallId: 'tool-1',
            toolName: 'run_allocation',
            type: 'tool_execution_start',
        });
        await flushImmediate();

        expect(cancelRun).toHaveBeenCalledWith('run-1', 'session-1');
        expect(settled).toBe(false);

        emit({
            args: { symbol: '513180' },
            runId: 'run-1',
            sessionId: 'session-1',
            timestamp: '2026-04-28T00:00:00.500Z',
            toolCallId: 'tool-2',
            toolName: 'get_asset_snapshot',
            type: 'tool_execution_start',
        });
        await flushImmediate();

        expect(events).toEqual([]);

        emit({
            runId: 'run-1',
            sessionId: 'session-1',
            timestamp: '2026-04-28T00:00:01.000Z',
            type: 'run_cancelled',
        });

        const error = await observed;

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(UnauthorizedResearchToolError);
        expect((error as Error).message).toContain('unauthorized tool');
        expect(error).toEqual(expect.objectContaining({
            allowedToolNames: ['get_asset_snapshot'],
            attemptedToolName: 'run_allocation',
            reasonCode: 'unauthorized_tool',
            role: 'trend',
            runId: 'run-1',
            sessionId: 'session-1',
        }));
    });

    test('rejects unauthorized tool execution events after bounded idle wait', async () => {
        const runtime = new FakePiRuntime((run) => ({
            args: {},
            runId: run.runId,
            sessionId: run.sessionId,
            timestamp: '2026-04-28T00:00:00.000Z',
            toolCallId: 'tool-1',
            toolName: 'run_allocation',
            type: 'tool_execution_start',
        }));
        const executor = createPiResearchExecutor({ piRuntime: runtime, timeoutMs: 1_000, unauthorizedToolIdleWaitMs: 10 });

        await expect(executor.runResearcher({
            context,
            prompt: { allowedToolNames: ['get_asset_snapshot'], manifest: [], policyTags: [], prompt: 'Research prompt.' },
            query: '研究恒生科技',
            requestId: 'request-1',
            role: 'trend',
        })).rejects.toThrow('unauthorized tool');
    });
});