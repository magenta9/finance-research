import { describe, expect, test } from 'vitest';

import { applyPortfolioVolatilityCap, portfolioVolatilityAnnualized } from './portfolio-volatility-cap';

describe('portfolio volatility cap', () => {
    test('scales risky weights down and routes excess to cash', () => {
        const covariance = [
            [0.04, 0.02],
            [0.02, 0.04],
        ];
        const weights = [0.6, 0.4];
        const volatility = portfolioVolatilityAnnualized(weights, covariance);

        expect(volatility).toBeGreaterThan(0.12);

        const capped = applyPortfolioVolatilityCap({
            capAnnualized: 0.12,
            covariance,
            minRiskyScale: 0.45,
            weights,
        });

        expect(capped.weights.reduce((sum, weight) => sum + weight, 0) + capped.cashReserve).toBeCloseTo(1, 6);
        expect(
            portfolioVolatilityAnnualized(capped.weights, covariance),
        ).toBeLessThanOrEqual(0.12 + 1e-6);
        expect(capped.cashReserve).toBeGreaterThan(0);
    });
});
