import { describe, expect, test, vi } from 'vitest';

import type { DailyPriceRecord, FxRateRecord } from '@quantdesk/shared';

import { prepareAllocationData } from './preprocessor';
import {
    buildAsset,
    buildFxRateRows,
    buildPriceRows,
    getLatestFxRate,
} from './portfolio-test-support';
import type { AllocationPreparationReader } from './preparation-repository-adapter';

const buildRows = ({
    assetId,
    basePrice,
    length,
    startDate = '2024-01-01',
}: {
    assetId: string;
    basePrice: number;
    length: number;
    startDate?: string;
}) => buildPriceRows({
    assetId,
    basePrice,
    length,
    startDate,
    step: 0.35,
});

const createReader = ({
    allRowsByAsset,
    fxRatesByPair = {},
    rangeRowsByAsset,
}: {
    allRowsByAsset: Record<string, DailyPriceRecord[]>;
    fxRatesByPair?: Record<string, FxRateRecord[]>;
    rangeRowsByAsset: Record<string, DailyPriceRecord[]>;
}) => {
    const priceRepository = {
        getRange: vi.fn(({ assetId }: { assetId: string; endDate: string; startDate: string }) => rangeRowsByAsset[assetId] ?? []),
        listByAsset: vi.fn((assetId: string) => allRowsByAsset[assetId] ?? []),
    };
    const fxRateRepository = {
        getLatestRate: vi.fn((pair: string, onOrBeforeDate: string) =>
            getLatestFxRate(fxRatesByPair, pair, onOrBeforeDate)),
    };

    const reader: AllocationPreparationReader = {
        readAssets: () => [],
        readPreparationContext: ({ endDate, startDate }) => ({
            assets: [],
            requestedEndDate: endDate,
            requestedStartDate: startDate,
        }),
        readPriceHistory: ({ assetId, endDate, startDate }) => {
            if (startDate && endDate) {
                return priceRepository.getRange({ assetId, endDate, startDate });
            }

            return priceRepository.listByAsset(assetId);
        },
        readFxRates: ({ assetCurrency, baseCurrency, onOrBeforeDate }) => {
            const directPair = `${assetCurrency}/${baseCurrency}`;
            const directRate = fxRateRepository.getLatestRate(directPair, onOrBeforeDate);

            if (directRate) {
                return {
                    ...directRate,
                    pair: directPair,
                };
            }

            const inversePair = `${baseCurrency}/${assetCurrency}`;
            const inverseRate = fxRateRepository.getLatestRate(inversePair, onOrBeforeDate);
            if (!inverseRate) {
                return null;
            }

            return {
                date: inverseRate.date,
                pair: inversePair,
                rate: 1 / inverseRate.rate,
                source: inverseRate.source,
            };
        },
    };

    return {
        fxRateRepository,
        priceRepository,
        reader,
    };
};

describe('prepareAllocationData', () => {
    test('uses readPriceHistory range queries when a date window is provided and records coverage', () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const rangeRows = {
            'asset-a': buildRows({ assetId: 'asset-a', basePrice: 100, length: 100 }),
            'asset-b': buildRows({ assetId: 'asset-b', basePrice: 80, length: 100 }),
        };
        const { priceRepository, reader } = createReader({
            allRowsByAsset: rangeRows,
            rangeRowsByAsset: rangeRows,
        });

        const result = prepareAllocationData({
            assets,
            baseCurrency: 'USD',
            endDate: '2024-04-10',
            reader,
            startDate: '2024-01-01',
        });

        expect(priceRepository.getRange).toHaveBeenCalledTimes(2);
        expect(priceRepository.listByAsset).not.toHaveBeenCalled();
        expect(result.assetDateCoverage).toEqual([
            expect.objectContaining({
                assetId: 'asset-a',
                isFallback: false,
                requestedStartDate: '2024-01-01',
                tradingDays: 100,
            }),
            expect.objectContaining({
                assetId: 'asset-b',
                isFallback: false,
                requestedStartDate: '2024-01-01',
                tradingDays: 100,
            }),
        ]);
    });

    test('throws when the requested window cannot support common coverage', () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const { reader } = createReader({
            allRowsByAsset: {
                'asset-a': buildRows({ assetId: 'asset-a', basePrice: 100, length: 800 }),
                'asset-b': buildRows({ assetId: 'asset-b', basePrice: 80, length: 800 }),
            },
            rangeRowsByAsset: {
                'asset-a': buildRows({ assetId: 'asset-a', basePrice: 100, length: 30 }),
                'asset-b': buildRows({ assetId: 'asset-b', basePrice: 80, length: 30 }),
            },
        });

        expect(() => {
            prepareAllocationData({
                assets,
                baseCurrency: 'USD',
                endDate: '2024-12-31',
                reader,
                startDate: '2024-01-01',
            });
        }).toThrow(/共同覆盖不足\s*61\s*个交易日/);
    });

    test('keeps backward-compatible behavior when no date window is provided', () => {
        const assets = [
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const allRows = {
            'asset-a': buildRows({ assetId: 'asset-a', basePrice: 100, length: 100 }),
            'asset-b': buildRows({ assetId: 'asset-b', basePrice: 80, length: 100 }),
        };
        const { priceRepository, reader } = createReader({
            allRowsByAsset: allRows,
            rangeRowsByAsset: {},
        });

        const result = prepareAllocationData({
            assets,
            baseCurrency: 'USD',
            reader,
        });

        expect(priceRepository.getRange).not.toHaveBeenCalled();
        expect(priceRepository.listByAsset).toHaveBeenCalledTimes(2);
        expect(result.assetDateCoverage.every((coverage) => coverage.isFallback === false)).toBe(true);
    });

    test('excludes assets whose full history is still insufficient', () => {
        const assets = [
            buildAsset('asset-short', 'GLD', 'commodity'),
            buildAsset('asset-a', 'SPY', 'equity'),
            buildAsset('asset-b', 'AGG', 'fixed_income'),
        ];
        const { reader } = createReader({
            allRowsByAsset: {
                'asset-short': buildRows({ assetId: 'asset-short', basePrice: 50, length: 40 }),
                'asset-a': buildRows({ assetId: 'asset-a', basePrice: 100, length: 100 }),
                'asset-b': buildRows({ assetId: 'asset-b', basePrice: 80, length: 100 }),
            },
            rangeRowsByAsset: {
                'asset-short': buildRows({ assetId: 'asset-short', basePrice: 50, length: 10 }),
                'asset-a': buildRows({ assetId: 'asset-a', basePrice: 100, length: 100 }),
                'asset-b': buildRows({ assetId: 'asset-b', basePrice: 80, length: 100 }),
            },
        });

        const result = prepareAllocationData({
            assets,
            baseCurrency: 'USD',
            endDate: '2024-04-10',
            reader,
            startDate: '2024-01-01',
        });

        expect(result.excludedAssets).toContain('asset-short');
        expect(result.series).toHaveLength(2);
        expect(result.warnings).toEqual(
            expect.arrayContaining([
                'GLD 历史数据不足 60 个交易日。',
            ]),
        );
    });

    test('normalizes cross-market prices into the requested base currency', () => {
        const assets = [
            buildAsset('asset-cny', '511010', 'fixed_income', { currency: 'CNY' }),
            buildAsset('asset-usd', 'SPY', 'equity', { currency: 'USD' }),
        ];
        const rowsByAsset = {
            'asset-cny': buildRows({ assetId: 'asset-cny', basePrice: 100, length: 90 }),
            'asset-usd': buildRows({ assetId: 'asset-usd', basePrice: 50, length: 90 }),
        };
        const { fxRateRepository, reader } = createReader({
            allRowsByAsset: rowsByAsset,
            fxRatesByPair: {
                'USD/CNY': buildFxRateRows({ length: 90, pair: 'USD/CNY', rate: 7.2 }),
            },
            rangeRowsByAsset: rowsByAsset,
        });

        const result = prepareAllocationData({
            assets,
            baseCurrency: 'CNY',
            endDate: '2024-03-30',
            reader,
            startDate: '2024-01-01',
        });

        expect(fxRateRepository.getLatestRate).toHaveBeenCalledWith('USD/CNY', '2024-01-01');
        expect(result.series[0]?.prices[0]).toBeCloseTo(100, 6);
        expect(result.series[1]?.prices[0]).toBeCloseTo(360, 6);
    });
});