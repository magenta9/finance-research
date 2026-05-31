import { describe, expect, test } from 'vitest';

import { nudgeWeightsTowardDiversificationRatio } from './diversification-ratio-nudge';

describe('nudgeWeightsTowardDiversificationRatio', () => {
    test('preserves total risky weight', () => {
        const covariance = [
            [0.04, 0.01],
            [0.01, 0.09],
        ];
        const weights = [0.6, 0.4];
        const nudged = nudgeWeightsTowardDiversificationRatio({
            blendWeight: 0.15,
            covariance,
            volatilities: [0.2, 0.3],
            weights,
        });

        expect(nudged.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    });
});
