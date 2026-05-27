import type { AllocationTrade } from '@quantdesk/shared';

import { minimumPortfolioTradeWeight } from './portfolio-constants';
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

export const scaleAllocationTrade = (trade: AllocationTrade, scale: number): AllocationTrade => ({
    ...trade,
    fromWeight: trade.fromWeight * scale,
    toWeight: trade.toWeight * scale,
    weightChange: trade.weightChange * scale,
});

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
    const trades = [
        ...allocationTrades.map((trade) => scaleAllocationTrade(trade, resolvedAllocationSleeveWeight)),
        ...(trendFollowing?.trades ?? []),
    ].filter((trade) => Math.abs(trade.weightChange) >= minimumPortfolioTradeWeight);

    return {
        allocationSleeveWeight: resolvedAllocationSleeveWeight,
        effectiveWeights,
        trades,
    };
};
