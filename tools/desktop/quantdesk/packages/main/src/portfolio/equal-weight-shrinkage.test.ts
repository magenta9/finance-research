import { describe, expect, it } from 'vitest';

import { applyEqualWeightShrinkage } from './equal-weight-shrinkage';

describe('applyEqualWeightShrinkage', () => {
    it('returns original weights when intensity is zero', () => {
        const weights = [0.6, 0.3, 0.1];

        expect(applyEqualWeightShrinkage({ intensity: 0, weights })).toEqual(weights);
    });

    it('blends toward equal weight among active holdings while preserving total', () => {
        const weights = [0.6, 0.3, 0.1];
        const shrunk = applyEqualWeightShrinkage({ intensity: 0.25, weights });
        const total = shrunk.reduce((sum, weight) => sum + weight, 0);

        expect(total).toBeCloseTo(1, 8);
        expect(shrunk[0]).toBeLessThan(0.6);
        expect(shrunk[1]).toBeGreaterThan(0.3);
        expect(shrunk[2]).toBeGreaterThan(0.1);
    });
});
