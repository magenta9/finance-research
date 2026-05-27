import type {
    AnalyticsAvailability,
    AnalyticsDegradationReason,
    AssetSeriesAnalyticsResult,
    DisplaySeriesMode,
    DrawdownAnalytics,
    DrawdownPoint,
    EffectiveDisplaySeriesMode,
    LogRegressionPayload,
    RegressionWindow,
    RollingVolAnalytics,
    RollingVolPoint,
    RollingVolWindow,
} from '@quantdesk/shared';

import { annualizationFactor } from './analytics-constants';
import { resolveAssetSeries, type AssetSeriesInputPrice, type ResolvedAssetSeriesPoint } from './asset-series';
import { shiftIsoDateByMonths } from './date-alignment';

export interface ComputeAssetSeriesAnalyticsInput {
    prices: AssetSeriesInputPrice[];
    displayStartDate: string;
    displayEndDate: string;
    displaySeriesMode: DisplaySeriesMode;
    regressionWindow: RegressionWindow;
    channelWidthSigma: number;
    volWindow: RollingVolWindow;
    includeRegression: boolean;
}

const REGRESSION_MIN_SAMPLES = 30;
const EPSILON = 1e-12;

const isFiniteNumber = (value: number | null): value is number =>
    value != null && Number.isFinite(value);

const isPositiveNumber = (value: number | null): value is number =>
    isFiniteNumber(value) && value > 0;

const clampChannelWidth = (value: number) => {
    if (!Number.isFinite(value)) {
        return 2;
    }

    return Math.min(3, Math.max(0.5, value));
};

const normalizeVolWindow = (value: RollingVolWindow) => {
    if (value === 20 || value === 60 || value === 120 || value === 252) {
        return value;
    }

    return 60;
};

const buildRegressionStartDate = (
    regressionWindow: RegressionWindow,
    displayStartDate: string,
    displayEndDate: string,
) => {
    if (regressionWindow === 'display') {
        return displayStartDate;
    }

    if (regressionWindow === '1Y') {
        return shiftIsoDateByMonths(displayEndDate, 12);
    }

    if (regressionWindow === '3Y') {
        return shiftIsoDateByMonths(displayEndDate, 36);
    }

    if (regressionWindow === '5Y') {
        return shiftIsoDateByMonths(displayEndDate, 60);
    }

    return null;
};

const resolveEffectiveDisplayMode = (
    requestedMode: DisplaySeriesMode,
    canShowRawObservation: boolean,
    hasAnalysisSeries: boolean,
): EffectiveDisplaySeriesMode => {
    if (!hasAnalysisSeries) {
        return 'raw';
    }

    if (requestedMode === 'raw' && canShowRawObservation) {
        return 'raw';
    }

    return 'analysis';
};

const emptyRegressionPayload = (): LogRegressionPayload => ({
    actualEndDate: null,
    actualStartDate: null,
    alpha: null,
    beta: null,
    fitFull: [],
    muAnnualLog: null,
    muAnnualSimple: null,
    n: 0,
    r2: null,
    regressionSkippedNonPositiveCount: 0,
    sigmaAnnual: null,
    sigmaRes: null,
    status: 'disabled',
});

const emptyDrawdownAnalytics = (): DrawdownAnalytics => ({
    currentDrawdown: 0,
    durationDays: 0,
    maxDrawdown: 0,
    maxDrawdownDate: null,
    points: [],
    recoveryDays: null,
    unrecoveredDays: null,
});

const emptyRollingVolAnalytics = (window: RollingVolWindow): RollingVolAnalytics => ({
    mean: null,
    points: [],
    window,
});

const filterByDate = <T extends { date: string }>(
    points: T[],
    startDate: string | null,
    endDate: string,
) => points.filter((point) => (startDate == null || point.date >= startDate) && point.date <= endDate);

const resolveAvailability = (
    availability: AnalyticsAvailability,
    degradationReason: AnalyticsDegradationReason,
    displayPoints: ResolvedAssetSeriesPoint[],
    analysisSeries: AssetSeriesAnalyticsResult['meta']['analysisSeries'],
): Pick<AssetSeriesAnalyticsResult['meta'], 'analyticsAvailability' | 'degradationReason'> => {
    if (analysisSeries == null) {
        return {
            analyticsAvailability: 'unavailable' as const,
            degradationReason,
        };
    }

    if (displayPoints.length === 0) {
        return {
            analyticsAvailability: 'unavailable' as const,
            degradationReason: 'insufficient_samples' as const,
        };
    }

    const positiveAnalysisCount = displayPoints.filter((point) => isPositiveNumber(point.analysisValue)).length;

    if (positiveAnalysisCount === 0) {
        return {
            analyticsAvailability: 'unavailable' as const,
            degradationReason: displayPoints.some((point) => isFiniteNumber(point.analysisValue) && point.analysisValue <= 0)
                ? 'non_positive_values'
                : 'insufficient_samples',
        };
    }

    return {
        analyticsAvailability: availability,
        degradationReason,
    };
};

const buildSeriesPoints = (
    displayPoints: ResolvedAssetSeriesPoint[],
    effectiveDisplaySeriesMode: EffectiveDisplaySeriesMode,
) => {
    const basePoint = displayPoints.find((point) => isPositiveNumber(point.analysisValue));
    const baseValue = basePoint?.analysisValue ?? null;

    return displayPoints.map((point) => ({
        analysisValue: point.analysisValue,
        cumulativeLogReturn: isPositiveNumber(point.analysisValue) && isPositiveNumber(baseValue)
            ? Math.log(point.analysisValue / baseValue)
            : null,
        date: point.date,
        displayValue: effectiveDisplaySeriesMode === 'raw'
            ? point.displayValueForRawMode
            : point.displayValueForAnalysisMode,
    }));
};

const computeRegression = (
    points: ResolvedAssetSeriesPoint[],
    channelWidthSigma: number,
    includeRegression: boolean,
): LogRegressionPayload => {
    if (!includeRegression) {
        return emptyRegressionPayload();
    }

    const positivePoints = points.filter((point) => isPositiveNumber(point.analysisValue));
    const skippedNonPositiveCount = points.filter((point) => isFiniteNumber(point.analysisValue) && point.analysisValue <= 0).length;

    if (positivePoints.length < REGRESSION_MIN_SAMPLES) {
        return {
            ...emptyRegressionPayload(),
            actualEndDate: positivePoints[positivePoints.length - 1]?.date ?? null,
            actualStartDate: positivePoints[0]?.date ?? null,
            n: positivePoints.length,
            regressionSkippedNonPositiveCount: skippedNonPositiveCount,
            status: 'insufficient_samples',
        };
    }

    const ys = positivePoints.map((point) => Math.log(point.analysisValue as number));
    const xs = positivePoints.map((_, index) => index);
    const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const varianceX = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
    const varianceY = ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0);

    if (varianceX <= EPSILON || varianceY <= EPSILON) {
        return {
            ...emptyRegressionPayload(),
            actualEndDate: positivePoints[positivePoints.length - 1]?.date ?? null,
            actualStartDate: positivePoints[0]?.date ?? null,
            n: positivePoints.length,
            regressionSkippedNonPositiveCount: skippedNonPositiveCount,
            status: 'degenerate_series',
        };
    }

    const covariance = xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0);
    const beta = covariance / varianceX;
    const alpha = meanY - beta * meanX;
    const fittedYs = xs.map((value) => alpha + beta * value);
    const residuals = ys.map((value, index) => value - fittedYs[index]);
    const ssRes = residuals.reduce((sum, value) => sum + value ** 2, 0);
    const sigmaRes = positivePoints.length > 2
        ? Math.sqrt(ssRes / Math.max(1, positivePoints.length - 2))
        : 0;
    const r2 = Math.max(0, Math.min(1, 1 - ssRes / varianceY));
    const sigmaWidth = clampChannelWidth(channelWidthSigma);

    return {
        actualEndDate: positivePoints[positivePoints.length - 1]?.date ?? null,
        actualStartDate: positivePoints[0]?.date ?? null,
        alpha,
        beta,
        fitFull: positivePoints.map((point, index) => {
            const fitted = alpha + beta * index;
            const upper = fitted + sigmaWidth * sigmaRes;
            const lower = fitted - sigmaWidth * sigmaRes;

            return {
                date: point.date,
                lower: Math.exp(lower),
                mid: Math.exp(fitted),
                upper: Math.exp(upper),
            };
        }),
        muAnnualLog: beta * annualizationFactor,
        muAnnualSimple: Math.exp(beta * annualizationFactor) - 1,
        n: positivePoints.length,
        r2,
        regressionSkippedNonPositiveCount: skippedNonPositiveCount,
        sigmaAnnual: sigmaRes * Math.sqrt(annualizationFactor),
        sigmaRes,
        status: 'ok',
    };
};

const computeDrawdown = (points: ResolvedAssetSeriesPoint[]): DrawdownAnalytics => {
    if (points.length === 0) {
        return emptyDrawdownAnalytics();
    }

    const drawdownPoints: DrawdownPoint[] = [];
    let peakDate: string | null = null;
    let peakValue: number | null = null;
    let peakIndex = -1;
    let maxDrawdown = 0;
    let maxDrawdownIndex = -1;
    let maxDrawdownPeakIndex = -1;
    let maxDrawdownPeakValue: number | null = null;

    for (const [index, point] of points.entries()) {
        if (isFiniteNumber(point.analysisValue) && (peakValue == null || point.analysisValue >= peakValue)) {
            peakDate = point.date;
            peakIndex = index;
            peakValue = point.analysisValue;
        }

        const previousDrawdown = drawdownPoints[drawdownPoints.length - 1]?.drawdown ?? 0;
        const drawdown = peakValue != null && isFiniteNumber(point.analysisValue)
            ? point.analysisValue / peakValue - 1
            : previousDrawdown;

        if (drawdown < maxDrawdown) {
            maxDrawdown = drawdown;
            maxDrawdownIndex = index;
            maxDrawdownPeakIndex = peakIndex;
            maxDrawdownPeakValue = peakValue;
        }

        drawdownPoints.push({
            date: point.date,
            daysSincePeak: peakIndex >= 0 ? index - peakIndex : 0,
            drawdown,
            peakDate,
            peakValue,
        });
    }

    let recoveryDays: number | null = null;
    let unrecoveredDays: number | null = null;

    if (maxDrawdownIndex >= 0 && maxDrawdownPeakValue != null) {
        for (let index = maxDrawdownIndex + 1; index < points.length; index += 1) {
            const point = points[index];

            if (isFiniteNumber(point.analysisValue) && point.analysisValue >= maxDrawdownPeakValue) {
                recoveryDays = index - maxDrawdownIndex;
                break;
            }
        }

        if (recoveryDays == null && maxDrawdown < 0) {
            unrecoveredDays = points.length - 1 - maxDrawdownIndex;
        }
    }

    return {
        currentDrawdown: drawdownPoints[drawdownPoints.length - 1]?.drawdown ?? 0,
        durationDays: maxDrawdownIndex >= 0 && maxDrawdownPeakIndex >= 0
            ? maxDrawdownIndex - maxDrawdownPeakIndex
            : 0,
        maxDrawdown,
        maxDrawdownDate: maxDrawdownIndex >= 0 ? points[maxDrawdownIndex]?.date ?? null : null,
        points: drawdownPoints,
        recoveryDays,
        unrecoveredDays,
    };
};

const computeRollingVol = (
    points: ResolvedAssetSeriesPoint[],
    requestedWindow: RollingVolWindow,
): RollingVolAnalytics => {
    const window = normalizeVolWindow(requestedWindow);

    if (points.length === 0) {
        return emptyRollingVolAnalytics(window);
    }

    const dailyLogReturns = points.map((point, index) => {
        if (index === 0) {
            return null;
        }

        const previous = points[index - 1]?.analysisValue ?? null;

        return isPositiveNumber(previous) && isPositiveNumber(point.analysisValue)
            ? Math.log(point.analysisValue / previous)
            : null;
    });

    const rollingPoints: RollingVolPoint[] = points.map((point, index) => {
        if (index < window) {
            return {
                date: point.date,
                maxDailyReturn: null,
                minDailyReturn: null,
                value: null,
                windowEndDate: null,
                windowStartDate: null,
            };
        }

        const windowReturns = dailyLogReturns.slice(index - window + 1, index + 1);

        if (windowReturns.length < window || windowReturns.some((value) => value == null)) {
            return {
                date: point.date,
                maxDailyReturn: null,
                minDailyReturn: null,
                value: null,
                windowEndDate: null,
                windowStartDate: null,
            };
        }

        const returns = windowReturns as number[];
        const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
        const variance = returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / Math.max(1, returns.length - 1);
        const sigmaWindow = Math.sqrt(Math.max(variance, 0));

        return {
            date: point.date,
            maxDailyReturn: Math.max(...returns),
            minDailyReturn: Math.min(...returns),
            value: sigmaWindow * Math.sqrt(annualizationFactor),
            windowEndDate: point.date,
            windowStartDate: points[index - window]?.date ?? null,
        };
    });
    const nonNullValues = rollingPoints
        .map((point) => point.value)
        .filter((value): value is number => value != null);

    return {
        mean: nonNullValues.length > 0
            ? nonNullValues.reduce((sum, value) => sum + value, 0) / nonNullValues.length
            : null,
        points: rollingPoints,
        window,
    };
};

export const computeAssetSeriesAnalytics = ({
    prices,
    displayStartDate,
    displayEndDate,
    displaySeriesMode,
    regressionWindow,
    channelWidthSigma,
    volWindow,
    includeRegression,
}: ComputeAssetSeriesAnalyticsInput): AssetSeriesAnalyticsResult => {
    const resolvedSeries = resolveAssetSeries(prices);
    const displayPoints = filterByDate(resolvedSeries.points, displayStartDate, displayEndDate);
    const effectiveDisplaySeriesMode = resolveEffectiveDisplayMode(
        displaySeriesMode,
        resolvedSeries.canShowRawObservation,
        resolvedSeries.analysisSeries != null,
    );
    const availability = resolveAvailability(
        resolvedSeries.analyticsAvailability,
        resolvedSeries.degradationReason,
        displayPoints,
        resolvedSeries.analysisSeries,
    );
    const regressionStartDate = buildRegressionStartDate(regressionWindow, displayStartDate, displayEndDate);
    const regressionPoints = filterByDate(resolvedSeries.points, regressionStartDate, displayEndDate);

    return {
        drawdown: resolvedSeries.analysisSeries == null
            ? emptyDrawdownAnalytics()
            : computeDrawdown(displayPoints),
        meta: {
            adjustedCloseMissingRatio: resolvedSeries.adjustedCloseMissingRatio,
            analyticsAvailability: availability.analyticsAvailability,
            analysisSeries: resolvedSeries.analysisSeries,
            canShowRawObservation: resolvedSeries.canShowRawObservation,
            dataSource: resolvedSeries.dataSource,
            degradationReason: availability.degradationReason,
            displaySeries: effectiveDisplaySeriesMode === 'raw'
                ? 'close'
                : resolvedSeries.preferredDisplaySeries,
            effectiveDisplaySeriesMode,
            tradingDaysPerYear: annualizationFactor,
        },
        points: buildSeriesPoints(displayPoints, effectiveDisplaySeriesMode),
        regression: resolvedSeries.analysisSeries == null
            ? emptyRegressionPayload()
            : computeRegression(regressionPoints, channelWidthSigma, includeRegression),
        rollingVol: resolvedSeries.analysisSeries == null
            ? emptyRollingVolAnalytics(normalizeVolWindow(volWindow))
            : computeRollingVol(displayPoints, volWindow),
    };
};