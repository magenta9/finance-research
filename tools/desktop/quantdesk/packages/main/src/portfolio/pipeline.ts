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
    buildAllocationErrorResult,
} from './allocation-result-assembler';
import type { AllocationPreparationService } from './preparation-service';
import { optimizeWeights } from './optimizer';
import { runSidecarOptimization } from './sidecar-optimizer-adapter';
import {
    defaultAllocationStrategyRegistry,
    type AllocationStrategyRegistry,
} from './strategy-registry';
import {
    annualizedReturns,
    annualizedVolatility,
    computeLogReturns,
    covarianceMatrix,
    shrinkCovarianceMatrix,
} from './statistics';
import type { SidecarRpc } from '../sidecar/runtime-types';

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

    private readonly strategyRegistry: AllocationStrategyRegistry;

    constructor(
        preparationService: Pick<AllocationPreparationService, 'prepare'>,
        sidecarRuntime: SidecarRpc,
        strategyRegistry: AllocationStrategyRegistry = defaultAllocationStrategyRegistry,
    ) {
        this.preparationService = preparationService;
        this.sidecarRuntime = sidecarRuntime;
        this.strategyRegistry = strategyRegistry;
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

        const strategyExecution = await this.strategyRegistry[strategy].run({
            analysisInput,
            baseCurrency,
            calculationDateRange,
            constraints,
            mode,
            optimize: (request) => this.optimize(request),
            prepared,
            rebalanceCadence,
            strategyMix,
        });

        return this.buildOutcome({
            calculationDateRange,
            effectiveDateRange,
            optimizerPath: strategyExecution.optimizerPath,
            result: strategyExecution.result,
            stage: strategyExecution.stage,
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
