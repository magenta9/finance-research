import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import { runActiveDualMomentumBacktest } from './active-dual-momentum';
import { buildAsset, buildDateRange } from './portfolio-test-support';

const buildTrend = (basePrice: number, drift: number, length: number) =>
    Array.from({ length }, (_value, index) => Number((basePrice * (1 + drift) ** index).toFixed(4)));

const buildCovariance = (assetCount: number) =>
    Array.from({ length: assetCount }, (_rowValue, rowIndex) =>
        Array.from({ length: assetCount }, (_columnValue, columnIndex) =>
            rowIndex === columnIndex ? 0.0004 : 0.00005,
        ),
    );

const buildPrepared = (assets: StoredAsset[], prices: number[][]): PreparedAllocationData => {
    const alignedDates = buildDateRange(prices[0]?.length ?? 0, '2024-01-01');

    return {
        alignedDates,
        assetDateCoverage: assets.map((asset) => ({
            actualEndDate: alignedDates.at(-1) ?? alignedDates[0],
            actualStartDate: alignedDates[0],
            assetId: asset.id,
            isFallback: false,
            requestedStartDate: alignedDates[0],
            symbol: asset.symbol,
            tradingDays: alignedDates.length,
        })),
        excludedAssets: [],
        series: assets.map((asset, index) => ({
            annualizedReturn: 0,
            annualizedVolatility: 0,
            asset,
            prices: prices[index],
        })),
        warnings: [],
    };
};

describe('runActiveDualMomentumBacktest', () => {
    test('runs ETF and futures mixed pools with explicit long and short directions', () => {
        const length = 520;
        const assets = [
            buildAsset('asset-etf-up', 'SPY', 'equity', { market: 'US' }),
            buildAsset('asset-etf-down', 'TLT', 'fixed_income', { market: 'US' }),
            buildAsset('asset-future-up', 'RB9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
            buildAsset('asset-future-down', 'FU9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
        ];
        const prepared = buildPrepared(assets, [
            buildTrend(100, 0.0012, length),
            buildTrend(120, -0.0002, length),
            buildTrend(80, 0.0015, length),
            buildTrend(90, -0.0018, length),
        ]);

        const result = runActiveDualMomentumBacktest({
            annualizedMeanReturns: [0.08, -0.02, 0.12, -0.15],
            annualizedVolatility: [0.16, 0.12, 0.28, 0.31],
            baseCurrency: 'USD',
            calculationDateRange: { startDate: prepared.alignedDates[0], endDate: prepared.alignedDates.at(-1) ?? prepared.alignedDates[0] },
            config: { researchProfile: { crossSignOffsetCash: false } } as Parameters<typeof runActiveDualMomentumBacktest>[0]['config'],
            covariance: buildCovariance(assets.length),
            prepared,
        });

        expect(result.error).toBeUndefined();
        expect(result.strategy).toBe('active_dual_momentum_gtaa');
        expect(result.rebalanceCadence).toBe('weekly');
        expect(result.portfolioPath).toHaveLength(length);
        expect(result.diagnostics.activeDualMomentum?.status).toBe('ok');
        expect(result.diagnostics.activeDualMomentum?.rebalanceRecords.length).toBeGreaterThan(26);
        expect(result.diagnostics.activeDualMomentum?.maxNominalExposure).toBeGreaterThan(0);
        expect(result.diagnostics.trades?.length).toBeGreaterThan(0);
        expect(result.correlationMatrix.labels).toEqual(['SPY', 'TLT', 'RB9999', 'FU9999']);
        expect(result.correlationMatrix.matrix).toHaveLength(4);
        expect(result.correlationMatrix.matrix[0]?.[0]).toBeCloseTo(1, 6);

        const latestHoldings = result.diagnostics.activeDualMomentum?.rebalanceRecords.at(-1)?.holdings ?? [];
        expect(latestHoldings.every((holding) => holding.weight >= 0)).toBe(true);
        expect(latestHoldings).toEqual(expect.arrayContaining([
            expect.objectContaining({ direction: 'short', symbol: 'FU9999' }),
            expect.objectContaining({ direction: 'long', symbol: 'RB9999' }),
        ]));
        expect(result.allocations.every((allocation) => allocation.weight >= 0 && allocation.direction)).toBe(true);
    });

    test('uses warmup prices for signals while reporting the requested calculation window', () => {
        const length = 360;
        const calculationStartDate = '2025-05-27';
        const assets = [
            buildAsset('asset-etf-up', 'SPY', 'equity', { market: 'US' }),
            buildAsset('asset-etf-down', 'TLT', 'fixed_income', { market: 'US' }),
            buildAsset('asset-future-up', 'RB9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
            buildAsset('asset-future-down', 'FU9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
        ];
        const prepared = buildPrepared(assets, [
            buildTrend(100, 0.0012, length),
            buildTrend(120, -0.0002, length),
            buildTrend(80, 0.0015, length),
            buildTrend(90, -0.0018, length),
        ]);
        prepared.alignedDates = buildDateRange(length, '2024-11-01');
        prepared.assetDateCoverage = prepared.assetDateCoverage.map((coverage) => ({
            ...coverage,
            actualEndDate: prepared.alignedDates.at(-1) ?? prepared.alignedDates[0],
            actualStartDate: prepared.alignedDates[0],
            requestedStartDate: prepared.alignedDates[0],
            tradingDays: prepared.alignedDates.length,
        }));

        const result = runActiveDualMomentumBacktest({
            annualizedMeanReturns: [0.08, -0.02, 0.12, -0.15],
            annualizedVolatility: [0.16, 0.12, 0.28, 0.31],
            baseCurrency: 'USD',
            calculationDateRange: { startDate: calculationStartDate, endDate: prepared.alignedDates.at(-1) ?? calculationStartDate },
            covariance: buildCovariance(assets.length),
            prepared,
        });

        expect(result.portfolioPath?.[0]).toEqual({ date: calculationStartDate, equity: 1 });
        expect(result.portfolioPath?.slice(1, 10).some((point) => point.equity !== 1)).toBe(true);
        expect(result.diagnostics.alignedDates).toBe(result.portfolioPath?.length);
        expect((result.diagnostics.activeDualMomentum?.rebalanceRecords[0]?.date ?? '') >= calculationStartDate).toBe(true);
    });

    test('uses configured topK to control the number of selected momentum holdings', () => {
        const length = 520;
        const assets = [
            buildAsset('asset-1', 'AAA', 'equity', { market: 'US' }),
            buildAsset('asset-2', 'BBB', 'equity', { market: 'US' }),
            buildAsset('asset-3', 'CCC', 'equity', { market: 'US' }),
            buildAsset('asset-4', 'DDD', 'equity', { market: 'US' }),
            buildAsset('asset-5', 'EEE', 'equity', { market: 'US' }),
            buildAsset('asset-6', 'FFF', 'equity', { market: 'US' }),
        ];
        const prepared = buildPrepared(assets, [
            buildTrend(100, 0.0018, length),
            buildTrend(100, 0.0016, length),
            buildTrend(100, 0.0014, length),
            buildTrend(100, 0.0012, length),
            buildTrend(100, 0.0010, length),
            buildTrend(100, 0.0008, length),
        ]);
        const commonInput = {
            annualizedMeanReturns: [0.18, 0.16, 0.14, 0.12, 0.1, 0.08],
            annualizedVolatility: [0.2, 0.19, 0.18, 0.17, 0.16, 0.15],
            baseCurrency: 'USD' as const,
            calculationDateRange: { startDate: prepared.alignedDates[0], endDate: prepared.alignedDates.at(-1) ?? prepared.alignedDates[0] },
            covariance: buildCovariance(assets.length),
            prepared,
        };

        const topThreeResult = runActiveDualMomentumBacktest({
            ...commonInput,
            config: { absoluteMomentumFilter: false, topK: 3 },
        });
        const topFiveResult = runActiveDualMomentumBacktest({
            ...commonInput,
            config: { absoluteMomentumFilter: false, topK: 5 },
        });

        expect(topThreeResult.diagnostics.activeDualMomentum?.rebalanceRecords.at(-1)?.holdings).toHaveLength(3);
        expect(topFiveResult.diagnostics.activeDualMomentum?.rebalanceRecords.at(-1)?.holdings).toHaveLength(5);
        expect(topFiveResult.diagnostics.activeDualMomentum?.rebalanceRecords.at(-1)?.holdings.map((holding) => holding.symbol)).toEqual([
            'AAA',
            'BBB',
            'CCC',
            'DDD',
            'EEE',
        ]);
    });
});
