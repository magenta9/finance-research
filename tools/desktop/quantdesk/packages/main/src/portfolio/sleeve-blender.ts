import type { AllocationTrade } from '@quantdesk/shared';

import { aggregateAllocationTradeSources } from './allocation-trade-orchestrator';
import type { TrendFollowingSimulationResult } from './trend-following';

export interface SleeveBlendInput {
    allocationSleeveWeight?: number;
    allocationTrades: AllocationTrade[];
    trendFollowing?: TrendFollowingSimulationResult | null;
    weights: number[];
}

export interface SleeveBlendResult {
    allocationSleeveWeight: number;
    effectiveWeights: number[];
    trades: AllocationTrade[];
}

export const blendAllocationSleeves = ({
    allocationSleeveWeight = 1,
    allocationTrades,
    trendFollowing,
    weights,
}: SleeveBlendInput): SleeveBlendResult => {
    const resolvedAllocationSleeveWeight = trendFollowing ? allocationSleeveWeight : 1;
    const effectiveWeights = trendFollowing
        ? weights.map((weight, index) =>
            resolvedAllocationSleeveWeight * weight + trendFollowing.sleeveWeight * (trendFollowing.latestWeights[index] ?? 0))
        : weights;
    const trades = aggregateAllocationTradeSources({
        sources: [
            { trades: allocationTrades, weightScale: resolvedAllocationSleeveWeight },
            { trades: trendFollowing?.trades ?? [] },
        ],
    });

    return {
        allocationSleeveWeight: resolvedAllocationSleeveWeight,
        effectiveWeights,
        trades,
    };
};
