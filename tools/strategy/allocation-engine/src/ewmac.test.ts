import { describe, expect, test } from 'vitest';

import {
    computeEwmac,
    computeEwmacFamily,
    defaultEwmacRules,
    forecastDiversificationMultiplierForRuleCount,
} from './ewmac';

const buildTrendingPrices = (direction: 1 | -1, length = 180) =>
    Array.from({ length }, (_value, index) => {
        const drift = direction * index * 0.18;
        const cycle = Math.sin(index / 5) * 0.7;
        return 100 + drift + cycle;
    });

describe('EWMAC trend following forecast', () => {
    test('produces positive forecasts for rising prices and negative forecasts for falling prices', () => {
        const rising = computeEwmac(buildTrendingPrices(1), {
            fast: 16,
            scalar: 3.75,
            slow: 64,
        });
        const falling = computeEwmac(buildTrendingPrices(-1), {
            fast: 16,
            scalar: 3.75,
            slow: 64,
        });

        expect(rising.forecast.at(-1)).toBeGreaterThan(0);
        expect(falling.forecast.at(-1)).toBeLessThan(0);
    });

    test('caps family forecasts and reports the default six-rule configuration', () => {
        const family = computeEwmacFamily({ prices: buildTrendingPrices(1) });

        expect(family.rules).toHaveLength(defaultEwmacRules.length);
        expect(family.ruleForecasts).toHaveLength(defaultEwmacRules.length);
        expect(Math.max(...family.forecast.map((value) => Math.abs(value)))).toBeLessThanOrEqual(20);
        expect(family.forecastDiversificationMultiplier).toBe(1.35);
    });

    test('handles flat prices without NaN or infinite values', () => {
        const family = computeEwmacFamily({ prices: Array(120).fill(100) as number[] });

        expect(family.forecast.every((value) => Number.isFinite(value))).toBe(true);
        expect(family.forecast.every((value) => value === 0)).toBe(true);
    });

    test('uses AFTS-style default FDM buckets', () => {
        expect(forecastDiversificationMultiplierForRuleCount(1)).toBe(1);
        expect(forecastDiversificationMultiplierForRuleCount(2)).toBe(1.1);
        expect(forecastDiversificationMultiplierForRuleCount(3)).toBe(1.2);
        expect(forecastDiversificationMultiplierForRuleCount(6)).toBe(1.35);
    });
});