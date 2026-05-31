import { describe, expect, test } from 'vitest';

import type { AllocationConstraints } from '@quantdesk/shared';

import { ERC_MAX_ITERATIONS, optimizeWeights } from './optimizer';
import { computeRiskContributions } from './statistics';

const baseConstraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 0.6,
};

describe('portfolio optimizer', () => {
    test('ERC: two equal-volatility zero-correlation assets produce near-equal weights', () => {
        const covariance = [
            [0.04, 0.0],
            [0.0, 0.04],
        ];
        const result = optimizeWeights({
            assetClasses: ['equity', 'fixed_income'],
            constraints: baseConstraints,
            covariance,
            mode: 'erc',
            volatilities: [0.2, 0.2],
        });
        const contributions = computeRiskContributions(result.weights, covariance);

        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
        expect(Math.abs(contributions[0] - contributions[1])).toBeLessThan(0.05);
        expect(result.diagnostics.erc?.iterations).toBeGreaterThan(0);
        expect(result.diagnostics.erc?.iterations).toBeLessThan(ERC_MAX_ITERATIONS);
    });

    test('ERC: solves a 3-asset allocation with near-equal risk contributions', () => {
        const covariance = [
            [0.04, 0.01, 0.0],
            [0.01, 0.03, 0.002],
            [0.0, 0.002, 0.02],
        ];
        const result = optimizeWeights({
            assetClasses: ['equity', 'fixed_income', 'commodity'],
            constraints: baseConstraints,
            covariance,
            mode: 'erc',
            volatilities: [0.2, 0.173, 0.141],
        });
        const contributions = computeRiskContributions(result.weights, covariance);

        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
        expect(Math.max(...contributions) - Math.min(...contributions)).toBeLessThan(0.08);
    });

    test('ERC: respects single-asset and class cap constraints', () => {
        const covariance = [
            [0.04, 0.01, 0.0],
            [0.01, 0.03, 0.002],
            [0.0, 0.002, 0.02],
        ];
        const result = optimizeWeights({
            assetClasses: ['equity', 'fixed_income', 'commodity'],
            constraints: {
                ...baseConstraints,
                maxSingleWeight: 0.4,
                maxClassWeight: { equity: 0.4 },
            },
            covariance,
            mode: 'erc',
            volatilities: [0.2, 0.173, 0.141],
        });

        expect(Math.max(...result.weights)).toBeLessThanOrEqual(0.400001);
        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
    });

    test('ERC: exposes fallback diagnostics when convergence is hard', () => {
        // Perfectly correlated assets with identical vol - hard to converge ERC
        const covariance = [
            [0.04, 0.04],
            [0.04, 0.04],
        ];
        const result = optimizeWeights({
            assetClasses: ['equity', 'equity'],
            constraints: baseConstraints,
            covariance,
            mode: 'erc',
            volatilities: [0.2, 0.2],
        });

        // Should still produce valid weights regardless of convergence
        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
        expect(result.diagnostics.erc).toBeDefined();
    });

    test('IVW: low-volatility assets get higher weight than high-volatility assets', () => {
        const result = optimizeWeights({
            assetClasses: ['equity', 'fixed_income', 'commodity'],
            constraints: baseConstraints,
            covariance: [
                [0.04, 0.0, 0.0],
                [0.0, 0.01, 0.0],
                [0.0, 0.0, 0.02],
            ],
            mode: 'inverse_volatility',
            volatilities: [0.2, 0.1, 0.141],
        });

        // fixed_income (lowest vol) should have highest weight
        expect(result.weights[1]).toBeGreaterThan(result.weights[0]);
        expect(result.weights[1]).toBeGreaterThan(result.weights[2]);
        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
    });

    test('IVW: does not produce infinite weights for near-zero volatility', () => {
        const result = optimizeWeights({
            assetClasses: ['equity', 'cash'],
            constraints: baseConstraints,
            covariance: [
                [0.04, 0.0],
                [0.0, 0.0000001],
            ],
            mode: 'inverse_volatility',
            volatilities: [0.2, 0.000001],
        });

        expect(result.weights.every(Number.isFinite)).toBe(true);
        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
    });

    test('MDP: low-correlation sample has diversificationRatio > 1', () => {
        // Covariance must be in daily scale (production convention); portfolioVolatility annualises internally.
        const annualCov = [
            [0.04, 0.002, 0.001],
            [0.002, 0.01, 0.0005],
            [0.001, 0.0005, 0.02],
        ];
        const covariance = annualCov.map((row) => row.map((v) => v / 252));
        const result = optimizeWeights({
            assetClasses: ['equity', 'fixed_income', 'commodity'],
            constraints: baseConstraints,
            covariance,
            mode: 'max_diversification',
            volatilities: [0.2, 0.1, 0.141],
        });

        expect(result.diversificationRatio).toBeDefined();
        expect(result.diversificationRatio!).toBeGreaterThan(1);
        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
    });

    test('MDP: singular matrix triggers regularization and fallback', () => {
        const covariance = [
            [0.04, 0.04],
            [0.04, 0.04],
        ];
        const result = optimizeWeights({
            assetClasses: ['equity', 'equity'],
            constraints: baseConstraints,
            covariance,
            mode: 'max_diversification',
            volatilities: [0.2, 0.2],
        });

        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
        expect(result.weights.every(Number.isFinite)).toBe(true);
        expect(result.diversificationRatio).toBeDefined();
    });

    test('enforces the single-asset maximum weight constraint', () => {
        const result = optimizeWeights({
            assetClasses: ['equity', 'fixed_income', 'commodity', 'cash'],
            constraints: {
                ...baseConstraints,
                maxSingleWeight: 0.3,
            },
            covariance: [
                [0.05, 0.0, 0.0, 0.0],
                [0.0, 0.02, 0.0, 0.0],
                [0.0, 0.0, 0.01, 0.0],
                [0.0, 0.0, 0.0, 0.005],
            ],
            mode: 'inverse_volatility',
            volatilities: [0.224, 0.141, 0.1, 0.071],
        });

        expect(Math.max(...result.weights)).toBeLessThanOrEqual(0.300001);
        expect(result.weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
    });

    test('raises a structured infeasibility signal for impossible constraints', () => {
        expect(() =>
            optimizeWeights({
                assetClasses: ['equity', 'fixed_income', 'commodity'],
                constraints: {
                    ...baseConstraints,
                    maxSingleWeight: 0.3,
                    maxClassWeight: {
                        commodity: 0.2,
                        equity: 0.2,
                        fixed_income: 0.2,
                    },
                },
                covariance: [
                    [0.04, 0.0, 0.0],
                    [0.0, 0.03, 0.0],
                    [0.0, 0.0, 0.02],
                ],
                mode: 'erc',
                volatilities: [0.2, 0.173, 0.141],
            }),
        ).toThrow(/infeasible/i);
    });

    test('rejects allowShort with a clear error', () => {
        expect(() =>
            optimizeWeights({
                assetClasses: ['equity', 'fixed_income'],
                constraints: { ...baseConstraints, allowShort: true },
                covariance: [[0.04, 0.0], [0.0, 0.02]],
                mode: 'erc',
                volatilities: [0.2, 0.141],
            }),
        ).toThrow(/short/i);
    });

    test('rejects allowLeverage with a clear error', () => {
        expect(() =>
            optimizeWeights({
                assetClasses: ['equity', 'fixed_income'],
                constraints: { ...baseConstraints, allowLeverage: true },
                covariance: [[0.04, 0.0], [0.0, 0.02]],
                mode: 'erc',
                volatilities: [0.2, 0.141],
            }),
        ).toThrow(/leverage/i);
    });
});
