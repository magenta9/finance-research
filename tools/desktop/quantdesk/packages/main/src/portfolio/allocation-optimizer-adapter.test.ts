import { describe, expect, test, vi } from 'vitest';

import type { AllocationConstraints, StoredAsset } from '@quantdesk/shared';

import { DefaultAllocationOptimizerAdapter } from './allocation-optimizer-adapter';
import type { PreparedAllocationData } from './preprocessor';
import type { SidecarRpc } from '../sidecar/runtime-types';

const constraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 1,
};

const buildAsset = (index: number): StoredAsset => ({
    assetClass: 'equity',
    createdAt: '2026-01-01T00:00:00.000Z',
    currency: 'CNY',
    id: `asset-${index}`,
    market: 'A',
    metadata: {},
    name: `Asset ${index}`,
    symbol: `A${index}`,
    tags: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
});

const buildPrepared = (assetCount: number): PreparedAllocationData => ({
    alignedDates: ['2026-01-01', '2026-01-02'],
    assetDateCoverage: [],
    excludedAssets: [],
    series: Array.from({ length: assetCount }, (_value, index) => ({
        annualizedReturn: 0,
        annualizedVolatility: 0,
        asset: buildAsset(index),
        prices: [1, 1 + index / 100],
    })),
    warnings: [],
});

const identityCovariance = (size: number) => Array.from({ length: size }, (_row, rowIndex) =>
    Array.from({ length: size }, (_column, columnIndex) => rowIndex === columnIndex ? 0.04 : 0));

const buildRequest = (assetCount: number) => ({
    annualizedAssetVolatility: Array.from({ length: assetCount }, () => 0.2),
    assetIndexes: Array.from({ length: assetCount }, (_value, index) => index),
    constraints,
    covariance: identityCovariance(assetCount),
    mode: 'inverse_volatility' as const,
    prepared: buildPrepared(assetCount),
});

describe('allocation optimizer adapter', () => {
    test('uses the JS optimizer for smaller requests', async () => {
        const sidecarRuntime: SidecarRpc = { call: vi.fn() };
        const adapter = new DefaultAllocationOptimizerAdapter(sidecarRuntime);

        const result = await adapter.optimize(buildRequest(3));

        expect(result).toEqual(expect.objectContaining({ ok: true, optimizer: 'js' }));
        if (result.ok) {
            expect(result.weights).toHaveLength(3);
        }
        expect(sidecarRuntime.call).not.toHaveBeenCalled();
    });

    test('delegates large requests to the sidecar optimizer', async () => {
        const response = {
            diagnostics: { warnings: ['python warning'] },
            diversificationRatio: 1.2,
            version: 2,
            weights: Array.from({ length: 21 }, () => 1 / 21),
        };
        const callMock = vi.fn();
        const sidecarRuntime: SidecarRpc = {
            call: async <T>(method: string, params?: unknown) => {
                callMock(method, params);
                return response as T;
            },
        };
        const adapter = new DefaultAllocationOptimizerAdapter(sidecarRuntime);

        const result = await adapter.optimize(buildRequest(21));

        expect(callMock).toHaveBeenCalledWith('run_optimization', expect.objectContaining({
            cov_matrix: expect.arrayContaining([expect.any(Array)]),
            mode: 'inverse_volatility',
        }));
        expect(result).toEqual(expect.objectContaining({
            diagnostics: { warnings: ['python warning'] },
            diversificationRatio: 1.2,
            ok: true,
            optimizer: 'python',
        }));
    });

    test('uses the injected optimizer selector for routing', async () => {
        const callMock = vi.fn();
        const sidecarRuntime: SidecarRpc = {
            call: async <T>(method: string, params?: unknown) => {
                callMock(method, params);
                return {
                    version: 2,
                    weights: [0.5, 0.5],
                } as T;
            },
        };
        const adapter = new DefaultAllocationOptimizerAdapter(sidecarRuntime, {
            selectOptimizer: () => 'python',
        });

        const result = await adapter.optimize(buildRequest(2));

        expect(callMock).toHaveBeenCalledWith('run_optimization', expect.any(Object));
        expect(result).toEqual(expect.objectContaining({ ok: true, optimizer: 'python' }));
    });

    test('converts JS optimizer failures into allocation errors', async () => {
        const sidecarRuntime: SidecarRpc = { call: vi.fn() };
        const adapter = new DefaultAllocationOptimizerAdapter(sidecarRuntime);
        const request = {
            ...buildRequest(3),
            constraints: { ...constraints, maxSingleWeight: 0.2 },
        };

        const result = await adapter.optimize(request);

        expect(result).toEqual(expect.objectContaining({
            error: expect.objectContaining({ code: 'INFEASIBLE_CONSTRAINTS' }),
            ok: false,
            optimizerPath: 'js',
        }));
    });
});
