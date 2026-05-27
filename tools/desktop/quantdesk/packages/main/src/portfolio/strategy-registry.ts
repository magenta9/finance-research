import type {
    AllocationConstraints,
    AllocationDiagnostics,
    AllocationResult,
    AllocationStrategy,
    AllocationStrategyMix,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import {
    assembleAllocationResult,
    buildAllocationErrorResult,
} from './allocation-result-assembler';
import {
    mergeAllocationConstraints,
    validateAllocationAssetSelection,
    validateAllocationConstraints,
    validateAllocationStrategyMix,
} from './allocation-validator';
import { runActiveDualMomentumBacktest } from './active-dual-momentum';
import {
    getPreparedAssetIds,
    getPreparedAssetNames,
    getPreparedAssetSymbols,
    getPreparedPriceSeries,
    resolvePreparedAssetIndexes,
} from './prepared-allocation-context';
import type { PreparedAllocationData } from './preprocessor';
import { simulateTrendFollowingSleeve } from './trend-following';

export interface StrategyAnalysisInput {
    annualizedAssetVolatility: number[];
    annualizedMeanReturns: number[];
    shrunkCovariance: number[][];
}

export interface StrategyOptimizationRequest {
    annualizedAssetVolatility: number[];
    assetIndexes: number[];
    constraints: AllocationConstraints;
    covariance: number[][];
    mode: AllocationType;
    prepared: PreparedAllocationData;
}

export type StrategyOptimizationResult =
    | {
        diagnostics: Partial<AllocationDiagnostics>;
        diversificationRatio?: number;
        ok: true;
        optimizer: 'js' | 'python';
        weights: number[];
    }
    | {
        error: NonNullable<AllocationResult['error']>;
        ok: false;
        optimizerPath: 'js' | 'python' | null;
    };

export interface StrategyExecutionContext {
    analysisInput: StrategyAnalysisInput;
    baseCurrency: Currency;
    calculationDateRange: { endDate: string; startDate: string };
    constraints: AllocationConstraints;
    mode: AllocationType;
    optimize: (request: StrategyOptimizationRequest) => Promise<StrategyOptimizationResult>;
    prepared: PreparedAllocationData;
    rebalanceCadence: RebalanceCadence;
    strategyMix?: AllocationStrategyMix;
}

export interface StrategyExecutionResult {
    optimizerPath: 'js' | 'python' | null;
    result: AllocationResult;
    stage: 'completed' | 'constraint_failed' | 'optimization_failed';
}

export interface AllocationStrategyHandler {
    run: (context: StrategyExecutionContext) => Promise<StrategyExecutionResult>;
}

export type AllocationStrategyRegistry = Record<AllocationStrategy, AllocationStrategyHandler>;

const buildStrategyErrorResult = ({
    baseCurrency,
    error,
    mode,
    prepared,
    rebalanceCadence,
    strategy,
}: {
    baseCurrency: Currency;
    error: NonNullable<AllocationResult['error']>;
    mode: AllocationType;
    prepared: PreparedAllocationData;
    rebalanceCadence: RebalanceCadence;
    strategy: AllocationStrategy;
}) => buildAllocationErrorResult({
    baseCurrency,
    effectiveDateRange: {
        endDate: prepared.alignedDates.at(-1) ?? '',
        startDate: prepared.alignedDates[0] ?? '',
    },
    error,
    mode,
    prepared,
    rebalanceCadence,
    strategy,
});

const expandWeights = (weights: number[], assetIndexes: number[], assetCount: number) => {
    const expandedWeights = Array.from({ length: assetCount }, () => 0);

    assetIndexes.forEach((assetIndex, localIndex) => {
        expandedWeights[assetIndex] = weights[localIndex] ?? 0;
    });

    return expandedWeights;
};

const createConfigurationStrategyHandler = (strategy: AllocationType): AllocationStrategyHandler => ({
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
                weights: expandWeights(optimization.weights, allocationAssetIndexes, prepared.series.length),
            }),
            stage: 'completed',
        };
    },
});

const ewmacTrendFollowingHandler: AllocationStrategyHandler = {
    run: async ({
        analysisInput,
        baseCurrency,
        calculationDateRange,
        mode,
        prepared,
        rebalanceCadence,
        strategyMix,
    }) => {
        const runnableStrategyMix: AllocationStrategyMix = {
            trendFollowing: {
                ...strategyMix?.trendFollowing,
                enabled: true,
                sleeveWeight: 1,
            },
        };
        const strategyMixError = validateAllocationStrategyMix(runnableStrategyMix);

        if (strategyMixError) {
            return {
                optimizerPath: null,
                result: buildStrategyErrorResult({
                    baseCurrency,
                    error: strategyMixError,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy: 'ewmac_trend_following',
                }),
                stage: 'constraint_failed',
            };
        }

        return {
            optimizerPath: 'js',
            result: assembleAllocationResult({
                annualizedAssetVolatility: analysisInput.annualizedAssetVolatility,
                annualizedMeanReturns: analysisInput.annualizedMeanReturns,
                baseCurrency,
                calculationDateRange,
                covariance: analysisInput.shrunkCovariance,
                mode,
                optimizer: 'js',
                optimizerDiagnostics: {},
                prepared,
                rebalanceCadence,
                strategy: 'ewmac_trend_following',
                trendFollowing: simulateTrendFollowingSleeve({
                    alignedDates: prepared.alignedDates,
                    assetIds: getPreparedAssetIds(prepared),
                    assetNames: getPreparedAssetNames(prepared),
                    priceSeries: getPreparedPriceSeries(prepared),
                    strategyMix: runnableStrategyMix,
                    symbols: getPreparedAssetSymbols(prepared),
                }),
                weights: Array.from({ length: prepared.series.length }, () => 0),
            }),
            stage: 'completed',
        };
    },
};

const activeDualMomentumHandler: AllocationStrategyHandler = {
    run: async ({
        analysisInput,
        baseCurrency,
        calculationDateRange,
        prepared,
        strategyMix,
    }) => ({
        optimizerPath: 'js',
        result: runActiveDualMomentumBacktest({
            annualizedMeanReturns: analysisInput.annualizedMeanReturns,
            annualizedVolatility: analysisInput.annualizedAssetVolatility,
            baseCurrency,
            calculationDateRange,
            config: strategyMix?.activeDualMomentum,
            prepared,
        }),
        stage: 'completed',
    }),
};

export const defaultAllocationStrategyRegistry: AllocationStrategyRegistry = {
    active_dual_momentum_gtaa: activeDualMomentumHandler,
    erc: createConfigurationStrategyHandler('erc'),
    ewmac_trend_following: ewmacTrendFollowingHandler,
    inverse_volatility: createConfigurationStrategyHandler('inverse_volatility'),
    max_diversification: createConfigurationStrategyHandler('max_diversification'),
};