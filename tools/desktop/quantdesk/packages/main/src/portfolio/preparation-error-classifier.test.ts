import { describe, expect, test } from 'vitest';

import { classifyAllocationPreparationError } from './preparation-error-classifier';
import { AllocationPreparationError } from './preparation-errors';

class CodedError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.code = code;
    }
}

describe('preparation error classifier', () => {
    test('preserves typed allocation preparation errors', () => {
        const error = classifyAllocationPreparationError(new AllocationPreparationError({
            code: 'MISSING_ASSETS',
            message: 'missing asset',
            suggestions: ['reload'],
        }));

        expect(error).toEqual({
            code: 'MISSING_ASSETS',
            message: 'missing asset',
            suggestions: ['reload'],
        });
    });

    test('classifies market data unavailable errors', () => {
        const error = classifyAllocationPreparationError(new CodedError('provider down', 'MARKET_DATA_UNAVAILABLE'));

        expect(error).toEqual(expect.objectContaining({
            code: 'MARKET_DATA_UNAVAILABLE',
            message: 'provider down',
        }));
    });

    test('classifies FX unavailable errors', () => {
        const error = classifyAllocationPreparationError(new CodedError('fx down', 'FX_RATE_UNAVAILABLE'));

        expect(error).toEqual(expect.objectContaining({
            code: 'FX_RATE_UNAVAILABLE',
            message: 'fx down',
        }));
    });

    test('wraps unknown errors as preparation failures', () => {
        const error = classifyAllocationPreparationError('unexpected');

        expect(error).toEqual(expect.objectContaining({
            code: 'ALLOCATION_PREPARATION_FAILED',
            message: 'unexpected',
        }));
    });
});
