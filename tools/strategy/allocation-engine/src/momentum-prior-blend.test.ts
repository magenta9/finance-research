import { describe, expect, it } from 'vitest';

import { blendMomentumPriorWeights } from './momentum-prior-blend';

describe('blendMomentumPriorWeights', () => {
    it('preserves total risky weight', () => {
        const blended = blendMomentumPriorWeights({
            blendWeight: 0.25,
            mdWeights: [0.7, 0.3],
            momentumScores: [0.1, 0.3],
        });

        expect(blended.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 8);
    });
});
