import type { DataSourceId, StoredAsset, SyncWarning } from '@quantdesk/shared';

import type { LoggerLike } from '../logger';
import { nextIsoDate } from './date-utils';
import type { MarketDataPort } from './market-data-port';
import {
    createWarning,
    dedupeWarnings,
    hasFxCoverage,
    hasPriceCoverageThroughEndDate,
    reconcileFxWithCache,
    reconcilePricesWithCache,
} from './price-sync-core';
import { SyncUnavailableError } from './provider-config';
import type {
    FxTaskDetails,
    PriceSyncDeps,
    PriceTaskDetails,
} from './price-sync-types';

const logSyncOutcome = ({
    kind,
    target,
    startDate,
    endDate,
    attemptedSources,
    insertedRows,
    warnings,
    outcome,
    error,
    logger,
}: {
    kind: 'fx' | 'price';
    target: string;
    startDate: string;
    endDate: string;
    attemptedSources: string[];
    insertedRows: number;
    warnings: SyncWarning[];
    outcome: 'failed' | 'success' | 'warning';
    error?: Error;
    logger?: LoggerLike;
}) => {
    const context = {
        attemptedSources,
        dateWindow: { endDate, startDate },
        insertedRows,
        kind,
        outcome,
        symbolOrPair: target,
        taskId: `${kind}:${target}:${startDate}:${endDate}`,
        warnings: warnings.map((warning) => warning.message),
    };

    if (outcome === 'failed') {
        logger?.error('main', 'market_sync_failed', error, context);
        return;
    }

    if (outcome === 'warning') {
        if (isInformationalPriceNotice({ insertedRows, kind, warnings })) {
            logger?.info('main', 'market_sync_completed', context);
            return;
        }

        logger?.warn('main', 'market_sync_warning', context);
        return;
    }

    logger?.info('main', 'market_sync_completed', context);
};

const RAW_FUTURES_NOTICE = 'raw continuous and not back-adjusted';

const isInformationalPriceNotice = ({
    kind,
    insertedRows,
    warnings,
}: {
    kind: 'fx' | 'price';
    insertedRows: number;
    warnings: SyncWarning[];
}) => (
    kind === 'price'
    && insertedRows > 0
    && warnings.length > 0
    && warnings.every((warning) => (
        warning.code === 'SOURCE_WARNING'
        && warning.message.includes(RAW_FUTURES_NOTICE)
    ))
);

const PRICE_SYNC_ASSET_METADATA_KEYS = [
    'contractType',
    'exchange',
    'instrumentType',
    'issueDate',
    'issueDateSource',
    'priceSeriesSource',
    'seriesAdjustment',
    'sourceSymbol',
    'tsCode',
    'tsCodeAsset',
    'underlyingSymbol',
] as const;

const buildPriceAssetMetadata = (metadata: Record<string, unknown>) => {
    const assetMetadata: Record<string, string> = {};

    for (const key of PRICE_SYNC_ASSET_METADATA_KEYS) {
        const value = metadata[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            assetMetadata[key] = value.trim();
        }
    }

    return Object.keys(assetMetadata).length > 0 ? assetMetadata : undefined;
};

export const performPriceTask = async ({
    asset,
    attemptedSources,
    fetchStartDate,
    endDate,
    hadCoveredHistory,
    deps,
    marketDataPort,
    logger,
}: {
    asset: StoredAsset;
    attemptedSources: DataSourceId[];
    fetchStartDate: string;
    endDate: string;
    hadCoveredHistory: boolean;
    deps: PriceSyncDeps;
    marketDataPort: MarketDataPort;
    logger?: LoggerLike;
}): Promise<PriceTaskDetails> => {
    const assetMetadata = buildPriceAssetMetadata(asset.metadata);
    const response = await marketDataPort.fetchPrices({
        ...(assetMetadata === undefined ? {} : { assetMetadata }),
        assetId: asset.id,
        enabledSources: attemptedSources,
        end: endDate,
        market: asset.market,
        start: fetchStartDate,
        symbol: asset.symbol,
    });
    const warnings = response.warnings.map((warning) =>
        createWarning('SOURCE_WARNING', 'price', asset.id, warning, response.attemptedSources),
    );

    if (response.prices.length === 0) {
        if (hadCoveredHistory) {
            const staleWarning = createWarning(
                'STALE_PRICE_CACHE_USED',
                'price',
                asset.id,
                `Using stale cached prices for ${asset.symbol}; remote providers returned no new rows.`,
                response.attemptedSources,
            );
            logSyncOutcome({
                attemptedSources: response.attemptedSources,
                endDate,
                insertedRows: 0,
                kind: 'price',
                logger,
                outcome: 'warning',
                startDate: fetchStartDate,
                target: asset.symbol,
                warnings: [...warnings, staleWarning],
            });
            return {
                assetId: asset.id,
                attemptedSources: response.attemptedSources,
                insertedRows: 0,
                warnings: [...warnings, staleWarning],
            };
        }

        const error = new SyncUnavailableError(
            'MARKET_DATA_UNAVAILABLE',
            `No real price data available for ${asset.symbol}.`,
        );
        logSyncOutcome({
            attemptedSources: response.attemptedSources,
            endDate,
            error,
            insertedRows: 0,
            kind: 'price',
            logger,
            outcome: 'failed',
            startDate: fetchStartDate,
            target: asset.symbol,
            warnings,
        });
        throw error;
    }

    const rowsToWrite = reconcilePricesWithCache({
        assetId: asset.id,
        incomingRows: response.prices.map((row) => ({
            adjustedClose: row.adjusted_close,
            assetId: asset.id,
            close: row.close,
            date: row.date,
            fetchedAt: new Date().toISOString(),
            high: row.high,
            low: row.low,
            open: row.open,
            source: row.source,
            volume: row.volume,
        })),
        market: asset.market,
        prices: deps.prices,
    });

    if (rowsToWrite.length > 0) {
        deps.prices.insertMany(rowsToWrite);
    }

    if (!hasPriceCoverageThroughEndDate({ asset, assetId: asset.id, endDate, prices: deps.prices })) {
        const error = new SyncUnavailableError(
            'MARKET_DATA_UNAVAILABLE',
            `Insufficient real history remains for ${asset.symbol} after sync.`,
        );
        logSyncOutcome({
            attemptedSources: response.attemptedSources,
            endDate,
            error,
            insertedRows: rowsToWrite.length,
            kind: 'price',
            logger,
            outcome: 'failed',
            startDate: fetchStartDate,
            target: asset.symbol,
            warnings,
        });
        throw error;
    }

    logSyncOutcome({
        attemptedSources: response.attemptedSources,
        endDate,
        insertedRows: rowsToWrite.length,
        kind: 'price',
        logger,
        outcome: warnings.length > 0 ? 'warning' : 'success',
        startDate: fetchStartDate,
        target: asset.symbol,
        warnings,
    });

    return {
        assetId: asset.id,
        attemptedSources: response.attemptedSources,
        insertedRows: rowsToWrite.length,
        warnings: dedupeWarnings(warnings),
    };
};

export const performFxTask = async ({
    attemptedSources,
    pair,
    startDate,
    endDate,
    deps,
    marketDataPort,
    logger,
}: {
    attemptedSources: DataSourceId[];
    pair: string;
    startDate: string;
    endDate: string;
    deps: PriceSyncDeps;
    marketDataPort: MarketDataPort;
    logger?: LoggerLike;
}): Promise<FxTaskDetails> => {
    const isRangeCovered = hasFxCoverage({
        endDate,
        fxRates: deps.fxRates,
        pair,
        startDate,
    });

    if (isRangeCovered) {
        return { attemptedSources: [], insertedRows: 0, pair, warnings: [] };
    }

    const bounds = deps.fxRates.getDateBounds(pair);
    const fetchStartDate = bounds.latestDate != null && bounds.latestDate >= startDate && bounds.latestDate < endDate
        ? nextIsoDate(bounds.latestDate)
        : startDate;
    const response = await marketDataPort.fetchFxRates({
        enabledSources: attemptedSources,
        end: endDate,
        pair,
        start: fetchStartDate,
    });
    const warnings = response.warnings.map((warning) =>
        createWarning('SOURCE_WARNING', 'fx', pair, warning, response.attemptedSources),
    );
    const hasCachedRate = deps.fxRates.getLatestRate(pair, endDate) != null;

    if (response.rates.length === 0) {
        if (hasCachedRate) {
            const staleWarning = createWarning(
                'STALE_FX_CACHE_USED',
                'fx',
                pair,
                `Using stale cached FX rates for ${pair}; remote providers returned no new rows.`,
                response.attemptedSources,
            );
            logSyncOutcome({
                attemptedSources: response.attemptedSources,
                endDate,
                insertedRows: 0,
                kind: 'fx',
                logger,
                outcome: 'warning',
                startDate: fetchStartDate,
                target: pair,
                warnings: [...warnings, staleWarning],
            });
            return {
                attemptedSources: response.attemptedSources,
                insertedRows: 0,
                pair,
                warnings: [...warnings, staleWarning],
            };
        }

        const error = new SyncUnavailableError('FX_RATE_UNAVAILABLE', `No real FX data available for ${pair}.`);
        logSyncOutcome({
            attemptedSources: response.attemptedSources,
            endDate,
            error,
            insertedRows: 0,
            kind: 'fx',
            logger,
            outcome: 'failed',
            startDate: fetchStartDate,
            target: pair,
            warnings,
        });
        throw error;
    }

    const rowsToWrite = reconcileFxWithCache({
        fxRates: deps.fxRates,
        incomingRows: response.rates.map((row) => ({
            date: row.date,
            pair,
            rate: row.rate,
            source: row.source,
        })),
        pair,
    });

    if (rowsToWrite.length > 0) {
        deps.fxRates.insertMany(rowsToWrite);
    }

    if (!hasFxCoverage({ endDate, fxRates: deps.fxRates, pair, startDate })) {
        const error = new SyncUnavailableError('FX_RATE_UNAVAILABLE', `Insufficient real FX history remains for ${pair} after sync.`);
        logSyncOutcome({
            attemptedSources: response.attemptedSources,
            endDate,
            error,
            insertedRows: rowsToWrite.length,
            kind: 'fx',
            logger,
            outcome: 'failed',
            startDate: fetchStartDate,
            target: pair,
            warnings,
        });
        throw error;
    }

    logSyncOutcome({
        attemptedSources: response.attemptedSources,
        endDate,
        insertedRows: rowsToWrite.length,
        kind: 'fx',
        logger,
        outcome: warnings.length > 0 ? 'warning' : 'success',
        startDate: fetchStartDate,
        target: pair,
        warnings,
    });

    return {
        attemptedSources: response.attemptedSources,
        insertedRows: rowsToWrite.length,
        pair,
        warnings: dedupeWarnings(warnings),
    };
};
