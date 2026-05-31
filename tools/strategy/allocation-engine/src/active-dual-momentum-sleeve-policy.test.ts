import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import type { ActiveDualMomentumCandidateScore } from './active-dual-momentum-candidate-scoring';
import { resolveActiveDualMomentumSleeveCandidate } from './active-dual-momentum-sleeve-policy';
import { normalizeActiveDualMomentumConfig } from './active-dual-momentum-rules';
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

const candidate = (overrides: Partial<ActiveDualMomentumCandidateScore> = {}): ActiveDualMomentumCandidateScore => ({
    assetIndex: 0,
    currentPrice: 100,
    downsideRisk: 0.01,
    drawdown: 0,
    futures: false,
    momentum: 0.1,
    rankScore: 1,
    recent: 0.03,
    riskScore: 1,
    volatility: 0.02,
    ...overrides,
});

describe('resolveActiveDualMomentumSleeveCandidate', () => {
    test('filters negative futures momentum out of the long sleeve', () => {
        const asset = buildAsset('future-down', 'FU9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } });
        const prepared = buildPrepared([asset], [[100, 90]]);

        const result = resolveActiveDualMomentumSleeveCandidate({
            asset,
            candidate: candidate({ futures: true, momentum: -0.1 }),
            config: normalizeActiveDualMomentumConfig(),
            lookbackDays: 1,
            prepared,
            rankSpread: 0.1,
            rebalanceIndex: 1,
            sleeve: 'long',
            slotWeight: 0.2,
        });

        expect(result.position).toBeUndefined();
        expect(result.cashWeight).toBeCloseTo(0.2, 6);
        expect(result.filtered).toEqual([expect.objectContaining({ assetId: 'future-down', reason: 'NEGATIVE_MOMENTUM' })]);
    });

    test('keeps futures shorts while routing multiplier excess to cash', () => {
        const asset = buildAsset('future-down', 'FU9999', 'commodity', { market: 'COMMODITY', metadata: { instrumentType: 'future' } });
        const prepared = buildPrepared([asset], [[100, 90]]);

        const result = resolveActiveDualMomentumSleeveCandidate({
            asset,
            candidate: candidate({ futures: true, momentum: -0.1 }),
            config: normalizeActiveDualMomentumConfig({ researchProfile: { futuresShortWeightMultiplier: 0.5 } } as Parameters<typeof normalizeActiveDualMomentumConfig>[0]),
            lookbackDays: 1,
            prepared,
            rankSpread: 0.1,
            rebalanceIndex: 1,
            sleeve: 'short',
            slotWeight: 0.2,
        });

        expect(result.position).toEqual(expect.objectContaining({ direction: 'short', shortMomentum: -0.1 }));
        expect(result.position?.weight).toBeCloseTo(0.1, 6);
        expect(result.cashWeight).toBeCloseTo(0.1, 6);
    });

    test('routes negative ETF momentum to cash under absolute momentum filter', () => {
        const asset = buildAsset('etf-down', 'TLT', 'fixed_income');
        const prepared = buildPrepared([asset], [[100, 90]]);

        const result = resolveActiveDualMomentumSleeveCandidate({
            asset,
            candidate: candidate({ currentPrice: 90, momentum: -0.1 }),
            config: normalizeActiveDualMomentumConfig(),
            lookbackDays: 1,
            prepared,
            rankSpread: 0.1,
            rebalanceIndex: 1,
            sleeve: 'short',
            slotWeight: 0.2,
        });

        expect(result.position).toBeUndefined();
        expect(result.cashWeight).toBeCloseTo(0.2, 6);
        expect(result.filtered).toEqual([expect.objectContaining({ assetId: 'etf-down', reason: 'NEGATIVE_MOMENTUM' })]);
    });
});
