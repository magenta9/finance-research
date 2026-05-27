import { describe, expect, test, vi } from 'vitest';

import { createEmptyAssistantContentProjection, reducePiItemEvents } from '@quantdesk/shared';

import { createPiSessionAdapter } from './session-adapter';
import type { PiRuntimeStatus, PiWrapperSessionTranscript, PiToolInvocation } from './types';

const sessionSummary = {
    cwd: '/tmp/workspace',
    firstMessage: '分析沪深 300 今天的波动',
    id: 'session-1',
    modifiedAt: '2026-04-21T10:00:00.000Z',
    name: '沪深 300 诊断',
    path: '/tmp/session-1.json',
} as const;

const transcript: PiWrapperSessionTranscript = {
    cwd: '/tmp/workspace',
    messages: [
        { content: '分析沪深 300 今天的波动', id: 'u1', role: 'user' },
        { content: '已经开始分析。', id: 'a1', role: 'assistant' },
    ],
    model: {
        modelId: 'qwen3-coder',
        provider: 'openrouter',
    },
    path: '/tmp/session-1.json',
    sessionId: 'session-1',
    thinkingLevel: 'balanced',
};

const runtimeStatus: PiRuntimeStatus = {
    currentSessionId: 'session-1',
    degraded: false,
    degradedReason: null,
    diagnostics: [],
    directories: {
        agentDir: '/tmp/config',
        sessionDir: '/tmp/sessions',
        toolInvocationDir: '/tmp/tools',
        workspaceDir: '/tmp/workspace',
    },
    financeTools: {
        available: true,
        lastError: null,
        names: ['market.scan'],
    },
    lastCheckedAt: '2026-04-21T10:00:00.000Z',
    lastError: null,
    lastStartedAt: '2026-04-21T09:59:00.000Z',
    model: {
        available: true,
        availableModels: ['qwen3-coder'],
        model: 'qwen3-coder',
        provider: 'openrouter',
        source: 'runtime',
    },
    pid: 123,
    sessionCount: 1,
    state: 'ready',
    wrapperVersion: '0.68.0',
};

const toolInvocation = {
    args: { symbol: '000300.SH' },
    error: null,
    finishedAt: '2026-04-21T10:01:00.000Z',
    result: { summary: '完成指数波动分析。' },
    runId: 'run-1',
    sessionId: 'session-1',
    startedAt: '2026-04-21T10:00:30.000Z',
    status: 'success',
    summary: '完成指数波动分析。',
    toolCallId: 'tool-1',
    toolName: 'market.scan',
} as const;

const runStatus = {
    currentTool: 'market.scan',
    degraded: false,
    degradedReason: null,
    lastError: null,
    runId: 'run-1',
    sessionId: 'session-1',
    state: 'running',
    updatedAt: '2026-04-21T10:00:40.000Z',
} as const;

const riskGateState = {
    acknowledged: false,
    acknowledgedAt: null,
    message: '发送前需要确认高权限风险。',
    required: true,
    riskLevel: 'high',
} as const;

describe('createPiSessionAdapter', () => {
    test('maps summaries and session records into shared pi shapes', async () => {
        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => runStatus),
            getSessionTranscript: vi.fn(async () => transcript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => [toolInvocation]),
        });

        await expect(adapter.listSessions()).resolves.toEqual([
            expect.objectContaining({
                id: 'session-1',
                lastToolName: 'market.scan',
                preview: '分析沪深 300 今天的波动',
                runState: 'running',
                title: '沪深 300 诊断',
            }),
        ]);

        await expect(adapter.getSession('session-1')).resolves.toEqual(expect.objectContaining({
            id: 'session-1',
            projection: expect.objectContaining({
                approvalBlock: expect.objectContaining({ status: 'requires_approval', toolName: 'high_privilege_risk' }),
            }),
            runStatus: expect.objectContaining({ runId: 'run-1', state: 'running' }),
            toolSteps: [expect.objectContaining({ toolName: 'market.scan' })],
            transcript: expect.objectContaining({
                messages: [
                    expect.objectContaining({ content: '分析沪深 300 今天的波动', role: 'user' }),
                    expect.objectContaining({ content: '已经开始分析。', role: 'assistant' }),
                ],
            }),
        }));
    });

    test('maps stream events into shared pi stream payloads', async () => {
        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => runStatus),
            getSessionTranscript: vi.fn(async () => transcript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => [toolInvocation]),
        });

        await expect(adapter.mapStreamEvent({
            runId: 'run-1',
            sessionId: 'session-1',
            timestamp: '2026-04-21T10:01:30.000Z',
            transcript,
            type: 'run_completed',
        })).resolves.toEqual(expect.objectContaining({
            itemEvents: [],
            status: expect.objectContaining({ runId: 'run-1', state: 'running' }),
            transcript: expect.objectContaining({ sessionId: 'session-1' }),
            type: 'run_completed',
        }));
    });

    test('preserves thinking and tool order inside a historical assistant turn', async () => {
        const orderedTranscript: PiWrapperSessionTranscript = {
            ...transcript,
            messages: [
                { content: '帮我调查一下今天的A股表现。', id: 'u1', role: 'user' },
                { content: '先看资产池里有没有 A 股相关标的。', id: 'a1', phase: 'thinking', role: 'assistant' },
                { content: 'tool finished', id: 'tool-result-1', role: 'toolResult', toolCallId: 'tool-1', toolName: 'get_asset_snapshot' },
                { content: '已经拿到首批 ETF 快照。', id: 'a2', phase: 'assistant', role: 'assistant' },
                { content: '接着判断行业和指数强弱。', id: 'a3', phase: 'thinking', role: 'assistant' },
                { content: 'tool finished', id: 'tool-result-2', role: 'toolResult', toolCallId: 'tool-2', toolName: 'macro_scan' },
                { content: '综合来看，今天开盘偏强。', id: 'a4', phase: 'assistant', role: 'assistant' },
            ],
        };

        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => null),
            getSessionTranscript: vi.fn(async () => orderedTranscript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => [
                {
                    ...toolInvocation,
                    summary: '拿到 ETF 快照。',
                    toolCallId: 'tool-1',
                    toolName: 'get_asset_snapshot',
                },
                {
                    ...toolInvocation,
                    result: { summary: '完成宏观扫描。' },
                    summary: '完成宏观扫描。',
                    toolCallId: 'tool-2',
                    toolName: 'macro_scan',
                },
            ]),
        });

        const sessionRecord = await adapter.getSession('session-1');
        expect(sessionRecord).not.toBeNull();

        if (!sessionRecord) {
            throw new Error('expected session record');
        }

        expect(sessionRecord.projection.timeline.map((item) => item.kind === 'message'
            ? `message:${item.role}`
            : item.kind === 'work_unit'
                ? `work_unit:${item.workUnit.kind}`
                : 'assistant_message')).toEqual([
                    'message:user',
                    'work_unit:reasoning',
                    'work_unit:tool_call',
                    'assistant_message',
                    'work_unit:reasoning',
                    'work_unit:tool_call',
                    'assistant_message',
                ]);
        expect(sessionRecord.projection.workUnits[0]).toEqual(expect.objectContaining({ content: '先看资产池里有没有 A 股相关标的。', kind: 'reasoning' }));
        expect(sessionRecord.projection.workUnits[1]).toEqual(expect.objectContaining({ toolName: 'get_asset_snapshot', kind: 'tool_call' }));
        expect(sessionRecord.projection.assistantMessages[0]?.blocks[0]).toEqual(expect.objectContaining({ content: '已经拿到首批 ETF 快照。', type: 'text' }));
        expect(sessionRecord.projection.workUnits[2]).toEqual(expect.objectContaining({ content: '接着判断行业和指数强弱。', kind: 'reasoning' }));
        expect(sessionRecord.projection.workUnits[3]).toEqual(expect.objectContaining({ toolName: 'macro_scan', kind: 'tool_call' }));
        expect(sessionRecord.projection.assistantMessages[1]?.blocks[0]).toEqual(expect.objectContaining({ content: '综合来看，今天开盘偏强。', type: 'text' }));
    });

    test('keeps the active processing block open across 1s snapshots while earlier response text collapses', async () => {
        vi.useFakeTimers();

        try {
            let currentTranscript: PiWrapperSessionTranscript = {
                ...transcript,
                messages: [
                    { content: '帮我调查一下今天的A股表现。', id: 'u1', role: 'user' },
                    { content: '先看资产池里有没有 A 股相关标的。', id: 'a1', phase: 'thinking', role: 'assistant' },
                    { content: '工具已经开始执行。', id: 'tool-result-1', role: 'toolResult', toolCallId: 'tool-1', toolName: 'get_asset_snapshot' },
                    { content: '工具已经开始执行。', id: 'r1', role: 'assistant' },
                ],
            };

            const runningToolInvocation: PiToolInvocation = {
                ...toolInvocation,
                finishedAt: null,
                result: undefined,
                status: 'running',
                summary: '正在扫描资产池。',
            };

            const adapter = createPiSessionAdapter({
                getRiskGateState: vi.fn(() => riskGateState),
                getSessionRunStatus: vi.fn(() => runStatus),
                getSessionTranscript: vi.fn(async () => currentTranscript),
                getStatus: vi.fn(async () => runtimeStatus),
                listSessions: vi.fn(async () => [sessionSummary]),
                listToolInvocations: vi.fn(async () => [runningToolInvocation]),
            });

            const snapshots = [
                {
                    expectedBlocks: [
                        { status: 'complete', type: 'thinking' },
                        { status: 'running', type: 'tool_call' },
                        { status: 'streaming', type: 'text' },
                    ],
                    messages: currentTranscript.messages,
                    now: '2026-04-21T10:00:00.000Z',
                },
                {
                    expectedBlocks: [
                        { status: 'complete', type: 'thinking' },
                        { status: 'running', type: 'tool_call' },
                        { status: 'complete', type: 'text' },
                        { status: 'streaming', type: 'thinking' },
                    ],
                    messages: [
                        ...currentTranscript.messages,
                        { content: '接着判断行业和指数强弱。', id: 'a2', phase: 'thinking' as const, role: 'assistant' },
                    ],
                    now: '2026-04-21T10:00:01.000Z',
                },
            ];

            for (const snapshot of snapshots) {
                vi.setSystemTime(new Date(snapshot.now));
                currentTranscript = {
                    ...currentTranscript,
                    messages: snapshot.messages,
                };

                const sessionRecord = await adapter.getSession('session-1');
                const timelineSlice = sessionRecord?.projection.timeline.slice(1) ?? [];

                expect(timelineSlice.map((item) => {
                    if (item.kind === 'work_unit') {
                        return { status: item.workUnit.status, type: item.workUnit.kind };
                    }

                    if (item.kind === 'assistant_message') {
                        return { status: item.assistantMessage.status, type: 'assistant_message' };
                    }

                    return { status: 'complete', type: 'message' };
                })).toEqual(snapshot.expectedBlocks.map((block) => (
                        block.type === 'text'
                            ? { status: block.status === 'streaming' ? 'streaming' : 'complete', type: 'assistant_message' }
                            : block.type === 'thinking'
                                ? { status: block.status, type: 'reasoning' }
                                : { status: block.status, type: 'tool_call' }
                    )));
                await vi.advanceTimersByTimeAsync(1000);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    test('emits a placeholder tool block on tool start so later text cannot overtake it', async () => {
        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => runStatus),
            getSessionTranscript: vi.fn(async () => transcript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => [toolInvocation]),
        });

        await expect(adapter.mapStreamEvent({
            args: { symbol: '510300.SH' },
            runId: 'run-1',
            sessionId: 'session-1',
            timestamp: '2026-04-21T10:00:30.000Z',
            toolCallId: 'tool-fast',
            toolName: 'get_asset_snapshot',
            type: 'tool_execution_start',
        })).resolves.toEqual(expect.objectContaining({
            itemEvents: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        itemId: 'tool:tool-fast',
                        kind: 'tool_call',
                        status: 'running',
                        toolName: 'get_asset_snapshot',
                    }),
                    event: 'item.started',
                }),
            ]),
            type: 'tool_execution_start',
        }));
    });

    test('keeps live thinking -> tool -> thinking -> final answer order identical after canonical projection replay', async () => {
        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => runStatus),
            getSessionTranscript: vi.fn(async () => transcript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => [toolInvocation]),
        });

        const events = [
            await adapter.mapStreamEvent({
                delta: '先收集 ETF 快照。',
                messageId: 'runtime-message-1',
                phase: 'thinking',
                runId: 'run-live-1',
                sessionId: 'session-1',
                timestamp: '2026-04-21T10:00:00.000Z',
                type: 'message_delta',
            }),
            await adapter.mapStreamEvent({
                args: { symbol: '510300.SH' },
                runId: 'run-live-1',
                sessionId: 'session-1',
                timestamp: '2026-04-21T10:00:01.000Z',
                toolCallId: 'tool-live-1',
                toolName: 'get_asset_snapshot',
                type: 'tool_execution_start',
            }),
            await adapter.mapStreamEvent({
                args: { symbol: '510300.SH' },
                result: { summary: '已拿到 ETF 快照。' },
                runId: 'run-live-1',
                sessionId: 'session-1',
                timestamp: '2026-04-21T10:00:02.000Z',
                toolCallId: 'tool-live-1',
                toolName: 'get_asset_snapshot',
                type: 'tool_execution_end',
            }),
            await adapter.mapStreamEvent({
                delta: '继续判断行业和指数强弱。',
                messageId: 'runtime-message-1',
                phase: 'thinking',
                runId: 'run-live-1',
                sessionId: 'session-1',
                timestamp: '2026-04-21T10:00:03.000Z',
                type: 'message_delta',
            }),
            await adapter.mapStreamEvent({
                delta: '综合来看，今天开盘偏强。',
                messageId: 'runtime-message-1',
                phase: 'assistant',
                runId: 'run-live-1',
                sessionId: 'session-1',
                timestamp: '2026-04-21T10:00:04.000Z',
                type: 'message_delta',
            }),
            await adapter.mapStreamEvent({
                runId: 'run-live-1',
                sessionId: 'session-1',
                timestamp: '2026-04-21T10:00:05.000Z',
                transcript,
                type: 'run_completed',
            }),
        ];

        const projection = events.reduce((current, event) => reducePiItemEvents(current, event.itemEvents), createEmptyAssistantContentProjection());

        expect(projection.timeline.map((item) => item.kind === 'work_unit'
            ? `${item.kind}:${item.workUnit.kind}`
            : item.kind)).toEqual([
                'work_unit:reasoning',
                'work_unit:tool_call',
                'work_unit:reasoning',
                'assistant_message',
            ]);
        expect(projection.workUnits[0]).toEqual(expect.objectContaining({ kind: 'reasoning', status: 'complete' }));
        expect(projection.workUnits[1]).toEqual(expect.objectContaining({ kind: 'tool_call', status: 'complete' }));
        expect(projection.workUnits[2]).toEqual(expect.objectContaining({ kind: 'reasoning', status: 'complete' }));
        expect(projection.assistantMessages[0]).toEqual(expect.objectContaining({ status: 'complete' }));
    });

    test('preserves failed historical sessions when live manager status is unavailable', async () => {
        const failedTranscript: PiWrapperSessionTranscript = {
            ...transcript,
            messages: [
                { content: '分析沪深 300 今天的波动', id: 'u1', role: 'user' },
                { content: 'provider auth failed', id: 'a1', isError: true, role: 'assistant' },
            ],
        };

        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => null),
            getSessionTranscript: vi.fn(async () => failedTranscript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => []),
        });

        await expect(adapter.listSessions()).resolves.toEqual([
            expect.objectContaining({
                id: 'session-1',
                lastError: 'provider auth failed',
                runState: 'failed',
            }),
        ]);

        await expect(adapter.getSession('session-1')).resolves.toEqual(expect.objectContaining({
            lastError: 'provider auth failed',
            runStatus: expect.objectContaining({
                lastError: 'provider auth failed',
                state: 'failed',
            }),
        }));
    });

    test('does not keep a session failed when a later assistant message succeeded', async () => {
        const recoveredTranscript: PiWrapperSessionTranscript = {
            ...transcript,
            messages: [
                { content: '先前失败请求', id: 'u1', role: 'user' },
                { content: 'provider auth failed', id: 'a1', isError: true, role: 'assistant' },
                { content: '重新执行一次', id: 'u2', role: 'user' },
                { content: '已经恢复，最新结果正常。', id: 'a2', role: 'assistant' },
            ],
        };

        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => null),
            getSessionTranscript: vi.fn(async () => recoveredTranscript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => []),
        });

        await expect(adapter.listSessions()).resolves.toEqual([
            expect.objectContaining({
                id: 'session-1',
                lastError: null,
                runState: 'idle',
            }),
        ]);
    });

    test('does not mark recovered sessions failed because of an earlier tool error', async () => {
        const recoveredTranscript: PiWrapperSessionTranscript = {
            ...transcript,
            messages: [
                { content: '本周 AI 模型新闻有哪些', id: 'u1', role: 'user' },
                {
                    content: 'JSONDecodeError: Expecting value',
                    id: 'tool-1',
                    isError: true,
                    role: 'toolResult',
                    toolCallId: 'tool-1',
                    toolName: 'bash',
                },
                { content: '已改用 HN RSS 源完成新闻汇总。', id: 'a1', role: 'assistant' },
            ],
        };
        const failedInvocation: PiToolInvocation = {
            args: {
                command: [
                    'curl -s "https://hn.algolia.com/api/v1/search?rows=15"',
                    'python3 -c "import json, sys; json.load(sys.stdin)"',
                ].join(' | '),
            },
            error: {
                code: 'BASH_EXIT_1',
                message: 'JSONDecodeError: Expecting value',
            },
            finishedAt: '2026-04-21T10:01:00.000Z',
            result: {
                content: [{ type: 'text', text: 'JSONDecodeError: Expecting value' }],
            },
            runId: 'run-1',
            sessionId: 'session-1',
            startedAt: '2026-04-21T10:00:30.000Z',
            status: 'error',
            toolCallId: 'tool-1',
            toolName: 'bash',
        };

        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => null),
            getSessionTranscript: vi.fn(async () => recoveredTranscript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => [failedInvocation]),
        });

        await expect(adapter.listSessions()).resolves.toEqual([
            expect.objectContaining({
                id: 'session-1',
                lastError: null,
                runState: 'idle',
            }),
        ]);

        await expect(adapter.getSession('session-1')).resolves.toEqual(expect.objectContaining({
            lastError: null,
            runStatus: expect.objectContaining({
                lastError: null,
                state: 'idle',
            }),
        }));
    });

    test('prefers a normalized bash timeout from tool invocations over a generic transcript failure', async () => {
        const failedTranscript: PiWrapperSessionTranscript = {
            ...transcript,
            messages: [
                { content: '抓取 GPT-5 页面', id: 'u1', role: 'user' },
                { content: '(no output)\n\nCommand exited with code 28', id: 'a1', isError: true, role: 'assistant' },
            ],
        };
        const failedInvocation: PiToolInvocation = {
            args: {
                command: 'curl -sL --max-time 15 "https://r.jina.ai/https://en.wikipedia.org/wiki/GPT-5" 2>&1',
            },
            error: {
                message: '(no output)\n\nCommand exited with code 28',
            },
            finishedAt: '2026-04-21T10:01:00.000Z',
            result: {
                content: [{ type: 'text', text: '(no output)\n\nCommand exited with code 28' }],
            },
            runId: 'run-1',
            sessionId: 'session-1',
            startedAt: '2026-04-21T10:00:30.000Z',
            status: 'error',
            toolCallId: 'tool-1',
            toolName: 'bash',
        };

        const adapter = createPiSessionAdapter({
            getRiskGateState: vi.fn(() => riskGateState),
            getSessionRunStatus: vi.fn(() => null),
            getSessionTranscript: vi.fn(async () => failedTranscript),
            getStatus: vi.fn(async () => runtimeStatus),
            listSessions: vi.fn(async () => [sessionSummary]),
            listToolInvocations: vi.fn(async () => [failedInvocation]),
        });

        await expect(adapter.listSessions()).resolves.toEqual([
            expect.objectContaining({
                id: 'session-1',
                lastError: 'curl request timed out while fetching r.jina.ai (exit code 28).',
                runState: 'failed',
            }),
        ]);

        await expect(adapter.getSession('session-1')).resolves.toEqual(expect.objectContaining({
            lastError: 'curl request timed out while fetching r.jina.ai (exit code 28).',
            runStatus: expect.objectContaining({
                lastError: 'curl request timed out while fetching r.jina.ai (exit code 28).',
                state: 'failed',
            }),
            toolSteps: [expect.objectContaining({
                error: expect.objectContaining({
                    code: 'CURL_EXIT_28',
                    message: 'curl request timed out while fetching r.jina.ai (exit code 28).',
                }),
            })],
        }));
    });
});
