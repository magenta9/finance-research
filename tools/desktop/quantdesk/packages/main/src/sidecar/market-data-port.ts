import type { AssetLookupResult, DataSourceId, Market } from '@quantdesk/shared';

export interface SidecarPriceRow {
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    adjusted_close: number | null;
    source: string;
}

export interface MarketDataPriceFetchResult {
    symbol: string;
    prices: SidecarPriceRow[];
    attemptedSources: string[];
    warnings: string[];
}

export interface SidecarFxRow {
    date: string;
    rate: number;
    source: string;
}

export interface MarketDataFxFetchResult {
    pair: string;
    rates: SidecarFxRow[];
    attemptedSources: string[];
    warnings: string[];
}

export type ResearchProviderId = 'akshare' | 'tushare' | 'yfinance';
export type ResearchProviderErrorType = 'network' | 'parse' | 'permission' | 'rate_limit' | 'unknown';

export interface ResearchProviderError {
    disabledUntil?: string | null;
    errorType: ResearchProviderErrorType;
    message: string;
    providerId: ResearchProviderId;
}

export interface ResearchProviderProvenance {
    fetchedAt: string | null;
    providerIds?: string[];
    qualityStatus: 'block' | 'pass' | 'warn';
    rowsUsed?: number | null;
    sourceId: string;
    warnings: string[];
}

export interface FundamentalPeriodMetrics {
    fiscalPeriod: string | null;
    reportDate: string | null;
}

export interface FundamentalUnderlyingValuation {
    asOf?: string;
    dividendYield?: number | null;
    indexCode?: string;
    indexName?: string;
    peTtm?: number | null;
    providerId?: ResearchProviderId | 'asset_metadata';
    sourceId?: string;
    status: 'available' | 'not_configured' | 'not_covered' | 'unavailable';
}

export interface FundamentalFundFacts {
    assetClass?: string;
    assetName?: string;
    fundType?: string;
    issuerStyleFundamentals: 'asset_not_covered';
    issueDate?: string;
    underlyingValuation?: FundamentalUnderlyingValuation;
    underlyingMarket?: string;
}

export interface FundamentalMetrics {
    fundFacts?: FundamentalFundFacts;
    period: FundamentalPeriodMetrics;
    [key: string]: unknown;
}

export interface FundamentalSnapshotResult {
    asOf: string | null;
    attemptedSources: ResearchProviderId[];
    dataAgeDays: number | null;
    dataProvenance: ResearchProviderProvenance[];
    market: string | null;
    metrics: FundamentalMetrics;
    providerErrors: ResearchProviderError[];
    qualityStatus: 'available' | 'degraded' | 'unavailable';
    symbol: string;
    warnings: string[];
}

export interface FlowSentimentSnapshotResult {
    asOf: string | null;
    attemptedSources: ResearchProviderId[];
    dataProvenance: ResearchProviderProvenance[];
    market: string | null;
    providerErrors: ResearchProviderError[];
    qualityStatus: 'available' | 'degraded' | 'unavailable';
    signals: Record<string, unknown>;
    symbol: string | null;
    warnings: string[];
}

export type NewsCatalystProviderId = 'cninfo' | 'eastmoney_notice' | 'sse_disclosure' | 'hkexnews' | 'hsi_index_notices' | 'sec_edgar' | 'sec_efts';
export type NewsCatalystCredibilityStatus = 'aggregator' | 'official' | 'provider' | 'unknown';
export type NewsCatalystCategory =
    | 'buyback'
    | 'contract_order'
    | 'dividend'
    | 'earnings_result'
    | 'guidance_forecast'
    | 'issuance_listing'
    | 'litigation_regulatory'
    | 'major_transaction'
    | 'management_change'
    | 'operation_update'
    | 'other'
    | 'shareholder_meeting'
    | 'suspension_resumption';

export interface NewsCatalystEvent {
    category: NewsCatalystCategory;
    confidence: 'high' | 'low' | 'medium';
    contentHash: string;
    credibilityStatus: NewsCatalystCredibilityStatus;
    eventDate: string | null;
    eventId: string;
    evidenceEligible: false;
    fetchedAt: string;
    market: string | null;
    providerId: NewsCatalystProviderId;
    publishedAt: string | null;
    snippet: string;
    sourceId: string;
    symbol: string;
    title: string;
    url: string;
}

export interface NewsCatalystWindow {
    endDate: string;
    lookaheadDays: number;
    lookbackDays: number;
    referenceDate: string;
    startDate: string;
}

export interface NewsCatalystProviderError {
    message: string;
    providerId: NewsCatalystProviderId;
}

export interface SearchNewsCatalystsRequest {
    assetMetadata?: Record<string, unknown>;
    enabledProviders: NewsCatalystProviderId[];
    lookaheadDays?: number;
    lookbackDays?: number;
    market?: Market | string;
    query: string;
    referenceDate?: string;
    symbol?: string;
}

export interface NewsCatalystSearchResult {
    attemptedSources: NewsCatalystProviderId[];
    coverageNotes: string[];
    events: NewsCatalystEvent[];
    inCatalystWindow: boolean | 'unknown';
    market: string | null;
    providerErrors: NewsCatalystProviderError[];
    qualityStatus: 'available' | 'degraded' | 'unavailable';
    symbol: string;
    warnings: string[];
    window: NewsCatalystWindow;
}

export interface MarketSourceReferenceResult {
    credibilityStatus: NewsCatalystCredibilityStatus;
    evidenceEligible: false;
    providerId: NewsCatalystProviderId;
    publishedAt: string | null;
    snippet: string;
    sourceId: string;
    title: string;
    url: string;
}

export interface SearchAnnouncementsRequest {
    assetMetadata?: Record<string, unknown>;
    enabledProviders: NewsCatalystProviderId[];
    market?: Market | string;
    query: string;
    symbol?: string;
}

export interface FetchMarketSourceRequest {
    sourceId?: string;
    url?: string;
}

export interface FetchedMarketSourceResult {
    contentHash: string;
    evidenceEligible: true;
    fetchedAt: string;
    provenance: Array<{
        fetchedAt: string | null;
        providerIds?: string[];
        qualityStatus: 'block' | 'pass' | 'warn';
        rowsUsed?: number | null;
        sourceId: string;
        warnings: string[];
    }>;
    sourceId: string;
    summary: string;
    textPreview?: string;
    title: string;
    url: string;
}

export interface SearchAssetsRequest {
    query: string;
    market?: Market | string;
    enabledSources: DataSourceId[];
}

export interface FetchPricesRequest {
    assetId?: string;
    symbol: string;
    start: string;
    end: string;
    market?: Market | string;
    enabledSources: DataSourceId[];
    assetMetadata?: Record<string, unknown>;
}

export interface FetchFxRatesRequest {
    pair: string;
    start: string;
    end: string;
    enabledSources: DataSourceId[];
}

export interface FetchFundamentalsRequest {
    assetMetadata?: Record<string, unknown>;
    enabledProviders: ResearchProviderId[];
    market?: Market | string | null;
    symbol: string;
}

export interface FetchFlowSentimentRequest {
    assetMetadata?: Record<string, unknown>;
    enabledProviders: ResearchProviderId[];
    market?: Market | string | null;
    symbol?: string | null;
}

export interface MarketDataPort {
    fetchFlowSentiment: (request: FetchFlowSentimentRequest) => Promise<FlowSentimentSnapshotResult>;
    fetchFundamentals: (request: FetchFundamentalsRequest) => Promise<FundamentalSnapshotResult>;
    fetchMarketSource: (request: FetchMarketSourceRequest) => Promise<FetchedMarketSourceResult>;
    searchAssets: (request: SearchAssetsRequest) => Promise<AssetLookupResult[]>;
    searchAnnouncements: (request: SearchAnnouncementsRequest) => Promise<MarketSourceReferenceResult[]>;
    searchNewsCatalysts: (request: SearchNewsCatalystsRequest) => Promise<NewsCatalystSearchResult>;
    fetchPrices: (request: FetchPricesRequest) => Promise<MarketDataPriceFetchResult>;
    fetchFxRates: (request: FetchFxRatesRequest) => Promise<MarketDataFxFetchResult>;
}