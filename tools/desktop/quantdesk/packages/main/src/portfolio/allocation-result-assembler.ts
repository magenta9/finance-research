import type {
    AllocationDiagnostics,
    AllocationResult,
    AllocationStrategy,
    AllocationTrade,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import { simulatePortfolioPath } from './path-simulator';
import { buildScenarioAnalysis } from './scenarios';
import { computeRiskContributions, correlationMatrix } from './statistics';
import type {
    TrendFollowingSimulationResult,
} from './trend-following';
import { combineSleeveReturns } from './trend-following';

const scaleTrade = (trade: AllocationTrade, scale: number): AllocationTrade => ({
    ...trade,
    fromWeight: trade.fromWeight * scale,
    toWeight: trade.toWeight * scale,
    weightChange: trade.weightChange * scale,
});

export interface AssembleAllocationResultInput {
    allocationAssetIds?: string[];
    annualizedAssetVolatility: number[];
    annualizedMeanReturns: number[];
    baseCurrency: Currency;
    calculationDateRange: { startDate: string; endDate: string };
    covariance: number[][];
    diversificationRatio?: number;
    mode: AllocationType;
    optimizer: 'js' | 'python';
    optimizerDiagnostics: Partial<AllocationDiagnostics>;
    prepared: PreparedAllocationData;
    rebalanceCadence: RebalanceCadence;
    strategy: AllocationStrategy;
    trendFollowing?: TrendFollowingSimulationResult | null;
    weights: number[];
}

export const assembleAllocationResult = ({
    allocationAssetIds,
    annualizedAssetVolatility,
    annualizedMeanReturns,
    baseCurrency,
    calculationDateRange,
    covariance,
    diversificationRatio,
    mode,
    optimizer,
    optimizerDiagnostics,
    prepared,
    rebalanceCadence,
    strategy,
    trendFollowing,
    weights,
}: AssembleAllocationResultInput): AllocationResult => {
    const priceSeries = prepared.series.map((entry) => entry.prices);
    const pathSimulation = simulatePortfolioPath({
        alignedDates: prepared.alignedDates,
        assetMetadata: prepared.series.map((entry) => ({
            assetId: entry.asset.id,
            name: entry.asset.name,
            symbol: entry.asset.symbol,
        })),
        priceSeries,
        rebalanceCadence,
        targetWeights: weights,
    });
    const combinedSleeveSimulation = trendFollowing
        ? combineSleeveReturns({
            alignedDates: prepared.alignedDates,
            allocationEquity: pathSimulation.portfolioEquity,
            trendFollowing,
        })
        : null;
    const allocationSleeveWeight = combinedSleeveSimulation?.allocationSleeveWeight ?? 1;
    const effectiveWeights = trendFollowing
        ? weights.map((weight, index) =>
            allocationSleeveWeight * weight + trendFollowing.sleeveWeight * (trendFollowing.latestWeights[index] ?? 0))
        : weights;
    const trades = [
        ...pathSimulation.trades.map((trade) => scaleTrade(trade, allocationSleeveWeight)),
        ...(trendFollowing?.trades ?? []),
    ].filter((trade) => Math.abs(trade.weightChange) >= 0.0001);
    const hasStrategyMix = trendFollowing != null || allocationAssetIds != null;
    const contributions = computeRiskContributions(effectiveWeights, covariance);
    const allocations = prepared.series.map((entry, index) => ({
        annualizedReturn: annualizedMeanReturns[index],
        annualizedVolatility: annualizedAssetVolatility[index],
        assetClass: entry.asset.assetClass,
        assetId: entry.asset.id,
        currency: entry.asset.currency,
        market: entry.asset.market,
        name: entry.asset.name,
        riskContribution: contributions[index],
        symbol: entry.asset.symbol,
        weight: effectiveWeights[index],
    }));

    return {
        allocations: allocations.sort((left, right) => right.weight - left.weight),
        baseCurrency,
        correlationMatrix: {
            labels: prepared.series.map((entry) => entry.asset.symbol),
            matrix: correlationMatrix(covariance),
        },
        diagnostics: {
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
            rebalanceEventCount: pathSimulation.rebalanceEventCount,
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
        },
        diversificationRatio,
        generatedAt: new Date().toISOString(),
        strategy,
        mode,
        portfolioMetrics: combinedSleeveSimulation?.metrics ?? pathSimulation.metrics,
        portfolioPath: combinedSleeveSimulation?.path ?? pathSimulation.portfolioPath,
        rebalanceCadence,
        riskContributions: Object.fromEntries(
            prepared.series.map((entry, index) => [entry.asset.id, contributions[index]]),
        ),
        scenarioAnalysis: buildScenarioAnalysis(allocations),
        weights: Object.fromEntries(
            prepared.series.map((entry, index) => [entry.asset.id, effectiveWeights[index]]),
        ),
    };
};

export const buildAllocationErrorResult = ({
    baseCurrency,
    effectiveDateRange,
    error,
    mode,
    prepared,
    rebalanceCadence,
    strategy,
}: {
    baseCurrency: Currency;
    effectiveDateRange: { startDate: string; endDate: string };
    error: NonNullable<AllocationResult['error']>;
    mode: AllocationType;
    prepared: PreparedAllocationData;
    rebalanceCadence: RebalanceCadence;
    strategy: AllocationStrategy;
}): AllocationResult => ({
    allocations: [],
    baseCurrency,
    correlationMatrix: {
        labels: [],
        matrix: [],
    },
    diagnostics: {
        alignedDates: prepared.alignedDates.length,
        strategy,
        assetDateCoverage: prepared.assetDateCoverage,
        dateRange: {
            endDate: effectiveDateRange.endDate,
            startDate: effectiveDateRange.startDate,
        },
        excludedAssets: prepared.excludedAssets,
        optimizer: 'js',
        warnings: prepared.warnings,
    },
    error,
    generatedAt: new Date().toISOString(),
    strategy,
    mode,
    portfolioMetrics: {
        expectedReturn: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        volatility: 0,
    },
    rebalanceCadence,
    riskContributions: {},
    scenarioAnalysis: [],
    weights: {},
});