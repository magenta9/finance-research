import type { PriceAnalogForwardOutcome, PriceAnalogPathPoint } from '@quantdesk/shared';

import { forwardHorizonPoints } from './series';
import type { AnalogSeries } from './types';

const buildOutcome = (
    series: AnalogSeries,
    windowEndIndex: number,
    horizonPoints: number,
): PriceAnalogForwardOutcome => {
    const start = series.points[windowEndIndex];
    const forwardPoints = series.points.slice(windowEndIndex + 1, windowEndIndex + 1 + horizonPoints);
    const end = forwardPoints.at(-1) ?? null;

    if (!start || forwardPoints.length === 0 || !end) {
        return {
            endDate: null,
            return: null,
            startDate: null,
            status: 'missing',
            tradingDays: 0,
        };
    }

    return {
        endDate: end.date,
        return: end.price / start.price - 1,
        startDate: forwardPoints[0].date,
        status: forwardPoints.length >= horizonPoints ? 'complete' : 'partial',
        tradingDays: forwardPoints.length,
    };
};

export const evaluateForwardOutcomes = (series: AnalogSeries, windowEndIndex: number) => ({
    '1M': buildOutcome(series, windowEndIndex, forwardHorizonPoints['1M']),
    '3M': buildOutcome(series, windowEndIndex, forwardHorizonPoints['3M']),
    '6M': buildOutcome(series, windowEndIndex, forwardHorizonPoints['6M']),
});

export const buildForwardPath = (
    series: AnalogSeries,
    windowEndIndex: number,
    horizonPoints: number,
): PriceAnalogPathPoint[] => {
    const start = series.points[windowEndIndex];

    if (!start) {
        return [];
    }

    return series.points
        .slice(windowEndIndex + 1, windowEndIndex + 1 + horizonPoints)
        .map((point, index) => ({
            date: point.date,
            index: index + 1,
            normalizedLogReturn: Math.log(point.price / start.price),
        }));
};

export const hasRequiredForwardCoverage = (
    outcomes: ReturnType<typeof evaluateForwardOutcomes>,
) => outcomes['1M'].status === 'complete' && outcomes['3M'].status === 'complete';