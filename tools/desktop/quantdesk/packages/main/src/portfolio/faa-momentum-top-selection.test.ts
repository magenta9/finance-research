import { describe, expect, it } from 'vitest';

import { selectFaaMomentumTopIndices } from './faa-momentum-top-selection';

describe('selectFaaMomentumTopIndices', () => {
    it('keeps all indices when topN exceeds eligible count', () => {
        expect(
            selectFaaMomentumTopIndices({
                eligibleIndices: [0, 1],
                momentumScores: [0.1, 0.2],
                topN: 5,
            }),
        ).toEqual([0, 1]);
    });

    it('selects highest momentum indices', () => {
        expect(
            selectFaaMomentumTopIndices({
                eligibleIndices: [0, 1, 2],
                momentumScores: [0.1, 0.5, 0.2],
                topN: 2,
            }),
        ).toEqual([1, 2]);
    });
});
