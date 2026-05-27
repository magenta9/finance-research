import { describe, expect, test, vi } from 'vitest';

import { SidecarRuntime } from './runtime';

describe('SidecarRuntime', () => {
    test('uses manager readiness and call behind a single runtime boundary', async () => {
        const manager = {
            call: vi.fn().mockResolvedValue({ status: 'ok' }),
            ensureReady: vi.fn().mockResolvedValue(undefined),
            getStatus: vi.fn().mockReturnValue({
                endpoint: 'ws://127.0.0.1:8765',
                lastDiagnostic: null,
                lastError: null,
                lastFault: null,
                restartCount: 0,
                sidecarPid: 123,
                sidecarPort: 8765,
                sidecarReady: true,
                state: 'ready',
            }),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const runtime = new SidecarRuntime(manager as never);

        await expect(runtime.call('health_check')).resolves.toEqual({ status: 'ok' });

        expect(manager.ensureReady).toHaveBeenCalledTimes(1);
        expect(manager.call).toHaveBeenCalledWith('health_check', undefined, undefined);
        expect(runtime.snapshot()).toEqual({
            endpoint: 'ws://127.0.0.1:8765',
            healthy: true,
            lastDiagnostic: null,
            lastError: null,
            pid: 123,
            restartCount: 0,
            state: 'ready',
        });
    });

    test('maps degraded manager status into a structured snapshot', () => {
        const runtime = new SidecarRuntime({
            call: vi.fn(),
            ensureReady: vi.fn(),
            getStatus: vi.fn().mockReturnValue({
                endpoint: null,
                lastDiagnostic: {
                    level: 'warn',
                    message: 'leftover stderr',
                    raw: 'leftover stderr',
                    source: 'stderr',
                    timestamp: '2026-04-22T00:00:00.000Z',
                },
                lastError: 'leftover stderr',
                lastFault: {
                    kind: 'diagnostic',
                    message: 'leftover stderr',
                    timestamp: '2026-04-22T00:00:00.000Z',
                },
                restartCount: 2,
                sidecarPid: null,
                sidecarPort: null,
                sidecarReady: false,
                state: 'degraded',
            }),
            stop: vi.fn(),
        } as never);

        expect(runtime.snapshot()).toEqual({
            endpoint: null,
            healthy: false,
            lastDiagnostic: {
                level: 'warn',
                message: 'leftover stderr',
                raw: 'leftover stderr',
                source: 'stderr',
                timestamp: '2026-04-22T00:00:00.000Z',
            },
            lastError: {
                kind: 'diagnostic',
                message: 'leftover stderr',
                timestamp: '2026-04-22T00:00:00.000Z',
            },
            pid: null,
            restartCount: 2,
            state: 'degraded',
        });
    });
});