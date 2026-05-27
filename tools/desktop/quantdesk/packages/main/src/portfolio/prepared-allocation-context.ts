import type { PreparedAllocationData } from './preprocessor';

export interface PreparedAssetMetadata {
    assetId: string;
    name: string;
    symbol: string;
}

export const getPreparedPriceSeries = (prepared: PreparedAllocationData): number[][] =>
    prepared.series.map((entry) => entry.prices);

export const getPreparedAssetMetadata = (prepared: PreparedAllocationData): PreparedAssetMetadata[] =>
    prepared.series.map((entry) => ({
        assetId: entry.asset.id,
        name: entry.asset.name,
        symbol: entry.asset.symbol,
    }));

export const getPreparedAssetIds = (prepared: PreparedAllocationData): string[] =>
    prepared.series.map((entry) => entry.asset.id);

export const getPreparedAssetNames = (prepared: PreparedAllocationData): string[] =>
    prepared.series.map((entry) => entry.asset.name);

export const getPreparedAssetSymbols = (prepared: PreparedAllocationData): string[] =>
    prepared.series.map((entry) => entry.asset.symbol);

export const resolvePreparedAssetIndexes = (prepared: PreparedAllocationData, assetIds?: string[]) => {
    if (!assetIds) {
        return prepared.series.map((_entry, index) => index);
    }

    const assetIdSet = new Set(assetIds);
    return prepared.series
        .map((entry, index) => assetIdSet.has(entry.asset.id) ? index : -1)
        .filter((index) => index >= 0);
};
