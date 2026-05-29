import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import {
    mergeActiveDualMomentumSleeves,
    normalizeActiveDualMomentumConfig,
    selectActiveDualMomentumSleeve,
} from './active-dual-momentum-rules';
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

describe('active dual momentum rules', () => {
    test('normalizes topK to the supported three to five asset range', () => {
        expect(normalizeActiveDualMomentumConfig({ topK: 2 }).topK).toBe(3);
        expect(normalizeActiveDualMomentumConfig({ topK: 4 }).topK).toBe(4);
        expect(normalizeActiveDualMomentumConfig({ topK: 6 }).topK).toBe(5);
        expect(normalizeActiveDualMomentumConfig({ topK: 4.6 }).topK).toBe(5);
    });

    test('selects futures by absolute momentum while filtering negative ETF momentum to cash', () => {
        const assets = [
            buildAsset('asset-etf-up', 'SPY', 'equity'),
            buildAsset('asset-etf-down', 'TLT', 'fixed_income'),
            buildAsset('asset-future-down', 'FU9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
        ];
        const prepared = buildPrepared(assets, [
            [100, 110],
            [100, 90],
            [100, 70],
        ]);

        const selection = selectActiveDualMomentumSleeve({
            config: normalizeActiveDualMomentumConfig({ sleeveWeights: { long: 0.5, short: 0.5 }, topK: 3 }),
            lookbackWeeks: 0.2,
            prepared,
            rebalanceIndex: 1,
            sleeve: 'short',
        });

        expect(selection.cashWeight).toBeCloseTo(1 / 6, 6);
        expect(selection.filtered).toEqual([expect.objectContaining({ assetId: 'asset-etf-down', reason: 'NEGATIVE_MOMENTUM' })]);
        expect(selection.positions).toEqual(expect.arrayContaining([
            expect.objectContaining({ assetIndex: 2, direction: 'short', weight: 1 / 6 }),
            expect.objectContaining({ assetIndex: 0, direction: 'long', weight: 1 / 6 }),
        ]));
    });

    test('merges short and long sleeves into net directional positions', () => {
        const merged = mergeActiveDualMomentumSleeves(
            { cashWeight: 0, filtered: [], positions: [{ assetIndex: 0, direction: 'short', shortMomentum: -0.2, source: 'short', weight: 0.4 }] },
            { cashWeight: 0, filtered: [], positions: [{ assetIndex: 0, direction: 'long', longMomentum: 0.1, source: 'long', weight: 0.1 }] },
        );

        expect(merged[0]).toEqual(expect.objectContaining({
            assetIndex: 0,
            direction: 'short',
            longMomentum: 0.1,
            shortMomentum: -0.2,
            source: 'both',
        }));
        expect(merged[0]?.weight).toBeCloseTo(0.3, 6);
    });

    test('weights selected sleeve assets by inverse realized volatility', () => {
        const assets = [
            buildAsset('asset-high-vol', 'HV', 'equity'),
            buildAsset('asset-low-vol', 'LV', 'equity'),
            buildAsset('asset-mid-vol', 'MV', 'equity'),
        ];
        const prepared = buildPrepared(assets, [
            [100, 130, 90, 110],
            [100, 101, 102, 103],
            [100, 104, 105, 106],
        ]);

        const selection = selectActiveDualMomentumSleeve({
            config: normalizeActiveDualMomentumConfig({ absoluteMomentumFilter: false, sleeveWeights: { long: 0.6, short: 0.4 }, topK: 3 }),
            lookbackWeeks: 0.6,
            prepared,
            rebalanceIndex: 3,
            sleeve: 'long',
        });
        const lowVolWeight = selection.positions.find((position) => position.assetIndex === 1)?.weight ?? 0;
        const highVolWeight = selection.positions.find((position) => position.assetIndex === 0)?.weight ?? 0;

        expect(selection.positions.reduce((sum, position) => sum + position.weight, 0)).toBeCloseTo(0.6, 6);
        expect(lowVolWeight).toBeGreaterThan(highVolWeight);
    });

    test('ranks candidates by momentum per downside volatility by default', () => {
        const assets = [
            buildAsset('asset-volatile', 'VOL', 'equity'),
            buildAsset('asset-steady', 'STD', 'equity'),
            buildAsset('asset-mid', 'MID', 'equity'),
            buildAsset('asset-weak', 'WEAK', 'equity'),
        ];
        const prepared = buildPrepared(assets, [
            [100, 170, 90, 150, 100, 150],
            [100, 101, 102, 103, 104, 112],
            [100, 103, 104, 106, 107, 115],
            [100, 102, 101, 103, 104, 106],
        ]);

        const selection = selectActiveDualMomentumSleeve({
            config: normalizeActiveDualMomentumConfig({ absoluteMomentumFilter: false, sleeveWeights: { long: 0.6, short: 0.4 }, topK: 3 }),
            lookbackWeeks: 1,
            prepared,
            rebalanceIndex: 5,
            sleeve: 'long',
        });

        expect(selection.positions[0]?.assetIndex).toBe(2);
        expect(selection.positions).toEqual(expect.arrayContaining([
            expect.objectContaining({ assetIndex: 1 }),
        ]));
        expect(selection.positions).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ assetIndex: 0 }),
        ]));
    });

    test('keeps long sleeve futures focused on positive trend', () => {
        const assets = [
            buildAsset('asset-future-up', 'UP9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
            buildAsset('asset-future-down', 'DN9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } }),
            buildAsset('asset-etf-up', 'ETF', 'equity'),
        ];
        const prepared = buildPrepared(assets, [
            [100, 105],
            [100, 80],
            [100, 103],
        ]);

        const selection = selectActiveDualMomentumSleeve({
            config: normalizeActiveDualMomentumConfig({ sleeveWeights: { long: 0.6, short: 0.4 }, topK: 3 }),
            lookbackWeeks: 0.2,
            prepared,
            rebalanceIndex: 1,
            sleeve: 'long',
        });

        expect(selection.positions).toEqual(expect.arrayContaining([
            expect.objectContaining({ assetIndex: 0, direction: 'long' }),
            expect.objectContaining({ assetIndex: 2, direction: 'long' }),
        ]));
        expect(selection.positions).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ assetIndex: 1 }),
        ]));
    });
});
