import type {
    AllocationDiagnostics,
    AllocationStrategy,
    AllocationTrade,
} from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import type { TrendFollowingSimulationResult } from './trend-following';

export interface AllocationDiagnosticsInput {
    allocationAssetIds?: string[];
    allocationSleeveWeight: number;
    calculationDateRange: { startDate: string; endDate: string };
    optimizer: 'js' | 'python';
    optimizerDiagnostics: Partial<AllocationDiagnostics>;
    prepared: PreparedAllocationData;
    rebalanceEventCount: number;
    strategy: AllocationStrategy;
    trades: AllocationTrade[];
    trendFollowing?: TrendFollowingSimulationResult | null;
}

export const buildAllocationDiagnostics = ({
    allocationAssetIds,
    allocationSleeveWeight,
    calculationDateRange,
    optimizer,
    optimizerDiagnostics,
    prepared,
    rebalanceEventCount,
    strategy,
    trades,
    trendFollowing,
}: AllocationDiagnosticsInput): AllocationDiagnostics => {
    const hasStrategyMix = trendFollowing != null || allocationAssetIds != null;

    return {
        alignedDates: prepared.alignedDates.length,
        strategy,
        assetDateCoverage: prepared.assetDateCoverage,
        dateRange: {
            endDate: calculationDateRange.endDate,
            startDate: calculationDateRange.startDate,
        },
        excludedAssets: prepared.excludedAssets,
        metricComputation: 'portfolio_path_simulation',
        optimizer,
        rebalanceEventCount,
        warnings: [...prepared.warnings, ...(optimizerDiagnostics.warnings ?? [])],
        solverPath: optimizer,
        fallbackUsed: optimizerDiagnostics.fallbackUsed,
        fallbackReason: optimizerDiagnostics.fallbackReason,
        fallbackEquivalentMode: optimizerDiagnostics.fallbackEquivalentMode,
        erc: optimizerDiagnostics.erc,
        trades,
        strategyMix: hasStrategyMix ? {
            allocationSleeveWeight,
            allocation: allocationAssetIds ? { assetIds: allocationAssetIds } : undefined,
            trendFollowing: trendFollowing ? {
                allowShort: trendFollowing.allowShort,
                assetIds: trendFollowing.assetIds,
                enabled: true,
                forecastCap: trendFollowing.forecastCap,
                forecastDiversificationMultiplier: trendFollowing.forecastDiversificationMultiplier,
                ruleSlotCount: trendFollowing.ruleSlotCount,
                rules: trendFollowing.rules,
                sleeveWeight: trendFollowing.sleeveWeight,
            } : undefined,
        } : undefined,
        trendFollowing: trendFollowing ? {
            assets: trendFollowing.assetDiagnostics,
        } : undefined,
    };
};
