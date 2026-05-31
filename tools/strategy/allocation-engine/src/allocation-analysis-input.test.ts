import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { buildAllocationAnalysisInput } from './allocation-analysis-input';
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

const buildPrepared = (priceCount: number): PreparedAllocationData => ({
    alignedDates: Array.from({ length: priceCount }, (_value, index) => `2026-01-${String(index + 1).padStart(2, '0')}`),
    assetDateCoverage: [],
    excludedAssets: [],
    series: [
        {
            annualizedReturn: 0,
            annualizedVolatility: 0,
            asset: buildAsset('asset-a', 'AAA'),
            prices: Array.from({ length: priceCount }, (_value, index) => 100 + index),
        },
        {
            annualizedReturn: 0,
            annualizedVolatility: 0,
            asset: buildAsset('asset-b', 'BBB'),
            prices: Array.from({ length: priceCount }, (_value, index) => 200 + index * 0.5),
        },
    ],
    warnings: [],
});

describe('allocation analysis input', () => {
    test('rejects prepared data with fewer than 60 return observations', () => {
        const result = buildAllocationAnalysisInput(buildPrepared(60));

        expect(result).toEqual({
            error: expect.objectContaining({ code: 'INSUFFICIENT_HISTORY' }),
            ok: false,
        });
    });

    test('builds annualized returns, volatilities, and shrunk covariance', () => {
        const result = buildAllocationAnalysisInput(buildPrepared(61));

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.analysisInput.annualizedAssetVolatility).toHaveLength(2);
        expect(result.analysisInput.annualizedMeanReturns).toHaveLength(2);
        expect(result.analysisInput.shrunkCovariance).toHaveLength(2);
        expect(result.analysisInput.shrunkCovariance[0]).toHaveLength(2);
        expect(result.analysisInput.annualizedAssetVolatility[0]).toBeGreaterThanOrEqual(0);
    });
});
