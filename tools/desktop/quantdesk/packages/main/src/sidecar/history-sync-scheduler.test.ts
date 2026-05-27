import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { HistorySyncScheduler } from './history-sync-scheduler';

describe('HistorySyncScheduler', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('runs hourly incomplete-history sync in background mode', async () => {
        const ensure = vi.fn().mockResolvedValue({
            priceSummary: {
                insertedRows: 0,
                skippedAssetIds: [],
                synchronizedAssetIds: [],
                warnings: [],
            },
        });
        const scheduler = new HistorySyncScheduler({
            ensure,
        } as never);

        scheduler.start();
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

        expect(ensure).toHaveBeenCalledWith({ intent: 'maintenance', priority: 'background', scope: 'repair-incomplete-history' });

        scheduler.stop();
    });

    test('skips overlapping hourly runs while the previous one is still active', async () => {
        let resolveRun!: () => void;
        const ensure = vi.fn().mockImplementation(
            () => new Promise<void>((resolve) => {
                resolveRun = resolve;
            }),
        );
        const scheduler = new HistorySyncScheduler({
            ensure,
        } as never);

        scheduler.start();
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

        expect(ensure).toHaveBeenCalledTimes(1);

        resolveRun();
        await Promise.resolve();
        scheduler.stop();
    });
});