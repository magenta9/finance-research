import { describe, expect, test } from 'vitest';

import type { AllocationConstraints, StoredAsset } from '@quantdesk/shared';

import type { AllocationAnalysisInput } from './allocation-analysis-input';
import {
    appendMaxDiversificationCashReserve,
    applyCorrelationAwareCashScale,
    resolveAbsoluteMomentumEligibleIndices,
    resolveMaxDiversificationOptimizationInput,
} from './max-diversification-research';
import { buildAsset, buildDateRange } from './portfolio-test-support';
import type { PreparedAllocationData } from './preprocessor';

const constraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 0.5,
};

const makeSeries = (start: number, drift: number, length = 260) =>
    Array.from({ length }, (_value, index) => Number((start * (1 + drift) ** index).toFixed(4)));

const buildPrepared = (assets: StoredAsset[], priceSeries: number[][]): PreparedAllocationData => {
    const alignedDates = buildDateRange(priceSeries[0]?.length ?? 0);

    return {
        alignedDates,
        assetDateCoverage: assets.map((asset) => ({
            actualEndDate: alignedDates.at(-1) ?? '',
            actualStartDate: alignedDates[0] ?? '',
            assetId: asset.id,
            isFallback: false,
            requestedStartDate: alignedDates[0] ?? '',
            symbol: asset.symbol,
            tradingDays: alignedDates.length,
        })),
        excludedAssets: [],
        series: assets.map((asset, index) => ({
            annualizedReturn: 0,
            annualizedVolatility: 0,
            asset,
            prices: priceSeries[index],
        })),
        warnings: [],
    };
};

const identityCovariance = (size: number) => Array.from({ length: size }, (_row, rowIndex) =>
    Array.from({ length: size }, (_column, columnIndex) => rowIndex === columnIndex ? 0.04 : 0));

const buildAnalysisInput = (assetCount: number): AllocationAnalysisInput => ({
    annualizedAssetVolatility: Array.from({ length: assetCount }, () => 0.2),
    annualizedMeanReturns: Array.from({ length: assetCount }, () => 0.08),
    shrunkCovariance: identityCovariance(assetCount),
});

describe('max diversification research v3', () => {
    test('filters eligible assets with multi-horizon absolute momentum', () => {
        const assets = [
            buildAsset('asset-a', 'AAA', 'equity'),
            buildAsset('asset-b', 'BBB', 'equity'),
            buildAsset('asset-c', 'CCC', 'fixed_income'),
        ];
        const prepared = buildPrepared(assets, [
            makeSeries(100, 0.003),
            makeSeries(100, -0.002),
            makeSeries(100, 0.001),
        ]);

        expect(resolveAbsoluteMomentumEligibleIndices(prepared, {
            absoluteMomentumLookbackDaysList: [50, 125, 252],
            absoluteMomentumMinPositiveCount: 2,
            absoluteMomentumThreshold: 0,
        })).toEqual([0, 2]);
    });

    test('keeps the strongest momentum asset when every asset fails the threshold', () => {
        const assets = [
            buildAsset('asset-a', 'AAA', 'equity'),
            buildAsset('asset-b', 'BBB', 'equity'),
            buildAsset('asset-c', 'CCC', 'fixed_income'),
        ];
        const prepared = buildPrepared(assets, [
            makeSeries(100, -0.003),
            makeSeries(100, -0.001),
            makeSeries(100, -0.002),
        ]);

        expect(resolveAbsoluteMomentumEligibleIndices(prepared, {
            absoluteMomentumLookbackDaysList: [50, 125, 252],
            absoluteMomentumMinPositiveCount: 2,
            absoluteMomentumThreshold: 0,
        })).toEqual([1]);
    });

    test('overrides constraints and scales cash by momentum breadth', () => {
        const assets = [
            buildAsset('asset-a', 'AAA', 'equity'),
            buildAsset('asset-b', 'BBB', 'equity'),
            buildAsset('asset-c', 'CCC', 'fixed_income'),
            buildAsset('asset-d', 'DDD', 'commodity'),
        ];
        const prepared = buildPrepared(assets, [
            makeSeries(100, 0.003),
            makeSeries(100, 0.002),
            makeSeries(100, -0.001),
            makeSeries(100, -0.002),
        ]);
        const input = resolveMaxDiversificationOptimizationInput({
            allocationAssetIndexes: [0, 1, 2, 3],
            analysisInput: buildAnalysisInput(4),
            constraints,
            prepared,
        });

        expect(input.assetIndexes).toEqual([0, 1]);
        expect(input.constraints.maxSingleWeight).toBe(0.6);
        expect(input.cashReserve).toBe(0.875);
        expect(input.annualizedAssetVolatility).toEqual([1, 1]);
        expect(input.covariance).toHaveLength(2);
        expect(input.assemblyCovariance).toHaveLength(4);
    });

    test('raises cash reserve when average pairwise correlation exceeds the floor', () => {
        const highCorrelation = [
            [0.04, 0.035, 0.032],
            [0.035, 0.04, 0.034],
            [0.032, 0.034, 0.04],
        ];

        expect(applyCorrelationAwareCashScale({
            assetIndexes: [0, 1, 2],
            baseCashReserve: 0.2,
            correlationFloor: 0.35,
            correlationScale: 0.75,
            covariance: highCorrelation,
        })).toBeGreaterThan(0.2);
    });

    test('applies correlation-aware cash scaling in the optimization input', () => {
        const assets = [
            buildAsset('asset-a', 'AAA', 'equity'),
            buildAsset('asset-b', 'BBB', 'equity'),
            buildAsset('asset-c', 'CCC', 'fixed_income'),
        ];
        const prepared = buildPrepared(assets, [
            makeSeries(100, 0.003),
            makeSeries(100, 0.002),
            makeSeries(100, 0.001),
        ]);
        const highCorrelationCovariance = [
            [0.04, 0.035, 0.032],
            [0.035, 0.04, 0.034],
            [0.032, 0.034, 0.04],
        ];
        const analysisInput: AllocationAnalysisInput = {
            annualizedAssetVolatility: [0.2, 0.2, 0.2],
            annualizedMeanReturns: [0.08, 0.08, 0.08],
            shrunkCovariance: highCorrelationCovariance,
        };
        const baseline = resolveMaxDiversificationOptimizationInput({
            allocationAssetIndexes: [0, 1, 2],
            analysisInput,
            constraints,
            prepared,
        });
        const withCorrelationAwareCash = resolveMaxDiversificationOptimizationInput({
            allocationAssetIndexes: [0, 1, 2],
            analysisInput,
            config: {
                correlationAwareCashFloor: 0.35,
                correlationAwareCashScale: 0.75,
            },
            constraints,
            prepared,
        });

        expect(withCorrelationAwareCash.cashReserve).toBeGreaterThan(baseline.cashReserve);
    });

    test('appends a synthetic cash reserve asset for result assembly', () => {
        const assets = [
            buildAsset('asset-a', 'AAA', 'equity'),
            buildAsset('asset-b', 'BBB', 'fixed_income'),
        ];
        const prepared = buildPrepared(assets, [
            makeSeries(100, 0.003),
            makeSeries(100, 0.002),
        ]);
        const output = appendMaxDiversificationCashReserve({
            baseCurrency: 'USD',
            cashReserve: 0.25,
            covariance: identityCovariance(2),
            meanReturns: [0.1, 0.05],
            prepared,
            volatility: [0.2, 0.1],
            weights: [0.6, 0.4],
        });

        expect(output.weights[0]).toBeCloseTo(0.45);
        expect(output.weights[1]).toBeCloseTo(0.3);
        expect(output.weights[2]).toBeCloseTo(0.25);
        expect(output.prepared.series.at(-1)?.asset).toEqual(expect.objectContaining({
            assetClass: 'cash',
            currency: 'USD',
            symbol: 'CASH_RESERVE',
        }));
        expect(output.prepared.series.at(-1)?.prices).toEqual(prepared.alignedDates.map(() => 1));
        expect(output.covariance).toHaveLength(3);
        expect(output.meanReturns.at(-1)).toBe(0);
        expect(output.volatility.at(-1)).toBe(0);
    });
});
