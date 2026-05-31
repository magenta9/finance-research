import type { AllocationStrategyMix } from '@quantdesk/shared';

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
import { buildStrategyErrorResult } from './strategy-error-result';
import type {
    AllocationStrategyHandler,
    AllocationStrategyRegistry,
} from './strategy-contracts';
import { simulateTrendFollowingSleeve } from './trend-following';

export type {
    AllocationStrategyHandler,
    AllocationStrategyRegistry,
    StrategyAnalysisInput,
    StrategyExecutionContext,
    StrategyExecutionResult,
    StrategyOptimizationRequest,
    StrategyOptimizationResult,
} from './strategy-contracts';

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
            result: await assembleAllocationResult({
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
            covariance: analysisInput.shrunkCovariance,
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