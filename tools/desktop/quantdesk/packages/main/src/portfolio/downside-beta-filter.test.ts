import { describe, expect, test } from 'vitest';

import { filterIndicesByDownsideBeta } from './downside-beta-filter';

describe('filterIndicesByDownsideBeta', () => {
    test('retains at least one index', () => {
        const covariance = [
            [0.04, 0.01, 0.01],
            [0.01, 0.09, 0.01],
            [0.01, 0.01, 0.16],
        ];
        const filtered = filterIndicesByDownsideBeta({
            covariance,
            indices: [0, 1, 2],
            threshold: 1.25,
        });

        expect(filtered.length).toBeGreaterThan(0);
    });
});
