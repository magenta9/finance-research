import { describe, expect, test } from 'vitest';

import { SizeBasedAllocationOptimizerSelector } from './optimizer-selector';

describe('optimizer selector', () => {
    test.each([
        [1, 'js'],
        [19, 'js'],
        [20, 'js'],
        [21, 'python'],
        [100, 'python'],
    ] as const)('selects %s assets -> %s', (assetCount, expected) => {
        const selector = new SizeBasedAllocationOptimizerSelector();

        expect(selector.selectOptimizer({ assetCount })).toBe(expected);
    });

    test('supports a custom python threshold', () => {
        const selector = new SizeBasedAllocationOptimizerSelector(2);

        expect(selector.selectOptimizer({ assetCount: 2 })).toBe('js');
        expect(selector.selectOptimizer({ assetCount: 3 })).toBe('python');
    });
});
