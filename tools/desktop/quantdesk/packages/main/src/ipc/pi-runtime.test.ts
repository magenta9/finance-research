import { describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    shell: {
        openPath: vi.fn(async () => ''),
    },
}));

vi.mock('electron', () => ({
    shell: mocks.shell,
}));

import { createPiRuntimeHandlers } from './pi-runtime';

describe('createPiRuntimeHandlers', () => {
    test('returns pi runtime status and opens the requested directory', async () => {
        const handlers = createPiRuntimeHandlers({
            getStatus: vi.fn(async () => ({
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
            })),
        } as never, {
            acknowledgeHighPrivilegeRisk: vi.fn(() => ({
                acknowledged: true,
                acknowledgedAt: '2026-04-21T10:01:00.000Z',
                message: 'risk gate',
                required: true,
                riskLevel: 'high' as const,
            })),
            getRiskGateState: vi.fn(() => ({
                acknowledged: false,
                acknowledgedAt: null,
                message: 'risk gate',
                required: true,
                riskLevel: 'high' as const,
            })),
        });

        await expect(handlers.getStatus()).resolves.toEqual(expect.objectContaining({
            currentSessionId: 'session-1',
            state: 'ready',
        }));
        await expect(handlers.getRiskGateState()).resolves.toEqual(expect.objectContaining({
            acknowledged: false,
        }));

        await handlers.openDirectory('workspaceDir');
        expect(mocks.shell.openPath).toHaveBeenCalledWith('/tmp/workspace');
    });
});