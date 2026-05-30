import type { AllocationStrategy, AllocationType } from '@quantdesk/shared';

import { buildAllocationAnalysisInput } from './allocation-analysis-input';
import { assembleAllocationResult } from './allocation-result-assembler';
import {
    mergeAllocationConstraints,
    validateAllocationAssetSelection,
    validateAllocationConstraints,
} from './allocation-validator';
import { applyMomentumReturnTiltAroundWeights } from './momentum-return-tilt';
import {
    appendMaxDiversificationCashReserve,
    mapSubsetWeights,
    resolveAverageMomentumScores,
    resolveMaxDiversificationOptimizationInput,
} from './max-diversification-research';
import type { PathSimulationTargetWeightsResolver } from './path-simulator';
import { resolvePreparedAssetIndexes } from './prepared-allocation-context';
import type { PreparedAllocationData } from './preprocessor';
import type { StrategyExecutionContext } from './strategy-registry';
import type { AllocationStrategyHandler } from './strategy-registry';
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
    baseCurrency,
    constraints,
    mode,
    optimize,
    prepared,
    researchBaseline,
    strategyMix,
}: Pick<StrategyExecutionContext, 'baseCurrency' | 'mode' | 'optimize' | 'prepared' | 'strategyMix'> & {
    allocationAssetIndexes: number[];
    constraints: ReturnType<typeof mergeAllocationConstraints>;
    researchBaseline: boolean;
}): PathSimulationTargetWeightsResolver => async ({ dayIndex, previousTargetWeights }) => {
    const slicedPrepared = slicePreparedAllocationData(prepared, dayIndex);
    const analysisInputResult = buildAllocationAnalysisInput(slicedPrepared, strategyMix?.maxDiversification);

    if (!analysisInputResult.ok) {
        return previousTargetWeights;
    }

    if (researchBaseline) {
        const researchInput = resolveMaxDiversificationOptimizationInput({
            allocationAssetIndexes,
            analysisInput: analysisInputResult.analysisInput,
            config: strategyMix?.maxDiversification,
            constraints,
            prepared: slicedPrepared,
        });
        const optimization = await optimize({
            annualizedAssetVolatility: researchInput.annualizedAssetVolatility,
            assetIndexes: researchInput.assetIndexes,
            constraints: researchInput.constraints,
            covariance: researchInput.covariance,
            mode,
            prepared: slicedPrepared,
        });

        if (!optimization.ok) {
            return previousTargetWeights;
        }

        const researchConfig = strategyMix?.maxDiversification;
        const momentumScores = resolveAverageMomentumScores(slicedPrepared, researchConfig);
        const optimizedWeights = typeof researchConfig?.momentumReturnTiltStrength === 'number'
            && typeof researchConfig?.maxTrackingErrorVolatility === 'number'
            ? applyMomentumReturnTiltAroundWeights({
                covariance: researchInput.covariance,
                momentumScores: researchInput.assetIndexes.map((index) => momentumScores[index] ?? 0),
                referenceWeights: optimization.weights,
                tiltStrength: researchConfig.momentumReturnTiltStrength,
                trackingErrorVolatilityLimit: researchConfig.maxTrackingErrorVolatility,
            })
            : optimization.weights;
        const riskyWeights = mapSubsetWeights(
            optimizedWeights,
            researchInput.assetIndexes,
            slicedPrepared.series.length,
        );
        const assemblyInput = appendMaxDiversificationCashReserve({
            baseCurrency,
            cashReserve: researchInput.cashReserve,
            covariance: researchInput.assemblyCovariance,
            meanReturns: analysisInputResult.analysisInput.annualizedMeanReturns,
            prepared: slicedPrepared,
            volatility: researchInput.assemblyVolatility,
            weights: riskyWeights,
        });

        return assemblyInput.weights;
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
        researchBaseline?: boolean;
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
                baseCurrency,
                constraints: mergedConstraints,
                mode,
                optimize,
                prepared,
                researchBaseline: Boolean(options.researchBaseline),
                strategyMix,
            });

        if (options.researchBaseline) {
            const researchInput = resolveMaxDiversificationOptimizationInput({
                allocationAssetIndexes,
                analysisInput,
                config: strategyMix?.maxDiversification,
                constraints: mergedConstraints,
                prepared,
            });
            const optimization = await optimize({
                annualizedAssetVolatility: researchInput.annualizedAssetVolatility,
                assetIndexes: researchInput.assetIndexes,
                constraints: researchInput.constraints,
                covariance: researchInput.covariance,
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

            const researchConfig = strategyMix?.maxDiversification;
            const momentumScores = resolveAverageMomentumScores(prepared, researchConfig);
            const optimizedWeights = typeof researchConfig?.momentumReturnTiltStrength === 'number'
                && typeof researchConfig?.maxTrackingErrorVolatility === 'number'
                ? applyMomentumReturnTiltAroundWeights({
                    covariance: researchInput.covariance,
                    momentumScores: researchInput.assetIndexes.map((index) => momentumScores[index] ?? 0),
                    referenceWeights: optimization.weights,
                    tiltStrength: researchConfig.momentumReturnTiltStrength,
                    trackingErrorVolatilityLimit: researchConfig.maxTrackingErrorVolatility,
                })
                : optimization.weights;
            const riskyWeights = mapSubsetWeights(
                optimizedWeights,
                researchInput.assetIndexes,
                prepared.series.length,
            );
            const assemblyInput = appendMaxDiversificationCashReserve({
                baseCurrency,
                cashReserve: researchInput.cashReserve,
                covariance: researchInput.assemblyCovariance,
                meanReturns: analysisInput.annualizedMeanReturns,
                prepared,
                volatility: researchInput.assemblyVolatility,
                weights: riskyWeights,
            });

            return {
                optimizerPath: optimization.optimizer,
                result: await assembleAllocationResult({
                    allocationAssetIds: undefined,
                    annualizedAssetVolatility: assemblyInput.volatility,
                    annualizedMeanReturns: assemblyInput.meanReturns,
                    baseCurrency,
                    calculationDateRange,
                    covariance: assemblyInput.covariance,
                    diversificationRatio: optimization.diversificationRatio,
                    mode,
                    optimizer: optimization.optimizer,
                    optimizerDiagnostics: optimization.diagnostics,
                    prepared: assemblyInput.prepared,
                    rebalanceCadence,
                    resolveTargetWeights,
                    strategy,
                    trendFollowing: null,
                    weights: assemblyInput.weights,
                }),
                stage: 'completed',
            };
        }

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
