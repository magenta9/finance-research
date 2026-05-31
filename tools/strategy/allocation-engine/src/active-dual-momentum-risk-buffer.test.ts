import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import {
    activeDualMomentumPortfolioDownsideVolatility,
    resolveActiveDualMomentumCashBufferMultiplier,
} from './active-dual-momentum-risk-buffer';
import { normalizeActiveDualMomentumConfig, type ActiveDualMomentumPosition } from './active-dual-momentum-rules';
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

const prepared = buildPrepared([
    buildAsset('asset-1', 'AAA', 'equity'),
    buildAsset('asset-2', 'BBB', 'equity'),
], [
    [100, 90, 110, 88, 112, 86],
    [100, 101, 99, 102, 98, 103],
]);

const positions: ActiveDualMomentumPosition[] = [
    { assetIndex: 0, direction: 'long', source: 'short', weight: 0.6 },
    { assetIndex: 1, direction: 'short', source: 'long', weight: 0.2 },
];

describe('active dual momentum risk buffer', () => {
    test('computes downside volatility from signed portfolio returns', () => {
        const downsideVolatility = activeDualMomentumPortfolioDownsideVolatility({
            endIndex: 5,
            positions,
            prepared,
            startIndex: 0,
        });

        expect(downsideVolatility).toBeGreaterThan(0);
    });

    test('keeps the base multiplier when downside-vol target is disabled', () => {
        const multiplier = resolveActiveDualMomentumCashBufferMultiplier({
            baseMultiplier: 0.75,
            config: normalizeActiveDualMomentumConfig({ researchProfile: { portfolioDownsideVolTarget: false } } as Parameters<typeof normalizeActiveDualMomentumConfig>[0]),
            grossPositions: positions,
            maxLookbackDays: 5,
            prepared,
            rebalanceIndex: 5,
        });

        expect(multiplier).toBe(0.75);
    });

    test('scales the cash buffer multiplier down when downside risk exceeds target', () => {
        const multiplier = resolveActiveDualMomentumCashBufferMultiplier({
            baseMultiplier: 0.75,
            config: normalizeActiveDualMomentumConfig(),
            grossPositions: positions,
            maxLookbackDays: 5,
            prepared,
            rebalanceIndex: 5,
        });

        expect(multiplier).toBeGreaterThan(0);
        expect(multiplier).toBeLessThan(0.75);
    });
});
