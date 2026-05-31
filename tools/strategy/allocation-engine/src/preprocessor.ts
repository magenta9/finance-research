import type { AssetDateCoverage, StoredAsset } from '@quantdesk/shared';

export interface PreparedAssetSeries {
    asset: StoredAsset;
    prices: number[];
    annualizedReturn: number;
    annualizedVolatility: number;
}

export interface PreparedAllocationData {
    alignedDates: string[];
    assetDateCoverage: AssetDateCoverage[];
    excludedAssets: string[];
    series: PreparedAssetSeries[];
    warnings: string[];
}
