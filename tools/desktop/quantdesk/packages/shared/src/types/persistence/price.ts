import type { Currency } from '../domain';

export interface DailyPriceInput {
    assetId: string;
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    adjustedClose: number | null;
    source: string;
    fetchedAt?: string;
}

export interface DailyPriceRecord extends Omit<DailyPriceInput, 'fetchedAt'> {
    fetchedAt: string;
}

export interface PriceRangeQuery {
    assetId: string;
    startDate: string;
    endDate: string;
}

export interface PriceFreshnessQuery {
    assetId: string;
    maxAgeHours: number;
    now?: string;
}

export type PriceBasis = 'adjustedClose' | 'close';

export type DisplaySeriesMode = 'auto' | 'analysis' | 'raw';

export type EffectiveDisplaySeriesMode = 'analysis' | 'raw';

export type RegressionWindow = 'display' | '1Y' | '3Y' | '5Y' | 'ALL';

export type RegressionStatus = 'ok' | 'insufficient_samples' | 'degenerate_series' | 'disabled';

export type AnalyticsAvailability = 'ok' | 'degraded' | 'unavailable';

export type AnalyticsDegradationReason =
    | 'missing_adjusted_series'
    | 'unsupported_raw_nav'
    | 'insufficient_samples'
    | 'non_positive_values'
    | null;

export type RollingVolWindow = 20 | 60 | 120 | 252;

export type RiskFreeRateMap = Record<Currency, number>;

export interface AssetMetricsRequest {
    assetId: string;
    startDate: string;
    endDate: string;
}

export interface AssetMetricsResult {
    priceBasis: PriceBasis;
    displaySeries: PriceBasis;
    analysisSeries: PriceBasis | null;
    analyticsAvailability: AnalyticsAvailability;
    degradationReason: AnalyticsDegradationReason;
    adjustedCloseMissingRatio: number;
    latestValue: number | null;
    periodReturn: number | null;
    annualizedVol: number | null;
    sharpeRatio: number | null;
    riskFreeRate: number;
    actualStartDate: string | null;
    actualEndDate: string | null;
    tradingDays: number;
    dataSource: string;
}

export interface AssetSeriesAnalyticsRequest {
    assetId: string;
    displayStartDate: string;
    displayEndDate: string;
    displaySeriesMode: DisplaySeriesMode;
    regressionWindow: RegressionWindow;
    channelWidthSigma: number;
    volWindow: RollingVolWindow;
    includeRegression: boolean;
}

export interface AssetSeriesPoint {
    date: string;
    displayValue: number | null;
    analysisValue: number | null;
    cumulativeLogReturn: number | null;
}

export interface AssetSeriesAnalyticsMeta {
    displaySeries: PriceBasis;
    analysisSeries: PriceBasis | null;
    effectiveDisplaySeriesMode: EffectiveDisplaySeriesMode;
    canShowRawObservation: boolean;
    tradingDaysPerYear: number;
    analyticsAvailability: AnalyticsAvailability;
    degradationReason: AnalyticsDegradationReason;
    dataSource: string;
    adjustedCloseMissingRatio: number;
}

export interface RegressionFitPoint {
    date: string;
    mid: number;
    upper: number;
    lower: number;
}

export interface LogRegressionPayload {
    status: RegressionStatus;
    alpha: number | null;
    beta: number | null;
    muAnnualLog: number | null;
    muAnnualSimple: number | null;
    sigmaRes: number | null;
    sigmaAnnual: number | null;
    r2: number | null;
    n: number;
    regressionSkippedNonPositiveCount: number;
    actualStartDate: string | null;
    actualEndDate: string | null;
    fitFull: RegressionFitPoint[];
}

export interface DrawdownPoint {
    date: string;
    drawdown: number;
    peakDate: string | null;
    peakValue: number | null;
    daysSincePeak: number;
}

export interface DrawdownAnalytics {
    points: DrawdownPoint[];
    maxDrawdown: number;
    maxDrawdownDate: string | null;
    durationDays: number;
    recoveryDays: number | null;
    unrecoveredDays: number | null;
    currentDrawdown: number;
}

export interface RollingVolPoint {
    date: string;
    value: number | null;
    windowStartDate: string | null;
    windowEndDate: string | null;
    maxDailyReturn: number | null;
    minDailyReturn: number | null;
}

export interface RollingVolAnalytics {
    window: RollingVolWindow;
    mean: number | null;
    points: RollingVolPoint[];
}

export interface AssetSeriesAnalyticsResult {
    meta: AssetSeriesAnalyticsMeta;
    points: AssetSeriesPoint[];
    regression: LogRegressionPayload;
    drawdown: DrawdownAnalytics;
    rollingVol: RollingVolAnalytics;
}

export interface FxRateInput {
    pair: string;
    date: string;
    rate: number;
    source: string;
}

export type FxRateRecord = FxRateInput;