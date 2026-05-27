import type { AllocationConstraints, AllocationType } from '@quantdesk/shared';

import type { SidecarRpc } from '../sidecar/runtime-types';
import { optimizeWeights } from './optimizer';
import type { PreparedAllocationData } from './preprocessor';
import { runSidecarOptimization } from './sidecar-optimizer-adapter';
import type { StrategyOptimizationRequest, StrategyOptimizationResult } from './strategy-registry';

export interface AllocationOptimizerAdapter {
    optimize(request: StrategyOptimizationRequest): Promise<StrategyOptimizationResult>;
}

interface OptimizerSubsetInput {
    annualizedAssetVolatility: number[];
    assetIndexes: number[];
    constraints: AllocationConstraints;
    covariance: number[][];
    mode: AllocationType;
    prepared: PreparedAllocationData;
}

const buildOptimizerSubset = ({
    annualizedAssetVolatility,
    assetIndexes,
    constraints,
    covariance,
    mode,
    prepared,
}: OptimizerSubsetInput) => ({
    assetClasses: assetIndexes.map((index) => prepared.series[index].asset.assetClass),
    constraints,
    covariance: assetIndexes.map((rowIndex) => assetIndexes.map((columnIndex) => covariance[rowIndex]?.[columnIndex] ?? 0)),
    mode,
    volatilities: assetIndexes.map((index) => annualizedAssetVolatility[index] ?? 0),
});

export class DefaultAllocationOptimizerAdapter implements AllocationOptimizerAdapter {
    private readonly sidecarRuntime: SidecarRpc;

    constructor(sidecarRuntime: SidecarRpc) {
        this.sidecarRuntime = sidecarRuntime;
    }

    async optimize(request: StrategyOptimizationRequest): Promise<StrategyOptimizationResult> {
        const optimizerInput = buildOptimizerSubset(request);

        if (request.assetIndexes.length > 20) {
            const sidecarResult = await runSidecarOptimization(this.sidecarRuntime, optimizerInput);

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
            const result = optimizeWeights(optimizerInput);

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
