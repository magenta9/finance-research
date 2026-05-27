import type { AssetClass, Currency, Market } from './domain';

export type PriceAnalogWindow = '3M' | '6M' | '1Y';

export type PriceAnalogStatus = 'ok' | 'degraded' | 'unavailable';

export type PriceAnalogSourceType = 'self' | 'peer';

export type PriceAnalogForwardHorizon = '1M' | '3M' | '6M';

export type PriceAnalogForwardStatus = 'complete' | 'partial' | 'missing';

export interface PricePatternAnalogSearchRequest {
    assetId: string;
    window: PriceAnalogWindow;
    startDate?: string;
    endDate?: string;
    limit?: number;
}

export interface PriceAnalogPathPoint {
    date: string;
    index: number;
    normalizedLogReturn: number;
}

export interface PriceAnalogForwardOutcome {
    endDate: string | null;
    return: number | null;
    startDate: string | null;
    status: PriceAnalogForwardStatus;
    tradingDays: number;
}

export interface PricePatternAnalogAssetIdentity {
    assetClass: AssetClass;
    currency: Currency;
    id: string;
    market: Market;
    name: string;
    symbol: string;
}

export interface PricePatternAnalog {
    asset: PricePatternAnalogAssetIdentity;
    diagnostics: {
        analogMaxDrawdown: number;
        analogTotalReturn: number;
        analogVolatility: number | null;
        targetMaxDrawdown: number;
        targetTotalReturn: number;
        targetVolatility: number | null;
    };
    forward: Record<PriceAnalogForwardHorizon, PriceAnalogForwardOutcome>;
    forwardPaths: Partial<Record<PriceAnalogForwardHorizon, PriceAnalogPathPoint[]>>;
    id: string;
    match: {
        endDate: string;
        startDate: string;
        tradingDays: number;
    };
    path: PriceAnalogPathPoint[];
    similarity: {
        maxDrawdownDiff: number;
        penalty: number;
        score: number;
        shapeDistance: number;
        shapeScore: number;
        totalReturnDiff: number;
        volatilityDiff: number | null;
    };
    sourceType: PriceAnalogSourceType;
}

export interface PricePatternAnalogSearchResult {
    candidateSummary: {
        comparableAssetCount: number;
        dedupedWindowCount: number;
        eligibleWindowCount: number;
        localAssetCount: number;
        rawWindowCount: number;
    };
    query: {
        assetClass: AssetClass | null;
        assetId: string;
        endDate: string | null;
        market: Market | null;
        startDate: string | null;
        symbol: string | null;
        tradingDays: number;
        window: PriceAnalogWindow;
    };
    results: PricePatternAnalog[];
    status: PriceAnalogStatus;
    targetPath: PriceAnalogPathPoint[];
    warnings: string[];
}