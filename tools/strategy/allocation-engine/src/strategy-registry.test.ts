import { describe, expect, test } from 'vitest';

import {
    CANONICAL_STRATEGY_IDS,
    defaultAllocationStrategyRegistry,
    resolveStrategyHandler,
} from './index';

describe('allocation strategy registry', () => {
    test('registers all canonical strategy ids', () => {
        for (const strategyId of CANONICAL_STRATEGY_IDS) {
            expect(defaultAllocationStrategyRegistry[strategyId]).toBeTruthy();
            expect(resolveStrategyHandler(strategyId)).toBeTruthy();
        }
    });

    test('rejects unknown strategy ids', () => {
        expect(resolveStrategyHandler('unknown_strategy' as never)).toBeNull();
    });
});
