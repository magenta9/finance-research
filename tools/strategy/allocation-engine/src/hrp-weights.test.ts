import { describe, expect, it } from 'vitest';

import { blendMdHrpWeights, computeHrpWeights } from './hrp-weights';

describe('computeHrpWeights', () => {
    it('returns unit weight for a single asset', () => {
        expect(computeHrpWeights([[0.04]])).toEqual([1]);
    });

    it('returns normalized long-only weights for multi-asset covariance', () => {
        const covariance = [
            [0.04, 0.01],
            [0.01, 0.03],
        ];
        const weights = computeHrpWeights(covariance);
        const total = weights.reduce((sum, weight) => sum + weight, 0);

        expect(weights).toHaveLength(2);
        expect(total).toBeCloseTo(1, 8);
        expect(weights.every((weight) => weight >= 0)).toBe(true);
    });
});

describe('blendMdHrpWeights', () => {
    it('preserves risky total when blending', () => {
        const md = [0.7, 0.3];
        const hrp = [0.5, 0.5];
        const blended = blendMdHrpWeights({ blendWeight: 0.4, hrpWeights: hrp, mdWeights: md });

        expect(blended.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 8);
    });
});
