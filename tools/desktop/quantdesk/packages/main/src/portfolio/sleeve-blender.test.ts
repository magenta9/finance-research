import { describe, expect, test } from 'vitest';

import type { AllocationTrade } from '@quantdesk/shared';

import { blendAllocationSleeves, scaleAllocationTrade } from './sleeve-blender';
import type { TrendFollowingSimulationResult } from './trend-following';

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

const buildTrendFollowing = (overrides: Partial<TrendFollowingSimulationResult> = {}): TrendFollowingSimulationResult => ({
    allowShort: true,
    assetDiagnostics: [],
    assetIds: ['asset-a', 'asset-b'],
    dailyReturns: [],
    forecastCap: 20,
    forecastDiversificationMultiplier: 1,
    latestWeights: [0.2, -0.1],
    path: [],
    ruleSlotCount: 2,
    rules: [],
    sleeveWeight: 0.4,
    trades: [{
        ...allocationTrade,
        assetId: 'asset-b',
        source: 'trend_following',
        symbol: 'BBB',
        toWeight: -0.04,
        weightChange: 0.04,
    }],
    ...overrides,
});

describe('sleeve blender', () => {
    test('returns allocation-only weights and trades without trend following', () => {
        const result = blendAllocationSleeves({
            allocationTrades: [allocationTrade],
            weights: [0.6, 0.4],
        });

        expect(result.allocationSleeveWeight).toBe(1);
        expect(result.effectiveWeights).toEqual([0.6, 0.4]);
        expect(result.trades).toEqual([allocationTrade]);
    });

    test('blends allocation and trend-following sleeve weights', () => {
        const result = blendAllocationSleeves({
            allocationSleeveWeight: 0.6,
            allocationTrades: [allocationTrade],
            trendFollowing: buildTrendFollowing(),
            weights: [0.5, 0.5],
        });

        expect(result.allocationSleeveWeight).toBe(0.6);
        expect(result.effectiveWeights[0]).toBeCloseTo(0.38, 6);
        expect(result.effectiveWeights[1]).toBeCloseTo(0.26, 6);
        expect(result.trades[0]).toEqual(expect.objectContaining({ toWeight: 0.36, weightChange: 0.36 }));
        expect(result.trades[1]).toEqual(expect.objectContaining({ source: 'trend_following' }));
    });

    test('scales allocation trades consistently', () => {
        expect(scaleAllocationTrade(allocationTrade, 0.5)).toEqual(expect.objectContaining({
            fromWeight: 0,
            toWeight: 0.3,
            weightChange: 0.3,
        }));
    });
});
