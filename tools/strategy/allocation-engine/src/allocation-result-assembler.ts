import type {
    AllocationDiagnostics,
    AllocationResult,
    AllocationStrategy,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import { buildAllocationDiagnostics } from './allocation-diagnostics';
import { buildAllocationRecords } from './allocation-records';
import { buildAllocationRiskMetrics } from './allocation-risk-metrics';
import { composeAllocationStrategyMix } from './allocation-strategy-mix-composer';
import { simulatePortfolioPath, type PathSimulationTargetWeightsResolver } from './path-simulator';
import { getPreparedAssetMetadata, getPreparedPriceSeries } from './prepared-allocation-context';
import { buildScenarioAnalysis } from './scenarios';
import type {
    TrendFollowingSimulationResult,
} from './trend-following';

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
    resolveTargetWeights?: PathSimulationTargetWeightsResolver;
    strategy: AllocationStrategy;
    trendFollowing?: TrendFollowingSimulationResult | null;
    weights: number[];
}

export const assembleAllocationResult = async ({
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
    resolveTargetWeights,
    strategy,
    trendFollowing,
    weights,
}: AssembleAllocationResultInput): Promise<AllocationResult> => {
    const priceSeries = getPreparedPriceSeries(prepared);
    const pathSimulation = await simulatePortfolioPath({
        alignedDates: prepared.alignedDates,
        assetMetadata: getPreparedAssetMetadata(prepared),
        priceSeries,
        rebalanceCadence,
        resolveTargetWeights,
        targetWeights: weights,
    });
    const strategyMixComposition = composeAllocationStrategyMix({
        alignedDates: prepared.alignedDates,
        allocationEquity: pathSimulation.portfolioEquity,
        allocationMetrics: pathSimulation.metrics,
        allocationPath: pathSimulation.portfolioPath,
        allocationTrades: pathSimulation.trades,
        trendFollowing,
        weights,
    });
    const { allocationSleeveWeight, effectiveWeights, trades } = strategyMixComposition;
    const riskMetrics = buildAllocationRiskMetrics({
        covariance,
        effectiveWeights,
        prepared,
    });
    const records = buildAllocationRecords({
        annualizedAssetVolatility,
        annualizedMeanReturns,
        effectiveWeights,
        prepared,
        riskContributions: riskMetrics.contributions,
    });
    const diagnostics = buildAllocationDiagnostics({
        allocationAssetIds,
        allocationSleeveWeight,
        calculationDateRange,
        optimizer,
        optimizerDiagnostics,
        prepared,
        rebalanceEventCount: pathSimulation.rebalanceEventCount,
        strategy,
        trades,
        trendFollowing,
    });

    return {
        allocations: records.allocations,
        baseCurrency,
        correlationMatrix: riskMetrics.correlationMatrix,
        diagnostics,
        diversificationRatio,
        generatedAt: new Date().toISOString(),
        strategy,
        mode,
        portfolioMetrics: strategyMixComposition.metrics,
        portfolioPath: strategyMixComposition.path,
        rebalanceCadence,
        riskContributions: riskMetrics.riskContributions,
        scenarioAnalysis: buildScenarioAnalysis(records.allocations),
        weights: records.weights,
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