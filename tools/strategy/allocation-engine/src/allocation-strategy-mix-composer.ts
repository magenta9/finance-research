import type { AllocationTrade, PortfolioMetrics, PortfolioPathPoint } from '@quantdesk/shared';

import { blendAllocationSleeves } from './sleeve-blender';
import type { TrendFollowingSimulationResult } from './trend-following';
import { combineSleeveReturns } from './trend-following';

export interface AllocationStrategyMixCompositionInput {
    alignedDates: string[];
    allocationEquity: number[];
    allocationMetrics: PortfolioMetrics;
    allocationPath: PortfolioPathPoint[];
    allocationTrades: AllocationTrade[];
    trendFollowing?: TrendFollowingSimulationResult | null;
    weights: number[];
}

export interface AllocationStrategyMixComposition {
    allocationSleeveWeight: number;
    effectiveWeights: number[];
    path: PortfolioPathPoint[];
    metrics: PortfolioMetrics;
    trades: AllocationTrade[];
}

export const composeAllocationStrategyMix = ({
    alignedDates,
    allocationEquity,
    allocationMetrics,
    allocationPath,
    allocationTrades,
    trendFollowing,
    weights,
}: AllocationStrategyMixCompositionInput): AllocationStrategyMixComposition => {
    const combinedSleeveSimulation = trendFollowing
        ? combineSleeveReturns({
            alignedDates,
            allocationEquity,
            trendFollowing,
        })
        : null;
    const sleeveBlend = blendAllocationSleeves({
        allocationSleeveWeight: combinedSleeveSimulation?.allocationSleeveWeight,
        allocationTrades,
        trendFollowing,
        weights,
    });

    return {
        ...sleeveBlend,
        metrics: combinedSleeveSimulation?.metrics ?? allocationMetrics,
        path: combinedSleeveSimulation?.path ?? allocationPath,
    };
};
