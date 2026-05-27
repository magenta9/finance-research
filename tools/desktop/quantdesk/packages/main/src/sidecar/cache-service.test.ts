import { describe, expect, test, vi } from 'vitest';

import { CacheService } from './cache-service';

describe('CacheService', () => {
    test('returns cache summary and clears price/fx repositories', () => {
        const clearPrices = vi.fn();
        const clearFx = vi.fn();
        const service = new CacheService({
            assets: { list: () => [{ id: 'asset-1' }] as never[] },
            fxRates: { clearAll: clearFx, count: () => 5 },
            prices: { clearAll: clearPrices, count: () => 10, getLatestFetchedAt: () => '2026-04-15T00:00:00.000Z' },
        }, () => ({
            activeTask: null,
            completedTasks: 0,
            failedTasks: 0,
            lastWarning: null,
            queuedTasks: 0,
            recentEvents: [],
            running: false,
        }));

        expect(service.getCacheSummary()).toEqual({
            assetCount: 1,
            fxRateRowCount: 5,
            latestPriceFetchAt: '2026-04-15T00:00:00.000Z',
            priceRowCount: 10,
        });

        const result = service.clearCache();

        expect(clearPrices).toHaveBeenCalledTimes(1);
        expect(clearFx).toHaveBeenCalledTimes(1);
        expect(result.cacheSummary.assetCount).toBe(1);
    });
});