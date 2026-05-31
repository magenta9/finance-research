import type { PortfolioMetrics, PortfolioPathPoint } from '@quantdesk/shared';

import { annualizationFactor } from './analytics-constants';

export const meanPortfolioValues = (values: number[]) => values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export const computePortfolioStandardDeviation = (values: number[]) => {
    if (values.length <= 1) {
        return 0;
    }

    const average = meanPortfolioValues(values);
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
    return Math.sqrt(Math.max(variance, 0));
};

export const computePortfolioMaxDrawdown = (equityCurve: number[]) => {
    let peak = equityCurve[0] ?? 1;
    let maxDrawdown = 0;

    for (const equity of equityCurve) {
        peak = Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    }

    return Math.abs(maxDrawdown);
};

export const buildPortfolioPathFromDailyReturns = (
    alignedDates: string[],
    dailyReturns: number[],
    extraPointFields?: (index: number, equity: number) => Partial<PortfolioPathPoint>,
) => {
    const equityCurve = [1];
    const path: PortfolioPathPoint[] = alignedDates.length === 0
        ? []
        : [{ date: alignedDates[0], equity: 1, ...extraPointFields?.(0, 1) }];

    for (let index = 0; index < dailyReturns.length; index += 1) {
        const nextEquity = equityCurve[index] * (1 + dailyReturns[index]);
        equityCurve.push(nextEquity);
        path.push({
            date: alignedDates[index + 1] ?? alignedDates[alignedDates.length - 1] ?? '',
            equity: nextEquity,
            ...extraPointFields?.(index + 1, nextEquity),
        });
    }

    return { equityCurve, path };
};

export const computePortfolioMetricsFromDailyReturns = (
    dailyReturns: number[],
    equityCurve: number[],
): PortfolioMetrics => {
    const expectedReturn = meanPortfolioValues(dailyReturns) * annualizationFactor;
    const volatility = computePortfolioStandardDeviation(dailyReturns) * Math.sqrt(annualizationFactor);

    return {
        expectedReturn,
        maxDrawdown: computePortfolioMaxDrawdown(equityCurve),
        sharpeRatio: volatility === 0 ? 0 : expectedReturn / volatility,
        volatility,
    };
};

export const computePortfolioWinRate = (dailyReturns: number[]) => dailyReturns.length === 0
    ? 0
    : dailyReturns.filter((value) => value > 0).length / dailyReturns.length;

export const computePortfolioCalmarRatio = (expectedReturn: number, maxDrawdown: number) => maxDrawdown === 0
    ? 0
    : expectedReturn / maxDrawdown;
