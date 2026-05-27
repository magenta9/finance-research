import { afterEach, describe, expect, test, vi } from 'vitest';

import { ipcContract, listIpcContractEntries } from '@quantdesk/shared/ipc-contract';

import { createQuantdeskApi } from './api';

describe('preload IPC contract', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    test('creates a callable wrapper for every shared IPC manifest entry', async () => {
        const invoke = vi.fn().mockResolvedValue(undefined);
        const send = vi.fn();
        const unsubscribe = vi.fn();
        const subscribe = vi.fn().mockReturnValue(unsubscribe);
        const api = createQuantdeskApi(invoke, send, subscribe) as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>;

        for (const entry of listIpcContractEntries()) {
            const method = api[entry.namespace][entry.method];
            expect(typeof method, `${entry.namespace}.${entry.method}`).toBe('function');

            if (entry.transport === 'invoke') {
                await method();
                expect(invoke).toHaveBeenLastCalledWith(entry.channel);
                continue;
            }

            if (entry.transport === 'send') {
                const payload = { method: entry.method };
                method(payload);
                expect(send).toHaveBeenLastCalledWith(entry.channel, payload);
                continue;
            }

            const listener = vi.fn();
            const unlisten = method(listener);
            expect(subscribe).toHaveBeenLastCalledWith(entry.channel, listener);
            expect(unlisten).toBe(unsubscribe);
        }
    });

    test('uses manifest timeout overrides for long-running invoke channels', async () => {
        vi.useFakeTimers();

        const invoke = vi.fn(() => new Promise(() => undefined));
        const send = vi.fn();
        const api = createQuantdeskApi(invoke, send);

        const pending = api.portfolio.runAllocation(undefined as never);
        const rejection = pending.then(
            () => new Error('Expected invocation to time out.'),
            (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(60_000);

        const error = await rejection;

        expect(error).toBeInstanceOf(Error);

        if (!(error instanceof Error)) {
            throw new Error('Expected an Error rejection.');
        }

        expect(error.message).toBe(`IPC 调用超时：${ipcContract.portfolio.runAllocation.channel}（60000ms）`);
        expect(send).toHaveBeenCalledWith(
            ipcContract.log.write.channel,
            expect.objectContaining({
                context: expect.objectContaining({
                    args: [undefined],
                    timeoutMs: 60_000,
                }),
                level: 'warn',
                message: `IPC timeout: ${ipcContract.portfolio.runAllocation.channel} (60000ms)`,
                source: 'preload',
            }),
        );
    });

    test('redacts sensitive research payloads from timeout logs', async () => {
        vi.useFakeTimers();

        const invoke = vi.fn(() => new Promise(() => undefined));
        const send = vi.fn();
        const api = createQuantdeskApi(invoke, send);

        const pending = api.research.startResearch({
            query: '恒生科技 private thesis',
            riskProfile: null,
        });
        const rejection = pending.then(
            () => new Error('Expected invocation to time out.'),
            (error: unknown) => error,
        );
        await vi.advanceTimersByTimeAsync(120_000);
        await rejection;

        expect(send).toHaveBeenCalledWith(
            ipcContract.log.write.channel,
            expect.objectContaining({
                context: expect.objectContaining({
                    args: ['[redacted]'],
                    timeoutMs: 120_000,
                }),
            }),
        );
    });
});