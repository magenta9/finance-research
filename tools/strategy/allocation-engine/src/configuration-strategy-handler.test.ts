import { describe, expect, test, vi } from 'vitest';

import type { AllocationConstraints } from '@quantdesk/shared';

import { buildAllocationAnalysisInput } from './allocation-analysis-input';
import { createConfigurationStrategyHandler } from './configuration-strategy-handler';
import { buildAsset, buildDateRange } from './portfolio-test-support';
import type { PreparedAllocationData } from './preprocessor';
import type { StrategyOptimizationRequest } from './strategy-registry';

const baseConstraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 1,
};

const buildPrepared = (length = 80): PreparedAllocationData => {
    const alignedDates = buildDateRange(length);
    const assets = [
        buildAsset('asset-a', 'AAA', 'equity'),
        buildAsset('asset-b', 'BBB', 'fixed_income'),
    ];

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
        series: assets.map((asset, assetIndex) => ({
            annualizedReturn: 0,
            annualizedVolatility: 0,
            asset,
            prices: Array.from({ length }, (_value, dayIndex) => {
                const drift = assetIndex === 0 && dayIndex >= 62 ? 0.006 : 0.0015;
                return Number((100 * (1 + drift) ** dayIndex).toFixed(4));
            }),
        })),
        warnings: [],
    };
};

describe('createConfigurationStrategyHandler', () => {
    test('re-optimizes configuration weights on weekly rebalance days', async () => {
        const prepared = buildPrepared();
        const analysisInputResult = buildAllocationAnalysisInput(prepared);

        expect(analysisInputResult.ok).toBe(true);
        if (!analysisInputResult.ok) {
            return;
        }

        const optimize = vi.fn(async (request: StrategyOptimizationRequest) => ({
            diagnostics: {},
            ok: true as const,
            optimizer: 'js' as const,
            weights: request.prepared.alignedDates.length < 70 ? [0.8, 0.2] : [0.2, 0.8],
        }));

        const outcome = await createConfigurationStrategyHandler('inverse_volatility').run({
            analysisInput: analysisInputResult.analysisInput,
            baseCurrency: 'USD',
            calculationDateRange: {
                endDate: prepared.alignedDates.at(-1) ?? '',
                startDate: prepared.alignedDates[0] ?? '',
            },
            constraints: baseConstraints,
            mode: 'inverse_volatility',
            optimize,
            prepared,
            rebalanceCadence: 'weekly',
        });

        expect(outcome.stage).toBe('completed');
        expect(optimize).toHaveBeenCalledWith(expect.objectContaining({
            prepared,
        }));
        expect(optimize).toHaveBeenCalledWith(expect.objectContaining({
            prepared: expect.objectContaining({
                alignedDates: expect.arrayContaining([prepared.alignedDates[60]]),
            }),
        }));
        expect(optimize.mock.calls.some(([request]) => request.prepared.alignedDates.length < prepared.alignedDates.length)).toBe(true);
        expect(outcome.result.diagnostics.rebalanceEventCount).toBeGreaterThan(0);
        expect(outcome.result.diagnostics.trades).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source: 'allocation',
                toWeight: 0.8,
            }),
        ]));
    });

    test('keeps single-optimization behavior when rebalance cadence is none', async () => {
        const prepared = buildPrepared();
        const analysisInputResult = buildAllocationAnalysisInput(prepared);

        expect(analysisInputResult.ok).toBe(true);
        if (!analysisInputResult.ok) {
            return;
        }

        const optimize = vi.fn(async () => ({
            diagnostics: {},
            ok: true as const,
            optimizer: 'js' as const,
            weights: [0.2, 0.8],
        }));

        const outcome = await createConfigurationStrategyHandler('inverse_volatility').run({
            analysisInput: analysisInputResult.analysisInput,
            baseCurrency: 'USD',
            calculationDateRange: {
                endDate: prepared.alignedDates.at(-1) ?? '',
                startDate: prepared.alignedDates[0] ?? '',
            },
            constraints: baseConstraints,
            mode: 'inverse_volatility',
            optimize,
            prepared,
            rebalanceCadence: 'none',
        });

        expect(outcome.stage).toBe('completed');
        expect(optimize).toHaveBeenCalledTimes(1);
        expect(outcome.result.diagnostics.rebalanceEventCount).toBe(0);
    });
});
