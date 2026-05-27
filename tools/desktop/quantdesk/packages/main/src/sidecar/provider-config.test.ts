import { describe, expect, test } from 'vitest';

import {
    getEnabledDataProviderIds,
    getEnabledFxSources,
    getEnabledPriceSources,
} from './provider-config';
import { preferenceKeys } from '../preferences/preference-keys';

describe('provider config', () => {
    test('derives enabled sources from user preferences', () => {
        const preferences = new Map<string, string>([
            [preferenceKeys.dataSource.akshareEnabled, 'false'],
            [preferenceKeys.dataSource.frankfurterEnabled, 'true'],
            [preferenceKeys.dataSource.tushareEnabled, 'false'],
            [preferenceKeys.dataSource.yfinanceEnabled, 'true'],
        ]);
        const reader = { get: (key: string) => preferences.get(key) ?? null };

        expect(getEnabledDataProviderIds(reader)).toEqual(['yfinance']);
        expect(getEnabledPriceSources(reader, 'US')).toEqual(['yfinance']);
        expect(getEnabledFxSources(reader)).toEqual(['yfinance', 'frankfurter']);
    });

    test('throws when every provider in a category is disabled', () => {
        const reader = { get: () => 'false' };

        expect(() => getEnabledPriceSources(reader)).toThrow('All price data providers are disabled.');
        expect(() => getEnabledFxSources(reader)).toThrow('All FX data providers are disabled.');
    });
});