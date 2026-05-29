import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import { normalizeActiveDualMomentumConfig, type ActiveDualMomentumPosition } from './active-dual-momentum-rules';
import { resolveActiveDualMomentumPositionPipeline } from './active-dual-momentum-position-pipeline';
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

const baseInput = ({
    baseTargetPositions,
    previousPositions = [],
    profile = {},
}: {
    baseTargetPositions: ActiveDualMomentumPosition[];
    previousPositions?: ActiveDualMomentumPosition[];
    profile?: NonNullable<ReturnType<typeof normalizeActiveDualMomentumConfig>['researchProfile']>;
}) => {
    const assets = [
        buildAsset('asset-1', 'AAA', 'equity'),
        buildAsset('asset-2', 'BBB', 'equity'),
        buildAsset('asset-3', 'CCC', 'equity'),
    ];
    const prepared = buildPrepared(assets, [
        [100, 101, 102, 103, 104, 105],
        [80, 81, 82, 83, 84, 85],
        [120, 119, 118, 117, 116, 115],
    ]);

    return {
        assetCount: assets.length,
        baseTargetPositions,
        cashInputs: {
            sameAssetSleeveDedup: 0.03,
            sleeveFilter: 0.05,
            standingBuffer: 0.12,
        },
        config: normalizeActiveDualMomentumConfig({ researchProfile: profile } as Parameters<typeof normalizeActiveDualMomentumConfig>[0]),
        maxLookbackDays: 5,
        prepared,
        previousPositions,
        rebalanceIndex: 5,
    };
};

describe('resolveActiveDualMomentumPositionPipeline', () => {
    test('explains explicit cash and residual cash separately', () => {
        const result = resolveActiveDualMomentumPositionPipeline(baseInput({
            baseTargetPositions: [
                { assetIndex: 0, direction: 'long', source: 'short', weight: 0.3 },
                { assetIndex: 1, direction: 'short', source: 'long', weight: 0.2 },
            ],
            profile: { correlatedSameDirectionBudgetDedup: false },
        }));

        expect(result.cashBreakdown.explicit.crossSignOffset).toBeCloseTo(0.4, 6);
        expect(result.cashBreakdown.explicit.total).toBeCloseTo(0.6, 6);
        expect(result.cashBreakdown.residual).toBeCloseTo(0.9, 6);
        expect(result.cashBreakdown.resolvedTotal).toBeCloseTo(0.9, 6);
        const crossSignTrace = result.processorTrace.find((trace) => trace.id === 'cross-sign-offset-cash');
        expect(crossSignTrace?.cashWeight).toBeCloseTo(0.4, 6);
        expect(result.processorTrace).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'rebalance-smoothing' }),
        ]));
        expect(result.targetPositions).toHaveLength(1);
        expect(result.targetPositions[0]).toEqual(expect.objectContaining({ assetIndex: 0, direction: 'long' }));
        expect(result.targetPositions[0]?.weight).toBeCloseTo(0.1, 6);
    });

    test('attributes same-direction correlation compression to the correlation processor', () => {
        const result = resolveActiveDualMomentumPositionPipeline(baseInput({
            baseTargetPositions: [
                { assetIndex: 0, direction: 'long', source: 'short', weight: 0.3 },
                { assetIndex: 1, direction: 'long', source: 'long', weight: 0.1 },
            ],
            profile: { crossSignOffsetCash: false },
        }));

        expect(result.cashBreakdown.explicit.correlatedSameDirectionDedup).toBeCloseTo(0.1, 6);
        expect(result.targetPositions).toEqual([
            expect.objectContaining({ assetIndex: 0, direction: 'long', weight: 0.3 }),
        ]);
        const correlationTrace = result.processorTrace.find((trace) => trace.id === 'correlated-same-direction-dedup');
        expect(correlationTrace).toEqual(expect.objectContaining({ changedPositionCount: 1 }));
        expect(correlationTrace?.cashWeight).toBeCloseTo(0.1, 6);
    });

    test('routes exited risk budget to cash before redeploying new positions', () => {
        const result = resolveActiveDualMomentumPositionPipeline(baseInput({
            baseTargetPositions: [
                { assetIndex: 1, direction: 'long', source: 'long', weight: 0.6 },
            ],
            previousPositions: [
                { assetIndex: 0, direction: 'long', source: 'short', weight: 0.4 },
            ],
            profile: { correlatedSameDirectionBudgetDedup: false, crossSignOffsetCash: false },
        }));

        expect(result.cashBreakdown.explicit.riskExitCooldown).toBeCloseTo(0.4, 6);
        expect(result.targetPositions).toHaveLength(1);
        expect(result.targetPositions[0]).toEqual(expect.objectContaining({ assetIndex: 1, direction: 'long' }));
        expect(result.targetPositions[0]?.weight).toBeCloseTo(0.2, 6);
        const exitTrace = result.processorTrace.find((trace) => trace.id === 'risk-exit-redeployment-cooldown');
        expect(exitTrace?.cashWeight).toBeCloseTo(0.4, 6);
    });

    test('routes trimmed same-direction risk budget to cash before increasing other positions', () => {
        const result = resolveActiveDualMomentumPositionPipeline(baseInput({
            baseTargetPositions: [
                { assetIndex: 0, direction: 'long', source: 'short', weight: 0.4 },
                { assetIndex: 1, direction: 'long', source: 'long', weight: 0.4 },
            ],
            previousPositions: [
                { assetIndex: 0, direction: 'long', source: 'short', weight: 0.6 },
            ],
            profile: { correlatedSameDirectionBudgetDedup: false, crossSignOffsetCash: false },
        }));

        expect(result.cashBreakdown.explicit.riskTrimCooldown).toBeCloseTo(0.2, 6);
        const retainedPosition = result.targetPositions.find((position) => position.assetIndex === 0);
        const increasedPosition = result.targetPositions.find((position) => position.assetIndex === 1);
        expect(retainedPosition).toEqual(expect.objectContaining({ direction: 'long' }));
        expect(retainedPosition?.weight).toBeCloseTo(0.4, 6);
        expect(increasedPosition).toEqual(expect.objectContaining({ direction: 'long' }));
        expect(increasedPosition?.weight).toBeCloseTo(0.2, 6);
        const trimTrace = result.processorTrace.find((trace) => trace.id === 'risk-trim-redeployment-cooldown');
        expect(trimTrace?.cashWeight).toBeCloseTo(0.2, 6);
    });
});
