import { describe, expect, test } from 'vitest';

import { adapterContractToDataSource, researchDataAdapterContracts } from './data-adapters';

const contractById = (id: string) => {
    const contract = researchDataAdapterContracts.find((item) => item.id === id);

    if (!contract) {
        throw new Error(`Missing data adapter contract: ${id}`);
    }

    return contract;
};

describe('research data adapter contracts', () => {
    test('declares executable degraded providers for external research data gaps', () => {
        expect(contractById('provider.fundamentals')).toEqual(expect.objectContaining({
            capabilities: expect.arrayContaining(['financial_summary', 'valuation_metrics', 'earnings_quality']),
            failureModes: expect.arrayContaining(['provider_disabled', 'asset_not_covered']),
            status: 'degraded',
            toolNames: ['get_fundamental_snapshot'],
        }));
        expect(contractById('provider.news_catalysts')).toEqual(expect.objectContaining({
            capabilities: expect.arrayContaining(['news_search', 'exchange_announcements', 'catalyst_events']),
            failureModes: expect.arrayContaining(['provider_unavailable', 'rate_limited']),
            status: 'degraded',
            toolNames: expect.arrayContaining(['search_news_catalysts', 'fetch_market_source']),
        }));
        expect(contractById('provider.macro')).toEqual(expect.objectContaining({
            capabilities: expect.arrayContaining(['fx_rates', 'market_index_proxy', 'liquidity_proxy']),
            failureModes: expect.arrayContaining(['series_not_covered', 'stale_macro_series']),
            status: 'degraded',
            toolNames: ['get_macro_series_snapshot'],
        }));
        expect(contractById('provider.flow_sentiment')).toEqual(expect.objectContaining({
            capabilities: expect.arrayContaining(['etf_flow', 'volume_price_proxy', 'news_sentiment']),
            failureModes: expect.arrayContaining(['source_not_covered', 'sentiment_model_unavailable']),
            status: 'degraded',
            toolNames: ['get_flow_sentiment_snapshot'],
        }));
    });

    test('projects adapter contracts into executable data source snapshots with visible data gaps', () => {
        const source = adapterContractToDataSource(contractById('provider.fundamentals'));

        expect(source).toEqual(expect.objectContaining({
            capabilities: expect.arrayContaining(['financial_summary']),
            coverage: expect.objectContaining({ markets: expect.arrayContaining(['A', 'HK', 'US']) }),
            failureModes: expect.arrayContaining(['provider_unavailable']),
            freshness: { asOf: null, expectedLag: null, status: 'unavailable' },
            qualityStatus: 'warn',
            status: 'degraded',
            toolNames: ['get_fundamental_snapshot'],
            warnings: [],
        }));
    });
    test('exposes provider adapters as warn-level degraded data sources', () => {
        expect(researchDataAdapterContracts.map((contract) => contract.id)).toEqual([
            'provider.fundamentals',
            'provider.news_catalysts',
            'provider.macro',
            'provider.flow_sentiment',
        ]);

        expect(adapterContractToDataSource(researchDataAdapterContracts[0])).toEqual(expect.objectContaining({
            id: 'provider.fundamentals',
            kind: 'provider',
            qualityStatus: 'warn',
            status: 'degraded',
        }));
    });
});
