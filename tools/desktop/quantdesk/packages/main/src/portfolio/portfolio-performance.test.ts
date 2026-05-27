import { describe, expect, test } from 'vitest';

import {
    buildPortfolioPathFromDailyReturns,
    computePortfolioCalmarRatio,
    computePortfolioMaxDrawdown,
    computePortfolioMetricsFromDailyReturns,
    computePortfolioWinRate,
    meanPortfolioValues,
} from './portfolio-performance';

describe('portfolio performance helpers', () => {
    test('builds equity path from daily returns', () => {
        const result = buildPortfolioPathFromDailyReturns(['2026-01-01', '2026-01-02', '2026-01-03'], [0.1, -0.05]);

        expect(result.equityCurve).toEqual([1, 1.1, 1.045]);
        expect(result.path).toEqual([
            { date: '2026-01-01', equity: 1 },
            { date: '2026-01-02', equity: 1.1 },
            { date: '2026-01-03', equity: 1.045 },
        ]);
    });

    test('computes shared portfolio metrics and extended ratios', () => {
        const dailyReturns = [0.02, -0.01, 0.03];
        const { equityCurve } = buildPortfolioPathFromDailyReturns(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'], dailyReturns);
        const metrics = computePortfolioMetricsFromDailyReturns(dailyReturns, equityCurve);

        expect(meanPortfolioValues(dailyReturns)).toBeCloseTo(0.0133333333, 10);
        expect(metrics.expectedReturn).toBeCloseTo(3.36, 10);
        expect(metrics.maxDrawdown).toBeCloseTo(computePortfolioMaxDrawdown(equityCurve), 10);
        expect(metrics.volatility).toBeGreaterThan(0);
        expect(metrics.sharpeRatio).toBeGreaterThan(0);
        expect(computePortfolioWinRate(dailyReturns)).toBeCloseTo(2 / 3, 10);
        expect(computePortfolioCalmarRatio(metrics.expectedReturn, metrics.maxDrawdown)).toBe(metrics.expectedReturn / metrics.maxDrawdown);
    });
});
