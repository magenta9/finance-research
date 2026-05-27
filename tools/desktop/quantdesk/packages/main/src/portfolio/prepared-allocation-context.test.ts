import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import {
    getPreparedAssetIds,
    getPreparedAssetMetadata,
    getPreparedAssetNames,
    getPreparedAssetSymbols,
    getPreparedPriceSeries,
    resolvePreparedAssetIndexes,
} from './prepared-allocation-context';
import type { PreparedAllocationData } from './preprocessor';

const buildAsset = (id: string, symbol: string): StoredAsset => ({
    assetClass: 'equity',
    createdAt: '2026-01-01T00:00:00.000Z',
    currency: 'CNY',
    id,
    market: 'A',
    metadata: {},
    name: `Name ${symbol}`,
    symbol,
    tags: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
});

const prepared: PreparedAllocationData = {
    alignedDates: ['2026-01-01', '2026-01-02'],
    assetDateCoverage: [],
    excludedAssets: [],
    series: [
        { annualizedReturn: 0, annualizedVolatility: 0, asset: buildAsset('asset-a', 'AAA'), prices: [1, 2] },
        { annualizedReturn: 0, annualizedVolatility: 0, asset: buildAsset('asset-b', 'BBB'), prices: [3, 4] },
        { annualizedReturn: 0, annualizedVolatility: 0, asset: buildAsset('asset-c', 'CCC'), prices: [5, 6] },
    ],
    warnings: [],
};

describe('prepared allocation context', () => {
    test('derives price series and asset metadata contexts', () => {
        expect(getPreparedPriceSeries(prepared)).toEqual([[1, 2], [3, 4], [5, 6]]);
        expect(getPreparedAssetMetadata(prepared)).toEqual([
            { assetId: 'asset-a', name: 'Name AAA', symbol: 'AAA' },
            { assetId: 'asset-b', name: 'Name BBB', symbol: 'BBB' },
            { assetId: 'asset-c', name: 'Name CCC', symbol: 'CCC' },
        ]);
    });

    test('derives trend-following asset arrays in series order', () => {
        expect(getPreparedAssetIds(prepared)).toEqual(['asset-a', 'asset-b', 'asset-c']);
        expect(getPreparedAssetNames(prepared)).toEqual(['Name AAA', 'Name BBB', 'Name CCC']);
        expect(getPreparedAssetSymbols(prepared)).toEqual(['AAA', 'BBB', 'CCC']);
    });

    test('resolves selected asset indexes in prepared series order', () => {
        expect(resolvePreparedAssetIndexes(prepared)).toEqual([0, 1, 2]);
        expect(resolvePreparedAssetIndexes(prepared, ['asset-c', 'asset-a'])).toEqual([0, 2]);
        expect(resolvePreparedAssetIndexes(prepared, ['missing'])).toEqual([]);
    });
});
