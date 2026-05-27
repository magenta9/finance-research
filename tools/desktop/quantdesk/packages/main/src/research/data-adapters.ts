import type { ResearchDataSourceSnapshot, ResearchRole } from '@quantdesk/shared';

export type ResearchDataAdapterStatus = 'available' | 'degraded' | 'unavailable' | 'contract';

export interface ResearchDataAdapterQuery {
    assetIds: string[];
    query: string;
    role: ResearchRole;
}

export interface ResearchDataAdapterResult {
    evidence: Array<{
        label: string;
        sourceId: string;
        summary: string;
    }>;
    status: ResearchDataAdapterStatus;
    warnings: string[];
}

export interface ResearchDataAdapterContract {
    capabilities: string[];
    cost: NonNullable<ResearchDataSourceSnapshot['cost']>;
    coverage: NonNullable<ResearchDataSourceSnapshot['coverage']>;
    failureModes: string[];
    freshness: NonNullable<ResearchDataSourceSnapshot['freshness']>;
    id: string;
    label: string;
    providerIds: string[];
    roleAffinity: ResearchRole[];
    status: ResearchDataAdapterStatus;
    toolNames: string[];
    unavailableReason: string | null;
}

const unavailableFreshness: NonNullable<ResearchDataSourceSnapshot['freshness']> = {
    asOf: null,
    expectedLag: null,
    status: 'unavailable',
};

export const researchDataAdapterContracts: ResearchDataAdapterContract[] = [
    {
        capabilities: [
            'asset_identification',
            'financial_summary',
            'valuation_metrics',
            'earnings_quality',
            'provider_provenance',
        ],
        cost: 'unknown',
        coverage: {
            assetClasses: ['equity'],
            markets: ['A', 'HK', 'US'],
            notes: ['Executable provider-backed snapshot tool is registered; coverage may degrade by asset type.'],
        },
        failureModes: ['provider_disabled', 'provider_unavailable', 'asset_not_covered', 'stale_financials'],
        freshness: unavailableFreshness,
        id: 'provider.fundamentals',
        label: 'Fundamentals provider',
        providerIds: ['research-provider.fundamentals'],
        roleAffinity: ['fundamental'],
        status: 'degraded',
        toolNames: ['get_fundamental_snapshot'],
        unavailableReason: null,
    },
    {
        capabilities: [
            'news_search',
            'exchange_announcements',
            'catalyst_events',
            'source_link_or_local_reference',
            'credibility_status',
        ],
        cost: 'unknown',
        coverage: {
            assetClasses: ['equity', 'fixed_income', 'commodity', 'alternative'],
            markets: ['A', 'HK', 'US'],
            notes: [
                'Executable source search/fetch tools are registered; snippets are not evidence until fetched.',
                'Enabled disclosure providers: cninfo, eastmoney_notice, hkexnews, hsi_index_notices, sec_edgar. Planned enhancements: sse_disclosure, sec_efts.',
            ],
        },
        failureModes: ['provider_disabled', 'provider_unavailable', 'rate_limited', 'source_not_covered'],
        freshness: unavailableFreshness,
        id: 'provider.news_catalysts',
        label: 'News and catalyst provider',
        providerIds: ['cninfo', 'eastmoney_notice', 'hkexnews', 'hsi_index_notices', 'sec_edgar'],
        roleAffinity: ['fundamental', 'macro'],
        status: 'degraded',
        toolNames: ['search_news_catalysts', 'search_market_sources', 'fetch_market_source', 'search_announcements'],
        unavailableReason: null,
    },
    {
        capabilities: [
            'fx_rates',
            'rates_proxy',
            'inflation_proxy',
            'market_index_proxy',
            'liquidity_proxy',
        ],
        cost: 'unknown',
        coverage: {
            assetClasses: ['equity', 'fixed_income', 'commodity', 'cash'],
            markets: ['A', 'HK', 'US', 'BOND', 'COMMODITY'],
            notes: ['Executable macro snapshot tool is registered; missing series return degraded provider status.'],
        },
        failureModes: ['provider_disabled', 'provider_unavailable', 'series_not_covered', 'stale_macro_series'],
        freshness: unavailableFreshness,
        id: 'provider.macro',
        label: 'Macro provider',
        providerIds: ['research-provider.macro'],
        roleAffinity: ['allocation', 'macro', 'risk'],
        status: 'degraded',
        toolNames: ['get_macro_series_snapshot'],
        unavailableReason: null,
    },
    {
        capabilities: [
            'etf_flow',
            'volume_price_proxy',
            'news_sentiment',
            'external_sentiment_source',
            'provider_provenance',
        ],
        cost: 'unknown',
        coverage: {
            assetClasses: ['equity', 'fixed_income', 'commodity', 'alternative'],
            markets: ['A', 'HK', 'US', 'BOND', 'COMMODITY'],
            notes: ['Executable flow/sentiment snapshot tool is registered; sentiment may degrade to local liquidity proxies.'],
        },
        failureModes: ['provider_disabled', 'provider_unavailable', 'source_not_covered', 'sentiment_model_unavailable'],
        freshness: unavailableFreshness,
        id: 'provider.flow_sentiment',
        label: 'Flow and sentiment provider',
        providerIds: ['research-provider.flow_sentiment'],
        roleAffinity: ['flow_sentiment'],
        status: 'degraded',
        toolNames: ['get_flow_sentiment_snapshot'],
        unavailableReason: null,
    },
];

export const adapterContractToDataSource = (contract: ResearchDataAdapterContract): ResearchDataSourceSnapshot => ({
    capabilities: contract.capabilities,
    cost: contract.cost,
    coverage: contract.coverage,
    failureModes: contract.failureModes,
    freshness: contract.freshness,
    id: contract.id,
    kind: 'provider',
    label: contract.label,
    providerIds: contract.providerIds,
    qualityStatus: contract.status === 'available' ? 'pass' : 'warn',
    roleAffinity: contract.roleAffinity,
    status: contract.status === 'available' || contract.status === 'degraded' || contract.status === 'unavailable'
        ? contract.status
        : 'degraded',
    toolNames: contract.toolNames,
    warnings: contract.unavailableReason ? [contract.unavailableReason] : [],
});
