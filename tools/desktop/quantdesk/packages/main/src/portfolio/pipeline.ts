import type {
    AllocationConstraints,
    AllocationResult,
    AllocationStrategy,
    AllocationStrategyMix,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import { buildAllocationAnalysisInput } from './allocation-analysis-input';
import {
    DefaultAllocationOptimizerAdapter,
    type AllocationOptimizerAdapter,
} from './allocation-optimizer-adapter';
import { resolveActiveDualMomentumWarmupCalendarDays } from './active-dual-momentum-rules';
import {
    buildAllocationErrorResult,
} from './allocation-result-assembler';
import type { AllocationPreparationService } from './preparation-service';
import {
    defaultAllocationStrategyRegistry,
    type AllocationStrategyHandler,
    type AllocationStrategyRegistry,
} from './strategy-registry';
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

    private readonly optimizerAdapter: AllocationOptimizerAdapter;

    private readonly strategyRegistry: AllocationStrategyRegistry;

    constructor(
        preparationService: Pick<AllocationPreparationService, 'prepare'>,
        sidecarRuntime: SidecarRpc,
        strategyRegistry: AllocationStrategyRegistry = defaultAllocationStrategyRegistry,
        optimizerAdapter: AllocationOptimizerAdapter = new DefaultAllocationOptimizerAdapter(sidecarRuntime),
    ) {
        this.preparationService = preparationService;
        this.optimizerAdapter = optimizerAdapter;
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
            warmupDays: this.resolveWarmupDays(strategy, strategyMix),
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

        const analysisInputResult = buildAllocationAnalysisInput(prepared);

        if (!analysisInputResult.ok) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: analysisInputResult.error,
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'preparation_failed',
                warnings: prepared.warnings,
            });
        }
        const { analysisInput } = analysisInputResult;

        const strategyHandler = this.resolveStrategyHandler(strategy);

        if (!strategyHandler) {
            return this.buildOutcome({
                calculationDateRange,
                effectiveDateRange,
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency,
                    effectiveDateRange: calculationDateRange,
                    error: {
                        code: 'UNSUPPORTED_STRATEGY',
                        message: `未注册的配置策略：${strategy}`,
                        suggestions: [
                            `可用策略：${Object.keys(defaultAllocationStrategyRegistry).sort().join('、')}`,
                        ],
                    },
                    mode,
                    prepared,
                    rebalanceCadence,
                    strategy,
                }),
                stage: 'constraint_failed',
                warnings: prepared.warnings,
            });
        }

        const strategyExecution = await this.runStrategyHandler({
            analysisInput,
            baseCurrency,
            calculationDateRange,
            constraints,
            mode,
            optimize: (request) => this.optimizerAdapter.optimize(request),
            prepared,
            rebalanceCadence,
            strategy,
            strategyHandler,
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

    private resolveStrategyHandler(strategy: AllocationStrategy): AllocationStrategyHandler | null {
        return (this.strategyRegistry as Partial<AllocationStrategyRegistry>)[strategy] ?? null;
    }

    private resolveWarmupDays(strategy: AllocationStrategy, strategyMix?: AllocationStrategyMix) {
        return strategy === 'active_dual_momentum_gtaa'
            ? resolveActiveDualMomentumWarmupCalendarDays(strategyMix?.activeDualMomentum)
            : 0;
    }

    private async runStrategyHandler({
        strategy,
        strategyHandler,
        ...context
    }: Parameters<AllocationStrategyHandler['run']>[0] & {
        strategy: AllocationStrategy;
        strategyHandler: AllocationStrategyHandler;
    }) {
        try {
            return await strategyHandler.run(context);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            return {
                optimizerPath: null,
                result: buildAllocationErrorResult({
                    baseCurrency: context.baseCurrency,
                    effectiveDateRange: context.calculationDateRange,
                    error: {
                        code: 'ALLOCATION_STRATEGY_FAILED',
                        message,
                        suggestions: ['Review strategy parameters and retry.', 'If the error persists, inspect strategy diagnostics.'],
                    },
                    mode: context.mode,
                    prepared: context.prepared,
                    rebalanceCadence: context.rebalanceCadence,
                    strategy,
                }),
                stage: 'optimization_failed' as const,
            };
        }
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


}
