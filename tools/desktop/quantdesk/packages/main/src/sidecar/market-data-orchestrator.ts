import type {
    AssetLookupResult,
    CacheResetResult,
    CacheSummary,
    CsvImportResult,
    FxSyncSummary,
    MetadataBackfillStatus,
    PositionImportRow,
    PriceSyncRequest,
    PriceSyncSummary,
    SyncStatus,
    SyncTaskPriority,
    SyncWarning,
} from '@quantdesk/shared';
import { shiftIsoDateByDays } from '@quantdesk/shared/date-utils';

import type { DataServices } from '../db/services';
import { currentIsoDate } from './date-utils';
import type { MarketDataServices } from './market-data-service';
import { getEnabledSearchSources } from './provider-config';
import { createEmptyPriceSyncSummary } from './sync-defaults';
import type { AssetHistoryHorizon } from './history-backfill-service';

const TEN_YEAR_HISTORY_DAYS = 3650;
const THIRTY_YEAR_HISTORY_DAYS = 10950;

const resolveAssetHistoryLookbackDays = (horizon?: AssetHistoryHorizon) => (
    horizon === '30y' ? THIRTY_YEAR_HISTORY_DAYS : TEN_YEAR_HISTORY_DAYS
);

export interface MarketDataLookupRequest {
    market?: string;
    query: string;
}

export type EnsureMarketDataRequest =
    | {
        assetIds: string[];
        force?: boolean;
        intent: 'allocation';
        priority?: SyncTaskPriority;
        window: { endDate: string; startDate: string };
    }
    | {
        assetId: string;
        horizon?: AssetHistoryHorizon;
        intent: 'asset-history';
        priority?: SyncTaskPriority;
        window?: { endDate?: string; startDate?: string };
    }
    | {
        intent: 'maintenance';
        priority?: 'background';
        scope: 'repair-incomplete-history' | 'startup-prewarm';
    };

export interface EnsureMarketDataResult {
    intent: EnsureMarketDataRequest['intent'];
    metadataStatus?: MetadataBackfillStatus;
    priceSummary?: PriceSyncSummary;
    syncStatus: SyncStatus;
    warnings: SyncWarning[];
}

export interface MarketDataPublicApi {
    ensure(request: EnsureMarketDataRequest): Promise<EnsureMarketDataResult>;
    lookup(request: MarketDataLookupRequest): Promise<AssetLookupResult[]>;
}

export interface MarketDataStatusApi {
    getMetadataBackfillStatus(): MetadataBackfillStatus;
    getSyncStatus(): SyncStatus;
    subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void;
}

export class MarketDataOrchestrator {
    private readonly dataServices: DataServices;

    private readonly services: MarketDataServices;

    constructor(
        dataServices: DataServices,
        services: MarketDataServices,
    ) {
        this.dataServices = dataServices;
        this.services = services;
    }

    async lookup(request: MarketDataLookupRequest): Promise<AssetLookupResult[]> {
        return await this.services.marketDataPort.searchAssets({
            enabledSources: getEnabledSearchSources(this.dataServices.repositories.preferencesRepository, request.market),
            market: request.market,
            query: request.query,
        });
    }

    subscribeSyncStatus(listener: (status: SyncStatus) => void) {
        return this.services.priceSyncService.subscribeSyncStatus(listener);
    }

    getSyncStatus(): SyncStatus {
        return this.services.priceSyncService.getSyncStatus();
    }

    getMetadataBackfillStatus(): MetadataBackfillStatus {
        return this.services.metadataBackfillService.getMetadataBackfillStatus();
    }

    async shutdown() {
        await this.services.priceSyncService.shutdown();
    }

    async backfillMetadataForKnownAssets() {
        return await this.services.metadataBackfillService.backfillMetadataForKnownAssets();
    }

    async ensureAllocationHistory(
        assetIds: string[],
        options: { startDate?: string; endDate?: string; priority?: SyncTaskPriority } = {},
    ): Promise<PriceSyncSummary> {
        const endDate = options.endDate ?? currentIsoDate();
        const result = await this.ensure({
            assetIds,
            intent: 'allocation',
            priority: options.priority,
            window: {
                endDate,
                startDate: options.startDate ?? shiftIsoDateByDays(endDate, -TEN_YEAR_HISTORY_DAYS),
            },
        });

        return result.priceSummary ?? createEmptyPriceSyncSummary();
    }

    async syncFiveYearHistoryForAsset(
        assetId: string,
        priority: SyncTaskPriority = 'background',
    ): Promise<PriceSyncSummary> {
        const result = await this.ensure({ assetId, horizon: '10y', intent: 'asset-history', priority });

        return result.priceSummary ?? createEmptyPriceSyncSummary();
    }

    async syncIncompleteFiveYearHistory(priority: 'background' = 'background'): Promise<PriceSyncSummary> {
        const result = await this.ensure({ intent: 'maintenance', priority, scope: 'repair-incomplete-history' });

        return result.priceSummary ?? createEmptyPriceSyncSummary();
    }

    queueFiveYearHistoryForAsset(assetId: string) {
        this.services.historyBackfillService.queueFiveYearHistoryForAsset(assetId);
    }

    async syncPrices(request: PriceSyncRequest): Promise<PriceSyncSummary> {
        return await this.services.priceSyncService.syncPrices(request);
    }

    async syncFxRates(
        pairs: string[],
        startDate: string,
        endDate?: string,
        priority: SyncTaskPriority = 'interactive',
    ): Promise<FxSyncSummary> {
        return await this.services.priceSyncService.syncFxRates(pairs, startDate, endDate, priority);
    }

    importAssetsCsv(csvText: string): CsvImportResult {
        return this.services.csvImportService.importAssetsCsv(csvText);
    }

    importPricesCsv(assetId: string, csvText: string): CsvImportResult {
        return this.services.csvImportService.importPricesCsv(assetId, csvText);
    }

    importPositionsCsv(rows: PositionImportRow[]): CsvImportResult {
        return this.services.csvImportService.importPositionsCsv(rows);
    }

    getCacheSummary(): CacheSummary {
        return this.services.cacheService.getCacheSummary();
    }

    clearCache(): CacheResetResult {
        return this.services.cacheService.clearCache();
    }

    async ensure(request: EnsureMarketDataRequest): Promise<EnsureMarketDataResult> {
        switch (request.intent) {
            case 'allocation': {
                const priceSummary = await this.services.historyBackfillService.ensureAllocationHistory(request.assetIds, {
                    endDate: request.window.endDate,
                    priority: request.priority,
                    startDate: request.window.startDate,
                });

                return {
                    intent: request.intent,
                    priceSummary,
                    syncStatus: priceSummary.syncStatus,
                    warnings: priceSummary.warnings,
                };
            }
            case 'asset-history': {
                const priceSummary = await this.services.historyBackfillService.ensureAllocationHistory(
                    [request.assetId],
                    {
                        endDate: request.window?.endDate,
                        historyHorizon: request.horizon,
                        priority: request.priority ?? 'background',
                        startDate: request.window?.startDate ?? (
                            request.window?.endDate
                                ? shiftIsoDateByDays(request.window.endDate, -resolveAssetHistoryLookbackDays(request.horizon))
                                : undefined
                        ),
                    },
                );

                return {
                    intent: request.intent,
                    priceSummary,
                    syncStatus: priceSummary.syncStatus,
                    warnings: priceSummary.warnings,
                };
            }
            case 'maintenance': {
                const priceSummary = request.scope === 'startup-prewarm'
                    ? await this.prewarmKnownAssets(request.priority)
                    : await this.services.historyBackfillService.syncIncompleteFiveYearHistory(request.priority ?? 'background');

                return {
                    intent: request.intent,
                    priceSummary,
                    syncStatus: priceSummary.syncStatus,
                    warnings: priceSummary.warnings,
                };
            }
        }
    }

    private async prewarmKnownAssets(priority: SyncTaskPriority = 'background'): Promise<PriceSyncSummary> {
        const assetIds = this.dataServices.repositories.assetRepository.list().map((asset) => asset.id);

        if (assetIds.length === 0) {
            return createEmptyPriceSyncSummary();
        }

        return await this.services.priceSyncService.syncPrices({ assetIds, priority });
    }
}