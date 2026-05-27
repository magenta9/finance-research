import { describe, expect, test, vi } from 'vitest';

import { SyncQueue } from './sync-queue';

describe('SyncQueue', () => {
    test('deduplicates identical tasks and shares one promise', async () => {
        const queue = new SyncQueue({ backgroundDelayMs: 0 });
        const execute = vi.fn().mockResolvedValue({
            attemptedSources: ['akshare'],
            insertedRows: 3,
            warnings: [],
        });

        const first = queue.enqueue({
            endDate: '2026-04-13',
            execute,
            key: 'price:asset-1:2026-04-01:2026-04-13',
            kind: 'price',
            priority: 'background',
            startDate: '2026-04-01',
            target: 'asset-1',
        });
        const second = queue.enqueue({
            endDate: '2026-04-13',
            execute,
            key: 'price:asset-1:2026-04-01:2026-04-13',
            kind: 'price',
            priority: 'interactive',
            startDate: '2026-04-01',
            target: 'asset-1',
        });

        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(firstResult.taskId).toBe(secondResult.taskId);
        expect(firstResult.priority).toBe('interactive');
    });

    test('promotes interactive tasks ahead of background tasks', async () => {
        const queue = new SyncQueue({ backgroundDelayMs: 0 });
        const order: string[] = [];

        const first = queue.enqueue({
            endDate: '2026-04-13',
            execute: async () => {
                order.push('background-1');
                return { attemptedSources: ['akshare'], insertedRows: 1, warnings: [] };
            },
            key: 'price:a',
            kind: 'price',
            priority: 'background',
            startDate: '2026-04-01',
            target: 'a',
        });
        const second = queue.enqueue({
            endDate: '2026-04-13',
            execute: async () => {
                order.push('background-2');
                return { attemptedSources: ['akshare'], insertedRows: 1, warnings: [] };
            },
            key: 'price:b',
            kind: 'price',
            priority: 'background',
            startDate: '2026-04-01',
            target: 'b',
        });
        const third = queue.enqueueFront({
            endDate: '2026-04-13',
            execute: async () => {
                order.push('interactive');
                return { attemptedSources: ['yfinance'], insertedRows: 2, warnings: [] };
            },
            key: 'price:c',
            kind: 'price',
            priority: 'interactive',
            startDate: '2026-04-01',
            target: 'c',
        });

        await Promise.all([first, second, third]);

        expect(order[0]).toBe('background-1');
        expect(order[1]).toBe('interactive');
        expect(order[2]).toBe('background-2');
    });

    test('reports status changes to subscribers', async () => {
        const queue = new SyncQueue({ backgroundDelayMs: 0 });
        const listener = vi.fn();
        const unsubscribe = queue.subscribe(listener);

        await queue.enqueue({
            endDate: '2026-04-13',
            execute: async () => ({ attemptedSources: ['akshare'], insertedRows: 1, warnings: ['warn'] }),
            key: 'fx:USD/CNY',
            kind: 'fx',
            priority: 'interactive',
            startDate: '2026-04-01',
            target: 'USD/CNY',
        });

        unsubscribe();

        expect(listener).toHaveBeenCalled();
        expect(queue.getStatus()).toEqual(expect.objectContaining({
            completedTasks: 1,
            failedTasks: 0,
            lastWarning: 'warn',
            queuedTasks: 0,
            running: false,
        }));
    });
});