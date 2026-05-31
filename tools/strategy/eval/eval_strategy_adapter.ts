import type {
    AllocationConstraints,
} from '@quantdesk/shared';
import {
    optimizeWeights,
    resolveStrategyHandler,
    type StrategyExecutionContext,
    type StrategyOptimizationRequest,
    type StrategyOptimizationResult,
} from '@finance-research/allocation-engine';

import { buildAssetMap, prepareEvalBundle, type PreparedEvalBundle } from './eval_preparation';
import {
    projectAllocationResult,
    projectErrorRow,
    projectSkippedRow,
} from './eval_result_projector';
import type {
    EvalCaseInput,
    EvalResultRow,
    EvalRunRequest,
    StrategyRunInput,
} from './eval_runner_contract';
import { resolveAllocationMode, resolveRebalanceCadence } from './eval_runner_contract';

export { resolveStrategyHandler };

const mergeConstraints = (
    defaults: AllocationConstraints,
    override?: AllocationConstraints,
): AllocationConstraints => ({
    ...defaults,
    ...override,
    maxClassWeight: {
        ...defaults.maxClassWeight,
        ...override?.maxClassWeight,
    },
});

const createJsOptimizer = (): StrategyExecutionContext['optimize'] => async (
    request: StrategyOptimizationRequest,
): Promise<StrategyOptimizationResult> => {
    try {
        const result = optimizeWeights({
            assetClasses: request.assetIndexes.map((index) => request.prepared.series[index]?.asset.assetClass ?? 'equity'),
            constraints: request.constraints,
            covariance: request.assetIndexes.map((rowIndex) => (
                request.assetIndexes.map((columnIndex) => request.covariance[rowIndex]?.[columnIndex] ?? 0)
            )),
            mode: request.mode,
            volatilities: request.assetIndexes.map((index) => request.annualizedAssetVolatility[index] ?? 0),
        });
        const weights = Array.from({ length: request.prepared.series.length }, () => 0);
        request.assetIndexes.forEach((assetIndex, weightIndex) => {
            weights[assetIndex] = result.weights[weightIndex] ?? 0;
        });

        return {
            diagnostics: result.diagnostics,
            diversificationRatio: result.diversificationRatio,
            ok: true,
            optimizer: 'js',
            weights,
        };
    } catch (error) {
        return {
            error: {
                code: 'OPTIMIZATION_FAILED',
                message: error instanceof Error ? error.message : String(error),
                suggestions: ['Review constraints and retry.'],
            },
            ok: false,
            optimizerPath: 'js',
        };
    }
};

export const executeEvalStrategy = async ({
    bundle,
    evalCase,
    request,
    strategyRun,
}: {
    bundle: PreparedEvalBundle;
    evalCase: EvalCaseInput;
    request: EvalRunRequest;
    strategyRun: StrategyRunInput;
}): Promise<EvalResultRow> => {
    const handler = resolveStrategyHandler(strategyRun.strategyId);

    if (!handler) {
        return projectErrorRow({
            evalCase,
            error: `Unsupported strategy: ${strategyRun.strategyId}`,
            strategyRun,
        });
    }

    const execution = await handler.run({
        analysisInput: bundle.analysisInput,
        baseCurrency: request.baseCurrency,
        calculationDateRange: {
            endDate: evalCase.endDate,
            startDate: evalCase.startDate,
        },
        constraints: mergeConstraints(request.defaultConstraints, strategyRun.constraints),
        mode: resolveAllocationMode(strategyRun.strategyId),
        optimize: createJsOptimizer(),
        prepared: bundle.prepared,
        rebalanceCadence: resolveRebalanceCadence(evalCase, strategyRun.strategyId),
        strategyMix: strategyRun.strategyMix,
    });

    return projectAllocationResult({
        evalCase,
        extraResultFields: strategyRun.extraResultFields,
        result: execution.result,
        strategyRun,
    });
};

export const runEvalRequest = async (request: EvalRunRequest): Promise<EvalResultRow[]> => {
    const rows: EvalResultRow[] = [];

    for (const evalCase of request.cases) {
        if (evalCase.skipReason) {
            for (const strategyRun of request.strategyRuns) {
                rows.push(projectSkippedRow({
                    evalCase,
                    reason: evalCase.skipReason,
                    strategyRun,
                }));
            }
            continue;
        }

        for (const strategyRun of request.strategyRuns) {
            try {
                const assetBySymbol = buildAssetMap(request.assets, request.baseCurrency);
                const bundle = prepareEvalBundle({
                    assetBySymbol,
                    baseCurrency: request.baseCurrency,
                    maxDiversificationConfig: strategyRun.strategyMix?.maxDiversification,
                    pricesBySymbol: request.pricesBySymbol,
                    symbols: evalCase.symbols,
                });
                rows.push(await executeEvalStrategy({
                    bundle,
                    evalCase,
                    request,
                    strategyRun,
                }));
            } catch (error) {
                rows.push(projectErrorRow({ evalCase, error, strategyRun }));
            }
        }
    }

    return rows;
};
