import { describe, expect, test } from 'vitest';

import { computeAssetSeriesAnalytics } from './series-analytics';

const buildDates = (count: number, startDate = '2025-01-01') => {
    const dates: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);

    for (let index = 0; index < count; index += 1) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
};

const buildPrices = (
    values: number[],
    options?: {
        adjustedMultiplier?: number;
        source?: string;
    },
) => {
    const dates = buildDates(values.length);

    return values.map((value, index) => ({
        adjustedClose: Number((value * (options?.adjustedMultiplier ?? 1.01)).toFixed(6)),
        close: Number(value.toFixed(6)),
        date: dates[index],
        source: options?.source ?? 'yahoo',
    }));
};

describe('computeAssetSeriesAnalytics', () => {
    test('returns fitFull across the regression window rather than the display window', () => {
        const prices = buildPrices(Array.from({ length: 200 }, (_, index) => 100 * Math.exp(index * 0.004)));
        const analytics = computeAssetSeriesAnalytics({
            channelWidthSigma: 2,
            displayEndDate: prices[prices.length - 1].date,
            displaySeriesMode: 'analysis',
            displayStartDate: prices[140].date,
            includeRegression: true,
            prices,
            regressionWindow: 'ALL',
            volWindow: 60,
        });

        expect(analytics.regression.status).toBe('ok');
        expect(analytics.regression.actualStartDate).toBe(prices[0].date);
        expect(analytics.regression.actualEndDate).toBe(prices[prices.length - 1].date);
        expect(analytics.regression.fitFull).toHaveLength(prices.length);
        expect(analytics.regression.fitFull.length).toBeGreaterThan(analytics.points.length);
    });

    test('skips non-positive regression samples and returns insufficient samples when too few remain', () => {
        const prices = buildPrices(Array.from({ length: 35 }, (_, index) => index < 6 ? 0 : 100 + index));
        const analytics = computeAssetSeriesAnalytics({
            channelWidthSigma: 2,
            displayEndDate: prices[prices.length - 1].date,
            displaySeriesMode: 'analysis',
            displayStartDate: prices[0].date,
            includeRegression: true,
            prices,
            regressionWindow: 'display',
            volWindow: 20,
        });

        expect(analytics.regression.status).toBe('insufficient_samples');
        expect(analytics.regression.regressionSkippedNonPositiveCount).toBe(6);
        expect(analytics.regression.n).toBe(29);
    });

    test('marks constant series as degenerate for regression', () => {
        const prices = buildPrices(Array.from({ length: 40 }, () => 100));
        const analytics = computeAssetSeriesAnalytics({
            channelWidthSigma: 2,
            displayEndDate: prices[prices.length - 1].date,
            displaySeriesMode: 'analysis',
            displayStartDate: prices[0].date,
            includeRegression: true,
            prices,
            regressionWindow: 'display',
            volWindow: 20,
        });

        expect(analytics.regression.status).toBe('degenerate_series');
        expect(analytics.regression.r2).toBeNull();
        expect(analytics.regression.fitFull).toHaveLength(0);
    });

    test('computes drawdown recovery and current drawdown summary', () => {
        const prices = buildPrices([100, 120, 80, 90, 120, 110], { adjustedMultiplier: 1 });
        const analytics = computeAssetSeriesAnalytics({
            channelWidthSigma: 2,
            displayEndDate: prices[prices.length - 1].date,
            displaySeriesMode: 'analysis',
            displayStartDate: prices[0].date,
            includeRegression: false,
            prices,
            regressionWindow: 'display',
            volWindow: 20,
        });

        expect(analytics.drawdown.maxDrawdown).toBeCloseTo(-1 / 3, 6);
        expect(analytics.drawdown.durationDays).toBe(1);
        expect(analytics.drawdown.recoveryDays).toBe(2);
        expect(analytics.drawdown.currentDrawdown).toBeCloseTo(110 / 120 - 1, 6);
    });

    test('reports unrecovered drawdowns when the peak has not been reclaimed', () => {
        const prices = buildPrices([100, 120, 80, 90], { adjustedMultiplier: 1 });
        const analytics = computeAssetSeriesAnalytics({
            channelWidthSigma: 2,
            displayEndDate: prices[prices.length - 1].date,
            displaySeriesMode: 'analysis',
            displayStartDate: prices[0].date,
            includeRegression: false,
            prices,
            regressionWindow: 'display',
            volWindow: 20,
        });

        expect(analytics.drawdown.recoveryDays).toBeNull();
        expect(analytics.drawdown.unrecoveredDays).toBe(1);
    });

    test('returns null rolling volatility for the first W points', () => {
        const prices = buildPrices(Array.from({ length: 30 }, (_, index) => 100 * Math.exp(index * 0.01)));
        const analytics = computeAssetSeriesAnalytics({
            channelWidthSigma: 2,
            displayEndDate: prices[prices.length - 1].date,
            displaySeriesMode: 'analysis',
            displayStartDate: prices[0].date,
            includeRegression: false,
            prices,
            regressionWindow: 'display',
            volWindow: 20,
        });

        expect(analytics.rollingVol.points.slice(0, 20).every((point) => point.value == null)).toBe(true);
        expect(analytics.rollingVol.points[20]?.value).not.toBeNull();
    });

    test('returns usable analytics for raw nav series by using close values directly', () => {
        const prices = buildPrices([1.01, 1.02, 1.03, 1.04], {
            adjustedMultiplier: 1,
            source: 'akshare-nav',
        });
        const analytics = computeAssetSeriesAnalytics({
            channelWidthSigma: 2,
            displayEndDate: prices[prices.length - 1].date,
            displaySeriesMode: 'analysis',
            displayStartDate: prices[0].date,
            includeRegression: true,
            prices,
            regressionWindow: 'ALL',
            volWindow: 20,
        });

        expect(analytics.meta.analysisSeries).toBe('close');
        expect(analytics.meta.analyticsAvailability).toBe('ok');
        expect(analytics.meta.effectiveDisplaySeriesMode).toBe('analysis');
        expect(analytics.points.every((point) => point.cumulativeLogReturn != null)).toBe(true);
        expect(analytics.regression.status).toBe('insufficient_samples');
        expect(analytics.drawdown.points).toHaveLength(4);
        expect(analytics.rollingVol.points).toHaveLength(4);
    });
});