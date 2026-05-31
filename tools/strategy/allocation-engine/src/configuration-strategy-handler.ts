import type { AllocationStrategy, AllocationType } from '@quantdesk/shared';

import { buildAllocationAnalysisInput } from './allocation-analysis-input';
import { assembleAllocationResult } from './allocation-result-assembler';
import {
    mergeAllocationConstraints,
    validateAllocationAssetSelection,
    validateAllocationConstraints,
} from './allocation-validator';
import type { PathSimulationTargetWeightsResolver } from './path-simulator';
import { resolvePreparedAssetIndexes } from './prepared-allocation-context';
import type { PreparedAllocationData } from './preprocessor';
import type { AllocationStrategyHandler, StrategyExecutionContext } from './strategy-contracts';
import { buildStrategyErrorResult } from './strategy-error-result';

const expandConfigurationWeights = (weights: number[], assetIndexes: number[], assetCount: number) => {
    const expandedWeights = Array.from({ length: assetCount }, () => 0);

    assetIndexes.forEach((assetIndex, localIndex) => {
        expandedWeights[assetIndex] = weights[localIndex] ?? 0;
    });

    return expandedWeights;
};

const slicePreparedAllocationData = (prepared: PreparedAllocationData, dayIndex: number): PreparedAllocationData => {
    const sliceEnd = dayIndex + 1;
    const alignedDates = prepared.alignedDates.slice(0, sliceEnd);

    return {
        ...prepared,
        alignedDates,
        assetDateCoverage: prepared.assetDateCoverage.map((coverage) => ({
            ...coverage,
            actualEndDate: alignedDates.at(-1) ?? coverage.actualEndDate,
            actualStartDate: alignedDates[0] ?? coverage.actualStartDate,
            tradingDays: alignedDates.length,
        })),
        series: prepared.series.map((entry) => ({
            ...entry,
            prices: entry.prices.slice(0, sliceEnd),
        })),
    };
};

const createConfigurationTargetWeightsResolver = ({
    allocationAssetIndexes,
    constraints,
    mode,
    optimize,
    prepared,
}: Pick<StrategyExecutionContext, 'mode' | 'optimize' | 'prepared'> & {
    allocationAssetIndexes: number[];
    constraints: ReturnType<typeof mergeAllocationConstraints>;
}): PathSimulationTargetWeightsResolver => async ({ dayIndex, previousTargetWeights }) => {
    const slicedPrepared = slicePreparedAllocationData(prepared, dayIndex);
    const analysisInputResult = buildAllocationAnalysisInput(slicedPrepared);

    if (!analysisInputResult.ok) {
        return previousTargetWeights;
    }

    const optimization = await optimize({
        annualizedAssetVolatility: analysisInputResult.analysisInput.annualizedAssetVolatility,
        assetIndexes: allocationAssetIndexes,
        constraints,
        covariance: analysisInputResult.analysisInput.shrunkCovariance,
        mode,
        prepared: slicedPrepared,
    });

    if (!optimization.ok) {
        return previousTargetWeights;
    }

    return expandConfigurationWeights(optimization.weights, allocationAssetIndexes, slicedPrepared.series.length);
};

export const createConfigurationStrategyHandler = (
    mode: AllocationType,
    options: {
        strategy?: AllocationStrategy;
    } = {},
): AllocationStrategyHandler => ({
    run: async ({
        analysisInput,
        baseCurrency,
        calculationDateRange,
        constraints,
        optimize,
        prepared,
        rebalanceCadence,
        strategyMix,
    }) => {
        const strategy = options.strategy ?? mode;
        const mergedConstraints = mergeAllocationConstraints(constraints);
        const constraintError = validateAllocationConstraints(mergedConstraints);

        if (constraintError) {
            return {
                optimizerPath: null,
                result: buildStrategyErrorResult({
                    baseCurrency,
                    error: constraintError,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'constraint_failed',
            };
        }

        const allocationAssetIndexes = resolvePreparedAssetIndexes(prepared);
        const allocationAssetError = validateAllocationAssetSelection(allocationAssetIndexes);

        if (allocationAssetError) {
            return {
                optimizerPath: null,
                result: buildStrategyErrorResult({
                    baseCurrency,
                    error: allocationAssetError,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'constraint_failed',
            };
        }

        const resolveTargetWeights = rebalanceCadence === 'none'
            ? undefined
            : createConfigurationTargetWeightsResolver({
                allocationAssetIndexes,
                constraints: mergedConstraints,
                mode,
                optimize,
                prepared,
            });

        const optimization = await optimize({
            annualizedAssetVolatility: analysisInput.annualizedAssetVolatility,
            assetIndexes: allocationAssetIndexes,
            constraints: mergedConstraints,
            covariance: analysisInput.shrunkCovariance,
            mode,
            prepared,
        });

        if (!optimization.ok) {
            return {
                optimizerPath: optimization.optimizerPath,
                result: buildStrategyErrorResult({
                    baseCurrency,
                    error: optimization.error,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'optimization_failed',
            };
        }

        return {
            optimizerPath: optimization.optimizer,
            result: await assembleAllocationResult({
                allocationAssetIds: undefined,
                annualizedAssetVolatility: analysisInput.annualizedAssetVolatility,
                annualizedMeanReturns: analysisInput.annualizedMeanReturns,
                baseCurrency,
                calculationDateRange,
                covariance: analysisInput.shrunkCovariance,
                diversificationRatio: optimization.diversificationRatio,
                mode,
                optimizer: optimization.optimizer,
                optimizerDiagnostics: optimization.diagnostics,
                prepared,
                rebalanceCadence,
                resolveTargetWeights,
                strategy,
                trendFollowing: null,
                weights: expandConfigurationWeights(optimization.weights, allocationAssetIndexes, prepared.series.length),
            }),
            stage: 'completed',
        };
    },
});
