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

import { assembleAllocationResult } from './allocation-result-assembler';
import { validateAllocationStrategyMix } from './allocation-validator';
import { runActiveDualMomentumBacktest } from './active-dual-momentum';
import { createConfigurationStrategyHandler } from './configuration-strategy-handler';
import {
    getPreparedAssetIds,
    getPreparedAssetNames,
    getPreparedAssetSymbols,
    getPreparedPriceSeries,
} from './prepared-allocation-context';
import type { PreparedAllocationData } from './preprocessor';
import { buildStrategyErrorResult } from './strategy-error-result';
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