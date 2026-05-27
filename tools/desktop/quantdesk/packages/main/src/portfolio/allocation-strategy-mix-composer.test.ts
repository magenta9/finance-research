import { describe, expect, test } from 'vitest';

import type { AllocationTrade, PortfolioMetrics, PortfolioPathPoint } from '@quantdesk/shared';

import { composeAllocationStrategyMix } from './allocation-strategy-mix-composer';
import type { TrendFollowingSimulationResult } from './trend-following';

const allocationMetrics: PortfolioMetrics = {
    expectedReturn: 0.05,
    maxDrawdown: 0.1,
    sharpeRatio: 1,
    volatility: 0.08,
};

const allocationPath: PortfolioPathPoint[] = [
    { date: '2026-01-01', equity: 1 },
    { date: '2026-01-02', equity: 1.01 },
];

const allocationTrade: AllocationTrade = {
    action: 'open_long',
    assetId: 'asset-a',
    date: '2026-01-01',
    fromWeight: 0,
    name: 'Asset A',
    reason: '配置建仓',
    source: 'allocation',
    symbol: 'AAA',
    toWeight: 0.6,
    weightChange: 0.6,
};

const trendTrade: AllocationTrade = {
    ...allocationTrade,
    assetId: 'asset-b',
    source: 'trend_following',
    symbol: 'BBB',
    toWeight: -0.2,
    weightChange: 0.2,
};

const trendFollowing: TrendFollowingSimulationResult = {
    allowShort: true,
    assetDiagnostics: [],
    assetIds: ['asset-a', 'asset-b'],
    dailyReturns: [0, 0.02],
    forecastCap: 20,
    forecastDiversificationMultiplier: 1,
    latestWeights: [0.25, -0.25],
    path: [
        { date: '2026-01-01', equity: 1 },
        { date: '2026-01-02', equity: 1.02 },
    ],
    ruleSlotCount: 1,
    rules: [],
    sleeveWeight: 0.4,
    trades: [trendTrade],
};

describe('allocation strategy mix composer', () => {
    test('passes through allocation-only path, metrics, weights, and trades', () => {
        const result = composeAllocationStrategyMix({
            alignedDates: ['2026-01-01', '2026-01-02'],
            allocationEquity: [1, 1.01],
            allocationMetrics,
            allocationPath,
            allocationTrades: [allocationTrade],
            weights: [0.6, 0.4],
        });

        expect(result.allocationSleeveWeight).toBe(1);
        expect(result.effectiveWeights).toEqual([0.6, 0.4]);
        expect(result.metrics).toBe(allocationMetrics);
        expect(result.path).toBe(allocationPath);
        expect(result.trades).toEqual([allocationTrade]);
    });

    test('composes allocation and trend-following sleeves', () => {
        const result = composeAllocationStrategyMix({
            alignedDates: ['2026-01-01', '2026-01-02'],
            allocationEquity: [1, 1.01],
            allocationMetrics,
            allocationPath,
            allocationTrades: [allocationTrade],
            trendFollowing,
            weights: [0.5, 0.5],
        });

        expect(result.allocationSleeveWeight).toBeCloseTo(0.6, 6);
        expect(result.effectiveWeights[0]).toBeCloseTo(0.4, 6);
        expect(result.effectiveWeights[1]).toBeCloseTo(0.2, 6);
        expect(result.path[1]).toEqual(expect.objectContaining({
            allocationEquity: 1.01,
            date: '2026-01-02',
            trendFollowingEquity: 1.02,
        }));
        expect(result.metrics).not.toBe(allocationMetrics);
        expect(result.trades).toHaveLength(2);
    });
});
