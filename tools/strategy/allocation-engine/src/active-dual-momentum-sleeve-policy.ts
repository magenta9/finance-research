import type { ActiveDualMomentumDiagnostics } from '@quantdesk/shared';

import type { ActiveDualMomentumCandidateScore } from './active-dual-momentum-candidate-scoring';
import type { PreparedAllocationData } from './preprocessor';
import type {
    ActiveDualMomentumPosition,
    NormalizedActiveDualMomentumConfig,
} from './active-dual-momentum-rules';

export interface ActiveDualMomentumSleeveCandidatePolicyResult {
    cashWeight: number;
    filtered: ActiveDualMomentumDiagnostics['rebalanceRecords'][number]['selectedButFiltered'];
    position?: ActiveDualMomentumPosition;
}

const highestPrice = (prices: number[], startIndex: number, endIndex: number) => {
    let high = 0;

    for (let index = startIndex; index <= endIndex; index += 1) {
        high = Math.max(high, prices[index] ?? 0);
    }

    return high;
};

const filteredNegativeMomentum = ({
    asset,
    momentum,
}: {
    asset: PreparedAllocationData['series'][number]['asset'];
    momentum: number;
}): ActiveDualMomentumSleeveCandidatePolicyResult => ({
    cashWeight: 0,
    filtered: [{
        assetId: asset.id,
        momentum,
        reason: 'NEGATIVE_MOMENTUM',
        symbol: asset.symbol,
    }],
});

export const resolveActiveDualMomentumSleeveCandidate = ({
    asset,
    candidate,
    config,
    lookbackDays,
    prepared,
    rankSpread,
    rebalanceIndex,
    sleeve,
    slotWeight,
}: {
    asset: PreparedAllocationData['series'][number]['asset'];
    candidate: ActiveDualMomentumCandidateScore;
    config: NormalizedActiveDualMomentumConfig;
    lookbackDays: number;
    prepared: PreparedAllocationData;
    rankSpread: number;
    rebalanceIndex: number;
    sleeve: 'short' | 'long';
    slotWeight: number;
}): ActiveDualMomentumSleeveCandidatePolicyResult => {
    const profile = config.researchProfile;
    const filtered: ActiveDualMomentumSleeveCandidatePolicyResult['filtered'] = [];
    let cashWeight = 0;
    let resolvedSlotWeight = slotWeight;
    const closeScoreThreshold = profile?.closeScoreThreshold ?? 0;

    if (profile?.closeScoreCashFactor && rankSpread > 0 && rankSpread < closeScoreThreshold) {
        const retainedWeight = resolvedSlotWeight * profile.closeScoreCashFactor;
        cashWeight += resolvedSlotWeight - retainedWeight;
        resolvedSlotWeight = retainedWeight;
    }

    if (profile?.decayPenaltyFactor && Math.sign(candidate.momentum) !== Math.sign(candidate.recent) && candidate.recent !== 0) {
        const retainedWeight = resolvedSlotWeight * profile.decayPenaltyFactor;
        cashWeight += resolvedSlotWeight - retainedWeight;
        resolvedSlotWeight = retainedWeight;
    }

    if (profile?.shockToCash && candidate.volatility > 0 && Math.abs(candidate.recent) > candidate.volatility * 5) {
        return { cashWeight: cashWeight + resolvedSlotWeight, filtered };
    }

    if (profile?.maxPositionWeight && resolvedSlotWeight > profile.maxPositionWeight) {
        cashWeight += resolvedSlotWeight - profile.maxPositionWeight;
        resolvedSlotWeight = profile.maxPositionWeight;
    }

    if (candidate.futures) {
        if (candidate.momentum === 0) {
            return { cashWeight, filtered };
        }

        if (sleeve === 'long' && candidate.momentum < 0) {
            const negativeMomentum = filteredNegativeMomentum({ asset, momentum: candidate.momentum });
            return {
                cashWeight: cashWeight + resolvedSlotWeight,
                filtered: [...filtered, ...negativeMomentum.filtered],
            };
        }

        if (profile?.confirmFuturesShort && candidate.momentum < 0 && candidate.recent >= 0) {
            const negativeMomentum = filteredNegativeMomentum({ asset, momentum: candidate.momentum });
            return {
                cashWeight: cashWeight + resolvedSlotWeight,
                filtered: [...filtered, ...negativeMomentum.filtered],
            };
        }

        if (profile?.futuresShortWeightMultiplier && candidate.momentum < 0) {
            const retainedWeight = resolvedSlotWeight * profile.futuresShortWeightMultiplier;
            cashWeight += resolvedSlotWeight - retainedWeight;
            resolvedSlotWeight = retainedWeight;
        }

        return {
            cashWeight,
            filtered,
            position: {
                assetIndex: candidate.assetIndex,
                direction: candidate.momentum > 0 ? 'long' : 'short',
                longMomentum: sleeve === 'long' ? candidate.momentum : undefined,
                shortMomentum: sleeve === 'short' ? candidate.momentum : undefined,
                source: sleeve,
                weight: resolvedSlotWeight,
            },
        };
    }

    if (profile?.etfHighWaterFilter) {
        const high = highestPrice(prepared.series[candidate.assetIndex].prices, rebalanceIndex - lookbackDays, rebalanceIndex);

        if (high > 0 && candidate.currentPrice < high * 0.9) {
            const negativeMomentum = filteredNegativeMomentum({ asset, momentum: candidate.momentum });
            return {
                cashWeight: cashWeight + resolvedSlotWeight,
                filtered: [...filtered, ...negativeMomentum.filtered],
            };
        }
    }

    if (config.absoluteMomentumFilter && candidate.momentum <= 0) {
        const negativeMomentum = filteredNegativeMomentum({ asset, momentum: candidate.momentum });
        return {
            cashWeight: cashWeight + resolvedSlotWeight,
            filtered: [...filtered, ...negativeMomentum.filtered],
        };
    }

    return {
        cashWeight,
        filtered,
        position: {
            assetIndex: candidate.assetIndex,
            direction: 'long',
            longMomentum: sleeve === 'long' ? candidate.momentum : undefined,
            shortMomentum: sleeve === 'short' ? candidate.momentum : undefined,
            source: sleeve,
            weight: resolvedSlotWeight,
        },
    };
};
