import { describe, expect, test } from 'vitest';

import { applyCorrelationRegimeCashScale } from './correlation-regime-cash';

describe('applyCorrelationRegimeCashScale', () => {
    test('adds cash when average correlation is high', () => {
        const covariance = [
            [0.04, 0.032, 0.028],
            [0.032, 0.04, 0.03],
            [0.028, 0.03, 0.04],
        ];
        const boosted = applyCorrelationRegimeCashScale({
            baseCashReserve: 0.25,
            covariance,
            scale: 1,
        });

        expect(boosted).toBeGreaterThan(0.25);
        expect(boosted).toBeLessThanOrEqual(0.4);
    });
});
