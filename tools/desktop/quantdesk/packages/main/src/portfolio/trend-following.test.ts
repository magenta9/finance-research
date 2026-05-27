import { describe, expect, test } from 'vitest';

import { buildDateRange } from './portfolio-test-support';
import {
    combineSleeveReturns,
    simulateTrendFollowingSleeve,
} from './trend-following';

const buildPrices = (basePrice: number, drift: number, length = 180) =>
    Array.from({ length }, (_value, index) =>
        Number((basePrice * (1 + index * drift) * (1 + Math.sin(index / 6) * 0.012)).toFixed(4)));

describe('trend following sleeve simulation', () => {
    test('builds EWMAC forecasts, latest weights, and an equity path', () => {
        const alignedDates = buildDateRange(180);
        const trend = simulateTrendFollowingSleeve({
            alignedDates,
            assetIds: ['asset-spy', 'asset-agg'],
            assetNames: ['SPDR S&P 500 ETF Trust', 'US Aggregate Bond ETF'],
            priceSeries: [buildPrices(100, 0.0018), buildPrices(80, -0.0006)],
            strategyMix: {
                trendFollowing: {
                    enabled: true,
                    sleeveWeight: 0.35,
                },
            },
            symbols: ['SPY', 'AGG'],
        });

        expect(trend).not.toBeNull();
        expect(trend?.dailyReturns).toHaveLength(179);
        expect(trend?.path).toHaveLength(180);
        expect(trend?.latestWeights).toHaveLength(2);
        expect(trend?.ruleSlotCount).toBe(12);
        expect(trend?.assetDiagnostics[0]).toEqual(expect.objectContaining({
            activeLongRules: expect.any(Number),
            activeRuleCount: expect.any(Number),
            activeShortRules: expect.any(Number),
            symbol: 'SPY',
        }));
        expect(trend?.allowShort).toBe(true);
        expect(trend?.rules).toHaveLength(6);
    });

    test('allocates equal slots only to positive enabled rule signals when shorting is disabled', () => {
        const alignedDates = buildDateRange(120);
        const trend = simulateTrendFollowingSleeve({
            alignedDates,
            assetIds: ['asset-up', 'asset-down'],
            assetNames: ['Up Asset', 'Down Asset'],
            priceSeries: [
                Array.from({ length: 120 }, (_value, index) => 100 + index),
                Array.from({ length: 120 }, (_value, index) => 120 - index * 0.25),
            ],
            strategyMix: {
                trendFollowing: {
                    allowShort: false,
                    enabled: true,
                    rules: [{ enabled: true, fast: 2, slow: 8 }],
                    sleeveWeight: 0.3,
                },
            },
            symbols: ['UP', 'DOWN'],
        });

        expect(trend?.ruleSlotCount).toBe(2);
        expect(trend?.latestWeights[0]).toBeCloseTo(0.5, 6);
        expect(trend?.latestWeights[1]).toBeCloseTo(0, 6);
        expect(trend?.assetDiagnostics[1]).toEqual(expect.objectContaining({
            activeLongRules: 0,
            activeRuleCount: 0,
            activeShortRules: 0,
        }));
        expect(trend?.allowShort).toBe(false);
        expect(trend?.assetDiagnostics[0].latestPositionWeight).toBeCloseTo(0.15, 6);
    });

    test('allocates symmetric long and short slots when shorting is enabled', () => {
        const alignedDates = buildDateRange(120);
        const trend = simulateTrendFollowingSleeve({
            alignedDates,
            assetIds: ['asset-up', 'asset-down'],
            assetNames: ['Up Asset', 'Down Asset'],
            priceSeries: [
                Array.from({ length: 120 }, (_value, index) => 100 + index),
                Array.from({ length: 120 }, (_value, index) => 120 - index * 0.25),
            ],
            strategyMix: {
                trendFollowing: {
                    enabled: true,
                    rules: [{ enabled: true, fast: 2, slow: 8 }],
                    sleeveWeight: 0.3,
                },
            },
            symbols: ['UP', 'DOWN'],
        });

        expect(trend?.ruleSlotCount).toBe(2);
        expect(trend?.latestWeights[0]).toBeCloseTo(0.5, 6);
        expect(trend?.latestWeights[1]).toBeCloseTo(-0.5, 6);
        expect(trend?.assetDiagnostics[0]).toEqual(expect.objectContaining({
            activeLongRules: 1,
            activeRuleCount: 1,
            activeShortRules: 0,
            latestPositionWeight: expect.closeTo(0.15, 6),
        }));
        expect(trend?.assetDiagnostics[1]).toEqual(expect.objectContaining({
            activeLongRules: 0,
            activeRuleCount: 1,
            activeShortRules: 1,
            latestPositionWeight: expect.closeTo(-0.15, 6),
        }));
        expect(trend?.allowShort).toBe(true);
    });

    test('uses only configured trend assets when counting rule slots', () => {
        const alignedDates = buildDateRange(120);
        const trend = simulateTrendFollowingSleeve({
            alignedDates,
            assetIds: ['asset-up', 'asset-down'],
            assetNames: ['Up Asset', 'Down Asset'],
            priceSeries: [
                Array.from({ length: 120 }, (_value, index) => 100 + index),
                Array.from({ length: 120 }, (_value, index) => 120 + index),
            ],
            strategyMix: {
                trendFollowing: {
                    assetIds: ['asset-up'],
                    enabled: true,
                    rules: [{ enabled: true, fast: 2, slow: 8 }],
                    sleeveWeight: 0.3,
                },
            },
            symbols: ['UP', 'DOWN'],
        });

        expect(trend?.assetIds).toEqual(['asset-up']);
        expect(trend?.ruleSlotCount).toBe(1);
        expect(trend?.latestWeights).toHaveLength(2);
        expect(trend?.latestWeights[0]).toBeCloseTo(1, 6);
        expect(trend?.latestWeights[1]).toBeCloseTo(0, 6);
        expect(trend?.assetDiagnostics).toHaveLength(1);
        expect(trend?.assetDiagnostics[0].latestPositionWeight).toBeCloseTo(0.3, 6);
        expect(trend?.trades.some((trade) => trade.symbol === 'UP' && trade.action === 'open_long')).toBe(true);
    });

    test('records long and short trend actions as separate trade states', () => {
        const alignedDates = buildDateRange(220);
        const prices = [
            ...Array.from({ length: 70 }, (_value, index) => 100 + index * 0.8),
            ...Array.from({ length: 75 }, (_value, index) => 156 - index * 1.1),
            ...Array.from({ length: 75 }, (_value, index) => 73.5 + index * 1.05),
        ];
        const trend = simulateTrendFollowingSleeve({
            alignedDates,
            assetIds: ['asset-swing'],
            assetNames: ['Swing Asset'],
            priceSeries: [prices],
            strategyMix: {
                trendFollowing: {
                    enabled: true,
                    rules: [
                        { enabled: true, fast: 2, slow: 8 },
                        { enabled: true, fast: 8, slow: 32 },
                    ],
                    sleeveWeight: 1,
                },
            },
            symbols: ['SWING'],
        });

        const actions = new Set(trend?.trades.map((trade) => trade.action));

        expect(actions.has('open_long')).toBe(true);
        expect(actions.has('close_long')).toBe(true);
        expect(actions.has('open_short')).toBe(true);
        expect(actions.has('close_short')).toBe(true);
    });

    test('combines allocation and trend daily returns by sleeve weights', () => {
        const alignedDates = buildDateRange(4);
        const trend = {
            allowShort: true,
            assetIds: [],
            assetDiagnostics: [],
            dailyReturns: [0.02, -0.01, 0.03],
            forecastCap: 20,
            forecastDiversificationMultiplier: 1.35,
            latestWeights: [],
            path: [
                { date: alignedDates[0], equity: 1 },
                { date: alignedDates[1], equity: 1.02 },
                { date: alignedDates[2], equity: 1.0098 },
                { date: alignedDates[3], equity: 1.040094 },
            ],
            ruleSlotCount: 6,
            rules: [],
            sleeveWeight: 0.25,
            trades: [],
        };

        const combined = combineSleeveReturns({
            alignedDates,
            allocationEquity: [1, 1.01, 1.0201, 1.030301],
            trendFollowing: trend,
        });

        expect(combined.allocationSleeveWeight).toBe(0.75);
        expect(combined.combinedDailyReturns[0]).toBeCloseTo(0.0125, 6);
        expect(combined.path).toHaveLength(4);
        expect(combined.path[1].allocationEquity).toBeCloseTo(1.01, 6);
        expect(combined.path[1].trendFollowingEquity).toBeCloseTo(1.02, 6);
    });
});