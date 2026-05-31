import { describe, expect, test } from 'vitest';

import { applyHerfindahlWeightCap } from './herfindahl-weight-cap';

describe('applyHerfindahlWeightCap', () => {
    test('reduces concentration while preserving total weight', () => {
        const weights = [0.25, 0.25, 0.25, 0.15, 0.1];
        const capped = applyHerfindahlWeightCap({ weights });
        const herfindahl = capped
            .map((weight) => weight / capped.reduce((sum, value) => sum + value, 0))
            .reduce((sum, weight) => sum + weight ** 2, 0);

        expect(herfindahl).toBeLessThanOrEqual(0.2201);
        expect(capped.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    });
});
