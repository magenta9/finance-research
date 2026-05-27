import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { buildAllocationRiskMetrics } from './allocation-risk-metrics';
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

describe('allocation risk metrics', () => {
    test('builds risk contribution records and correlation matrix labels', () => {
        const result = buildAllocationRiskMetrics({
            covariance: [
                [0.04, 0.01],
                [0.01, 0.09],
            ],
            effectiveWeights: [0.5, 0.5],
            prepared,
        });

        expect(result.contributions[0]).toBeCloseTo(1 / 3, 6);
        expect(result.contributions[1]).toBeCloseTo(2 / 3, 6);
        expect(result.riskContributions).toEqual({
            'asset-a': result.contributions[0],
            'asset-b': result.contributions[1],
        });
        expect(result.correlationMatrix.labels).toEqual(['AAA', 'BBB']);
        expect(result.correlationMatrix.matrix[0][1]).toBeCloseTo(1 / 6, 6);
    });
});
