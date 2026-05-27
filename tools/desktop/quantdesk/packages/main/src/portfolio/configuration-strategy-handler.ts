import type { AllocationType } from '@quantdesk/shared';

import { assembleAllocationResult } from './allocation-result-assembler';
import {
    mergeAllocationConstraints,
    validateAllocationAssetSelection,
    validateAllocationConstraints,
} from './allocation-validator';
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

export const createConfigurationStrategyHandler = (strategy: AllocationType): AllocationStrategyHandler => ({
    run: async ({
        analysisInput,
        baseCurrency,
        calculationDateRange,
        constraints,
        optimize,
        prepared,
        rebalanceCadence,
    }) => {
        const mergedConstraints = mergeAllocationConstraints(constraints);
        const constraintError = validateAllocationConstraints(mergedConstraints);

        if (constraintError) {
            return {
                optimizerPath: null,
                result: buildStrategyErrorResult({
                    baseCurrency,
                    error: constraintError,
                    mode: strategy,
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
                    mode: strategy,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'constraint_failed',
            };
        }

        const optimization = await optimize({
            annualizedAssetVolatility: analysisInput.annualizedAssetVolatility,
            assetIndexes: allocationAssetIndexes,
            constraints: mergedConstraints,
            covariance: analysisInput.shrunkCovariance,
            mode: strategy,
            prepared,
        });

        if (!optimization.ok) {
            return {
                optimizerPath: optimization.optimizerPath,
                result: buildStrategyErrorResult({
                    baseCurrency,
                    error: optimization.error,
                    mode: strategy,
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
                mode: strategy,
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
