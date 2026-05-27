import { describe, expect, test } from 'vitest';

import type { AllocationTrade } from '@quantdesk/shared';

import { buildAllocationDiagnostics } from './allocation-diagnostics';
import type { PreparedAllocationData } from './preprocessor';
import type { TrendFollowingSimulationResult } from './trend-following';

const prepared: PreparedAllocationData = {
    alignedDates: ['2026-01-01', '2026-01-02'],
    assetDateCoverage: [],
    excludedAssets: ['excluded-a'],
    series: [],
    warnings: ['prepared warning'],
};

const trade: AllocationTrade = {
    action: 'open_long',
    assetId: 'asset-a',
    date: '2026-01-02',
    fromWeight: 0,
    name: 'Asset A',
    reason: '配置建仓',
    source: 'allocation',
    symbol: 'AAA',
    toWeight: 0.5,
    weightChange: 0.5,
};

const trendFollowing: TrendFollowingSimulationResult = {
    allowShort: true,
    assetDiagnostics: [{
        activeLongRules: 1,
        activeRuleCount: 2,
        activeShortRules: 1,
        assetId: 'asset-b',
        averageAbsForecast: 0.4,
        latestForecast: -0.2,
        latestPositionWeight: -0.1,
        symbol: 'BBB',
    }],
    assetIds: ['asset-b'],
    dailyReturns: [],
    forecastCap: 20,
    forecastDiversificationMultiplier: 1.5,
    latestWeights: [0, -0.1],
    path: [],
    ruleSlotCount: 1,
    rules: [{ fast: 16, scalar: 1, slow: 64, weight: 1 }],
    sleeveWeight: 0.4,
    trades: [],
};

describe('allocation diagnostics', () => {
    test('builds base diagnostics and strategy mix diagnostics', () => {
        const diagnostics = buildAllocationDiagnostics({
            allocationAssetIds: ['asset-a'],
            allocationSleeveWeight: 0.6,
            calculationDateRange: { endDate: '2026-01-31', startDate: '2026-01-01' },
            optimizer: 'js',
            optimizerDiagnostics: {
                fallbackReason: 'singular_matrix',
                fallbackUsed: true,
                warnings: ['optimizer warning'],
            },
            prepared,
            rebalanceEventCount: 2,
            strategy: 'erc',
            trades: [trade],
            trendFollowing,
        });

        expect(diagnostics).toEqual(expect.objectContaining({
            alignedDates: 2,
            fallbackReason: 'singular_matrix',
            fallbackUsed: true,
            metricComputation: 'portfolio_path_simulation',
            rebalanceEventCount: 2,
            solverPath: 'js',
            warnings: ['prepared warning', 'optimizer warning'],
        }));
        expect(diagnostics.strategyMix).toEqual(expect.objectContaining({
            allocation: { assetIds: ['asset-a'] },
            allocationSleeveWeight: 0.6,
        }));
        expect(diagnostics.strategyMix?.trendFollowing).toEqual(expect.objectContaining({
            allowShort: true,
            assetIds: ['asset-b'],
            enabled: true,
            sleeveWeight: 0.4,
        }));
        expect(diagnostics.trendFollowing?.assets).toEqual(trendFollowing.assetDiagnostics);
        expect(diagnostics.trades).toEqual([trade]);
    });

    test('omits strategy mix when no secondary strategy is present', () => {
        const diagnostics = buildAllocationDiagnostics({
            allocationSleeveWeight: 1,
            calculationDateRange: { endDate: '2026-01-31', startDate: '2026-01-01' },
            optimizer: 'python',
            optimizerDiagnostics: {},
            prepared,
            rebalanceEventCount: 0,
            strategy: 'inverse_volatility',
            trades: [],
        });

        expect(diagnostics.strategyMix).toBeUndefined();
        expect(diagnostics.trendFollowing).toBeUndefined();
    });
});
