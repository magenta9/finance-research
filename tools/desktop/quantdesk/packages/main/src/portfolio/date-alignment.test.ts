import { describe, expect, test } from 'vitest';

import { formatIsoDate, shiftIsoDateByMonths } from './date-alignment';

describe('date alignment', () => {
    test('formats dates as ISO calendar dates', () => {
        expect(formatIsoDate(new Date('2026-05-27T12:34:56.000Z'))).toBe('2026-05-27');
    });

    test.each([
        ['2026-05-27', 3, '2026-02-27'],
        ['2026-05-27', 6, '2025-11-27'],
        ['2026-05-27', 12, '2025-05-27'],
    ] as const)('shifts %s back %s months', (endDate, months, expected) => {
        expect(shiftIsoDateByMonths(endDate, months)).toBe(expected);
    });
});
