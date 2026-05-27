import { describe, expect, test } from 'vitest';

import type { AllocationConstraints } from '@quantdesk/shared';

import {
    mergeAllocationConstraints,
    validateAllocationAssetSelection,
    validateAllocationConstraints,
    validateAllocationStrategyMix,
} from './allocation-validator';

const baseConstraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: { equity: 0.8 },
    maxSingleWeight: 0.4,
};

describe('allocation validator', () => {
    test('merges allocation constraints with defaults', () => {
        expect(mergeAllocationConstraints({
            ...baseConstraints,
            maxClassWeight: { commodity: 0.3 },
        })).toEqual(expect.objectContaining({
            allowLeverage: false,
            allowShort: false,
            maxClassWeight: { commodity: 0.3 },
            maxSingleWeight: 0.4,
        }));
    });

    test('rejects unsupported short and leverage constraints', () => {
        expect(validateAllocationConstraints({ ...baseConstraints, allowShort: true })).toEqual(expect.objectContaining({
            code: 'UNSUPPORTED_CONSTRAINTS',
            message: 'Short selling is not supported by the current allocation modes.',
        }));
        expect(validateAllocationConstraints({ ...baseConstraints, allowLeverage: true })).toEqual(expect.objectContaining({
            code: 'UNSUPPORTED_CONSTRAINTS',
            message: 'Leverage is not supported by the current allocation modes.',
        }));
    });

    test('validates allocation asset selection size', () => {
        expect(validateAllocationAssetSelection([0])).toEqual(expect.objectContaining({
            code: 'INVALID_STRATEGY_MIX',
        }));
        expect(validateAllocationAssetSelection([0, 1])).toBeNull();
    });

    test('accepts missing or disabled trend-following strategy mix', () => {
        expect(validateAllocationStrategyMix()).toBeNull();
        expect(validateAllocationStrategyMix({ trendFollowing: { enabled: false, sleeveWeight: 2 } })).toBeNull();
    });

    test('validates trend-following sleeve and forecast parameters', () => {
        expect(validateAllocationStrategyMix({ trendFollowing: { enabled: true, sleeveWeight: 1.2 } })).toEqual(expect.objectContaining({
            code: 'INVALID_STRATEGY_MIX',
            message: '趋势跟随仓位需要在 0% 到 100% 之间。',
        }));
        expect(validateAllocationStrategyMix({
            trendFollowing: { enabled: true, forecastCap: 0, sleeveWeight: 0.5 },
        })).toEqual(expect.objectContaining({
            code: 'INVALID_STRATEGY_MIX',
            message: '趋势跟随 forecast cap 必须为正数。',
        }));
    });

    test('validates enabled EWMAC rules', () => {
        expect(validateAllocationStrategyMix({
            trendFollowing: {
                enabled: true,
                rules: [{ fast: 8, slow: 4 }],
                sleeveWeight: 0.5,
            },
        })).toEqual(expect.objectContaining({
            code: 'INVALID_STRATEGY_MIX',
            message: 'EWMAC 子规则需要满足 slow > fast > 0。',
        }));
        expect(validateAllocationStrategyMix({
            trendFollowing: {
                enabled: true,
                rules: [{ fast: 8, scalar: 0, slow: 32 }],
                sleeveWeight: 0.5,
            },
        })).toEqual(expect.objectContaining({
            code: 'INVALID_STRATEGY_MIX',
            message: 'EWMAC forecast scalar 必须为正数。',
        }));
        expect(validateAllocationStrategyMix({
            trendFollowing: {
                enabled: true,
                rules: [{ enabled: false, fast: 8, scalar: 0, slow: 4 }],
                sleeveWeight: 0.5,
            },
        })).toBeNull();
    });
});
