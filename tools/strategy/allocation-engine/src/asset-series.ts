import type {
    AnalyticsAvailability,
    AnalyticsDegradationReason,
    PriceBasis,
} from '@quantdesk/shared';

export interface AssetSeriesInputPrice {
    date: string;
    close: number | null;
    adjustedClose: number | null;
    source: string;
}

export interface ResolvedAssetSeriesPoint {
    date: string;
    rawValue: number | null;
    analysisValue: number | null;
    displayValueForAnalysisMode: number | null;
    displayValueForRawMode: number | null;
    source: string;
}

export interface ResolvedAssetSeries {
    preferredDisplaySeries: PriceBasis;
    analysisSeries: PriceBasis | null;
    analyticsAvailability: AnalyticsAvailability;
    degradationReason: AnalyticsDegradationReason;
    adjustedCloseMissingRatio: number;
    dataSource: string;
    canShowRawObservation: boolean;
    points: ResolvedAssetSeriesPoint[];
}

const isFiniteNumber = (value: number | null): value is number =>
    value != null && Number.isFinite(value);

const isPositiveNumber = (value: number | null): value is number =>
    isFiniteNumber(value) && value > 0;

const normalizeFiniteValue = (value: number | null) =>
    isFiniteNumber(value) ? value : null;

const resolveRawValue = (price: AssetSeriesInputPrice) => {
    if (isFiniteNumber(price.close)) {
        return price.close;
    }

    return normalizeFiniteValue(price.adjustedClose);
};

export const majoritySource = (prices: Array<{ source: string }>) => {
    const counts = new Map<string, number>();

    for (const price of prices) {
        counts.set(price.source, (counts.get(price.source) ?? 0) + 1);
    }

    let maxCount = 0;
    let maxSource = 'unknown';

    for (const [source, count] of counts) {
        if (count > maxCount) {
            maxCount = count;
            maxSource = source;
        }
    }

    return maxSource;
};

const resolveAnalysisSeries = (prices: AssetSeriesInputPrice[]): {
    analysisSeries: PriceBasis | null;
    adjustedCloseMissingRatio: number;
    analyticsAvailability: AnalyticsAvailability;
    degradationReason: AnalyticsDegradationReason;
    preferredDisplaySeries: PriceBasis;
} => {
    if (prices.length === 0) {
        return {
            adjustedCloseMissingRatio: 1,
            analysisSeries: null,
            analyticsAvailability: 'unavailable',
            degradationReason: 'insufficient_samples',
            preferredDisplaySeries: 'close',
        };
    }

    const adjustedCloseValidCount = prices.filter((price) => isPositiveNumber(price.adjustedClose)).length;
    const adjustedCloseMissingRatio = 1 - adjustedCloseValidCount / prices.length;

    return {
        adjustedCloseMissingRatio,
        analysisSeries: 'close',
        analyticsAvailability: 'ok',
        degradationReason: null,
        preferredDisplaySeries: 'close',
    };
};

export const resolveAssetSeries = (prices: AssetSeriesInputPrice[]): ResolvedAssetSeries => {
    const resolution = resolveAnalysisSeries(prices);
    const points = prices.map((price) => {
        const rawValue = resolveRawValue(price);
        const analysisValue = rawValue;

        return {
            analysisValue,
            date: price.date,
            displayValueForAnalysisMode: analysisValue ?? rawValue,
            displayValueForRawMode: rawValue ?? analysisValue,
            rawValue,
            source: price.source,
        } satisfies ResolvedAssetSeriesPoint;
    });

    return {
        adjustedCloseMissingRatio: resolution.adjustedCloseMissingRatio,
        analysisSeries: resolution.analysisSeries,
        analyticsAvailability: resolution.analyticsAvailability,
        canShowRawObservation: false,
        dataSource: majoritySource(prices),
        degradationReason: resolution.degradationReason,
        points,
        preferredDisplaySeries: resolution.preferredDisplaySeries,
    };
};