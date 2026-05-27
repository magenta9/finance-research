// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type {
    PiRiskGateState,
    PiRuntimeStatus,
    PiSessionRecord,
    PiSessionSummary,
} from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import { resetPiAgentStore } from '../stores/pi-agent-store';
import { useShellStore } from '../stores/shell-store';
import { PiAgentPage } from './pi-agent-page';

const createSessionRecord = (): PiSessionRecord => ({
    cwd: '/tmp/workspace',
    degraded: false,
    degradedReason: null,
    id: 'session-1',
    lastError: null,
    lastToolName: null,
    preview: '检查组合风险',
    projection: {
        approvalBlock: null,
        assistantMessages: [{
            blocks: [{
                content: '风险已评估',
                id: 'assistant-1:text:0',
                status: 'complete',
                type: 'text',
            }],
            createdAt: '2026-04-21T10:00:00.000Z',
            id: 'assistant-1',
            model: 'gpt-4o',
            providerId: 'github-copilot',
            role: 'assistant',
            status: 'complete',
        }],
        timeline: [
            {
                content: '检查组合风险',
                createdAt: '2026-04-21T10:00:00.000Z',
                id: 'u1',
                kind: 'message',
                role: 'user',
            },
            {
                assistantMessage: {
                    blocks: [{
                        content: '风险已评估',
                        id: 'assistant-1:text:0',
                        status: 'complete',
                        type: 'text',
                    }],
                    createdAt: '2026-04-21T10:00:00.000Z',
                    id: 'assistant-1',
                    model: 'gpt-4o',
                    providerId: 'github-copilot',
                    role: 'assistant',
                    status: 'complete',
                },
                createdAt: '2026-04-21T10:00:00.000Z',
                id: 'assistant-1',
                kind: 'assistant_message',
            },
        ],
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
    title: 'Pi 历史会话',
    titleSource: 'placeholder',
    titleStatus: 'ready',
    titleUpdatedAt: '2026-04-21T10:00:00.000Z',
    toolSteps: [],
    transcript: {
        cwd: '/tmp/workspace',
        messages: [
            { content: '检查组合风险', id: 'u1', role: 'user' },
            { content: '风险已评估', id: 'a1', role: 'assistant' },
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
});

const createSessionSummary = (): PiSessionSummary => ({
    cwd: '/tmp/workspace',
    degraded: false,
    degradedReason: null,
    id: 'session-1',
    lastError: null,
    lastToolName: null,
    preview: '检查组合风险',
    runState: 'idle',
    title: 'Pi 历史会话',
    titleSource: 'placeholder',
    titleStatus: 'ready',
    titleUpdatedAt: '2026-04-21T10:00:00.000Z',
    updatedAt: '2026-04-21T10:00:00.000Z',
});

describe('PiAgentPage', () => {
    let mockApi: QuantdeskApi;

    const runtimeStatus: PiRuntimeStatus = {
        currentSessionId: 'session-1',
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
            names: ['analyze_asset'],
        },
        lastCheckedAt: '2026-04-21T10:00:00.000Z',
        lastError: null,
        lastStartedAt: '2026-04-21T09:59:00.000Z',
        model: {
            available: true,
            availableModels: ['gpt-4o'],
            model: 'gpt-4o',
            provider: 'github-copilot',
            source: 'runtime',
        },
        pid: 123,
        sessionCount: 1,
        state: 'ready',
        wrapperVersion: '1.0.0',
    };

    const riskGateState: PiRiskGateState = {
        acknowledged: true,
        acknowledgedAt: '2026-04-21T09:59:00.000Z',
        message: 'risk gate',
        required: true,
        riskLevel: 'high',
    };

    beforeEach(() => {
        resetPiAgentStore();
        useShellStore.setState({
            commandDeckOpen: false,
            isPrimaryRailCollapsed: false,
            isSidebarCollapsed: false,
        });

        const sessionSummary = createSessionSummary();
        const sessionRecord = createSessionRecord();

        mockApi = {
            piAgent: {
                cancelRun: vi.fn().mockResolvedValue({ cancelled: true }),
                deleteSession: vi.fn().mockResolvedValue(true),
                discardAttachments: vi.fn().mockResolvedValue(undefined),
                getSession: vi.fn().mockImplementation(async (sessionId: string) => (
                    sessionId === sessionSummary.id ? sessionRecord : null
                )),
                listSessions: vi.fn().mockResolvedValue([sessionSummary]),
                listSkills: vi.fn().mockResolvedValue([]),
                onStream: vi.fn().mockReturnValue(() => undefined),
                sendMessage: vi.fn().mockResolvedValue({ runId: 'run-1', sessionId: sessionSummary.id }),
                stageAttachments: vi.fn().mockResolvedValue({ attachments: [], rejected: [] }),
            },
            piRuntime: {
                acknowledgeHighPrivilegeRisk: vi.fn().mockResolvedValue(riskGateState),
                getRiskGateState: vi.fn().mockResolvedValue(riskGateState),
                getStatus: vi.fn().mockResolvedValue(runtimeStatus),
                openDirectory: vi.fn().mockResolvedValue(undefined),
            },
            settings: {
                delete: vi.fn().mockResolvedValue(undefined),
                get: vi.fn().mockResolvedValue(null),
                getAll: vi.fn().mockResolvedValue([]),
                set: vi.fn().mockResolvedValue(undefined),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        setApiClientOverride(null);
    });

    test('显示会话入口，并可展开线程栏', async () => {
        const user = userEvent.setup();

        render(<PiAgentPage />);

        expect(await screen.findByTestId('agent-open-history-overlay')).toBeInTheDocument();
        expect(screen.getByTestId('agent-open-history-overlay')).toHaveClass('max-w-[28rem]');
        expect(screen.getByTestId('agent-open-history-overlay')).toHaveAttribute('aria-controls', 'pi-history-overlay');
        expect(screen.getByTestId('agent-open-history-overlay')).toHaveAttribute('aria-haspopup', 'dialog');
        expect(screen.getByTestId('agent-open-history-overlay')).toHaveAttribute('aria-expanded', 'false');

        await user.click(screen.getByTestId('agent-open-history-overlay'));
        expect(screen.getByTestId('agent-open-history-overlay')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('dialog', { name: '会话历史' })).toHaveAttribute('id', 'pi-history-overlay');
        expect(screen.getByRole('searchbox', { name: '搜索会话' })).toBeInTheDocument();
    });

    test('历史弹层会在会话项上提供删除入口', async () => {
        const user = userEvent.setup();

        render(<PiAgentPage />);

        await user.click(await screen.findByTestId('agent-open-history-overlay'));
        await user.click(screen.getByRole('button', { name: '删除Pi 历史会话' }));

        expect(mockApi.piAgent.deleteSession).toHaveBeenCalledWith('session-1');
        expect(await screen.findByTestId('pi-agent-session-count')).toHaveTextContent('0');
    });
});
