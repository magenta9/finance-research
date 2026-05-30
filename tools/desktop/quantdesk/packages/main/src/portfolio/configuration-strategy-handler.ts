import type { AllocationStrategy, AllocationType } from '@quantdesk/shared';

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
import { resolvePreparedAssetIndexes } from './prepared-allocation-context';
import type { AllocationStrategyHandler } from './strategy-registry';
import { buildStrategyErrorResult } from './strategy-error-result';

const expandConfigurationWeights = (weights: number[], assetIndexes: number[], assetCount: number) => {
    const expandedWeights = Array.from({ length: assetCount }, () => 0);

    assetIndexes.forEach((assetIndex, localIndex) => {
        expandedWeights[assetIndex] = weights[localIndex] ?? 0;
    });

    return expandedWeights;
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
                result: assembleAllocationResult({
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
            result: assembleAllocationResult({
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
                strategy,
                trendFollowing: null,
                weights: expandConfigurationWeights(optimization.weights, allocationAssetIndexes, prepared.series.length),
            }),
            stage: 'completed',
        };
    },
});
