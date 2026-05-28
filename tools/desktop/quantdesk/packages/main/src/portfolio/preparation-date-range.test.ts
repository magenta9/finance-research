import { describe, expect, test } from 'vitest';

import {
    resolveAllocationPreparationDateRange,
    resolvePreparedCalculationDateRange,
    resolveWarmupPreparationDateRange,
} from './preparation-date-range';
import type { PreparedAllocationData } from './preprocessor';

const clock = () => new Date('2026-05-27T12:00:00.000Z');

const emptyPrepared: PreparedAllocationData = {
    alignedDates: [],
    assetDateCoverage: [],
    excludedAssets: [],
    series: [],
    warnings: [],
};

describe('preparation date range', () => {
    test('uses the default one-year window when dates are omitted', () => {
        expect(resolveAllocationPreparationDateRange({ clock })).toEqual({
            endDate: '2026-05-27',
            startDate: '2025-05-27',
        });
    });

    test('clamps future end dates and overly old start dates', () => {
        expect(resolveAllocationPreparationDateRange({
            clock,
            endDate: '2027-01-01',
            startDate: '2010-01-01',
        })).toEqual({
            endDate: '2026-05-27',
            startDate: '2021-05-28',
        });
    });

    test('falls back to the default window when start is not before end', () => {
        expect(resolveAllocationPreparationDateRange({
            clock,
            endDate: '2026-01-01',
            startDate: '2026-01-01',
        })).toEqual({
            endDate: '2026-05-27',
            startDate: '2025-05-27',
        });
    });

    test('uses prepared aligned dates as the actual calculation range', () => {
        expect(resolvePreparedCalculationDateRange({
            ...emptyPrepared,
            alignedDates: ['2026-01-03', '2026-01-05'],
        }, { endDate: '2026-01-31', startDate: '2026-01-01' })).toEqual({
            endDate: '2026-01-05',
            startDate: '2026-01-03',
        });
    });

    test('keeps warmup dates out of the calculation range', () => {
        expect(resolvePreparedCalculationDateRange({
            ...emptyPrepared,
            alignedDates: ['2025-12-15', '2026-01-03', '2026-01-05'],
        }, { endDate: '2026-01-31', startDate: '2026-01-01' })).toEqual({
            endDate: '2026-01-05',
            startDate: '2026-01-03',
        });
    });

    test('falls back to the effective range when prepared dates are empty', () => {
        expect(resolvePreparedCalculationDateRange(emptyPrepared, {
            endDate: '2026-01-31',
            startDate: '2026-01-01',
        })).toEqual({
            endDate: '2026-01-31',
            startDate: '2026-01-01',
        });
    });

    test('extends preparation start date for warmup history', () => {
        expect(resolveWarmupPreparationDateRange({
            endDate: '2026-05-27',
            startDate: '2025-05-27',
        }, 203)).toEqual({
            endDate: '2026-05-27',
            startDate: '2024-11-05',
        });
    });
});
