import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { applyActiveDualMomentumCorrelationDedup } from './active-dual-momentum-correlation-dedup';
import type { PreparedAllocationData } from './preprocessor';
import { buildAsset, buildDateRange } from './portfolio-test-support';

const buildPrepared = (assets: StoredAsset[], prices: number[][]): PreparedAllocationData => ({
    alignedDates: buildDateRange(prices[0]?.length ?? 0),
    assetDateCoverage: [],
    excludedAssets: [],
    series: assets.map((asset, index) => ({
        annualizedReturn: 0,
        annualizedVolatility: 0,
        asset,
        prices: prices[index],
    })),
    warnings: [],
});

describe('applyActiveDualMomentumCorrelationDedup', () => {
    test('keeps the largest representative in each same-direction cluster', () => {
        const prepared = buildPrepared([
            buildAsset('asset-1', 'AAA', 'equity'),
            buildAsset('asset-2', 'BBB', 'equity'),
            buildAsset('asset-3', 'CCC', 'equity'),
        ], [
            [100, 101, 102, 103, 104, 105],
            [80, 80.8, 81.6, 82.4, 83.2, 84],
            [120, 119, 118, 117, 116, 115],
        ]);

        const result = applyActiveDualMomentumCorrelationDedup({
            maxLookbackDays: 5,
            positions: [
                { assetIndex: 0, direction: 'long', source: 'short', weight: 0.3 },
                { assetIndex: 1, direction: 'long', source: 'long', weight: 0.1 },
                { assetIndex: 2, direction: 'short', source: 'long', weight: 0.2 },
            ],
            prepared,
            rebalanceIndex: 5,
            representativeOnly: true,
        });

        expect(result.cashWeight).toBeCloseTo(0.1, 6);
        expect(result.positions).toEqual(expect.arrayContaining([
            expect.objectContaining({ assetIndex: 0, direction: 'long', weight: 0.3 }),
            expect.objectContaining({ assetIndex: 2, direction: 'short', weight: 0.2 }),
        ]));
        expect(result.positions).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ assetIndex: 1 }),
        ]));
    });

    test('compresses cluster weights proportionally when representative mode is disabled', () => {
        const prepared = buildPrepared([
            buildAsset('asset-1', 'AAA', 'equity'),
            buildAsset('asset-2', 'BBB', 'equity'),
        ], [
            [100, 101, 102, 103, 104, 105],
            [80, 80.8, 81.6, 82.4, 83.2, 84],
        ]);

        const result = applyActiveDualMomentumCorrelationDedup({
            maxLookbackDays: 5,
            positions: [
                { assetIndex: 0, direction: 'long', source: 'short', weight: 0.3 },
                { assetIndex: 1, direction: 'long', source: 'long', weight: 0.1 },
            ],
            prepared,
            rebalanceIndex: 5,
            representativeOnly: false,
        });

        const first = result.positions.find((position) => position.assetIndex === 0);
        const second = result.positions.find((position) => position.assetIndex === 1);
        expect(result.cashWeight).toBeCloseTo(0.1, 6);
        expect(first?.weight).toBeCloseTo(0.225, 6);
        expect(second?.weight).toBeCloseTo(0.075, 6);
    });
});
