import type { AssetLookupResult } from '@quantdesk/shared';

import type {
    FetchMarketSourceRequest,
    FetchFlowSentimentRequest,
    FetchFxRatesRequest,
    FetchFundamentalsRequest,
    FetchPricesRequest,
    FetchedMarketSourceResult,
    FlowSentimentSnapshotResult,
    FundamentalSnapshotResult,
    MarketDataFxFetchResult,
    MarketDataPort,
    MarketDataPriceFetchResult,
    MarketSourceReferenceResult,
    NewsCatalystSearchResult,
    SearchAssetsRequest,
    SearchAnnouncementsRequest,
    SearchNewsCatalystsRequest,
} from './market-data-port';
import type { SidecarRpc } from './runtime-types';

export class SidecarMarketDataAdapter implements MarketDataPort {
    private readonly rpc: SidecarRpc;

    constructor(rpc: SidecarRpc) {
        this.rpc = rpc;
    }

    async searchAssets(request: SearchAssetsRequest): Promise<AssetLookupResult[]> {
        return await this.rpc.call<AssetLookupResult[]>('search_assets', {
            enabledSources: request.enabledSources,
            market: request.market,
            query: request.query,
        });
    }

    async searchNewsCatalysts(request: SearchNewsCatalystsRequest): Promise<NewsCatalystSearchResult> {
        return await this.rpc.call<NewsCatalystSearchResult>('search_news_catalysts', {
            ...(request.assetMetadata === undefined ? {} : { assetMetadata: request.assetMetadata }),
            enabledProviders: request.enabledProviders,
            ...(request.lookaheadDays === undefined ? {} : { lookaheadDays: request.lookaheadDays }),
            ...(request.lookbackDays === undefined ? {} : { lookbackDays: request.lookbackDays }),
            market: request.market,
            query: request.query,
            ...(request.referenceDate === undefined ? {} : { referenceDate: request.referenceDate }),
            symbol: request.symbol,
        });
    }

    async searchAnnouncements(request: SearchAnnouncementsRequest): Promise<MarketSourceReferenceResult[]> {
        return await this.rpc.call<MarketSourceReferenceResult[]>('search_announcements', {
            ...(request.assetMetadata === undefined ? {} : { assetMetadata: request.assetMetadata }),
            enabledProviders: request.enabledProviders,
            market: request.market,
            query: request.query,
            symbol: request.symbol,
        });
    }

    async fetchMarketSource(request: FetchMarketSourceRequest): Promise<FetchedMarketSourceResult> {
        return await this.rpc.call<FetchedMarketSourceResult>('fetch_market_source', {
            sourceId: request.sourceId,
            url: request.url,
        });
    }

    async fetchFundamentals(request: FetchFundamentalsRequest): Promise<FundamentalSnapshotResult> {
        return await this.rpc.call<FundamentalSnapshotResult>('fetch_fundamentals', {
            ...(request.assetMetadata === undefined ? {} : { assetMetadata: request.assetMetadata }),
            enabledProviders: request.enabledProviders,
            market: request.market,
            symbol: request.symbol,
        });
    }

    async fetchFlowSentiment(request: FetchFlowSentimentRequest): Promise<FlowSentimentSnapshotResult> {
        return await this.rpc.call<FlowSentimentSnapshotResult>('fetch_flow_sentiment', {
            ...(request.assetMetadata === undefined ? {} : { assetMetadata: request.assetMetadata }),
            enabledProviders: request.enabledProviders,
            market: request.market,
            symbol: request.symbol,
        });
    }

    async fetchPrices(request: FetchPricesRequest): Promise<MarketDataPriceFetchResult> {
        return await this.rpc.call<MarketDataPriceFetchResult>('fetch_prices', {
            ...(request.assetMetadata === undefined ? {} : { assetMetadata: request.assetMetadata }),
            enabledSources: request.enabledSources,
            end: request.end,
            market: request.market,
            start: request.start,
            symbol: request.symbol,
        });
    }

    async fetchFxRates(request: FetchFxRatesRequest): Promise<MarketDataFxFetchResult> {
        return await this.rpc.call<MarketDataFxFetchResult>('fetch_fx_rates', {
            enabledSources: request.enabledSources,
            end: request.end,
            pair: request.pair,
            start: request.start,
        });
    }
}
