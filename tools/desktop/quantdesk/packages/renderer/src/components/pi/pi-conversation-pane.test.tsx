// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { PiSessionRecord } from '@quantdesk/shared';

import { PiConversationPane } from './pi-conversation-pane';

const session: PiSessionRecord = {
    cwd: '/tmp/workspace',
    degraded: false,
    degradedReason: null,
    id: 'session-1',
    lastError: 'provider auth failed',
    lastToolName: null,
    preview: '检查组合风险',
    projection: {
        approvalBlock: null,
        assistantMessages: [{
            blocks: [{
                content: 'provider auth failed',
                id: 'session-1:error:text',
                status: 'complete',
                type: 'text',
            }],
            createdAt: '2026-04-21T10:00:00.000Z',
            id: 'assistant-session-1',
            model: 'gpt-4o',
            providerId: 'github-copilot',
            role: 'assistant',
            status: 'complete',
        }],
        timeline: [
            {
                content: '检查组合风险',
                createdAt: '2026-04-21T09:59:00.000Z',
                id: 'u1',
                kind: 'message',
                role: 'user',
            },
            {
                assistantMessage: {
                    blocks: [{
                        content: 'provider auth failed',
                        id: 'session-1:error:text',
                        status: 'complete',
                        type: 'text',
                    }],
                    createdAt: '2026-04-21T10:00:00.000Z',
                    id: 'assistant-session-1',
                    model: 'gpt-4o',
                    providerId: 'github-copilot',
                    role: 'assistant',
                    status: 'complete',
                },
                createdAt: '2026-04-21T10:00:00.000Z',
                id: 'assistant-session-1',
                kind: 'assistant_message',
            },
        ],
        workUnits: [],
    },
    runState: 'failed',
    toolSteps: [
        {
            args: {},
            error: null,
            finishedAt: '2026-04-21T09:59:10.000Z',
            runId: 'run-1',
            sessionId: 'session-1',
            startedAt: '2026-04-21T09:59:00.000Z',
            status: 'success',
            summary: '命中 SPY',
            toolCallId: 'call-1',
            toolName: 'analyze_asset',
        },
    ],
    runStatus: {
        currentTool: null,
        degraded: false,
        degradedReason: null,
        lastError: 'provider auth failed',
        runId: 'run-1',
        sessionId: 'session-1',
        state: 'failed',
        updatedAt: '2026-04-21T10:00:00.000Z',
    },
    title: '失败会话',
    titleSource: 'placeholder',
    titleStatus: 'failed',
    titleUpdatedAt: '2026-04-21T10:00:00.000Z',
    transcript: {
        cwd: '/tmp/workspace',
        messages: [
            { content: '检查组合风险', id: 'u1', role: 'user' },
            { content: 'provider auth failed', id: 'a1', isError: true, role: 'assistant' },
        ],
        model: {
            modelId: 'gpt-4o',
            provider: 'github-copilot',
        },
        path: '/tmp/session-1.jsonl',
        sessionId: 'session-1',
        thinkingLevel: 'off',
    },
    updatedAt: '2026-04-21T10:00:00.000Z',
};

describe('PiConversationPane', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('surfaces failed state and the latest run error above the transcript', () => {
        render(
            <PiConversationPane
                draft=""
                isLoadingSession={false}
                isSending={false}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={vi.fn()}
                onSend={vi.fn()}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={session.runStatus}
                session={session}
            />,
        );

        expect(screen.getByTestId('pi-agent-run-failure-banner')).toHaveTextContent('最近一次 Pi 运行失败');
        expect(screen.getByTestId('pi-agent-run-failure-banner')).toHaveTextContent('provider auth failed');
        expect(screen.getAllByText('失败').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByTestId('pi-agent-session-info-toggle'));
        expect(screen.getByTestId('pi-agent-session-info-panel')).toHaveTextContent('gpt-4o');
        expect(screen.getByTestId('pi-agent-session-info-panel')).toHaveTextContent('github-copilot');
    });

    test('keeps editing with Enter and sends with Shift Enter', () => {
        const onSend = vi.fn();

        render(
            <PiConversationPane
                draft="分析当前组合"
                isLoadingSession={false}
                isSending={false}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={vi.fn()}
                onSend={onSend}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={session.runStatus}
                session={session}
            />,
        );

        const input = screen.getByTestId('pi-agent-message-input');

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSend).not.toHaveBeenCalled();

        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    test('suggests Pi skills by partial slash matches and completes before sending', () => {
        const onDraftChange = vi.fn();
        const onSend = vi.fn();
        const { rerender } = render(
            <PiConversationPane
                draft="/rese"
                isLoadingSession={false}
                isSending={false}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={onDraftChange}
                onSend={onSend}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={session.runStatus}
                session={session}
                skills={[
                    {
                        description: 'QuantDesk research skill',
                        name: 'quantdesk-research',
                        path: '/tmp/.pi/skills/quantdesk-research/SKILL.md',
                        source: '/tmp/.pi/skills',
                    },
                    {
                        description: 'Macro scan skill',
                        name: 'macro-scan',
                        path: '/tmp/.pi/skills/macro-scan/SKILL.md',
                        source: '/tmp/.pi/skills',
                    },
                ]}
            />,
        );

        expect(screen.getByTestId('pi-agent-skill-suggestions')).toHaveTextContent('/skill:quantdesk-research');

        fireEvent.keyDown(screen.getByTestId('pi-agent-message-input'), { key: 'Enter', shiftKey: true });
        expect(onDraftChange).toHaveBeenCalledWith('/skill:quantdesk-research ');
        expect(onSend).not.toHaveBeenCalled();

        rerender(
            <PiConversationPane
                draft="/skill:quantdesk-research 恒生科技配置多少仓位"
                isLoadingSession={false}
                isSending={false}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={onDraftChange}
                onSend={onSend}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={session.runStatus}
                session={session}
                skills={[]}
            />,
        );

        fireEvent.keyDown(screen.getByTestId('pi-agent-message-input'), { key: 'Enter', shiftKey: true });
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    test('renders thinking, tool activity, and final answer from canonical projection', () => {
        render(
            <PiConversationPane
                draft=""
                isLoadingSession={false}
                isSending={false}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={vi.fn()}
                onSend={vi.fn()}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={{
                    currentTool: null,
                    degraded: false,
                    degradedReason: null,
                    lastError: null,
                    runId: 'run-2',
                    sessionId: 'session-2',
                    state: 'idle',
                    updatedAt: '2026-04-21T10:00:00.000Z',
                }}
                session={{
                    ...session,
                    id: 'session-2',
                    lastError: null,
                    runState: 'idle',
                    runStatus: {
                        currentTool: null,
                        degraded: false,
                        degradedReason: null,
                        lastError: null,
                        runId: 'run-2',
                        sessionId: 'session-2',
                        state: 'idle',
                        updatedAt: '2026-04-21T10:00:00.000Z',
                    },
                    titleSource: 'placeholder',
                    titleStatus: 'ready',
                    titleUpdatedAt: '2026-04-21T10:00:00.000Z',
                    projection: {
                        approvalBlock: null,
                        assistantMessages: [{
                            blocks: [{
                                content: '这是最终回答。',
                                id: 'assistant-2:text:0',
                                status: 'complete',
                                type: 'text',
                            }],
                            createdAt: '2026-04-21T10:00:00.000Z',
                            id: 'assistant-2',
                            model: 'gpt-4o',
                            providerId: 'github-copilot',
                            role: 'assistant',
                            status: 'complete',
                        }],
                        timeline: [
                            {
                                content: '检查组合风险',
                                createdAt: '2026-04-21T09:59:00.000Z',
                                id: 'u1',
                                kind: 'message',
                                role: 'user',
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'reasoning-2',
                                kind: 'work_unit',
                                workUnit: {
                                    content: '我先看一下上下文。\n再核对当前页面快照。',
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'reasoning-2',
                                    kind: 'reasoning',
                                    status: 'complete',
                                    summary: '我先看一下上下文。',
                                },
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'tool-2',
                                kind: 'work_unit',
                                workUnit: {
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'tool-2',
                                    input: { url: 'http://example.com' },
                                    kind: 'tool_call',
                                    output: {
                                        content: '页面已打开。',
                                        summary: '已运行 Playwright 代码',
                                    },
                                    status: 'complete',
                                    toolLabel: 'playwright.run',
                                    toolName: 'playwright.run',
                                },
                            },
                            {
                                assistantMessage: {
                                    blocks: [{
                                        content: '这是最终回答。',
                                        id: 'assistant-2:text:0',
                                        status: 'complete',
                                        type: 'text',
                                    }],
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'assistant-2',
                                    model: 'gpt-4o',
                                    providerId: 'github-copilot',
                                    role: 'assistant',
                                    status: 'complete',
                                },
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'assistant-2',
                                kind: 'assistant_message',
                            },
                        ],
                        workUnits: [
                            {
                                content: '我先看一下上下文。\n再核对当前页面快照。',
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'reasoning-2',
                                kind: 'reasoning',
                                status: 'complete',
                                summary: '我先看一下上下文。',
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'tool-2',
                                input: { url: 'http://example.com' },
                                kind: 'tool_call',
                                output: {
                                    content: '页面已打开。',
                                    summary: '已运行 Playwright 代码',
                                },
                                status: 'complete',
                                toolLabel: 'playwright.run',
                                toolName: 'playwright.run',
                            },
                        ],
                    },
                    toolSteps: [],
                    transcript: {
                        ...session.transcript,
                        messages: [{ content: '检查组合风险', id: 'u1', role: 'user' }],
                        thinkingLevel: 'balanced',
                    },
                }}
            />,
        );

        expect(screen.getByText('我先看一下上下文。')).toBeInTheDocument();
        expect(screen.getByText('这是最终回答。')).toBeInTheDocument();
        expect(screen.getByText('playwright.run')).toBeInTheDocument();
        expect(screen.getByText('已运行 Playwright 代码')).toBeInTheDocument();
        expect(screen.getByTestId('content-block-reasoning-2').querySelector('button')).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('再核对当前页面快照。')).not.toBeInTheDocument();
    });

    test('renders running tool calls expanded with live progress styling by default', () => {
        render(
            <PiConversationPane
                draft=""
                isLoadingSession={false}
                isSending={true}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={vi.fn()}
                onSend={vi.fn()}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={{
                    currentTool: 'playwright.run',
                    degraded: false,
                    degradedReason: null,
                    lastError: null,
                    runId: 'run-3',
                    sessionId: 'session-3',
                    state: 'running',
                    updatedAt: '2026-04-21T10:00:00.000Z',
                }}
                session={{
                    ...session,
                    id: 'session-3',
                    lastError: null,
                    runState: 'running',
                    runStatus: {
                        currentTool: 'playwright.run',
                        degraded: false,
                        degradedReason: null,
                        lastError: null,
                        runId: 'run-3',
                        sessionId: 'session-3',
                        state: 'running',
                        updatedAt: '2026-04-21T10:00:00.000Z',
                    },
                    projection: {
                        approvalBlock: null,
                        assistantMessages: [],
                        timeline: [
                            {
                                content: '检查页面状态',
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'u3',
                                kind: 'message',
                                role: 'user',
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'tool-running',
                                kind: 'work_unit',
                                workUnit: {
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'tool-running',
                                    input: { url: 'http://example.com' },
                                    kind: 'tool_call',
                                    output: {
                                        content: 'navigating',
                                        summary: '正在打开页面',
                                    },
                                    status: 'running',
                                    toolLabel: 'playwright.run',
                                    toolName: 'playwright.run',
                                },
                            },
                        ],
                        workUnits: [{
                            createdAt: '2026-04-21T10:00:00.000Z',
                            id: 'tool-running',
                            input: { url: 'http://example.com' },
                            kind: 'tool_call',
                            output: {
                                content: 'navigating',
                                summary: '正在打开页面',
                            },
                            status: 'running',
                            toolLabel: 'playwright.run',
                            toolName: 'playwright.run',
                        }],
                    },
                    toolSteps: [],
                    transcript: {
                        ...session.transcript,
                        messages: [{ content: '检查页面状态', id: 'u3', role: 'user' }],
                        sessionId: 'session-3',
                        thinkingLevel: 'balanced',
                    },
                }}
            />,
        );

        const runningCard = screen.getByTestId('content-block-tool-running');
        const toggleButton = within(runningCard).getByRole('button', { expanded: true });

        expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
        expect(runningCard).toHaveTextContent('进行中');
        expect(runningCard).toHaveTextContent('正在打开页面');
        expect(runningCard).toHaveTextContent('中间结果');
    });

    test('keeps collapsed tool call cards from showing long returned text in the summary', () => {
        const longOutput = 'LONG_TOOL_OUTPUT_SENTINEL '.repeat(20).trim();

        render(
            <PiConversationPane
                draft=""
                isLoadingSession={false}
                isSending={false}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={vi.fn()}
                onSend={vi.fn()}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={{
                    currentTool: null,
                    degraded: false,
                    degradedReason: null,
                    lastError: null,
                    runId: 'run-5',
                    sessionId: 'session-5',
                    state: 'idle',
                    updatedAt: '2026-04-21T10:00:00.000Z',
                }}
                session={{
                    ...session,
                    id: 'session-5',
                    lastError: null,
                    projection: {
                        approvalBlock: null,
                        assistantMessages: [],
                        timeline: [
                            {
                                content: '检查页面状态',
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'u5',
                                kind: 'message',
                                role: 'user',
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'tool-complete',
                                kind: 'work_unit',
                                workUnit: {
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'tool-complete',
                                    input: { url: 'http://example.com' },
                                    kind: 'tool_call',
                                    output: {
                                        content: longOutput,
                                        summary: '点击展开查看输入输出',
                                    },
                                    status: 'complete',
                                    toolLabel: 'playwright.run',
                                    toolName: 'playwright.run',
                                },
                            },
                        ],
                        workUnits: [{
                            createdAt: '2026-04-21T10:00:00.000Z',
                            id: 'tool-complete',
                            input: { url: 'http://example.com' },
                            kind: 'tool_call',
                            output: {
                                content: longOutput,
                                summary: '点击展开查看输入输出',
                            },
                            status: 'complete',
                            toolLabel: 'playwright.run',
                            toolName: 'playwright.run',
                        }],
                    },
                    transcript: {
                        ...session.transcript,
                        messages: [{ content: '检查页面状态', id: 'u5', role: 'user' }],
                        sessionId: 'session-5',
                        thinkingLevel: 'balanced',
                    },
                }}
            />,
        );

        const collapsedCard = screen.getByTestId('content-block-tool-complete');

        expect(collapsedCard).toHaveTextContent('点击展开查看输入输出');
        expect(collapsedCard).not.toHaveTextContent('LONG_TOOL_OUTPUT_SENTINEL');
    });

    test('shows debug completion logs and current display order when debug mode is enabled', () => {
        window.localStorage.setItem('quantdesk.pi.debug-mode', 'true');

        render(
            <PiConversationPane
                draft=""
                isLoadingSession={false}
                isSending={false}
                modelLabel="gpt-4o"
                onAcknowledgeRisk={vi.fn()}
                onCancel={vi.fn()}
                onDraftChange={vi.fn()}
                onSend={vi.fn()}
                providerLabel="github-copilot"
                riskGateState={{
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T09:59:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high',
                }}
                runStatus={{
                    currentTool: null,
                    degraded: false,
                    degradedReason: null,
                    lastError: null,
                    runId: 'run-4',
                    sessionId: 'session-4',
                    state: 'idle',
                    updatedAt: '2026-04-21T10:00:00.000Z',
                }}
                session={{
                    ...session,
                    id: 'session-4',
                    lastError: null,
                    projection: {
                        approvalBlock: null,
                        assistantMessages: [{
                            blocks: [
                                {
                                    content: '这是最后的回答。',
                                    id: 'text-1',
                                    status: 'complete',
                                    type: 'text',
                                },
                            ],
                            createdAt: '2026-04-21T10:00:00.000Z',
                            id: 'assistant-4',
                            model: 'gpt-4o',
                            providerId: 'github-copilot',
                            role: 'assistant',
                            status: 'complete',
                        }],
                        timeline: [
                            {
                                content: '检查页面状态',
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'u4',
                                kind: 'message',
                                role: 'user',
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'thinking-1',
                                kind: 'work_unit',
                                workUnit: {
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'thinking-1',
                                    kind: 'reasoning',
                                    content: '我先看一下上下文。',
                                    status: 'complete',
                                    summary: '我先看一下上下文。',
                                },
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'tool-1',
                                kind: 'work_unit',
                                workUnit: {
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'tool-1',
                                    input: { symbol: '510300.SH' },
                                    kind: 'tool_call',
                                    output: {
                                        content: '完成扫描。',
                                        summary: '完成扫描。',
                                    },
                                    status: 'complete',
                                    toolLabel: 'get_asset_snapshot',
                                    toolName: 'get_asset_snapshot',
                                },
                            },
                            {
                                assistantMessage: {
                                    blocks: [{
                                        content: '这是最后的回答。',
                                        id: 'text-1',
                                        status: 'complete',
                                        type: 'text',
                                    }],
                                    createdAt: '2026-04-21T10:00:00.000Z',
                                    id: 'assistant-4',
                                    model: 'gpt-4o',
                                    providerId: 'github-copilot',
                                    role: 'assistant',
                                    status: 'complete',
                                },
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'assistant-4',
                                kind: 'assistant_message',
                            },
                        ],
                        workUnits: [
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'thinking-1',
                                kind: 'reasoning',
                                content: '我先看一下上下文。',
                                status: 'complete',
                                summary: '我先看一下上下文。',
                            },
                            {
                                createdAt: '2026-04-21T10:00:00.000Z',
                                id: 'tool-1',
                                input: { symbol: '510300.SH' },
                                kind: 'tool_call',
                                output: {
                                    content: '完成扫描。',
                                    summary: '完成扫描。',
                                },
                                status: 'complete',
                                toolLabel: 'get_asset_snapshot',
                                toolName: 'get_asset_snapshot',
                            },
                        ],
                    },
                    transcript: {
                        ...session.transcript,
                        messages: [{ content: '检查页面状态', id: 'u4', role: 'user' }],
                        sessionId: 'session-4',
                    },
                }}
            />,
        );

        const debugPanel = screen.getByTestId('pi-agent-debug-panel');

        fireEvent.click(screen.getByTestId('pi-agent-session-info-toggle'));
        expect(screen.getByTestId('pi-agent-debug-toggle')).toHaveTextContent('关闭 Debug');
        expect(debugPanel).toHaveTextContent('当前展示顺序');
        expect(debugPanel).toHaveTextContent('1. 我先看一下上下文。 [reasoning]');
        expect(debugPanel).toHaveTextContent('2. get_asset_snapshot [tool_call]');
        expect(debugPanel).toHaveTextContent('3. 这是最后的回答。 [assistant_message]');
        expect(debugPanel).toHaveTextContent('reasoning');
        expect(debugPanel).toHaveTextContent('get_asset_snapshot');
        expect(debugPanel).toHaveTextContent('顺序快照');
    });
});
