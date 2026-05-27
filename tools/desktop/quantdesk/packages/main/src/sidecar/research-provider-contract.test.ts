import { afterEach, describe, expect, test } from 'vitest';

import { resetMarketDataContractsCacheForTests } from './market-data-contracts';
import {
    getFlowSentimentProviderOrder,
    getFundamentalsProviderOrder,
    loadResearchProviderFixture,
    loadResearchProviderPolicy,
    resetResearchProviderContractsCacheForTests,
} from './research-provider-contracts';
import type { ResearchProviderId } from './market-data-port';

afterEach(() => {
    resetMarketDataContractsCacheForTests();
    resetResearchProviderContractsCacheForTests();
});

describe('research provider contracts', () => {
    test('loads the shared research provider policy artifact', () => {
        const policy = loadResearchProviderPolicy();

        expect(policy.schemaVersion).toBe(1);
        expect(policy.providerStatus.akshare).toBe('enabled');
        expect(policy.fundamentalsProviderOrder.A).toEqual(['tushare', 'akshare']);
        expect(policy.flowSentimentProviderOrder.A).toEqual(['tushare', 'akshare']);
        expect(policy.fieldCaveats.northboundNetInflow).toBe('disclosure_policy_change_2024');
        expect(policy.freshness.fundamentalsStaleAfterDays).toBe(180);
    });

    test('keeps provider routing aligned with the shared fixture corpus', () => {
        const fixture = loadResearchProviderFixture<{
            cases: Array<{
                enabledProviders: ResearchProviderId[];
                expectedProviders: ResearchProviderId[];
                kind: 'flow_sentiment' | 'fundamentals';
                market: string | null;
                name: string;
            }>;
        }>('research-provider-routing.json');

        for (const testCase of fixture.cases) {
            const actual = testCase.kind === 'fundamentals'
                ? getFundamentalsProviderOrder({
                    enabledProviders: testCase.enabledProviders,
                    market: testCase.market,
                })
                : getFlowSentimentProviderOrder({
                    enabledProviders: testCase.enabledProviders,
                    market: testCase.market,
                });

            expect(actual, testCase.name).toEqual(testCase.expectedProviders);
        }
    });
});