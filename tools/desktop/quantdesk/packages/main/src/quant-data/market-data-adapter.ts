import type { AssetLookupResult, DailyPriceRecord, PriceRangeQuery } from '@quantdesk/shared';

import type {
    MarketDataPort,
    FetchFxRatesRequest,
    FetchPricesRequest,
    MarketDataFxFetchResult,
    MarketDataPriceFetchResult,
    SearchAssetsRequest,
    SidecarFxRow,
    SidecarPriceRow,
} from '../sidecar/market-data-port';
import { QuantDataCliClient } from './client';

interface QuantDataPriceRow {
    adjustedClose?: number | null;
    calculationClose?: number | null;
    close?: number | null;
    date: string;
    high?: number | null;
    low?: number | null;
    open?: number | null;
    source: string;
    volume?: number | null;
}

interface QuantDataPriceSeriesResult {
    attemptedSources?: string[];
    prices?: QuantDataPriceRow[];
    symbol?: string;
    warnings?: string[];
}

interface QuantDataReadPricesResult {
    assetId?: string;
    prices?: DailyPriceRecord[];
}

interface QuantDataFxRow {
    date: string;
    rate: number;
    source: string;
}

interface QuantDataFxRatesResult {
    attemptedSources?: string[];
    pair?: string;
    rates?: QuantDataFxRow[];
    warnings?: string[];
}

export interface QuantDataProviderConfigurationStatus {
    code: string | null;
    message: string | null;
    ready: boolean;
}

export interface QuantDataStatusResult {
    providerConfiguration?: QuantDataProviderConfigurationStatus;
    stats?: {
        fxRateRowCount?: number;
        latestPriceFetchAt?: string | null;
        priceRowCount?: number;
    };
    storePath?: string;
    storeVersion?: number;
}

export class QuantDataMarketDataPort implements MarketDataPort {
    private readonly fallback: MarketDataPort;

    private readonly quantData: QuantDataMarketDataAdapter;

    constructor({
        fallback,
        quantData = new QuantDataMarketDataAdapter(),
    }: {
        fallback: MarketDataPort;
        quantData?: QuantDataMarketDataAdapter;
    }) {
        this.fallback = fallback;
        this.quantData = quantData;
    }

    async searchAssets(request: SearchAssetsRequest): Promise<AssetLookupResult[]> {
        return await this.quantData.searchAssets(request);
    }

    async fetchPrices(request: FetchPricesRequest): Promise<MarketDataPriceFetchResult> {
        return await this.quantData.fetchPrices(request);
    }

    async fetchFxRates(request: FetchFxRatesRequest): Promise<MarketDataFxFetchResult> {
        return await this.quantData.fetchFxRates(request);
    }

    searchNewsCatalysts: MarketDataPort['searchNewsCatalysts'] = async (request) => await this.fallback.searchNewsCatalysts(request);

    searchAnnouncements: MarketDataPort['searchAnnouncements'] = async (request) => await this.fallback.searchAnnouncements(request);

    fetchMarketSource: MarketDataPort['fetchMarketSource'] = async (request) => await this.fallback.fetchMarketSource(request);

    fetchFundamentals: MarketDataPort['fetchFundamentals'] = async (request) => await this.fallback.fetchFundamentals(request);

    fetchFlowSentiment: MarketDataPort['fetchFlowSentiment'] = async (request) => await this.fallback.fetchFlowSentiment(request);
}

export class QuantDataMarketDataAdapter {
    private readonly client: QuantDataCliClient;

    constructor(client = new QuantDataCliClient()) {
        this.client = client;
    }

    async searchAssets(request: SearchAssetsRequest): Promise<AssetLookupResult[]> {
        const envelope = await this.client.run<AssetLookupResult[]>('search-assets', {
            ...(request.market === undefined ? {} : { market: request.market }),
            query: request.query,
        });

        return envelope.data ?? [];
    }

    async fetchPrices(request: FetchPricesRequest): Promise<MarketDataPriceFetchResult> {
        const envelope = await this.client.run<QuantDataPriceSeriesResult>('get-price-series', {
            ...(request.assetId === undefined ? {} : { assetId: request.assetId }),
            end: request.end,
            ...(request.market === undefined ? {} : { market: request.market }),
            start: request.start,
            symbol: request.symbol,
        });
        const data = envelope.data ?? {};

        return {
            attemptedSources: data.attemptedSources ?? [],
            prices: (data.prices ?? []).map(mapPriceRow),
            symbol: data.symbol ?? request.symbol,
            warnings: data.warnings ?? [],
        };
    }

    async fetchFxRates(request: FetchFxRatesRequest): Promise<MarketDataFxFetchResult> {
        const envelope = await this.client.run<QuantDataFxRatesResult>('get-fx-rates', {
            end: request.end,
            pair: request.pair,
            start: request.start,
        });
        const data = envelope.data ?? {};

        return {
            attemptedSources: data.attemptedSources ?? [],
            pair: data.pair ?? request.pair,
            rates: (data.rates ?? []).map(mapFxRow),
            warnings: data.warnings ?? [],
        };
    }

    async getStatus(): Promise<QuantDataStatusResult> {
        const envelope = await this.client.run<QuantDataStatusResult>('status');
        return envelope.data ?? {};
    }

    async listByAsset(assetId: string): Promise<DailyPriceRecord[]> {
        const envelope = await this.client.run<QuantDataReadPricesResult>('read-prices', { assetId });
        return envelope.data?.prices ?? [];
    }

    async getRange(query: PriceRangeQuery): Promise<DailyPriceRecord[]> {
        const envelope = await this.client.run<QuantDataReadPricesResult>('read-prices', {
            assetId: query.assetId,
            end: query.endDate,
            start: query.startDate,
        });

        return envelope.data?.prices ?? [];
    }
}

const mapPriceRow = (row: QuantDataPriceRow): SidecarPriceRow => ({
    adjusted_close: row.calculationClose ?? row.adjustedClose ?? null,
    close: row.close ?? null,
    date: row.date,
    high: row.high ?? null,
    low: row.low ?? null,
    open: row.open ?? null,
    source: row.source,
    volume: row.volume ?? null,
});

const mapFxRow = (row: QuantDataFxRow): SidecarFxRow => ({
    date: row.date,
    rate: row.rate,
    source: row.source,
});
