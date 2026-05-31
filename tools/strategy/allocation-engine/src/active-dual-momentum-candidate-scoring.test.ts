import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import {
    buildActiveDualMomentumCandidateScores,
    isActiveDualMomentumFuturesAsset,
} from './active-dual-momentum-candidate-scoring';
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

describe('active dual momentum candidate scoring', () => {
    test('detects futures assets from metadata, tags, and main contract symbols', () => {
        expect(isActiveDualMomentumFuturesAsset(buildAsset('future-meta', 'RB', 'commodity', { metadata: { instrumentType: 'future' } }))).toBe(true);
        expect(isActiveDualMomentumFuturesAsset(buildAsset('future-tag', 'CU', 'commodity', { tags: ['期货'] }))).toBe(true);
        expect(isActiveDualMomentumFuturesAsset(buildAsset('future-symbol', 'FU9999', 'commodity'))).toBe(true);
        expect(isActiveDualMomentumFuturesAsset(buildAsset('etf', 'SPY', 'equity'))).toBe(false);
    });

    test('ranks futures by absolute momentum and equities by signed momentum', () => {
        const assets = [
            buildAsset('future-down', 'FU9999', 'commodity'),
            buildAsset('equity-up', 'SPY', 'equity'),
            buildAsset('equity-down', 'TLT', 'fixed_income'),
        ];
        const prepared = buildPrepared(assets, [
            [100, 70],
            [100, 120],
            [100, 80],
        ]);

        const candidates = buildActiveDualMomentumCandidateScores({
            lookbackDays: 1,
            prepared,
            rebalanceIndex: 1,
            topK: 3,
        });

        expect(candidates.map((candidate) => candidate.assetIndex)).toEqual([0, 1, 2]);
        expect(candidates[0]?.momentum).toBeCloseTo(-0.3, 6);
        expect(candidates[0]?.rankScore).toBeGreaterThan(candidates[1]?.rankScore ?? 0);
    });

    test('uses downside-volatility adjusted rank and risk score by default', () => {
        const assets = [
            buildAsset('volatile', 'VOL', 'equity'),
            buildAsset('steady', 'STD', 'equity'),
            buildAsset('mid', 'MID', 'equity'),
        ];
        const prepared = buildPrepared(assets, [
            [100, 170, 90, 150, 100, 150],
            [100, 101, 102, 103, 104, 112],
            [100, 103, 104, 106, 107, 115],
        ]);

        const candidates = buildActiveDualMomentumCandidateScores({
            lookbackDays: 5,
            prepared,
            rebalanceIndex: 5,
            topK: 3,
        });

        expect(candidates[0]?.assetIndex).toBe(2);
        expect(candidates[1]?.assetIndex).toBe(1);
        expect(candidates.find((candidate) => candidate.assetIndex === 1)?.riskScore)
            .toBeGreaterThan(candidates.find((candidate) => candidate.assetIndex === 0)?.riskScore ?? 0);
    });
});
