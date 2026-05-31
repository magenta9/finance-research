import { describe, expect, test } from 'vitest';

import { applyMomentumReturnTiltAroundWeights } from './momentum-return-tilt';

describe('momentum return tilt', () => {
    test('keeps reference weights when tilt strength is zero', () => {
        const referenceWeights = [0.6, 0.4];
        const covariance = [
            [0.04, 0.01],
            [0.01, 0.03],
        ];

        expect(applyMomentumReturnTiltAroundWeights({
            covariance,
            momentumScores: [0.1, -0.05],
            referenceWeights,
            tiltStrength: 0,
            trackingErrorVolatilityLimit: 0.05,
        })).toEqual(referenceWeights);
    });

    test('limits tracking error versus the reference portfolio', () => {
        const referenceWeights = [0.5, 0.5];
        const covariance = [
            [0.04, 0.02],
            [0.02, 0.04],
        ];
        const tilted = applyMomentumReturnTiltAroundWeights({
            covariance,
            momentumScores: [0.2, -0.2],
            referenceWeights,
            tiltStrength: 0.5,
            trackingErrorVolatilityLimit: 0.01,
        });

        expect(tilted.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 8);
        expect(tilted[0]).toBeCloseTo(referenceWeights[0], 1);
    });
});
