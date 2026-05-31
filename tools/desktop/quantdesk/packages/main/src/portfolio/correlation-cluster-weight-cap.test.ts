import { describe, expect, test } from 'vitest';

import { applyCorrelationClusterWeightCap } from './correlation-cluster-weight-cap';

describe('applyCorrelationClusterWeightCap', () => {
    test('scales down a highly correlated pair while preserving risky total', () => {
        const covariance = [
            [0.04, 0.035, 0.005],
            [0.035, 0.04, 0.005],
            [0.005, 0.005, 0.09],
        ];
        const weights = [0.35, 0.35, 0.3];
        const capped = applyCorrelationClusterWeightCap({
            covariance,
            maxClusterWeight: 0.45,
            weights,
        });

        expect(capped[0] + capped[1]).toBeLessThanOrEqual(0.4501);
        expect(capped.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    });
});
