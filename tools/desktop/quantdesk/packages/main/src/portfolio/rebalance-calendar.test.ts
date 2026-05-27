import { describe, expect, test } from 'vitest';

import {
    buildWeeklyRebalanceIndexesOnOrBeforeWeekday,
    isPortfolioCadenceRebalanceDay,
    resolvePortfolioWeekKey,
} from './rebalance-calendar';

describe('rebalance calendar', () => {
    test('detects weekly, monthly, and quarterly cadence boundaries', () => {
        expect(isPortfolioCadenceRebalanceDay(['2026-01-09', '2026-01-12'], 0, 'weekly')).toBe(true);
        expect(isPortfolioCadenceRebalanceDay(['2026-01-30', '2026-02-02'], 0, 'monthly')).toBe(true);
        expect(isPortfolioCadenceRebalanceDay(['2026-03-31', '2026-04-01'], 0, 'quarterly')).toBe(true);
        expect(isPortfolioCadenceRebalanceDay(['2026-01-09', '2026-01-12'], 0, 'none')).toBe(false);
    });

    test('uses ISO-style week keys across year boundaries', () => {
        expect(resolvePortfolioWeekKey('2026-12-31')).toBe(resolvePortfolioWeekKey('2027-01-01'));
        expect(resolvePortfolioWeekKey('2027-01-04')).not.toBe(resolvePortfolioWeekKey('2027-01-01'));
    });

    test('builds weekly rebalance indexes from latest available date on or before a weekday', () => {
        const indexes = buildWeeklyRebalanceIndexesOnOrBeforeWeekday({
            dates: ['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15'],
            latestWeekday: 3,
            minimumIndex: 1,
        });

        expect(indexes).toEqual([1, 5]);
    });
});
