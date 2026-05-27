import type { DataSourceId, StoredAsset } from '@quantdesk/shared';

import type { DataServices } from '../db/services';
import type { ResearchProviderService, ResearchProviderSnapshot } from '../agent/capabilities/finance';
import type {
    FlowSentimentSnapshotResult,
    FundamentalSnapshotResult,
    MarketDataPort,
    ResearchProviderId,
} from './market-data-port';
import { getEnabledDataProviderIds, getEnabledFxSources, getEnabledPriceSources } from './provider-config';
import {
    getFlowSentimentProviderOrder,
    getFundamentalsProviderOrder,
    loadResearchProviderPolicy,
} from './research-provider-contracts';

interface ResearchProviderServiceOptions {
    dataServices: DataServices;
    marketDataPort: MarketDataPort;
}

interface ResolvedResearchProviderRequest {
    assetMetadata?: Record<string, unknown>;
    enabledProviders: ResearchProviderId[];
    market?: string | null;
    symbol: string;
    warnings: string[];
}

const isResearchProviderId = (value: DataSourceId): value is ResearchProviderId => (
    value === 'akshare' || value === 'tushare' || value === 'yfinance'
);

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

const buildAssetMetadata = (asset: StoredAsset | null) => asset
    ? {
        ...asset.metadata,
        assetClass: asset.assetClass,
        currency: asset.currency,
        market: asset.market,
        name: asset.name,
        symbol: asset.symbol,
    }
    : undefined;

const configuredResearchProviders = (dataServices: DataServices): ResearchProviderId[] => getEnabledDataProviderIds(
    dataServices.repositories.preferencesRepository,
).filter(isResearchProviderId);

const resolveRequest = (
    dataServices: DataServices,
    request: { market?: string; symbol?: string | null },
    selectProviders: (input: { enabledProviders: ResearchProviderId[]; market?: string | null }) => ResearchProviderId[],
): ResolvedResearchProviderRequest => {
    const symbol = request.symbol?.trim() ?? '';
    const asset = symbol ? resolveAssetBySymbol(dataServices, symbol) : null;
    const market = request.market ?? asset?.market ?? null;
    const assetMetadata = buildAssetMetadata(asset);
    const warnings = market === null
        ? [`Unable to resolve market for ${symbol || 'request'}; pass explicit market or add the asset first.`]
        : [];

    return {
        ...(assetMetadata === undefined ? {} : { assetMetadata }),
        enabledProviders: selectProviders({
            enabledProviders: configuredResearchProviders(dataServices),
            market,
        }) as ResearchProviderId[],
        market,
        symbol,
        warnings,
    };
};

const mergeWarnings = (...groups: string[][]) => Array.from(new Set(groups.flat()));

const statusLabel = (status: FundamentalSnapshotResult['qualityStatus'] | FlowSentimentSnapshotResult['qualityStatus']) => {
    if (status === 'available') {
        return '可用';
    }

    if (status === 'degraded') {
        return '降级';
    }

    return '不可用';
};

const isFundFactsOnlySnapshot = (result: FundamentalSnapshotResult) => (
    (result.metrics.fundFacts as { issuerStyleFundamentals?: unknown } | undefined)?.issuerStyleFundamentals === 'asset_not_covered'
);

const underlyingValuationStatus = (result: FundamentalSnapshotResult) => (
    (result.metrics.fundFacts as { underlyingValuation?: { status?: unknown } } | undefined)?.underlyingValuation?.status
);

const snapshotFromFundamentals = (
    result: FundamentalSnapshotResult,
    extraWarnings: string[],
): ResearchProviderSnapshot => {
    const warnings = mergeWarnings(extraWarnings, result.warnings);

    return {
        dataProvenance: result.dataProvenance,
        payload: {
            ...result,
            warnings,
        },
        providerIds: result.attemptedSources,
        status: result.qualityStatus,
        summary: isFundFactsOnlySnapshot(result)
            ? underlyingValuationStatus(result) === 'available'
                ? `基本面快照${statusLabel(result.qualityStatus)}：${result.symbol || 'unknown'} 是 ETF/基金类标的，股票发行人基本面不适用；已返回 fundFacts 和 AkShare 底层指数 PE/股息率估值，PB 未覆盖。`
                : `基本面快照${statusLabel(result.qualityStatus)}：${result.symbol || 'unknown'} 是 ETF/基金类标的，股票发行人基本面不适用；已返回 fundFacts 元数据，未提供 PE/PB/ROE。指数估值需要独立估值数据源。`
            : `基本面快照${statusLabel(result.qualityStatus)}：${result.symbol || 'unknown'}，${result.attemptedSources.length} 个 provider，${warnings.length} 个警告。`,
        warnings,
    };
};

const snapshotFromFlowSentiment = (
    result: FlowSentimentSnapshotResult,
    extraWarnings: string[],
): ResearchProviderSnapshot => {
    const warnings = mergeWarnings(extraWarnings, result.warnings);

    return {
        dataProvenance: result.dataProvenance,
        payload: {
            ...result,
            warnings,
        },
        providerIds: result.attemptedSources,
        status: result.qualityStatus,
        summary: `资金流/情绪快照${statusLabel(result.qualityStatus)}：${result.symbol || 'unknown'}，${result.attemptedSources.length} 个 provider，${warnings.length} 个警告。`,
        warnings,
    };
};

const defaultMacroSymbols = ['USDCNY', 'CSI300', 'HSCEI', 'VIX', 'DXY'];

type MacroSeriesTarget =
    | { kind: 'fx'; pair: string; requestSymbol: string }
    | { assetMetadata?: Record<string, unknown>; kind: 'price'; market?: string; requestSymbol: string; symbol: string };

const normalizeMacroSymbol = (symbol: string) => symbol.trim().toUpperCase().replace(/^\^/u, '').replace(/\.HK$/u, '');

const resolveMacroSeriesTarget = (symbol: string): MacroSeriesTarget => {
    const normalized = normalizeMacroSymbol(symbol);

    if (normalized === 'USDCNY' || normalized === 'USD/CNY') {
        return { kind: 'fx', pair: 'USD/CNY', requestSymbol: symbol };
    }

    if (normalized === 'CSI300' || normalized === '000300') {
        return {
            assetMetadata: { assetClass: 'equity', benchmark: '沪深300', tsCode: '000300.SH' },
            kind: 'price',
            market: 'A',
            requestSymbol: symbol,
            symbol: '000300',
        };
    }

    if (normalized === 'HSCEI') {
        return { kind: 'price', market: 'HK', requestSymbol: symbol, symbol: '^HSCE' };
    }

    if (normalized === 'HSTECH' || symbol.includes('恒生科技')) {
        return { kind: 'price', market: 'HK', requestSymbol: symbol, symbol: '^HSTECH' };
    }

    if (normalized === 'VIX') {
        return { kind: 'price', market: 'US', requestSymbol: symbol, symbol: '^VIX' };
    }

    if (normalized === 'DXY') {
        return { kind: 'price', market: 'US', requestSymbol: symbol, symbol: 'DX-Y.NYB' };
    }

    return { kind: 'price', requestSymbol: symbol, symbol };
};

const recentMacroWindow = () => {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 45);

    return {
        end: end.toISOString().slice(0, 10),
        start: start.toISOString().slice(0, 10),
    };
};

const snapshotFromMacroSeries = async (
    dataServices: DataServices,
    marketDataPort: MarketDataPort,
    request: { symbols?: string[] },
): Promise<ResearchProviderSnapshot> => {
    const requestedSymbols = request.symbols?.filter((symbol) => symbol.trim().length > 0) ?? defaultMacroSymbols;
    const window = recentMacroWindow();
    const series: Record<string, unknown> = {};
    const dataProvenance: ResearchProviderSnapshot['dataProvenance'] = [];
    const providerIds = new Set<string>();
    const warnings: string[] = [];

    for (const requestedSymbol of requestedSymbols) {
        const target = resolveMacroSeriesTarget(requestedSymbol);

        try {
            if (target.kind === 'fx') {
                const result = await marketDataPort.fetchFxRates({
                    enabledSources: getEnabledFxSources(dataServices.repositories.preferencesRepository),
                    end: window.end,
                    pair: target.pair,
                    start: window.start,
                });
                const points = result.rates.map((row) => ({ date: row.date, source: row.source, value: row.rate }));
                result.attemptedSources.forEach((providerId) => providerIds.add(providerId));
                warnings.push(...result.warnings);
                series[target.requestSymbol] = { kind: 'fx', pair: target.pair, points, warnings: result.warnings };
                dataProvenance.push({
                    fetchedAt: new Date().toISOString(),
                    providerIds: result.attemptedSources,
                    qualityStatus: points.length > 0 ? 'pass' : 'warn',
                    rowsUsed: points.length,
                    sourceId: `macro:fx:${target.pair}`,
                    warnings: result.warnings,
                });
                continue;
            }

            const result = await marketDataPort.fetchPrices({
                ...(target.assetMetadata === undefined ? {} : { assetMetadata: target.assetMetadata }),
                enabledSources: getEnabledPriceSources(dataServices.repositories.preferencesRepository, target.market, target.symbol),
                end: window.end,
                market: target.market,
                start: window.start,
                symbol: target.symbol,
            });
            const points = result.prices.map((row) => ({ date: row.date, source: row.source, value: row.adjusted_close ?? row.close }));
            result.attemptedSources.forEach((providerId) => providerIds.add(providerId));
            warnings.push(...result.warnings);
            series[target.requestSymbol] = { kind: 'price', market: target.market ?? null, points, providerSymbol: target.symbol, warnings: result.warnings };
            dataProvenance.push({
                fetchedAt: new Date().toISOString(),
                providerIds: result.attemptedSources,
                qualityStatus: points.length > 0 ? 'pass' : 'warn',
                rowsUsed: points.length,
                sourceId: `macro:price:${target.symbol}`,
                warnings: result.warnings,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`${target.requestSymbol}: ${message}`);
            series[target.requestSymbol] = { error: message, kind: target.kind, points: [] };
            dataProvenance.push({
                fetchedAt: new Date().toISOString(),
                qualityStatus: 'warn',
                rowsUsed: 0,
                sourceId: `macro:${target.kind}:${target.requestSymbol}`,
                warnings: [message],
            });
        }
    }

    const rowsUsed = dataProvenance.reduce((total, item) => total + (item.rowsUsed ?? 0), 0);
    const dedupedWarnings = mergeWarnings(warnings);
    const status = rowsUsed > 0
        ? dedupedWarnings.length > 0 ? 'degraded' : 'available'
        : 'unavailable';

    return {
        dataProvenance,
        payload: {
            asOf: window.end,
            series,
            symbols: requestedSymbols,
            window,
        },
        providerIds: Array.from(providerIds),
        status,
        summary: `宏观序列快照${statusLabel(status)}：请求 ${requestedSymbols.length} 个指标，返回 ${rowsUsed} 行价格/汇率代理数据。`,
        warnings: dedupedWarnings,
    };
};

export const createResearchProviderServices = ({
    dataServices,
    marketDataPort,
}: ResearchProviderServiceOptions): Pick<ResearchProviderService, 'getFlowSentimentSnapshot' | 'getFundamentalSnapshot' | 'getMacroSeriesSnapshot'> => {
    loadResearchProviderPolicy();

    return {
        getFlowSentimentSnapshot: async (request) => {
            const resolved = resolveRequest(dataServices, request, getFlowSentimentProviderOrder);
            const result = await marketDataPort.fetchFlowSentiment({
                ...(resolved.assetMetadata === undefined ? {} : { assetMetadata: resolved.assetMetadata }),
                enabledProviders: resolved.enabledProviders,
                market: resolved.market,
                symbol: resolved.symbol || null,
            });

            return snapshotFromFlowSentiment(result, resolved.warnings);
        },
        getFundamentalSnapshot: async (request) => {
            const resolved = resolveRequest(dataServices, request, getFundamentalsProviderOrder);
            const result = await marketDataPort.fetchFundamentals({
                ...(resolved.assetMetadata === undefined ? {} : { assetMetadata: resolved.assetMetadata }),
                enabledProviders: resolved.enabledProviders,
                market: resolved.market,
                symbol: resolved.symbol,
            });

            return snapshotFromFundamentals(result, resolved.warnings);
        },
        getMacroSeriesSnapshot: async (request) => await snapshotFromMacroSeries(dataServices, marketDataPort, request),
    };
};