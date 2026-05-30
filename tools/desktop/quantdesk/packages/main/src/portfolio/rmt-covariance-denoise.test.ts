import { describe, expect, test } from 'vitest';

import { denoiseCovarianceMarchenkoPastur } from './rmt-covariance-denoise';

describe('rmt covariance denoise', () => {
    test('returns a positive definite covariance matrix', () => {
        const covariance = [
            [0.04, 0.03, 0.02, 0.015],
            [0.03, 0.035, 0.018, 0.012],
            [0.02, 0.018, 0.03, 0.01],
            [0.015, 0.012, 0.01, 0.025],
        ];
        const denoised = denoiseCovarianceMarchenkoPastur(covariance, 252);

        expect(denoised).toHaveLength(4);
        expect(denoised[0][0]).toBeGreaterThan(0);
        expect(denoised[1][1]).toBeGreaterThan(0);
        expect(denoised[0][1]).toBeCloseTo(denoised[1][0], 10);
    });
});
