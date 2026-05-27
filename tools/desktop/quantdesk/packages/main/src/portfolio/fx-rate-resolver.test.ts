import { describe, expect, test, vi } from 'vitest';

import type { FxRateRecord } from '@quantdesk/shared';

import { DirectInverseFxRateResolver, type FxRateRepositoryReader } from './fx-rate-resolver';

const rate = (pair: string, value: number): FxRateRecord => ({
    date: '2026-01-02',
    pair,
    rate: value,
    source: 'test',
});

const buildRepository = (rates: Record<string, FxRateRecord>): FxRateRepositoryReader => ({
    getLatestRate: vi.fn((pair: string) => rates[pair] ?? null),
});

describe('FX rate resolver', () => {
    test('returns identity rate for matching currencies', () => {
        const repository = buildRepository({});
        const resolver = new DirectInverseFxRateResolver(repository);

        expect(resolver.resolve({
            assetCurrency: 'CNY',
            baseCurrency: 'CNY',
            onOrBeforeDate: '2026-01-03',
        })).toEqual({
            date: '2026-01-03',
            pair: 'CNY/CNY',
            rate: 1,
            source: 'identity',
        });
        expect(repository.getLatestRate).not.toHaveBeenCalled();
    });

    test('prefers direct FX rates', () => {
        const repository = buildRepository({ 'USD/CNY': rate('USD/CNY', 7.1) });
        const resolver = new DirectInverseFxRateResolver(repository);

        expect(resolver.resolve({
            assetCurrency: 'USD',
            baseCurrency: 'CNY',
            onOrBeforeDate: '2026-01-03',
        })).toEqual(rate('USD/CNY', 7.1));
    });

    test('falls back to inverse FX rates', () => {
        const repository = buildRepository({ 'CNY/USD': rate('CNY/USD', 0.14) });
        const resolver = new DirectInverseFxRateResolver(repository);

        expect(resolver.resolve({
            assetCurrency: 'USD',
            baseCurrency: 'CNY',
            onOrBeforeDate: '2026-01-03',
        })).toEqual({
            date: '2026-01-02',
            pair: 'CNY/USD',
            rate: 1 / 0.14,
            source: 'test',
        });
    });

    test('returns null when no direct or inverse rate exists', () => {
        const repository = buildRepository({});
        const resolver = new DirectInverseFxRateResolver(repository);

        expect(resolver.resolve({
            assetCurrency: 'USD',
            baseCurrency: 'CNY',
            onOrBeforeDate: '2026-01-03',
        })).toBeNull();
    });
});
