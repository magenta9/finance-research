import type { DataSourceId, Market } from '@quantdesk/shared';

import {
    getFxProviderOrder,
    getPriceProviderOrder,
    getSearchProviderOrder,
    loadMarketDataPolicy,
} from './market-data-contracts';
import { createPreferencesService } from '../preferences/preferences-service';

export interface PreferenceReader {
    get: (key: string) => string | null;
}

export class SyncUnavailableError extends Error {
    readonly code: 'FX_RATE_UNAVAILABLE' | 'MARKET_DATA_UNAVAILABLE';

    constructor(
        code: 'FX_RATE_UNAVAILABLE' | 'MARKET_DATA_UNAVAILABLE',
        message: string,
    ) {
        super(message);
        this.code = code;
        this.name = 'SyncUnavailableError';
    }
}

const sourceRoot = (source: string) => source.split('-', 1)[0] ?? source;
const normalizeMarketKey = (market?: Market | string | null) => market === 'US' || market === 'HK' || market === 'A' || market === 'BOND' || market === 'COMMODITY'
    ? market
    : 'default';

const getEnabledProviderIds = (
    providerIds: DataSourceId[],
    enabledSources: DataSourceId[],
) => {
    const enabled = new Set(enabledSources);
    return providerIds.filter((providerId) => enabled.has(providerId));
};

const getConfiguredEnabledSources = (
    preferences: PreferenceReader,
    includeFrankfurter = false,
): DataSourceId[] => {
    const sources = getEnabledDataProviderIds(preferences);

    if (includeFrankfurter && createPreferencesService(preferences).getDataSourceEnabled('frankfurterEnabled')) {
        sources.push('frankfurter');
    }

    return sources;
};

const requireAvailableSources = (
    sources: DataSourceId[],
    code: SyncUnavailableError['code'],
    message: string,
): DataSourceId[] => {
    if (sources.length === 0) {
        throw new SyncUnavailableError(code, message);
    }

    return sources;
};

export const getSourcePriority = ({
    kind,
    market,
    source,
}: {
    kind: 'fx' | 'price';
    market?: string | null;
    source: string;
}) => {
    const policy = loadMarketDataPolicy();
    const root = sourceRoot(source);
    const marketKey = normalizeMarketKey(market);
    const basePriority = kind === 'price'
        ? policy.sourcePriorityWeights.price[marketKey][root as 'akshare' | 'tushare' | 'yfinance'] ?? 0
        : policy.sourcePriorityWeights.fx[root as 'akshare' | 'frankfurter' | 'yfinance'] ?? 0;

    if (source.includes('derived')) {
        return basePriority - policy.derivedSourcePenalty;
    }

    return basePriority;
};

export const getEnabledDataProviderIds = (preferences: PreferenceReader): DataSourceId[] => {
    const sources: DataSourceId[] = [];
    const service = createPreferencesService(preferences);

    if (service.getDataSourceEnabled('akshareEnabled')) {
        sources.push('akshare');
    }

    if (service.getDataSourceEnabled('tushareEnabled')) {
        sources.push('tushare');
    }

    if (service.getDataSourceEnabled('yfinanceEnabled')) {
        sources.push('yfinance');
    }

    return sources;
};

export const getSearchProviderIds = ({
    enabledSources,
    market,
}: {
    enabledSources: DataSourceId[];
    market?: Market | string | null;
}) => getEnabledProviderIds(getSearchProviderOrder({ enabledSources, market }), enabledSources);

export const getPriceProviderIds = ({
    enabledSources,
    market,
    symbol,
}: {
    enabledSources: DataSourceId[];
    market?: Market | string | null;
    symbol: string;
}) => getEnabledProviderIds(getPriceProviderOrder({ enabledSources, market, symbol }), enabledSources);

export const getFxProviderIds = (enabledSources: DataSourceId[]) => getEnabledProviderIds(getFxProviderOrder(enabledSources), enabledSources);

export const getEnabledSearchSources = (
    preferences: PreferenceReader,
    market?: Market | string | null,
): DataSourceId[] => requireAvailableSources(getSearchProviderIds({
    enabledSources: getConfiguredEnabledSources(preferences),
    market,
}), 'MARKET_DATA_UNAVAILABLE', 'All asset lookup providers are disabled.');

export const getEnabledPriceSources = (
    preferences: PreferenceReader,
    market?: Market | string | null,
    symbol = '',
): DataSourceId[] => requireAvailableSources(getPriceProviderIds({
    enabledSources: getConfiguredEnabledSources(preferences),
    market,
    symbol,
}), 'MARKET_DATA_UNAVAILABLE', 'All price data providers are disabled.');

export const getEnabledFxSources = (preferences: PreferenceReader): DataSourceId[] => requireAvailableSources(
    getFxProviderIds(getConfiguredEnabledSources(preferences, true)),
    'FX_RATE_UNAVAILABLE',
    'All FX data providers are disabled.',
);