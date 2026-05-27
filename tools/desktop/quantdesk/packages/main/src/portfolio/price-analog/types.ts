import type { PricePatternAnalog, PricePatternAnalogSearchRequest, StoredAsset } from '@quantdesk/shared';

export interface AnalogSeriesPoint {
    date: string;
    price: number;
}

export interface AnalogSeries {
    asset: StoredAsset;
    points: AnalogSeriesPoint[];
}

export interface WindowSnapshot {
    endIndex: number;
    logPath: number[];
    maxDrawdown: number;
    path: PricePatternAnalog['path'];
    shapePath: number[];
    startIndex: number;
    totalReturn: number;
    volatility: number | null;
}

export interface ScoredAnalogCandidate extends PricePatternAnalog {
    endIndex: number;
    overlapStartIndex: number;
    startIndex: number;
}

export interface PriceAnalogSearchDependencies {
    assetRepository: {
        list: () => StoredAsset[];
    };
    priceRepository: {
        listByAsset: (assetId: string) => Array<{
            adjustedClose: number | null;
            close: number | null;
            date: string;
            source: string;
        }>;
    };
}

export interface PriceAnalogSearchInput {
    dependencies: PriceAnalogSearchDependencies;
    request: PricePatternAnalogSearchRequest;
}