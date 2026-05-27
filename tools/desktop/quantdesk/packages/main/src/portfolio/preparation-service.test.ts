import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { DailyPriceRecord, FxRateRecord, StoredAsset } from '@quantdesk/shared';

import {
    buildAsset,
    buildPriceRows,
    getLatestFxRate,
} from './portfolio-test-support';
import { AllocationPreparationService } from './preparation-service';
import type { AllocationPreparationReader } from './preparation-repository-adapter';

const createReader = ({
    assets,
    fxRatesByPair = {},
    priceRowsByAsset,
}: {
    assets: StoredAsset[];
    fxRatesByPair?: Record<string, FxRateRecord[]>;
    priceRowsByAsset: Record<string, DailyPriceRecord[]>;
}): AllocationPreparationReader => ({
    readAssets: (assetIds) => {
        const assetIdSet = new Set(assetIds);
        return assets.filter((asset) => assetIdSet.has(asset.id));
    },
    readPreparationContext: ({ assetIds, endDate, startDate }) => ({
        assets: assets.filter((asset) => assetIds.includes(asset.id)),
        requestedEndDate: endDate,
        requestedStartDate: startDate,
    }),
    readPriceHistory: ({ assetId, endDate, startDate }) => {
        const rows = priceRowsByAsset[assetId] ?? [];

        if (!startDate || !endDate) {
            return rows;
        }

        return rows.filter((row) => row.date >= startDate && row.date <= endDate);
    },
    readFxRates: ({ assetCurrency, baseCurrency, onOrBeforeDate }) => {
        const directPair = `${assetCurrency}/${baseCurrency}`;
        const directRate = getLatestFxRate(fxRatesByPair, directPair, onOrBeforeDate);

        if (directRate) {
            return {
                ...directRate,
                pair: directPair,
            };
        }

        return null;
    },
});

describe('allocation preparation service', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('clamps out-of-range dates and synchronizes allocation history through the market-data cluster', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const marketDataOrchestrator = {
            ensure: vi.fn().mockResolvedValue({ warnings: [] }),
        };
        const service = new AllocationPreparationService({
            clock: () => new Date('2026-04-15T12:00:00.000Z'),
            marketDataOrchestrator,
            reader: createReader({
                assets,
                priceRowsByAsset: {
                    'asset-a': buildPriceRows({ assetId: 'asset-a', basePrice: 100, length: 90, startDate: '2025-04-15' }),
                    'asset-b': buildPriceRows({ assetId: 'asset-b', basePrice: 80, length: 90, startDate: '2025-04-15' }),
                },
            }),
        });

        const result = await service.prepare({
            assetIds: ['asset-a', 'asset-b'],
            baseCurrency: 'USD',
            endDate: '2027-01-01',
            startDate: '2010-01-01',
        });

        expect(marketDataOrchestrator.ensure).toHaveBeenCalledWith({
            assetIds: ['asset-a', 'asset-b'],
            intent: 'allocation',
            priority: 'interactive',
            window: {
                endDate: '2026-04-15',
                startDate: '2021-04-16',
            },
        });
        expect(result.ok).toBe(true);

        if (!result.ok) {
            throw new Error('Expected preparation to succeed.');
        }

        expect(result.effectiveDateRange).toEqual({
            endDate: '2026-04-15',
            startDate: '2021-04-16',
        });
        expect(result.calculationDateRange).toEqual({
            endDate: '2025-07-13',
            startDate: '2025-04-15',
        });
    });

    test('falls back to the default one-year window when dates are ordered incorrectly', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const marketDataOrchestrator = {
            ensure: vi.fn().mockResolvedValue({ warnings: [] }),
        };
        const service = new AllocationPreparationService({
            clock: () => new Date('2026-04-15T12:00:00.000Z'),
            marketDataOrchestrator,
            reader: createReader({
                assets,
                priceRowsByAsset: {
                    'asset-a': buildPriceRows({ assetId: 'asset-a', basePrice: 100, length: 90, startDate: '2025-04-15' }),
                    'asset-b': buildPriceRows({ assetId: 'asset-b', basePrice: 80, length: 90, startDate: '2025-04-15' }),
                },
            }),
        });

        const result = await service.prepare({
            assetIds: ['asset-a', 'asset-b'],
            baseCurrency: 'USD',
            endDate: '2024-01-01',
            startDate: '2024-01-01',
        });

        expect(result.ok).toBe(true);

        if (!result.ok) {
            throw new Error('Expected preparation to succeed.');
        }

        expect(result.effectiveDateRange).toEqual({
            endDate: '2026-04-15',
            startDate: '2025-04-15',
        });
        expect(result.calculationDateRange).toEqual({
            endDate: '2025-07-13',
            startDate: '2025-04-15',
        });
    });

    test('returns a structured insufficient history error instead of throwing', async () => {
        const assets = [
            buildAsset('short-a', 'SPY', 'equity'),
            buildAsset('short-b', 'QQQ', 'equity'),
        ];
        const service = new AllocationPreparationService({
            clock: () => new Date('2026-04-15T12:00:00.000Z'),
            marketDataOrchestrator: {
                ensure: vi.fn().mockResolvedValue({ warnings: [] }),
            },
            reader: createReader({
                assets,
                priceRowsByAsset: {
                    'short-a': buildPriceRows({ assetId: 'short-a', basePrice: 100, length: 40, startDate: '2025-04-15' }),
                    'short-b': buildPriceRows({ assetId: 'short-b', basePrice: 80, length: 40, startDate: '2025-04-15' }),
                },
            }),
        });

        const result = await service.prepare({
            assetIds: ['short-a', 'short-b'],
            baseCurrency: 'USD',
        });

        expect(result.ok).toBe(false);

        if (result.ok) {
            throw new Error('Expected preparation to fail.');
        }

        expect(result.error).toEqual(
            expect.objectContaining({
                code: 'INSUFFICIENT_HISTORY',
            }),
        );
    });

    test('returns a typed missing asset error', async () => {
        const service = new AllocationPreparationService({
            marketDataOrchestrator: {
                ensure: vi.fn().mockResolvedValue({ warnings: [] }),
            },
            reader: createReader({
                assets: [buildAsset('asset-a', 'SPY', 'equity')],
                priceRowsByAsset: {
                    'asset-a': buildPriceRows({ assetId: 'asset-a', basePrice: 100, length: 90, startDate: '2025-04-15' }),
                },
            }),
        });

        const result = await service.prepare({
            assetIds: ['asset-a', 'missing-asset'],
            baseCurrency: 'USD',
        });

        expect(result.ok).toBe(false);

        if (result.ok) {
            throw new Error('Expected preparation to fail.');
        }

        expect(result.error).toEqual(expect.objectContaining({ code: 'MISSING_ASSETS' }));
    });

    test('returns a typed missing FX rate error', async () => {
        const assets = [
            buildAsset('asset-hk', '2800', 'equity', { currency: 'HKD', market: 'HK' }),
            buildAsset('asset-us', 'SPY', 'equity', { currency: 'USD', market: 'US' }),
        ];
        const service = new AllocationPreparationService({
            marketDataOrchestrator: {
                ensure: vi.fn().mockResolvedValue({ warnings: [] }),
            },
            reader: createReader({
                assets,
                priceRowsByAsset: {
                    'asset-hk': buildPriceRows({ assetId: 'asset-hk', basePrice: 100, length: 90, startDate: '2025-04-15' }),
                    'asset-us': buildPriceRows({ assetId: 'asset-us', basePrice: 80, length: 90, startDate: '2025-04-15' }),
                },
            }),
        });

        const result = await service.prepare({
            assetIds: ['asset-hk', 'asset-us'],
            baseCurrency: 'USD',
        });

        expect(result.ok).toBe(false);

        if (result.ok) {
            throw new Error('Expected preparation to fail.');
        }

        expect(result.error).toEqual(expect.objectContaining({ code: 'FX_RATE_MISSING' }));
    });

    test('merges sync warnings with preparation warnings', async () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
            buildAsset('asset-short', 'GLD', 'commodity'),
        ];
        const service = new AllocationPreparationService({
            marketDataOrchestrator: {
                ensure: vi.fn().mockResolvedValue({
                    warnings: [{ message: 'Sidecar sync warning' }],
                }),
            },
            reader: createReader({
                assets,
                priceRowsByAsset: {
                    'asset-a': buildPriceRows({ assetId: 'asset-a', basePrice: 100, length: 90, startDate: '2025-04-15' }),
                    'asset-b': buildPriceRows({ assetId: 'asset-b', basePrice: 80, length: 90, startDate: '2025-04-15' }),
                    'asset-short': buildPriceRows({ assetId: 'asset-short', basePrice: 60, length: 40, startDate: '2025-04-15' }),
                },
            }),
        });

        const result = await service.prepare({
            assetIds: ['asset-a', 'asset-b', 'asset-short'],
            baseCurrency: 'USD',
        });

        expect(result.ok).toBe(true);

        if (!result.ok) {
            throw new Error('Expected preparation to succeed.');
        }

        expect(result.prepared.warnings).toEqual([
            'Sidecar sync warning',
            'GLD 历史数据不足 60 个交易日。',
        ]);
    });
});