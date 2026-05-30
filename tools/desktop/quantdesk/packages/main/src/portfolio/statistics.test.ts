import { describe, expect, test } from 'vitest';

import {
    computeSingleAssetMetrics,
    annualizedReturns,
    annualizedVolatility,
    computeLogReturns,
    correlationMatrix,
    covarianceMatrix,
    shrinkCovarianceMatrix,
} from './statistics';

describe('portfolio statistics', () => {
    test('computes log returns, covariance, correlation and annualized metrics from a known dataset', () => {
        const prices = [
            [100, 105, 110, 120],
            [50, 51, 50, 52],
        ];
        const returns = computeLogReturns(prices);
        const covariance = covarianceMatrix(returns);
        const correlations = correlationMatrix(covariance);
        const meanReturns = annualizedReturns(returns);
        const volatility = annualizedVolatility(covariance);

        expect(returns[0][0]).toBeCloseTo(Math.log(105 / 100), 8);
        expect(returns[0][2]).toBeCloseTo(Math.log(120 / 110), 8);
        expect(covariance[0][0]).toBeGreaterThan(0);
        expect(covariance[1][1]).toBeGreaterThan(0);
        expect(covariance[0][1]).toBeCloseTo(covariance[1][0], 12);
        expect(correlations[0][0]).toBeCloseTo(1, 12);
        expect(correlations[1][1]).toBeCloseTo(1, 12);
        expect(meanReturns[0]).toBeGreaterThan(meanReturns[1]);
        expect(volatility[0]).toBeGreaterThan(0);
        expect(volatility[1]).toBeGreaterThan(0);
    });

    test('shrinks a near-singular covariance matrix into a positive definite matrix', () => {
        const sample = [
            [0.0400, 0.0399],
            [0.0399, 0.0398],
        ];
        const shrunk = shrinkCovarianceMatrix(sample);
        const determinant = shrunk[0][0] * shrunk[1][1] - shrunk[0][1] * shrunk[1][0];

        expect(shrunk[0][0]).toBeGreaterThan(0);
        expect(shrunk[1][1]).toBeGreaterThan(0);
        expect(determinant).toBeGreaterThan(0);
    });

    test('returns null metrics for empty single-asset prices', () => {
        const result = computeSingleAssetMetrics({ prices: [], currency: 'CNY' });

        expect(result.analyticsAvailability).toBe('unavailable');
        expect(result.analysisSeries).toBeNull();
        expect(result.priceBasis).toBe('close');
        expect(result.tradingDays).toBe(0);
        expect(result.latestValue).toBeNull();
        expect(result.periodReturn).toBeNull();
        expect(result.annualizedVol).toBeNull();
        expect(result.sharpeRatio).toBeNull();
        expect(result.riskFreeRate).toBe(0.02);
    });

    test('uses close as the unified calculation basis when history is available', () => {
        const prices = Array.from({ length: 200 }, (_, index) => ({
            adjustedClose: 101 + index * 0.5,
            close: 100 + index * 0.5,
            date: `2025-01-${String((index % 28) + 1).padStart(2, '0')}`,
            source: 'akshare',
        }));

        const result = computeSingleAssetMetrics({ prices, currency: 'CNY' });

        expect(result.priceBasis).toBe('close');
        expect(result.analysisSeries).toBe('close');
        expect(result.displaySeries).toBe('close');
        expect(result.analyticsAvailability).toBe('ok');
        expect(result.tradingDays).toBe(200);
        expect(result.annualizedVol).not.toBeNull();
        expect(result.sharpeRatio).not.toBeNull();
    });

    test('keeps analytics available even when adjustedClose coverage is incomplete', () => {
        const prices = Array.from({ length: 200 }, (_, index) => ({
            adjustedClose: index < 30 ? null : 100 + index,
            close: 100 + index,
            date: `2025-02-${String((index % 28) + 1).padStart(2, '0')}`,
            source: 'akshare',
        }));

        const result = computeSingleAssetMetrics({ prices, currency: 'CNY' });

        expect(result.priceBasis).toBe('close');
        expect(result.analysisSeries).toBe('close');
        expect(result.displaySeries).toBe('close');
        expect(result.analyticsAvailability).toBe('ok');
        expect(result.degradationReason).toBeNull();
        expect(result.adjustedCloseMissingRatio).toBeGreaterThan(0.1);
    });

    test('disables volatility and sharpe when history is insufficient', () => {
        const prices = Array.from({ length: 100 }, (_, index) => ({
            adjustedClose: 100 + index,
            close: 100 + index,
            date: `2025-03-${String((index % 28) + 1).padStart(2, '0')}`,
            source: 'yahoo',
        }));

        const result = computeSingleAssetMetrics({ prices, currency: 'USD' });

        expect(result.annualizedVol).toBeNull();
        expect(result.sharpeRatio).toBeNull();
        expect(result.periodReturn).toBeCloseTo(0.99, 6);
        expect(result.riskFreeRate).toBe(0.04);
    });

    test('uses raw nav assets directly for metrics so analytics remain available', () => {
        const prices = Array.from({ length: 20 }, (_, index) => ({
            adjustedClose: 1 + index * 0.01,
            close: 1 + index * 0.01,
            date: `2025-05-${String((index % 28) + 1).padStart(2, '0')}`,
            source: 'akshare-nav',
        }));

        const result = computeSingleAssetMetrics({ prices, currency: 'CNY' });

        expect(result.analysisSeries).toBe('close');
        expect(result.analyticsAvailability).toBe('ok');
        expect(result.degradationReason).toBeNull();
        expect(result.latestValue).toBeCloseTo(1.19, 6);
        expect(result.periodReturn).toBeCloseTo(0.19, 6);
        expect(result.annualizedVol).toBeNull();
        expect(result.sharpeRatio).toBeNull();
        expect(result.tradingDays).toBe(20);
    });

    test('uses currency-specific risk free rates', () => {
        const prices = Array.from({ length: 126 }, (_, index) => ({
            adjustedClose: 100 + index,
            close: 100 + index,
            date: `2025-04-${String((index % 28) + 1).padStart(2, '0')}`,
            source: 'test',
        }));

        expect(computeSingleAssetMetrics({ prices, currency: 'CNY' }).riskFreeRate).toBe(0.02);
        expect(computeSingleAssetMetrics({ prices, currency: 'HKD' }).riskFreeRate).toBe(0.04);
        expect(computeSingleAssetMetrics({ prices, currency: 'USD' }).riskFreeRate).toBe(0.04);
    });

    test('computes period return and majority source correctly', () => {
        const result = computeSingleAssetMetrics({
            currency: 'CNY',
            prices: [
                { adjustedClose: 100, close: 99, date: '2025-01-01', source: 'akshare' },
                { adjustedClose: 110, close: 109, date: '2025-01-02', source: 'akshare' },
                { adjustedClose: 111, close: 110, date: '2025-01-03', source: 'csv' },
            ],
        });

        expect(result.periodReturn).toBeCloseTo(0.11);
        expect(result.dataSource).toBe('akshare');
    });
});