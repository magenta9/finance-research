import type {
    AllocationConstraints,
    AllocationDiagnostics,
    AllocationResult,
    AllocationType,
} from '@quantdesk/shared';

import type { SidecarRpc } from '../sidecar/runtime-types';
import type { PreparedAllocationData } from './preprocessor';

interface SidecarOptimizerResponseV2 {
    diagnostics?: AllocationDiagnostics;
    diversificationRatio?: number;
    version: number;
    weights: number[];
}

export interface SidecarOptimizationInput {
    assetClasses: Array<PreparedAllocationData['series'][number]['asset']['assetClass']>;
    constraints: AllocationConstraints;
    covariance: number[][];
    mode: AllocationType;
    volatilities: number[];
}

export interface SidecarOptimizationSuccess {
    diagnostics: Partial<AllocationDiagnostics>;
    diversificationRatio?: number;
    weights: number[];
}

export type SidecarOptimizationResult =
    | { ok: true; result: SidecarOptimizationSuccess }
    | { error: NonNullable<AllocationResult['error']>; ok: false };

export const runSidecarOptimization = async (
    sidecarRuntime: SidecarRpc,
    input: SidecarOptimizationInput,
): Promise<SidecarOptimizationResult> => {
    const sidecarResponse = await sidecarRuntime.call<number[] | SidecarOptimizerResponseV2>(
        'run_optimization',
        {
            asset_classes: input.assetClasses,
            constraints: input.constraints,
            cov_matrix: input.covariance,
            mode: input.mode,
            volatilities: input.volatilities,
        },
    );

    if (Array.isArray(sidecarResponse)) {
        return {
            ok: true,
            result: {
                diagnostics: {
                    warnings: ['Sidecar returned legacy v1 format; consider restarting sidecar.'],
                },
                weights: sidecarResponse,
            },
        };
    }

    if (sidecarResponse && typeof sidecarResponse === 'object' && sidecarResponse.version === 2) {
        return {
            ok: true,
            result: {
                diagnostics: sidecarResponse.diagnostics ?? {},
                diversificationRatio: sidecarResponse.diversificationRatio,
                weights: sidecarResponse.weights,
            },
        };
    }

    return {
        error: {
            code: 'SIDECAR_PROTOCOL_ERROR',
            message: 'Sidecar returned an unrecognized response format.',
            suggestions: ['Restart the sidecar process.', 'Check sidecar version compatibility.'],
        },
        ok: false,
    };
};
