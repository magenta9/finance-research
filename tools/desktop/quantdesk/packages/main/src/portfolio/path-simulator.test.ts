import { describe, expect, test } from 'vitest';

import { simulatePortfolioPath } from './path-simulator';

describe('simulatePortfolioPath', () => {
    test('simulates buy-and-hold paths without rebalance events', () => {
        const result = simulatePortfolioPath({
            alignedDates: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'],
            priceSeries: [
                [100, 101, 102.01, 103.0301, 104.060401],
                [200, 202, 204.02, 206.0602, 208.120802],
            ],
            rebalanceCadence: 'none',
            targetWeights: [0.5, 0.5],
        });

        expect(result.portfolioEquity).toEqual([1, 1.01, 1.0201, 1.030301, 1.04060401]);
        expect(result.portfolioPath).toEqual([
            { date: '2026-01-05', equity: 1 },
            { date: '2026-01-06', equity: 1.01 },
            { date: '2026-01-07', equity: 1.0201 },
            { date: '2026-01-08', equity: 1.030301 },
            { date: '2026-01-09', equity: 1.04060401 },
        ]);
        expect(result.rebalanceEventCount).toBe(0);
        expect(result.metrics.expectedReturn).toBeCloseTo(2.52, 10);
        expect(result.metrics.volatility).toBeCloseTo(0, 10);
        expect(result.metrics.sharpeRatio).toBe(0);
        expect(result.metrics.maxDrawdown).toBe(0);
    });

    test('does not invent trade identifiers when asset metadata is missing', () => {
        const result = simulatePortfolioPath({
            alignedDates: ['2026-01-08', '2026-01-09', '2026-01-12'],
            priceSeries: [
                [100, 200, 200],
                [100, 100, 200],
            ],
            rebalanceCadence: 'weekly',
            targetWeights: [0.5, 0.5],
        });

        expect(result.portfolioEquity).toEqual([1, 1.5, 2.25]);
        expect(result.trades).toEqual([]);
    });

    test('rebalances on the last available trading day of a month', () => {
        const result = simulatePortfolioPath({
            alignedDates: ['2026-01-30', '2026-01-31', '2026-02-03'],
            priceSeries: [
                [100, 200, 200],
                [100, 100, 200],
            ],
            rebalanceCadence: 'monthly',
            targetWeights: [0.5, 0.5],
        });

        expect(result.rebalanceEventCount).toBe(1);
        expect(result.portfolioEquity).toEqual([1, 1.5, 2.25]);
    });

    test('rebalances on the last available trading day of a week', () => {
        const result = simulatePortfolioPath({
            alignedDates: ['2026-01-08', '2026-01-09', '2026-01-12'],
            priceSeries: [
                [100, 200, 200],
                [100, 100, 200],
            ],
            rebalanceCadence: 'weekly',
            targetWeights: [0.5, 0.5],
        });

        expect(result.rebalanceEventCount).toBe(1);
        expect(result.portfolioEquity).toEqual([1, 1.5, 2.25]);
    });

    test('rebalances on the last available trading day of a quarter', () => {
        const result = simulatePortfolioPath({
            alignedDates: ['2026-03-30', '2026-03-31', '2026-04-01'],
            priceSeries: [
                [100, 200, 200],
                [100, 100, 200],
            ],
            rebalanceCadence: 'quarterly',
            targetWeights: [0.5, 0.5],
        });

        expect(result.rebalanceEventCount).toBe(1);
        expect(result.portfolioEquity).toEqual([1, 1.5, 2.25]);
    });

    test('does not emit monthly rebalances when the window stays inside one month', () => {
        const result = simulatePortfolioPath({
            alignedDates: ['2026-01-05', '2026-01-06', '2026-01-07'],
            priceSeries: [
                [100, 101, 102],
                [100, 100, 100],
            ],
            rebalanceCadence: 'monthly',
            targetWeights: [0.5, 0.5],
        });

        expect(result.rebalanceEventCount).toBe(0);
    });

    test('returns zeroed risk metrics when prices never move', () => {
        const result = simulatePortfolioPath({
            alignedDates: ['2026-01-05', '2026-01-06', '2026-01-07'],
            priceSeries: [
                [100, 100, 100],
                [50, 50, 50],
            ],
            rebalanceCadence: 'quarterly',
            targetWeights: [0.6, 0.4],
        });

        expect(result.metrics.expectedReturn).toBe(0);
        expect(result.metrics.volatility).toBe(0);
        expect(result.metrics.sharpeRatio).toBe(0);
        expect(result.metrics.maxDrawdown).toBe(0);
    });
});