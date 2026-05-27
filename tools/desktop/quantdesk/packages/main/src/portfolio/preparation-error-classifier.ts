import type { AllocationResult } from '@quantdesk/shared';

import { isAllocationPreparationError } from './preparation-errors';

export const classifyAllocationPreparationError = (
    error: unknown,
): NonNullable<AllocationResult['error']> => {
    if (isAllocationPreparationError(error)) {
        return error.toAllocationError();
    }

    if (error instanceof Error && 'code' in error && error.code === 'MARKET_DATA_UNAVAILABLE') {
        return {
            code: 'MARKET_DATA_UNAVAILABLE',
            message: error.message,
            suggestions: ['Enable at least one market data provider.', 'Refresh the asset after the provider recovers.'],
        };
    }

    if (error instanceof Error && 'code' in error && error.code === 'FX_RATE_UNAVAILABLE') {
        return {
            code: 'FX_RATE_UNAVAILABLE',
            message: error.message,
            suggestions: ['Enable at least one FX provider.', 'Refresh FX cache before running allocation.'],
        };
    }

    const message = error instanceof Error ? error.message : String(error);

    return {
        code: 'ALLOCATION_PREPARATION_FAILED',
        message,
        suggestions: ['Review asset history coverage and cached prices.', 'Retry after refreshing market data.'],
    };
};
