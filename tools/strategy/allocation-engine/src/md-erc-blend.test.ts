import { describe, expect, it } from 'vitest';

import { blendMdErcWeights } from './md-erc-blend';

describe('blendMdErcWeights', () => {
    it('returns MDP weights when blend weight is zero', () => {
        const md = [0.7, 0.3];
        const erc = [0.5, 0.5];

        expect(blendMdErcWeights({ blendWeight: 0, ercWeights: erc, mdWeights: md })).toEqual(md);
    });

    it('blends toward ERC while preserving risky weight total', () => {
        const md = [0.8, 0.2];
        const erc = [0.5, 0.5];
        const blended = blendMdErcWeights({ blendWeight: 0.5, ercWeights: erc, mdWeights: md });
        const total = blended.reduce((sum, weight) => sum + weight, 0);

        expect(total).toBeCloseTo(1, 8);
        expect(blended[0]).toBeLessThan(0.8);
        expect(blended[1]).toBeGreaterThan(0.2);
    });
});
