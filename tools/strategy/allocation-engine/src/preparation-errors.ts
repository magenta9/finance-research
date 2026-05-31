import type { AllocationResult } from '@quantdesk/shared';

export class AllocationPreparationError extends Error {
    readonly code: string;

    readonly suggestions: string[];

    constructor({
        code,
        message,
        suggestions,
    }: NonNullable<AllocationResult['error']>) {
        super(message);
        this.name = 'AllocationPreparationError';
        this.code = code;
        this.suggestions = suggestions;
    }

    toAllocationError(): NonNullable<AllocationResult['error']> {
        return {
            code: this.code,
            message: this.message,
            suggestions: this.suggestions,
        };
    }
}

export const isAllocationPreparationError = (error: unknown): error is AllocationPreparationError => error instanceof AllocationPreparationError;
