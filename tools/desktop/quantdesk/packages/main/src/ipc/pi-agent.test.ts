import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dialog } from 'electron';
import { describe, expect, test, vi } from 'vitest';

import { createPiAgentHandlers } from '../pi/ipc-handlers';

vi.mock('electron', () => ({
    dialog: {
        showOpenDialog: vi.fn(),
    },
}));

describe('createPiAgentHandlers', () => {
    test('blocks sendMessage until the high privilege risk is acknowledged', async () => {
        const handlers = createPiAgentHandlers({
            cancelRun: vi.fn(),
            getSessionRunStatus: vi.fn(() => null),
            getSessionTranscript: vi.fn(async () => ({
                cwd: '/tmp/workspace',
                messages: [],
                model: null,
                path: '/tmp/session-1.json',
                sessionId: 'session-1',
                thinkingLevel: 'balanced',
            })),
            getStatus: vi.fn(async () => ({
                currentSessionId: null,
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
                    names: [],
                },
                lastCheckedAt: null,
                lastError: null,
                lastStartedAt: null,
                model: {
                    available: false,
                    availableModels: [],
                    model: null,
                    provider: null,
                    source: 'unknown',
                },
                pid: null,
                sessionCount: 0,
                state: 'stopped',
                wrapperVersion: null,
            })),
            listSessions: vi.fn(async () => []),
            listToolInvocations: vi.fn(async () => []),
            sendMessage: vi.fn(async () => ({ runId: 'run-1', sessionId: 'session-1' })),
            subscribe: vi.fn(() => () => undefined),
        } as never, {
            acknowledgeHighPrivilegeRisk: vi.fn(),
            getRiskGateState: vi.fn(() => ({
                acknowledged: false,
                acknowledgedAt: null,
                message: 'risk gate',
                required: true,
                riskLevel: 'high' as const,
            })),
        });

        await expect(handlers.sendMessage({ message: 'hello' })).rejects.toThrow('尚未确认高权限风险');
    });

    test('delegates sendMessage once the risk gate is acknowledged', async () => {
        const sendMessage = vi.fn(async () => ({ runId: 'run-1', sessionId: 'session-1' }));
        const handlers = createPiAgentHandlers({
            cancelRun: vi.fn(),
            getSessionRunStatus: vi.fn(() => null),
            getSessionTranscript: vi.fn(async () => ({
                cwd: '/tmp/workspace',
                messages: [],
                model: null,
                path: '/tmp/session-1.json',
                sessionId: 'session-1',
                thinkingLevel: 'balanced',
            })),
            getStatus: vi.fn(async () => ({
                currentSessionId: null,
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
                    names: [],
                },
                lastCheckedAt: null,
                lastError: null,
                lastStartedAt: null,
                model: {
                    available: false,
                    availableModels: [],
                    model: null,
                    provider: null,
                    source: 'unknown',
                },
                pid: null,
                sessionCount: 0,
                state: 'stopped',
                wrapperVersion: null,
            })),
            listSessions: vi.fn(async () => []),
            listToolInvocations: vi.fn(async () => []),
            sendMessage,
            subscribe: vi.fn(() => () => undefined),
        } as never, {
            acknowledgeHighPrivilegeRisk: vi.fn(),
            getRiskGateState: vi.fn(() => ({
                acknowledged: true,
                acknowledgedAt: '2026-04-21T10:00:00.000Z',
                message: 'risk gate',
                required: true,
                riskLevel: 'high' as const,
            })),
        });

        await expect(handlers.sendMessage({ message: 'hello' })).resolves.toEqual({
            runId: 'run-1',
            sessionId: 'session-1',
        });
        expect(sendMessage).toHaveBeenCalledWith({ attachments: [], message: 'hello', sessionId: undefined });
    });

    test('resolves staged attachments before delegating sendMessage', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantdesk-pi-ipc-'));
        const sourcePath = path.join(tempDir, 'notes.md');
        const workspaceDir = path.join(tempDir, 'workspace');
        fs.mkdirSync(workspaceDir, { recursive: true });
        fs.writeFileSync(sourcePath, '# Notes\nUse the attached context.');

        try {
            vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [sourcePath] });
            const sendMessage = vi.fn(async () => ({ runId: 'run-1', sessionId: 'session-1' }));
            const handlers = createPiAgentHandlers({
                cancelRun: vi.fn(),
                getSessionRunStatus: vi.fn(() => null),
                getSessionTranscript: vi.fn(async () => ({
                    cwd: workspaceDir,
                    messages: [],
                    model: null,
                    path: path.join(tempDir, 'sessions', 'session-1.jsonl'),
                    sessionId: 'session-1',
                    thinkingLevel: 'balanced',
                })),
                getStatus: vi.fn(async () => ({
                    currentSessionId: null,
                    degraded: false,
                    degradedReason: null,
                    diagnostics: [],
                    directories: {
                        agentDir: path.join(tempDir, 'config'),
                        sessionDir: path.join(tempDir, 'sessions'),
                        toolInvocationDir: path.join(tempDir, 'tools'),
                        workspaceDir,
                    },
                    financeTools: {
                        available: true,
                        lastError: null,
                        names: [],
                    },
                    lastCheckedAt: null,
                    lastError: null,
                    lastStartedAt: null,
                    model: {
                        available: false,
                        availableModels: [],
                        model: null,
                        provider: null,
                        source: 'unknown',
                    },
                    pid: null,
                    sessionCount: 0,
                    state: 'stopped',
                    wrapperVersion: null,
                })),
                listSessions: vi.fn(async () => []),
                listToolInvocations: vi.fn(async () => []),
                sendMessage,
                subscribe: vi.fn(() => () => undefined),
            } as never, {
                acknowledgeHighPrivilegeRisk: vi.fn(),
                getRiskGateState: vi.fn(() => ({
                    acknowledged: true,
                    acknowledgedAt: '2026-04-21T10:00:00.000Z',
                    message: 'risk gate',
                    required: true,
                    riskLevel: 'high' as const,
                })),
            });

            const staged = await handlers.stageAttachments();
            await handlers.sendMessage({ attachments: staged.attachments, message: 'hello' });

            expect(staged.attachments).toEqual([expect.objectContaining({
                kind: 'text_document',
                name: 'notes.md',
            })]);
            expect(sendMessage).toHaveBeenCalledWith({
                attachments: [expect.objectContaining({
                    kind: 'text_document',
                    name: 'notes.md',
                    path: expect.stringContaining(path.join('attachments', staged.attachments[0]!.id)),
                })],
                message: 'hello',
                sessionId: undefined,
            });
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });
});