import type {
    DataSourceId,
    FxSyncSummary,
    PriceSyncRequest,
    PriceSyncSummary,
    StoredAsset,
    SyncStatus,
    SyncTaskPriority,
    SyncWarning,
} from '@quantdesk/shared';

import type { LoggerLike } from '../logger';
import { currentIsoDate } from './date-utils';
import type { MarketDataPort } from './market-data-port';
import {
    buildFxSyncWindowsFromAssetPrices,
    createWarning,
    DEFAULT_PRICE_MAX_AGE_HOURS,
    dedupeWarnings,
    resolvePriceWindow,
} from './price-sync-core';
import { performFxTask, performPriceTask } from './price-sync-execution';
import { getEnabledFxSources, getEnabledPriceSources } from './provider-config';
import { SyncQueue } from './sync-queue';
import type {
    FxTaskDetails,
    PriceSyncDeps,
    PriceSyncPort,
    PriceTaskDetails,
} from './price-sync-types';

export type {
    FxTaskDetails,
    PriceSyncDeps,
    PriceSyncPort,
    PriceTaskDetails,
    SyncWindow,
} from './price-sync-types';

export {
    chooseFxRow,
    choosePriceRow,
    DEFAULT_PRICE_MAX_AGE_HOURS,
    hasPriceCoverageThroughEndDate,
    isFilledBy,
    priceCompleteness,
    reconcileFxWithCache,
    reconcilePricesWithCache,
} from './price-sync-core';

export class PriceSyncService implements PriceSyncPort {
    private readonly deps: PriceSyncDeps;

    private readonly marketDataPort: MarketDataPort;

    private readonly syncQueue: SyncQueue;

    private readonly logger?: LoggerLike;

    constructor(
        deps: PriceSyncDeps,
        marketDataPort: MarketDataPort,
        syncQueue = new SyncQueue(),
        logger?: LoggerLike,
    ) {
        this.deps = deps;
        this.marketDataPort = marketDataPort;
        this.syncQueue = syncQueue;
        this.logger = logger;
    }

    getSyncStatus(): SyncStatus {
        return this.syncQueue.getStatus();
    }

    subscribeSyncStatus(listener: (status: SyncStatus) => void) {
        return this.syncQueue.subscribe(listener);
    }

    async shutdown() {
        await this.syncQueue.shutdown();
    }

    async syncPrices(request: PriceSyncRequest): Promise<PriceSyncSummary> {
        const requestedAssetIds = new Set(request.assetIds);
        const assets = this.deps.assets
            .list()
            .filter((asset) => requestedAssetIds.has(asset.id));

        if (assets.length === 0) {
            return {
                fxPairs: [],
                insertedRows: 0,
                skippedAssetIds: [],
                synchronizedAssetIds: [],
                syncStatus: this.getSyncStatus(),
                warnings: [],
            };
        }

        const endDate = request.endDate ?? currentIsoDate();
        const startDate = request.startDate
            ?? new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const maxAgeHours = request.maxAgeHours ?? DEFAULT_PRICE_MAX_AGE_HOURS;
        const priority = request.priority ?? 'interactive';
        const synchronizedAssetIds: string[] = [];
        const skippedAssetIds: string[] = [];
        const warnings: SyncWarning[] = [];
        let insertedRows = 0;
        const needsFxSync = assets.some((asset) => asset.currency !== 'CNY');
        const enabledFxSources = needsFxSync ? getEnabledFxSources(this.deps.preferences) : [];

        const priceTasks: Array<Promise<PriceTaskDetails>> = [];

        for (const asset of assets) {
            const window = resolvePriceWindow({
                asset,
                assetId: asset.id,
                endDate,
                forceRefresh: request.forceRefresh ?? false,
                maxAgeHours,
                prices: this.deps.prices,
                startDate,
            });

            if (!window.shouldSync) {
                skippedAssetIds.push(asset.id);
                continue;
            }

            priceTasks.push(this.enqueuePriceTask({
                asset,
                attemptedSources: getEnabledPriceSources(this.deps.preferences, asset.market, asset.symbol),
                endDate,
                fetchStartDate: window.fetchStartDate,
                hadCoveredHistory: window.isRangeCovered,
                priority,
            }));
        }

        const priceResults = await Promise.allSettled(priceTasks);
        for (const result of priceResults) {
            if (result.status === 'fulfilled') {
                synchronizedAssetIds.push(result.value.assetId);
                insertedRows += result.value.insertedRows;
                warnings.push(...result.value.warnings);
                continue;
            }

            if (priority === 'background') {
                warnings.push(createWarning(
                    'MARKET_DATA_UNAVAILABLE',
                    'price',
                    'background-sync',
                    result.reason instanceof Error ? result.reason.message : String(result.reason),
                    [],
                ));
                continue;
            }

            throw result.reason;
        }

        const fxSyncWindows = buildFxSyncWindowsFromAssetPrices({
            assets,
            endDate,
            prices: this.deps.prices,
            startDate,
        });
        const fxPairs = [...fxSyncWindows.keys()];
        const fxResults = await Promise.allSettled(
            fxPairs.map((pair) => {
                const window = fxSyncWindows.get(pair);
                if (!window) {
                    throw new Error(`Missing FX sync window for ${pair}.`);
                }

                return this.enqueueFxTask({
                    attemptedSources: enabledFxSources,
                    endDate: window.endDate,
                    pair,
                    priority,
                    startDate: window.startDate,
                });
            }),
        );

        for (const result of fxResults) {
            if (result.status === 'fulfilled') {
                warnings.push(...result.value.warnings);
                continue;
            }

            if (priority === 'background') {
                warnings.push(createWarning(
                    'FX_RATE_UNAVAILABLE',
                    'fx',
                    'background-sync',
                    result.reason instanceof Error ? result.reason.message : String(result.reason),
                    [],
                ));
                continue;
            }

            throw result.reason;
        }

        return {
            fxPairs,
            insertedRows,
            skippedAssetIds,
            synchronizedAssetIds,
            syncStatus: this.getSyncStatus(),
            warnings: dedupeWarnings(warnings),
        };
    }

    async syncFxRates(
        pairs: string[],
        startDate: string,
        endDate?: string,
        priority: SyncTaskPriority = 'interactive',
    ): Promise<FxSyncSummary> {
        if (pairs.length === 0) {
            return {
                insertedRows: 0,
                pairs: [],
                warnings: [],
            };
        }

        const resolvedEndDate = endDate ?? currentIsoDate();
        const warnings: SyncWarning[] = [];
        let insertedRows = 0;
        const attemptedSources = getEnabledFxSources(this.deps.preferences);
        const tasks = pairs.map((pair) => this.enqueueFxTask({
            attemptedSources,
            endDate: resolvedEndDate,
            pair,
            priority,
            startDate,
        }));
        const results = await Promise.allSettled(tasks);

        for (const result of results) {
            if (result.status === 'fulfilled') {
                insertedRows += result.value.insertedRows;
                warnings.push(...result.value.warnings);
                continue;
            }

            if (priority === 'background') {
                warnings.push(createWarning(
                    'FX_RATE_UNAVAILABLE',
                    'fx',
                    'background-sync',
                    result.reason instanceof Error ? result.reason.message : String(result.reason),
                    [],
                ));
                continue;
            }

            throw result.reason;
        }

        return {
            pairs,
            insertedRows,
            warnings: dedupeWarnings(warnings),
        };
    }

    private async enqueuePriceTask({
        asset,
        attemptedSources,
        endDate,
        fetchStartDate,
        hadCoveredHistory,
        priority,
    }: {
        asset: StoredAsset;
        attemptedSources: DataSourceId[];
        fetchStartDate: string;
        endDate: string;
        hadCoveredHistory: boolean;
        priority: SyncTaskPriority;
    }): Promise<PriceTaskDetails> {
        const taskKey = `price:${asset.id}:${fetchStartDate}:${endDate}`;
        if (priority === 'interactive') {
            void this.syncQueue.promote(taskKey);
        }

        const result = await this.syncQueue.enqueue({
            endDate,
            execute: async () => {
                const details = await performPriceTask({
                    asset,
                    attemptedSources,
                    deps: this.deps,
                    endDate,
                    fetchStartDate,
                    hadCoveredHistory,
                    logger: this.logger,
                    marketDataPort: this.marketDataPort,
                });
                return {
                    attemptedSources: details.attemptedSources,
                    details,
                    insertedRows: details.insertedRows,
                    warnings: details.warnings.map((warning) => warning.message),
                };
            },
            key: taskKey,
            kind: 'price',
            priority,
            startDate: fetchStartDate,
            target: asset.id,
        });

        return result.details as PriceTaskDetails;
    }

    private async enqueueFxTask({
        attemptedSources,
        pair,
        startDate,
        endDate,
        priority,
    }: {
        attemptedSources: DataSourceId[];
        pair: string;
        startDate: string;
        endDate: string;
        priority: SyncTaskPriority;
    }): Promise<FxTaskDetails> {
        const taskKey = `fx:${pair}:${startDate}:${endDate}`;
        if (priority === 'interactive') {
            void this.syncQueue.promote(taskKey);
        }

        const result = await this.syncQueue.enqueue({
            endDate,
            execute: async () => {
                const details = await performFxTask({
                    attemptedSources,
                    deps: this.deps,
                    endDate,
                    logger: this.logger,
                    marketDataPort: this.marketDataPort,
                    pair,
                    startDate,
                });
                return {
                    attemptedSources: details.attemptedSources,
                    details,
                    insertedRows: details.insertedRows,
                    warnings: details.warnings.map((warning) => warning.message),
                };
            },
            key: taskKey,
            kind: 'fx',
            priority,
            startDate,
            target: pair,
        });

        return result.details as FxTaskDetails;
    }

}
