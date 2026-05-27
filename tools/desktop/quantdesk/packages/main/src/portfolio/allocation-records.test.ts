import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { buildAllocationRecords } from './allocation-records';
import type { PreparedAllocationData } from './preprocessor';

const buildAsset = (id: string, symbol: string): StoredAsset => ({
    assetClass: 'equity',
    createdAt: '2026-01-01T00:00:00.000Z',
    currency: 'CNY',
    id,
    market: 'A',
    metadata: {},
    name: symbol,
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
        { annualizedReturn: 0, annualizedVolatility: 0, asset: buildAsset('asset-b', 'BBB'), prices: [2, 3] },
    ],
    warnings: [],
};

describe('allocation records', () => {
    test('builds sorted allocation records and asset weight map', () => {
        const result = buildAllocationRecords({
            annualizedAssetVolatility: [0.2, 0.3],
            annualizedMeanReturns: [0.08, 0.1],
            effectiveWeights: [0.25, 0.75],
            prepared,
            riskContributions: [0.2, 0.8],
        });

        expect(result.allocations.map((allocation) => allocation.assetId)).toEqual(['asset-b', 'asset-a']);
        expect(result.allocations[0]).toEqual(expect.objectContaining({
            annualizedReturn: 0.1,
            annualizedVolatility: 0.3,
            riskContribution: 0.8,
            weight: 0.75,
        }));
        expect(result.weights).toEqual({
            'asset-a': 0.25,
            'asset-b': 0.75,
        });
    });
});
