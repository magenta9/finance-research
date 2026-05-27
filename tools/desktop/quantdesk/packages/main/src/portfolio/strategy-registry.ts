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
import { runActiveDualMomentumBacktest } from './active-dual-momentum';
import type { PreparedAllocationData } from './preprocessor';
import { simulateTrendFollowingSleeve } from './trend-following';

const defaultConstraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 0.5,
};

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

const mergeConstraints = (constraints: AllocationConstraints): AllocationConstraints => ({
    ...defaultConstraints,
    ...constraints,
    maxClassWeight: {
        ...defaultConstraints.maxClassWeight,
        ...constraints.maxClassWeight,
    },
});

const validateConstraints = (constraints: AllocationConstraints): NonNullable<AllocationResult['error']> | null => {
    if (constraints.allowShort) {
        return {
            code: 'UNSUPPORTED_CONSTRAINTS',
            message: 'Short selling is not supported by the current allocation modes.',
            suggestions: ['Disable allowShort and re-run.'],
        };
    }

    if (constraints.allowLeverage) {
        return {
            code: 'UNSUPPORTED_CONSTRAINTS',
            message: 'Leverage is not supported by the current allocation modes.',
            suggestions: ['Disable allowLeverage and re-run.'],
        };
    }

    return null;
};

const validateAllocationAssetSelection = (assetIndexes: number[]): NonNullable<AllocationResult['error']> | null => {
    if (assetIndexes.length >= 2) {
        return null;
    }

    return {
        code: 'INVALID_STRATEGY_MIX',
        message: '配置部分至少需要覆盖两个标的。',
        suggestions: ['在配置标的中至少勾选两个资产，或从资产池补充可配置标的。'],
    };
};

const validateStrategyMix = (strategyMix?: AllocationStrategyMix): NonNullable<AllocationResult['error']> | null => {
    const trendFollowing = strategyMix?.trendFollowing;

    if (!trendFollowing?.enabled) {
        return null;
    }

    if (!Number.isFinite(trendFollowing.sleeveWeight) || trendFollowing.sleeveWeight < 0 || trendFollowing.sleeveWeight > 1) {
        return {
            code: 'INVALID_STRATEGY_MIX',
            message: '趋势跟随仓位需要在 0% 到 100% 之间。',
            suggestions: ['将趋势跟随仓位调整到 0 到 1 之间。'],
        };
    }

    if (trendFollowing.forecastCap != null && (!Number.isFinite(trendFollowing.forecastCap) || trendFollowing.forecastCap <= 0)) {
        return {
            code: 'INVALID_STRATEGY_MIX',
            message: '趋势跟随 forecast cap 必须为正数。',
            suggestions: ['使用默认 cap 20，或输入一个正数。'],
        };
    }

    for (const rule of trendFollowing.rules ?? []) {
        if (rule.enabled === false) {
            continue;
        }

        const slow = rule.slow ?? rule.fast * 4;

        if (!Number.isFinite(rule.fast) || rule.fast <= 0 || !Number.isFinite(slow) || slow <= rule.fast) {
            return {
                code: 'INVALID_STRATEGY_MIX',
                message: 'EWMAC 子规则需要满足 slow > fast > 0。',
                suggestions: ['使用 2/8、4/16、8/32、16/64、32/128、64/256 这一组默认规则。'],
            };
        }

        if (rule.scalar != null && (!Number.isFinite(rule.scalar) || rule.scalar <= 0)) {
            return {
                code: 'INVALID_STRATEGY_MIX',
                message: 'EWMAC forecast scalar 必须为正数。',
                suggestions: ['使用默认 scalar 表。'],
            };
        }
    }

    return null;
};

const resolveAllocationAssetIndexes = (prepared: PreparedAllocationData, assetIds?: string[]) => {
    if (!assetIds) {
        return prepared.series.map((_entry, index) => index);
    }

    const assetIdSet = new Set(assetIds);
    return prepared.series
        .map((entry, index) => assetIdSet.has(entry.asset.id) ? index : -1)
        .filter((index) => index >= 0);
};

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
        const mergedConstraints = mergeConstraints(constraints);
        const constraintError = validateConstraints(mergedConstraints);

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

        const allocationAssetIndexes = resolveAllocationAssetIndexes(prepared);
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
        const strategyMixError = validateStrategyMix(runnableStrategyMix);

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
                    assetIds: prepared.series.map((entry) => entry.asset.id),
                    assetNames: prepared.series.map((entry) => entry.asset.name),
                    priceSeries: prepared.series.map((entry) => entry.prices),
                    strategyMix: runnableStrategyMix,
                    symbols: prepared.series.map((entry) => entry.asset.symbol),
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