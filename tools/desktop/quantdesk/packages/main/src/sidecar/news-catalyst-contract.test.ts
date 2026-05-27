import { afterEach, describe, expect, test } from 'vitest';

import { resetMarketDataContractsCacheForTests } from './market-data-contracts';
import type { NewsCatalystProviderId } from './market-data-port';
import {
    evaluateNewsCatalystWindow,
    getNewsCatalystProviderOrder,
    loadNewsCatalystFixture,
    loadNewsCatalystPolicy,
    resetNewsCatalystContractsCacheForTests,
    resolveNewsCatalystSymbolMarket,
} from './news-catalyst-contracts';

afterEach(() => {
    resetMarketDataContractsCacheForTests();
    resetNewsCatalystContractsCacheForTests();
});

describe('news catalyst contracts', () => {
    test('loads the shared news catalyst policy artifact', () => {
        const policy = loadNewsCatalystPolicy();

        expect(policy.schemaVersion).toBe(1);
        expect(policy.announcementProviderOrder.A).toEqual(['cninfo', 'eastmoney_notice']);
        expect(policy.announcementProviderOrder.HK).toEqual(['hkexnews', 'hsi_index_notices']);
        expect(policy.providerStatus.sse_disclosure).toBe('planned');
        expect(policy.providerStatus.sec_efts).toBe('planned');
        expect(policy.windowDefaults).toEqual({ lookaheadDays: 14, lookbackDays: 30 });
    });

    test('keeps provider routing aligned with the shared fixture corpus', () => {
        const fixture = loadNewsCatalystFixture<{
            cases: Array<{
                enabledProviders: NewsCatalystProviderId[];
                expectedProviders: NewsCatalystProviderId[];
                market: string | null;
                name: string;
            }>;
        }>('news-catalyst-routing.json');

        for (const testCase of fixture.cases) {
            expect(getNewsCatalystProviderOrder({
                enabledProviders: testCase.enabledProviders,
                market: testCase.market,
            }), testCase.name).toEqual(testCase.expectedProviders);
        }
    });

    test('keeps symbol to market resolution aligned with the shared fixture corpus', () => {
        const fixture = loadNewsCatalystFixture<{
            cases: Array<{
                assetMetadata: Record<string, unknown>;
                expectedMarket: 'A' | 'HK' | 'US' | null;
                expectedReasonCode: 'market_unresolved' | null;
                expectedSymbol: string;
                market: string | null;
                name: string;
                symbol: string;
            }>;
        }>('news-catalyst-symbol-market.json');

        for (const testCase of fixture.cases) {
            const actual = resolveNewsCatalystSymbolMarket({
                assetMetadata: testCase.assetMetadata,
                market: testCase.market,
                symbol: testCase.symbol,
            });

            expect(actual.market, testCase.name).toBe(testCase.expectedMarket);
            expect(actual.reasonCode, testCase.name).toBe(testCase.expectedReasonCode);
            expect(actual.symbol, testCase.name).toBe(testCase.expectedSymbol);
        }
    });

    test('keeps catalyst window semantics aligned with the shared fixture corpus', () => {
        const fixture = loadNewsCatalystFixture<{
            cases: Array<{
                events: Array<{ eventDate: string | null; publishedAt: string | null }>;
                expectedInCatalystWindow: boolean | 'unknown';
                name: string;
                providerStatus: 'available' | 'degraded' | 'unavailable';
            }>;
            referenceDate: string;
            window: { lookaheadDays: number; lookbackDays: number };
        }>('news-catalyst-window.json');

        for (const testCase of fixture.cases) {
            const actual = evaluateNewsCatalystWindow({
                events: testCase.events,
                lookaheadDays: fixture.window.lookaheadDays,
                lookbackDays: fixture.window.lookbackDays,
                providerStatus: testCase.providerStatus,
                referenceDate: fixture.referenceDate,
            });

            expect(actual.inCatalystWindow, testCase.name).toBe(testCase.expectedInCatalystWindow);
        }
    });
});