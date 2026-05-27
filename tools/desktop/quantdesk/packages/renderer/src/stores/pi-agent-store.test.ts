// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import { resetPiAgentStore, usePiAgentStore } from './pi-agent-store';

describe('usePiAgentStore', () => {
    let mockApi: QuantdeskApi;
    let streamListener: ((payload: Parameters<QuantdeskApi['piAgent']['onStream']>[0] extends (payload: infer T) => void ? T : never) => void) | null;

    beforeEach(() => {
        resetPiAgentStore();
        streamListener = null;

        mockApi = {
            log: {
                openDirectory: vi.fn().mockResolvedValue(undefined),
                write: vi.fn(),
                writeBatch: vi.fn(),
            },
            data: {
                addAsset: vi.fn(),
                clearCache: vi.fn(),
                deleteAsset: vi.fn(),
                deletePosition: vi.fn(),
                getAssets: vi.fn(),
                getCacheSummary: vi.fn(),
                getPositions: vi.fn(),
                getPriceRange: vi.fn(),
                getPrices: vi.fn(),
                getSyncStatus: vi.fn(),
                importAssetsCsv: vi.fn(),
                importPositionsCsv: vi.fn(),
                importPricesCsv: vi.fn(),
                lookupAssets: vi.fn(),
                searchAssets: vi.fn(),
                subscribeSyncStatus: vi.fn().mockReturnValue(() => undefined),
                syncFxRates: vi.fn(),
                syncPrices: vi.fn(),
                updateAsset: vi.fn(),
                updatePosition: vi.fn(),
            },
            piAgent: {
                cancelRun: vi.fn(),
                discardAttachments: vi.fn().mockResolvedValue(undefined),
                getSession: vi.fn(),
                getSessionTranscript: vi.fn(),
                listSessions: vi.fn(),
                listSkills: vi.fn().mockResolvedValue([]),
                onStream: vi.fn().mockImplementation((listener) => {
                    streamListener = listener;
                    return () => {
                        streamListener = null;
                    };
                }),
                sendMessage: vi.fn().mockRejectedValue(new Error('provider rejected request')),
                stageAttachments: vi.fn().mockResolvedValue({ attachments: [], rejected: [] }),
            },
            piRuntime: {
                acknowledgeHighPrivilegeRisk: vi.fn(),
                getRiskGateState: vi.fn(),
                getStatus: vi.fn(),
                openDirectory: vi.fn(),
            },
            portfolio: {
                deletePlan: vi.fn(),
                getPlans: vi.fn(),
                runAllocation: vi.fn(),
                savePlan: vi.fn(),
            },
            runtime: {
                getCapabilities: vi.fn(),
                getConfig: vi.fn(),
                getMode: vi.fn(),
                updateConfig: vi.fn(),
                validateProviderConnection: vi.fn(),
                validateSidecarConnection: vi.fn(),
            },
            secrets: {
                delete: vi.fn(),
                get: vi.fn(),
                set: vi.fn(),
            },
            settings: {
                delete: vi.fn(),
                get: vi.fn(),
                getAll: vi.fn(),
                set: vi.fn(),
            },
            system: {
                checkNativeBindings: vi.fn(),
                getRuntimeStatus: vi.fn(),
                ping: vi.fn(),
                runDummyPython: vi.fn(),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        setApiClientOverride(null);
    });

    test('rolls back optimistic sessionRuns when sending a message fails', async () => {
        usePiAgentStore.setState({
            activeSessionId: 'session-1',
            draft: '重新执行一次',
            riskGateState: {
                acknowledged: true,
                acknowledgedAt: '2026-04-21T09:59:00.000Z',
                message: 'risk gate',
                required: true,
                riskLevel: 'high',
            },
            sessionRecords: {
                'session-1': {
                    cwd: '/tmp/workspace',
                    degraded: false,
                    degradedReason: null,
                    id: 'session-1',
                    lastError: null,
                    lastToolName: null,
                    preview: '旧消息',
                    projection: {
                        approvalBlock: null,
                        assistantMessages: [{
                            blocks: [{
                                content: '旧消息',
                                id: 'assistant-1:text:0',
                                status: 'complete',
                                type: 'text',
                            }],
                            createdAt: '2026-04-21T10:00:00.000Z',
                            id: 'assistant-1',
                            model: null,
                            providerId: null,
                            role: 'assistant',
                            status: 'complete',
                        }],
                        timeline: [{
                            assistantMessage: {
                                blocks: [{
                                    content: '旧消息',
                                    id: 'assistant-1:text:0',
                                    status: 'complete',
                                    type: 'text',
                                }],
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'assistant-1',
                                model: null,
                                providerId: null,
                                role: 'assistant',
                                status: 'complete',
                            },
                            createdAt: '2026-04-21T10:00:00.000Z',
                            id: 'assistant-1',
                            kind: 'assistant_message',
                        }],
                        workUnits: [],
                    },
                    runState: 'idle',
                    runStatus: {
                        currentTool: null,
                        degraded: false,
                        degradedReason: null,
                        lastError: null,
                        runId: null,
                        sessionId: 'session-1',
                        state: 'idle',
                        updatedAt: '2026-04-21T10:00:00.000Z',
                    },
                    title: '测试会话',
                    titleSource: 'placeholder',
                    titleStatus: 'ready',
                    titleUpdatedAt: '2026-04-21T10:00:00.000Z',
                    toolSteps: [],
                    transcript: {
                        cwd: '/tmp/workspace',
                        messages: [{ content: '旧消息', id: 'm1', role: 'assistant' }],
                        model: null,
                        path: '/tmp/session-1.jsonl',
                        sessionId: 'session-1',
                        thinkingLevel: 'balanced',
                    },
                    updatedAt: '2026-04-21T10:00:00.000Z',
                },
            },
            sessionRuns: {
                'session-1': {
                    currentTool: null,
                    degraded: false,
                    degradedReason: null,
                    lastError: null,
                    runId: null,
                    sessionId: 'session-1',
                    state: 'idle',
                    updatedAt: '2026-04-21T10:00:00.000Z',
                },
            },
            sessions: [{
                cwd: '/tmp/workspace',
                degraded: false,
                degradedReason: null,
                id: 'session-1',
                lastError: null,
                lastToolName: null,
                preview: '旧消息',
                runState: 'idle',
                title: '测试会话',
                titleSource: 'placeholder',
                titleStatus: 'ready',
                titleUpdatedAt: '2026-04-21T10:00:00.000Z',
                updatedAt: '2026-04-21T10:00:00.000Z',
            }],
        });

        await expect(usePiAgentStore.getState().sendMessage()).resolves.toBe(false);

        const state = usePiAgentStore.getState();
        expect(state.errorMessage).toBe('provider rejected request');
        expect(state.sessionRuns['session-1']).toEqual(expect.objectContaining({
            runId: null,
            state: 'idle',
        }));
        expect(state.sessionRecords['session-1'].transcript.messages).toEqual([
            expect.objectContaining({ content: '旧消息', role: 'assistant' }),
        ]);
    });

    test('keeps the placeholder title for a new session until Pi returns title metadata', async () => {
        mockApi.piAgent.sendMessage = vi.fn().mockResolvedValue({ runId: 'run-2', sessionId: 'session-2' });
        mockApi.piRuntime.getStatus = vi.fn().mockResolvedValue({
            currentSessionId: 'session-2',
            degraded: false,
            degradedReason: null,
            diagnostics: [],
            directories: {
                agentDir: '/tmp/.pi/agent',
                sessionDir: '/tmp/.pi/sessions',
                toolInvocationDir: '/tmp/.pi/invocations',
                workspaceDir: '/tmp/workspace',
            },
            financeTools: {
                available: true,
                lastError: null,
                names: [],
            },
            lastCheckedAt: '2026-04-21T10:01:00.000Z',
            lastError: null,
            lastStartedAt: '2026-04-21T10:00:00.000Z',
            model: {
                available: true,
                availableModels: ['minimax-cn'],
                model: 'minimax-cn',
                provider: 'minimax-cn',
                source: 'runtime',
            },
            pid: 100,
            sessionCount: 1,
            state: 'ready',
            wrapperVersion: '1.0.0',
        });

        await usePiAgentStore.getState().initialize();
        usePiAgentStore.setState({
            draft: '请总结今天与中国资产相关的市场新闻，并列出重点风险。',
            riskGateState: {
                acknowledged: true,
                acknowledgedAt: '2026-04-21T09:59:00.000Z',
                message: 'risk gate',
                required: true,
                riskLevel: 'high',
            },
        });

        await expect(usePiAgentStore.getState().sendMessage()).resolves.toBe(true);

        expect(usePiAgentStore.getState().sessions[0]).toEqual(expect.objectContaining({
            id: 'session-2',
            title: '请总结今天与中国资产相关的市场新闻，并列出重点风险。',
            titleSource: 'placeholder',
            titleStatus: 'pending',
        }));

        streamListener?.({
            session: {
                cwd: '/tmp/workspace',
                degraded: false,
                degradedReason: null,
                id: 'session-2',
                lastError: null,
                lastToolName: null,
                preview: '',
                runState: 'running',
                title: null,
                titleSource: 'placeholder',
                titleStatus: 'pending',
                titleUpdatedAt: null,
                updatedAt: '2026-04-21T10:02:00.000Z',
            },
            timestamp: '2026-04-21T10:02:00.000Z',
            type: 'session_created',
        });

        expect(usePiAgentStore.getState().sessions[0]).toEqual(expect.objectContaining({
            id: 'session-2',
            title: '请总结今天与中国资产相关的市场新闻，并列出重点风险。',
            titleSource: 'placeholder',
            titleStatus: 'pending',
        }));
    });

    test('stages attachments and sends them with an attachment-only prompt', async () => {
        const attachment = {
            id: '11111111-1111-4111-8111-111111111111',
            kind: 'text_document' as const,
            mimeType: 'text/markdown',
            name: 'notes.md',
            size: 42,
        };
        mockApi.piAgent.stageAttachments = vi.fn().mockResolvedValue({ attachments: [attachment], rejected: [] });
        mockApi.piAgent.sendMessage = vi.fn().mockResolvedValue({ runId: 'run-3', sessionId: 'session-3' });
        usePiAgentStore.setState({
            riskGateState: {
                acknowledged: true,
                acknowledgedAt: '2026-04-21T09:59:00.000Z',
                message: 'risk gate',
                required: true,
                riskLevel: 'high',
            },
        });

        await expect(usePiAgentStore.getState().stageAttachments()).resolves.toBe(true);
        await expect(usePiAgentStore.getState().sendMessage()).resolves.toBe(true);

        expect(mockApi.piAgent.sendMessage).toHaveBeenCalledWith({
            attachments: [attachment],
            message: '请分析这些附件。',
            sessionId: undefined,
        });
        expect(usePiAgentStore.getState().draftAttachments).toEqual([]);
        expect(usePiAgentStore.getState().sessionRecords['session-3'].transcript.messages[0]).toEqual(expect.objectContaining({
            content: expect.stringContaining('notes.md'),
            role: 'user',
        }));
    });

    test('keeps work units and final assistant answer as separate timeline items during PI streaming', async () => {
        mockApi.piRuntime.getStatus = vi.fn().mockResolvedValue({
            currentSessionId: null,
            degraded: false,
            degradedReason: null,
            diagnostics: [],
            directories: {
                agentDir: '/tmp/.pi/agent',
                sessionDir: '/tmp/.pi/sessions',
                toolInvocationDir: '/tmp/.pi/invocations',
                workspaceDir: '/tmp/workspace',
            },
            financeTools: {
                available: true,
                lastError: null,
                names: [],
            },
            lastCheckedAt: '2026-04-21T10:01:00.000Z',
            lastError: null,
            lastStartedAt: '2026-04-21T10:00:00.000Z',
            model: {
                available: true,
                availableModels: ['gpt-4o'],
                model: 'gpt-4o',
                provider: 'github-copilot',
                source: 'runtime',
            },
            pid: 100,
            sessionCount: 1,
            state: 'ready',
            wrapperVersion: '1.0.0',
        });
        mockApi.piRuntime.getRiskGateState = vi.fn().mockResolvedValue({
            acknowledged: true,
            acknowledgedAt: '2026-04-21T09:59:00.000Z',
            message: 'risk gate',
            required: true,
            riskLevel: 'high',
        });
        mockApi.piAgent.listSessions = vi.fn().mockResolvedValue([]);

        await usePiAgentStore.getState().initialize();

        streamListener?.({
            itemEvents: [],
            message: '分析 A 股开盘强弱',
            status: {
                currentTool: null,
                degraded: false,
                degradedReason: null,
                lastError: null,
                runId: 'run-1',
                sessionId: 'session-1',
                state: 'running',
                updatedAt: '2026-04-21T10:00:00.000Z',
            },
            timestamp: '2026-04-21T10:00:00.000Z',
            type: 'run_started',
        });

        streamListener?.({
            delta: '先看 ETF 快照。',
            itemEvents: [
                {
                    data: {
                        createdAt: '2026-04-21T10:00:01.000Z',
                        itemId: 'reasoning:run-1:0',
                        kind: 'reasoning',
                        runId: 'run-1',
                        status: 'streaming',
                    },
                    event: 'item.started',
                },
                {
                    data: {
                        contentKind: 'reasoning',
                        delta: '先看 ETF 快照。',
                        itemId: 'reasoning:run-1:0',
                    },
                    event: 'content.delta',
                },
            ],
            messageId: 'reasoning:run-1:0',
            phase: 'thinking',
            runId: 'run-1',
            sessionId: 'session-1',
            timestamp: '2026-04-21T10:00:01.000Z',
            type: 'message_delta',
        });

        streamListener?.({
            itemEvents: [
                {
                    data: {
                        createdAt: '2026-04-21T10:00:01.000Z',
                        itemId: 'reasoning:run-1:0',
                        kind: 'reasoning',
                        runId: 'run-1',
                        status: 'complete',
                    },
                    event: 'item.completed',
                },
                {
                    data: {
                        createdAt: '2026-04-21T10:00:02.000Z',
                        input: { symbol: '510300.SH' },
                        itemId: 'tool:tool-1',
                        kind: 'tool_call',
                        runId: 'run-1',
                        sourceMessageId: 'tool-1',
                        startedAt: '2026-04-21T10:00:02.000Z',
                        status: 'running',
                        toolLabel: 'get_asset_snapshot',
                        toolName: 'get_asset_snapshot',
                    },
                    event: 'item.started',
                },
            ],
            step: {
                args: { symbol: '510300.SH' },
                error: null,
                finishedAt: null,
                runId: 'run-1',
                sessionId: 'session-1',
                startedAt: '2026-04-21T10:00:02.000Z',
                status: 'running',
                summary: null,
                toolCallId: 'tool-1',
                toolName: 'get_asset_snapshot',
            },
            timestamp: '2026-04-21T10:00:02.000Z',
            type: 'tool_execution_start',
        });

        streamListener?.({
            itemEvents: [
                {
                    data: {
                        createdAt: '2026-04-21T10:00:03.000Z',
                        durationMs: 1000,
                        finishedAt: '2026-04-21T10:00:03.000Z',
                        input: { symbol: '510300.SH' },
                        itemId: 'tool:tool-1',
                        kind: 'tool_call',
                        output: {
                            content: '已拿到 ETF 快照。',
                            summary: '已拿到 ETF 快照。',
                        },
                        runId: 'run-1',
                        sourceMessageId: 'tool-1',
                        startedAt: '2026-04-21T10:00:02.000Z',
                        status: 'complete',
                        toolLabel: 'get_asset_snapshot',
                        toolName: 'get_asset_snapshot',
                    },
                    event: 'item.completed',
                },
                {
                    data: {
                        assistantSegmentId: '0',
                        createdAt: '2026-04-21T10:00:04.000Z',
                        itemId: 'assistant:run-1:segment:0',
                        kind: 'assistant_message',
                        runId: 'run-1',
                        status: 'streaming',
                    },
                    event: 'item.started',
                },
                {
                    data: {
                        contentKind: 'assistant_text',
                        delta: '综合来看，今天开盘偏强。',
                        itemId: 'assistant:run-1:segment:0',
                    },
                    event: 'content.delta',
                },
            ],
            delta: '综合来看，今天开盘偏强。',
            messageId: 'assistant:run-1:segment:0',
            phase: 'assistant',
            runId: 'run-1',
            sessionId: 'session-1',
            timestamp: '2026-04-21T10:00:04.000Z',
            type: 'message_delta',
        });

        const projection = usePiAgentStore.getState().sessionRecords['session-1']?.projection;

        expect(projection?.timeline.map((item) => item.kind === 'work_unit' ? `work_unit:${item.workUnit.kind}` : item.kind)).toEqual([
            'work_unit:reasoning',
            'work_unit:tool_call',
            'assistant_message',
        ]);
        expect(projection?.workUnits[0]).toEqual(expect.objectContaining({ kind: 'reasoning', status: 'complete' }));
        expect(projection?.workUnits[1]).toEqual(expect.objectContaining({ kind: 'tool_call', status: 'complete' }));
        expect(projection?.assistantMessages[0]?.blocks[0]).toEqual(expect.objectContaining({
            content: '综合来看，今天开盘偏强。',
            type: 'text',
        }));
    });
});
