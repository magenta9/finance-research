import type { PriceAnalogPathPoint, PriceAnalogWindow, StoredAsset } from '@quantdesk/shared';

import { resolveAssetSeries } from '../asset-series';
import type { AnalogSeries, WindowSnapshot } from './types';

export const minimumWindowPoints: Record<PriceAnalogWindow, number> = {
    '3M': 45,
    '6M': 90,
    '1Y': 180,
};

export const forwardHorizonPoints = {
    '1M': 21,
    '3M': 63,
    '6M': 126,
} as const;

const tradingDaysPerYear = 252;
const epsilon = 1e-12;

const isPositiveFinite = (value: number | null): value is number => (
    value != null && Number.isFinite(value) && value > 0
);

const average = (values: number[]) => (
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

const standardDeviation = (values: number[]) => {
    if (values.length < 2) {
        return 0;
    }

    const mean = average(values);
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, values.length - 1);

    return Math.sqrt(Math.max(variance, 0));
};

export const shiftMonths = (endDate: string, months: number) => {
    const cursor = new Date(`${endDate}T00:00:00Z`);
    cursor.setUTCMonth(cursor.getUTCMonth() - months);
    return cursor.toISOString().slice(0, 10);
};

export const windowStartDateFromEnd = (window: PriceAnalogWindow, endDate: string) => {
    if (window === '3M') {
        return shiftMonths(endDate, 3);
    }

    if (window === '6M') {
        return shiftMonths(endDate, 6);
    }

    return shiftMonths(endDate, 12);
};

export const buildAnalogSeries = (
    asset: StoredAsset,
    prices: Array<{ adjustedClose: number | null; close: number | null; date: string; source: string }>,
): AnalogSeries => {
    const resolved = resolveAssetSeries(prices);

    return {
        asset,
        points: resolved.points
            .filter((point) => isPositiveFinite(point.analysisValue))
            .map((point) => ({
                date: point.date,
                price: point.analysisValue as number,
            })),
    };
};

export const buildRequestedWindow = (
    series: AnalogSeries,
    window: PriceAnalogWindow,
    startDate?: string,
    endDate?: string,
) => {
    const actualEndDate = endDate ?? series.points.at(-1)?.date ?? null;

    if (!actualEndDate) {
        return null;
    }

    const actualStartDate = startDate ?? windowStartDateFromEnd(window, actualEndDate);
    const startIndex = series.points.findIndex((point) => point.date >= actualStartDate);
    let endIndex = -1;

    for (let index = series.points.length - 1; index >= 0; index -= 1) {
        if (series.points[index].date <= actualEndDate) {
            endIndex = index;
            break;
        }
    }

    if (startIndex < 0 || endIndex < startIndex) {
        return null;
    }

    return buildWindowSnapshot(series, startIndex, endIndex);
};

const computeMaxDrawdown = (prices: number[]) => {
    if (prices.length === 0) {
        return 0;
    }

    let peak = prices[0];
    let worst = 0;

    for (const price of prices) {
        peak = Math.max(peak, price);
        worst = Math.min(worst, price / peak - 1);
    }

    return worst;
};

const computeVolatility = (prices: number[]) => {
    if (prices.length < 3) {
        return null;
    }

    const returns = prices.slice(1).map((price, index) => Math.log(price / prices[index]));
    const sigma = standardDeviation(returns);

    return sigma * Math.sqrt(tradingDaysPerYear);
};

const buildLogPath = (prices: number[]) => {
    const base = prices[0];

    return prices.map((price) => Math.log(price / base));
};

const buildShapePath = (logPath: number[]) => {
    const mean = average(logPath);
    const centered = logPath.map((value) => value - mean);
    const sigma = standardDeviation(logPath);

    if (sigma <= epsilon) {
        return centered;
    }

    return centered.map((value) => value / sigma);
};

const buildPathPoints = (points: Array<{ date: string }>, logPath: number[]): PriceAnalogPathPoint[] => (
    points.map((point, index) => ({
        date: point.date,
        index,
        normalizedLogReturn: logPath[index],
    }))
);

export const buildWindowSnapshot = (
    series: AnalogSeries,
    startIndex: number,
    endIndex: number,
): WindowSnapshot => {
    const points = series.points.slice(startIndex, endIndex + 1);
    const prices = points.map((point) => point.price);
    const logPath = buildLogPath(prices);

    return {
        endIndex,
        logPath,
        maxDrawdown: computeMaxDrawdown(prices),
        path: buildPathPoints(points, logPath),
        shapePath: buildShapePath(logPath),
        startIndex,
        totalReturn: prices.at(-1)! / prices[0] - 1,
        volatility: computeVolatility(prices),
    };
};