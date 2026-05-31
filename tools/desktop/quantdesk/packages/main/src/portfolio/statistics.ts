import type { AssetMetricsResult, Currency } from '@quantdesk/shared';

import { Matrix } from 'ml-matrix';

import {
    annualizationFactor,
    minTradingDaysForRiskMetrics,
    riskFreeRates,
} from './analytics-constants';
import { resolveAssetSeries, type AssetSeriesInputPrice } from './asset-series';

export const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

export const computeLogReturns = (priceSeries: number[][]) =>
    priceSeries.map((series) => {
        const returns: number[] = [];

        for (let index = 1; index < series.length; index += 1) {
            returns.push(Math.log(series[index] / series[index - 1]));
        }

        return returns;
    });

export const semiCovarianceMatrix = (series: number[][]) => {
    const assetCount = series.length;
    const sampleLength = series[0]?.length ?? 0;
    const matrix = Array.from({ length: assetCount }, () => Array(assetCount).fill(0));

    for (let row = 0; row < assetCount; row += 1) {
        for (let column = row; column < assetCount; column += 1) {
            let total = 0;

            for (let index = 0; index < sampleLength; index += 1) {
                const rowReturn = series[row][index];
                const columnReturn = series[column][index];
                const downsideRow = rowReturn < 0 ? rowReturn : 0;
                const downsideColumn = columnReturn < 0 ? columnReturn : 0;
                total += downsideRow * downsideColumn;
            }

            const covariance = total / Math.max(1, sampleLength - 1);
            matrix[row][column] = covariance;
            matrix[column][row] = covariance;
        }
    }

    return matrix;
};

export const covarianceMatrix = (series: number[][]) => {
    const assetCount = series.length;
    const sampleLength = series[0]?.length ?? 0;
    const means = series.map((row) => mean(row));
    const matrix = Array.from({ length: assetCount }, () => Array(assetCount).fill(0));

    for (let row = 0; row < assetCount; row += 1) {
        for (let column = 0; column < assetCount; column += 1) {
            let total = 0;

            for (let index = 0; index < sampleLength; index += 1) {
                total += (series[row][index] - means[row]) * (series[column][index] - means[column]);
            }

            matrix[row][column] = total / Math.max(1, sampleLength - 1);
        }
    }

    return matrix;
};

export const shrinkCovarianceMatrix = (sample: number[][]) => {
    const size = sample.length;
    const diagonalAverage = mean(sample.map((row, index) => row[index]));
    const shrinkage = Math.min(0.45, Math.max(0.08, size / 50));

    return sample.map((row, rowIndex) =>
        row.map((value, columnIndex) => {
            const target = rowIndex === columnIndex ? diagonalAverage : 0;
            return value * (1 - shrinkage) + target * shrinkage;
        }),
    );
};

export const correlationMatrix = (covariance: number[][]) =>
    covariance.map((row, rowIndex) =>
        row.map((value, columnIndex) => {
            const denominator = Math.sqrt(covariance[rowIndex][rowIndex] * covariance[columnIndex][columnIndex]);
            return denominator === 0 ? 0 : value / denominator;
        }),
    );

export const annualizedReturns = (returns: number[][]) => returns.map((row) => mean(row) * annualizationFactor);

export const annualizedVolatility = (covariance: number[][]) =>
    covariance.map((row, index) => Math.sqrt(Math.max(row[index] * annualizationFactor, 0)));

export const portfolioVolatility = (weights: number[], covariance: number[][]) => {
    const weightsMatrix = Matrix.rowVector(weights);
    const covarianceMatrixValue = new Matrix(covariance);
    const variance = weightsMatrix.mmul(covarianceMatrixValue).mmul(weightsMatrix.transpose()).get(0, 0);
    return Math.sqrt(Math.max(variance * annualizationFactor, 0));
};

export const portfolioReturn = (weights: number[], annualizedMeanReturns: number[]) =>
    weights.reduce((sum, weight, index) => sum + weight * annualizedMeanReturns[index], 0);

export const computeRiskContributions = (weights: number[], covariance: number[][]) => {
    const covarianceTimesWeights = covariance.map((row) =>
        row.reduce((sum, value, index) => sum + value * weights[index], 0),
    );
    const variance = weights.reduce(
        (sum, weight, index) => sum + weight * covarianceTimesWeights[index],
        0,
    );

    return weights.map((weight, index) =>
        variance === 0 ? 0 : (weight * covarianceTimesWeights[index]) / variance,
    );
};

export const maxRiskContributionGap = (weights: number[], covariance: number[][]) => {
    const contributions = computeRiskContributions(weights, covariance);
    return Math.max(...contributions) - Math.min(...contributions);
};

export const computeDiversificationRatio = (
    weights: number[],
    covariance: number[][],
    volatilities: number[],
) => {
    const weightedVolSum = weights.reduce(
        (sum, weight, index) => sum + weight * volatilities[index],
        0,
    );
    const portVol = portfolioVolatility(weights, covariance);
    if (portVol < 1e-12) {
        return 1;
    }
    return weightedVolSum / portVol;
};

export const computeMaxDrawdown = (portfolioReturns: number[]) => {
    let peak = 1;
    let equity = 1;
    let maxDrawdown = 0;

    for (const dailyReturn of portfolioReturns) {
        equity *= Math.exp(dailyReturn);
        peak = Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    }

    return Math.abs(maxDrawdown);
};

export interface SingleAssetMetricsInput {
    prices: AssetSeriesInputPrice[];
    currency: Currency;
}

export type SingleAssetMetricsOutput = AssetMetricsResult;

const isFiniteNumber = (value: number | null): value is number =>
    value != null && Number.isFinite(value);

const isPositiveNumber = (value: number | null): value is number =>
    isFiniteNumber(value) && value > 0;

export const computeSingleAssetMetrics = ({
    currency,
    prices,
}: SingleAssetMetricsInput): SingleAssetMetricsOutput => {
    const riskFreeRate = riskFreeRates[currency];

    if (prices.length === 0) {
        return {
            analyticsAvailability: 'unavailable',
            analysisSeries: null,
            priceBasis: 'close',
            displaySeries: 'close',
            degradationReason: 'insufficient_samples',
            adjustedCloseMissingRatio: 1,
            latestValue: null,
            periodReturn: null,
            annualizedVol: null,
            sharpeRatio: null,
            riskFreeRate,
            actualStartDate: null,
            actualEndDate: null,
            tradingDays: 0,
            dataSource: 'unknown',
        };
    }

    const resolvedSeries = resolveAssetSeries(prices);
    const displayPoints = resolvedSeries.points.filter((point) => isFiniteNumber(point.displayValueForAnalysisMode));
    const analysisPoints = resolvedSeries.points.filter((point) => isPositiveNumber(point.analysisValue));
    const latestDisplayValue = [...resolvedSeries.points]
        .reverse()
        .find((point) => isFiniteNumber(point.displayValueForAnalysisMode))
        ?.displayValueForAnalysisMode ?? null;
    const actualDisplayStartDate = displayPoints[0]?.date ?? null;
    const actualDisplayEndDate = displayPoints[displayPoints.length - 1]?.date ?? null;

    if (resolvedSeries.analysisSeries == null || analysisPoints.length === 0) {
        return {
            actualEndDate: actualDisplayEndDate,
            actualStartDate: actualDisplayStartDate,
            adjustedCloseMissingRatio: resolvedSeries.adjustedCloseMissingRatio,
            analyticsAvailability: resolvedSeries.analysisSeries == null
                ? resolvedSeries.analyticsAvailability
                : 'unavailable',
            analysisSeries: resolvedSeries.analysisSeries,
            displaySeries: resolvedSeries.preferredDisplaySeries,
            priceBasis: resolvedSeries.analysisSeries ?? resolvedSeries.preferredDisplaySeries,
            degradationReason: resolvedSeries.analysisSeries == null
                ? resolvedSeries.degradationReason
                : prices.some((price) => isFiniteNumber(price.adjustedClose) && price.adjustedClose <= 0)
                    ? 'non_positive_values'
                    : 'insufficient_samples',
            periodReturn: null,
            annualizedVol: null,
            sharpeRatio: null,
            riskFreeRate,
            latestValue: latestDisplayValue,
            tradingDays: 0,
            dataSource: resolvedSeries.dataSource,
        };
    }

    const series = analysisPoints.map((point) => point.analysisValue) as number[];
    const firstValue = series[0];
    const latestValue = series[series.length - 1];
    const tradingDays = series.length;
    const periodReturn = firstValue > 0 ? (latestValue - firstValue) / firstValue : null;
    let annualizedVol: number | null = null;
    let sharpeRatio: number | null = null;

    if (tradingDays >= minTradingDaysForRiskMetrics) {
        const logReturns = computeLogReturns([series]);
        const covariance = covarianceMatrix(logReturns);
        const annualizedReturn = annualizedReturns(logReturns)[0];
        const volatility = annualizedVolatility(covariance)[0];

        annualizedVol = volatility;
        sharpeRatio = volatility > 0 ? (annualizedReturn - riskFreeRate) / volatility : 0;
    }

    return {
        actualEndDate: analysisPoints[analysisPoints.length - 1]?.date ?? actualDisplayEndDate,
        actualStartDate: analysisPoints[0]?.date ?? actualDisplayStartDate,
        adjustedCloseMissingRatio: resolvedSeries.adjustedCloseMissingRatio,
        analyticsAvailability: resolvedSeries.analyticsAvailability,
        analysisSeries: resolvedSeries.analysisSeries,
        dataSource: resolvedSeries.dataSource,
        degradationReason: resolvedSeries.degradationReason,
        displaySeries: resolvedSeries.preferredDisplaySeries,
        latestValue: latestDisplayValue,
        priceBasis: resolvedSeries.analysisSeries ?? resolvedSeries.preferredDisplaySeries,
        periodReturn,
        annualizedVol,
        sharpeRatio,
        riskFreeRate,
        tradingDays,
    };
};