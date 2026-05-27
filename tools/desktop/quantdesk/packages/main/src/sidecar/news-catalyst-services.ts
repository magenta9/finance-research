import type { StoredAsset } from '@quantdesk/shared';

import type { DataServices } from '../db/services';
import type {
    FetchedMarketSource,
    MarketSourceReference,
    MarketSourceService,
    ResearchProviderService,
    ResearchProviderSnapshot,
} from '../agent/capabilities/finance';
import type { MarketDataPort, NewsCatalystSearchResult } from './market-data-port';
import {
    getNewsCatalystProviderOrder,
    loadNewsCatalystPolicy,
    resolveNewsCatalystSymbolMarket,
} from './news-catalyst-contracts';

interface NewsCatalystServiceOptions {
    dataServices: DataServices;
    marketDataPort: MarketDataPort;
}

interface ResolvedNewsCatalystRequest {
    assetMetadata?: Record<string, unknown>;
    enabledProviders: ReturnType<typeof getNewsCatalystProviderOrder>;
    market?: string;
    symbol: string;
    warnings: string[];
}

const resolveAssetBySymbol = (dataServices: DataServices, symbol: string): StoredAsset | null => {
    const normalized = symbol.trim().toLowerCase();

    if (!normalized) {
        return null;
    }

    return dataServices.repositories.assetRepository.list()
        .find((asset) => asset.symbol.toLowerCase() === normalized)
        ?? dataServices.repositories.assetRepository.search(symbol)[0]
        ?? null;
};

const firstQueryToken = (query: string) => query.trim().split(/\s+/u)[0] ?? '';

const buildAssetMetadata = (asset: StoredAsset | null) => asset
    ? {
        ...asset.metadata,
        market: asset.market,
    }
    : undefined;

const resolveNewsCatalystRequest = (
    dataServices: DataServices,
    request: { market?: string; query: string; symbol?: string },
): ResolvedNewsCatalystRequest => {
    const symbolCandidate = request.symbol?.trim() || firstQueryToken(request.query);
    const asset = resolveAssetBySymbol(dataServices, symbolCandidate);
    const assetMetadata = buildAssetMetadata(asset);
    const resolution = resolveNewsCatalystSymbolMarket({
        assetMetadata,
        market: request.market ?? asset?.market,
        symbol: asset?.symbol ?? symbolCandidate,
    });

    return {
        ...(assetMetadata === undefined ? {} : { assetMetadata }),
        enabledProviders: getNewsCatalystProviderOrder({ market: resolution.market }),
        ...(resolution.market === null ? {} : { market: resolution.market }),
        symbol: resolution.symbol,
        warnings: resolution.warnings,
    };
};

const summarizeWindowStatus = (value: NewsCatalystSearchResult['inCatalystWindow']) => {
    if (value === 'unknown') {
        return '窗口状态未知';
    }

    return value ? '处于催化窗口' : '未处于催化窗口';
};

const snapshotFromNewsCatalysts = (
    result: NewsCatalystSearchResult,
    extraWarnings: string[],
): ResearchProviderSnapshot => {
    const warnings = [
        ...extraWarnings,
        ...result.warnings,
        'News catalyst search results are source references, not evidence; call fetch_market_source before citing factual claims.',
        'If a source reference is directly material to the user request, fetch_market_source should be called next without asking for permission.',
    ];

    return {
        dataProvenance: [],
        payload: {
            ...result,
            warnings,
        },
        providerIds: result.attemptedSources,
        status: result.qualityStatus,
        summary: `新闻催化搜索返回 ${result.events.length} 条事件，${summarizeWindowStatus(result.inCatalystWindow)}。`,
        warnings,
    };
};

export const createNewsCatalystServices = ({
    dataServices,
    marketDataPort,
}: NewsCatalystServiceOptions): {
    marketSourceService: MarketSourceService;
    researchProviderService: Pick<ResearchProviderService, 'searchNewsCatalysts'>;
} => {
    const policy = loadNewsCatalystPolicy();

    const searchAnnouncements = async (request: { market?: string; query: string; symbol?: string }): Promise<MarketSourceReference[]> => {
        const resolved = resolveNewsCatalystRequest(dataServices, request);

        return await marketDataPort.searchAnnouncements({
            ...(resolved.assetMetadata === undefined ? {} : { assetMetadata: resolved.assetMetadata }),
            enabledProviders: resolved.enabledProviders,
            market: resolved.market,
            query: request.query,
            symbol: resolved.symbol,
        });
    };

    return {
        marketSourceService: {
            fetchSource: async (request): Promise<FetchedMarketSource> => await marketDataPort.fetchMarketSource(request),
            searchAnnouncements,
            searchSources: searchAnnouncements,
        },
        researchProviderService: {
            searchNewsCatalysts: async (request) => {
                const resolved = resolveNewsCatalystRequest(dataServices, request);
                const result = await marketDataPort.searchNewsCatalysts({
                    ...(resolved.assetMetadata === undefined ? {} : { assetMetadata: resolved.assetMetadata }),
                    enabledProviders: resolved.enabledProviders,
                    lookaheadDays: policy.windowDefaults.lookaheadDays,
                    lookbackDays: policy.windowDefaults.lookbackDays,
                    market: resolved.market,
                    query: request.query,
                    symbol: resolved.symbol,
                });

                return snapshotFromNewsCatalysts(result, resolved.warnings);
            },
        },
    };
};