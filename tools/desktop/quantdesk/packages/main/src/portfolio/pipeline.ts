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

import type { PreparedAllocationData } from './preprocessor';
import {
    assembleAllocationResult,
    buildAllocationErrorResult,
} from './allocation-result-assembler';
import type { AllocationPreparationService } from './preparation-service';
import { optimizeWeights } from './optimizer';
import { runSidecarOptimization } from './sidecar-optimizer-adapter';
import { simulateTrendFollowingSleeve } from './trend-following';
import { runActiveDualMomentumBacktest } from './active-dual-momentum';
import {
    annualizedReturns,
    annualizedVolatility,
    computeLogReturns,
    covarianceMatrix,
    shrinkCovarianceMatrix,
} from './statistics';
import type { SidecarRpc } from '../sidecar/runtime-types';

const defaultConstraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 0.5,
};

export interface PortfolioAllocationCommand {
    assetIds: string[];
    baseCurrency?: Currency;
    constraints: AllocationConstraints;
    endDate?: string;
    mode: AllocationType;
    rebalanceCadence?: RebalanceCadence;
    startDate?: string;
    strategy?: AllocationStrategy;
    strategyMix?: AllocationStrategyMix;
}

export interface PortfolioAllocationOutcome {
    dateWindow: {
        calculation: { endDate: string; startDate: string } | null;
        effective: { endDate: string; startDate: string };
    };
    meta: {
        optimizerPath: 'js' | 'python' | null;
        stage: 'completed' | 'constraint_failed' | 'optimization_failed' | 'preparation_failed';
        warnings: string[];
    };
    result: AllocationResult;
}

export class PortfolioAllocationPipeline {
    private readonly preparationService: Pick<AllocationPreparationService, 'prepare'>;

    private readonly sidecarRuntime: SidecarRpc;

    constructor(
        preparationService: Pick<AllocationPreparationService, 'prepare'>,
        sidecarRuntime: SidecarRpc,
    ) {
        this.preparationService = preparationService;
        this.sidecarRuntime = sidecarRuntime;
    }

    async allocate({
        assetIds,
        baseCurrency = 'CNY',
        constraints,
        mode,
        endDate,
        startDate,
        rebalanceCadence = 'none',
        strategy = mode,
        strategyMix,
    }: PortfolioAllocationCommand): Promise<PortfolioAllocationOutcome> {
        const preparation = await this.preparationService.prepare({
            assetIds,
            baseCurrency,
            endDate,
            startDate,
        });

        if (!preparation.ok) {
            return this.buildOutcome({
                effectiveDateRange: preparation.calculationDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: preparation.calculationDateRange,
                    error: preparation.error,
                    mode,
                    prepared: preparation.prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'preparation_failed',
                warnings: preparation.prepared.warnings,
            });
        }

        const { calculationDateRange, effectiveDateRange, prepared } = preparation;

        if (prepared.series.length < 2) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: {
                        code: 'INSUFFICIENT_ASSETS',
                        message: '至少选择两个标的后才能运行配置。',
                        suggestions: ['从资产池补充至少两个可用标的后重新运行。'],
                    },
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'preparation_failed',
                warnings: prepared.warnings,
            });
        }

        const analysisInput = this.buildAnalysisInput(prepared);

        if (analysisInput.error) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: analysisInput.error,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'preparation_failed',
                warnings: prepared.warnings,
            });
        }

        const isTrendStrategy = strategy === 'ewmac_trend_following';
        const isActiveDualMomentumStrategy = strategy === 'active_dual_momentum_gtaa';

        if (isActiveDualMomentumStrategy) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
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
                warnings: prepared.warnings,
            });
        }

        const mergedConstraints = this.mergeConstraints(constraints);
        const constraintError = isTrendStrategy ? null : this.validateConstraints(mergedConstraints);

        if (constraintError) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: constraintError,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'constraint_failed',
                warnings: prepared.warnings,
            });
        }

        const runnableStrategyMix = this.buildRunnableStrategyMix(strategy, strategyMix);
        const strategyMixError = this.validateStrategyMix(runnableStrategyMix);

        if (strategyMixError) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: strategyMixError,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'constraint_failed',
                warnings: prepared.warnings,
            });
        }

        const allocationAssetIndexes = this.resolveAllocationAssetIndexes(prepared, runnableStrategyMix?.allocation?.assetIds);
        const allocationAssetError = isTrendStrategy ? null : this.validateAllocationAssetSelection(allocationAssetIndexes);

        if (allocationAssetError) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: allocationAssetError,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'constraint_failed',
                warnings: prepared.warnings,
            });
        }

        const optimization = isTrendStrategy
            ? {
                diagnostics: {},
                ok: true as const,
                optimizer: 'js' as const,
                weights: Array.from({ length: prepared.series.length }, () => 0),
            }
            : await this.optimize({
                annualizedAssetVolatility: analysisInput.annualizedAssetVolatility,
                assetIndexes: allocationAssetIndexes,
                constraints: mergedConstraints,
                covariance: analysisInput.shrunkCovariance,
                mode,
                prepared,
            });

        if (!optimization.ok) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: optimization.optimizerPath,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: optimization.error,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'optimization_failed',
                warnings: prepared.warnings,
            });
        }

        return this.buildOutcome({
            calculationDateRange,
            effectiveDateRange,
            optimizerPath: optimization.optimizer,
            result: assembleAllocationResult({
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
                trendFollowing: simulateTrendFollowingSleeve({
                    alignedDates: prepared.alignedDates,
                    assetIds: prepared.series.map((entry) => entry.asset.id),
                    assetNames: prepared.series.map((entry) => entry.asset.name),
                    priceSeries: prepared.series.map((entry) => entry.prices),
                    strategyMix: runnableStrategyMix,
                    symbols: prepared.series.map((entry) => entry.asset.symbol),
                }),
                allocationAssetIds: runnableStrategyMix?.allocation?.assetIds
                    ? allocationAssetIndexes.map((index) => prepared.series[index].asset.id)
                    : undefined,
                weights: this.expandWeights(optimization.weights, allocationAssetIndexes, prepared.series.length),
            }),
            stage: 'completed',
            warnings: prepared.warnings,
        });
    }

    private buildOutcome({
        calculationDateRange = null,
        effectiveDateRange,
        optimizerPath,
        result,
        stage,
        warnings,
    }: {
        calculationDateRange?: { endDate: string; startDate: string } | null;
        effectiveDateRange: { endDate: string; startDate: string };
        optimizerPath: 'js' | 'python' | null;
        result: AllocationResult;
        stage: PortfolioAllocationOutcome['meta']['stage'];
        warnings: string[];
    }): PortfolioAllocationOutcome {
        return {
            dateWindow: {
                calculation: calculationDateRange,
                effective: effectiveDateRange,
            },
            meta: {
                optimizerPath,
                stage,
                warnings,
            },
            result,
        };
    }

    private buildAnalysisInput(prepared: PreparedAllocationData) {
        const priceSeries = prepared.series.map((entry) => entry.prices);
        const returns = computeLogReturns(priceSeries);

        if (returns[0]?.length < 60) {
            return {
                error: {
                    code: 'INSUFFICIENT_HISTORY' as const,
                    message: '已选标的在当前窗口内的共同覆盖不足 61 个交易日。',
                    suggestions: ['缩短时间窗口。', '减少已选标的数量。'],
                },
            };
        }

        const sampleCovariance = covarianceMatrix(returns);
        const shrunkCovariance = shrinkCovarianceMatrix(sampleCovariance);
        return {
            annualizedAssetVolatility: annualizedVolatility(shrunkCovariance),
            annualizedMeanReturns: annualizedReturns(returns),
            shrunkCovariance,
        };
    }

    private mergeConstraints(constraints: AllocationConstraints): AllocationConstraints {
        return {
            ...defaultConstraints,
            ...constraints,
            maxClassWeight: {
                ...defaultConstraints.maxClassWeight,
                ...constraints.maxClassWeight,
            },
        };
    }

    private validateConstraints(constraints: AllocationConstraints): NonNullable<AllocationResult['error']> | null {
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
    }

    private resolveAllocationAssetIndexes(prepared: PreparedAllocationData, assetIds?: string[]) {
        if (!assetIds) {
            return prepared.series.map((_entry, index) => index);
        }

        const assetIdSet = new Set(assetIds);
        return prepared.series
            .map((entry, index) => assetIdSet.has(entry.asset.id) ? index : -1)
            .filter((index) => index >= 0);
    }

    private validateAllocationAssetSelection(assetIndexes: number[]): NonNullable<AllocationResult['error']> | null {
        if (assetIndexes.length >= 2) {
            return null;
        }

        return {
            code: 'INVALID_STRATEGY_MIX',
            message: '配置部分至少需要覆盖两个标的。',
            suggestions: ['在配置标的中至少勾选两个资产，或从资产池补充可配置标的。'],
        };
    }

    private expandWeights(weights: number[], assetIndexes: number[], assetCount: number) {
        const expandedWeights = Array.from({ length: assetCount }, () => 0);

        assetIndexes.forEach((assetIndex, localIndex) => {
            expandedWeights[assetIndex] = weights[localIndex] ?? 0;
        });

        return expandedWeights;
    }

    private validateStrategyMix(strategyMix?: AllocationStrategyMix): NonNullable<AllocationResult['error']> | null {
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
    }

    private buildRunnableStrategyMix(strategy: AllocationStrategy, strategyMix?: AllocationStrategyMix): AllocationStrategyMix | undefined {
        if (strategy !== 'ewmac_trend_following') {
            return undefined;
        }

        return {
            trendFollowing: {
                ...strategyMix?.trendFollowing,
                enabled: true,
                sleeveWeight: 1,
            },
        };
    }

    private async optimize({
        annualizedAssetVolatility,
        assetIndexes,
        constraints,
        covariance,
        mode,
        prepared,
    }: {
        annualizedAssetVolatility: number[];
        assetIndexes: number[];
        constraints: AllocationConstraints;
        covariance: number[][];
        mode: AllocationType;
        prepared: PreparedAllocationData;
    }): Promise<
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
        }
    > {
        const assetClasses = assetIndexes.map((index) => prepared.series[index].asset.assetClass);
        const covarianceSubset = assetIndexes.map((rowIndex) => assetIndexes.map((columnIndex) => covariance[rowIndex]?.[columnIndex] ?? 0));
        const volatilities = assetIndexes.map((index) => annualizedAssetVolatility[index] ?? 0);

        if (assetIndexes.length > 20) {
            const sidecarResult = await runSidecarOptimization(this.sidecarRuntime, {
                assetClasses,
                constraints,
                covariance: covarianceSubset,
                mode,
                volatilities,
            });

            if (!sidecarResult.ok) {
                return { error: sidecarResult.error, ok: false, optimizerPath: 'python' };
            }

            return {
                diagnostics: sidecarResult.result.diagnostics,
                diversificationRatio: sidecarResult.result.diversificationRatio,
                ok: true,
                optimizer: 'python',
                weights: sidecarResult.result.weights,
            };
        }

        try {
            const result = optimizeWeights({
                assetClasses,
                constraints,
                covariance: covarianceSubset,
                mode,
                volatilities,
            });

            return {
                diagnostics: result.diagnostics,
                diversificationRatio: result.diversificationRatio,
                ok: true,
                optimizer: 'js',
                weights: result.weights,
            };
        } catch (error) {
            return {
                error: {
                    code: 'INFEASIBLE_CONSTRAINTS',
                    message: error instanceof Error ? error.message : String(error),
                    suggestions: [
                        'Raise maxSingleWeight or relax class caps.',
                        'Disable leverage/short restrictions only if intentional.',
                    ],
                },
                ok: false,
                optimizerPath: 'js',
            };
        }
    }
}
