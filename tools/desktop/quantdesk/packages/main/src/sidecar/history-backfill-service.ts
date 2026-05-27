import type {
    PriceSyncSummary,
    StoredAsset,
    SyncTaskPriority,
} from '@quantdesk/shared';
import { shiftIsoDateByDays } from '@quantdesk/shared/date-utils';

import type { Repositories } from '../db/repositories';
import type { LoggerLike } from '../logger';
import type { MetadataBackfillService } from './metadata-backfill-service';
import {
    currentIsoDate,
    normalizeMetadataDate,
} from './date-utils';
import {
    DEFAULT_PRICE_MAX_AGE_HOURS,
    hasPriceCoverageThroughEndDate,
} from './price-sync-service';
import type { PriceSyncPort } from './price-sync-types';
import { createEmptyPriceSyncSummary, createIdleSyncStatus } from './sync-defaults';

const TEN_YEAR_HISTORY_DAYS = 3650;
const THIRTY_YEAR_HISTORY_DAYS = 10950;

export type AssetHistoryHorizon = '10y' | '30y' | 'full-known-history';

const resolveAssetHistoryLookbackDays = (horizon?: AssetHistoryHorizon) => (
    horizon === '30y' ? THIRTY_YEAR_HISTORY_DAYS : TEN_YEAR_HISTORY_DAYS
);

export interface HistoricalBackfillPlan {
    asset: StoredAsset;
    endDate: string;
    forceRefresh: boolean;
    mode: 'interactive' | 'background';
    needsFrontfill: boolean;
    shouldSync: boolean;
    startDate: string;
}

export interface HistoryBackfillDeps {
    assets: Pick<Repositories['assetRepository'], 'list' | 'update'>;
    prices: Pick<Repositories['priceRepository'], 'getDateBounds' | 'getRange' | 'isFresh'>;
}

export const buildHistoricalBackfillPlan = ({
    asset,
    endDate,
    historyHorizon,
    mode = 'background',
    prices,
    requestedStartDate,
}: {
    asset: StoredAsset;
    endDate: string;
    historyHorizon?: AssetHistoryHorizon;
    mode?: 'interactive' | 'background';
    prices: HistoryBackfillDeps['prices'];
    requestedStartDate?: string;
}): HistoricalBackfillPlan => {
    const metadata = asset.metadata ?? {};
    const lookbackStart = shiftIsoDateByDays(endDate, -resolveAssetHistoryLookbackDays(historyHorizon));
    const issueDate = normalizeMetadataDate(metadata.issueDate);
    const candidates: string[] = [];

    if (mode === 'interactive') {
        // interactive 以用户请求窗口为准；不让 observed floor 把 3Y/5Y 回补卡在旧观测上
        candidates.push(requestedStartDate ?? lookbackStart);
        if (issueDate != null) candidates.push(issueDate);
    } else {
        candidates.push(lookbackStart);
        if (issueDate != null) candidates.push(issueDate);
    }

    const startDate = candidates.reduce((latest, value) => (value > latest ? value : latest), candidates[0]);
    const bounds = prices.getDateBounds(asset.id);
    const isFresh = prices.isFresh({
        assetId: asset.id,
        maxAgeHours: DEFAULT_PRICE_MAX_AGE_HOURS,
    });
    const needsFrontfill = bounds.earliestDate == null || bounds.earliestDate > startDate;
    const hasTrailingCoverage = hasPriceCoverageThroughEndDate({
        asset,
        assetId: asset.id,
        endDate,
        prices,
    });
    const needsTrailingSync = !isFresh || !hasTrailingCoverage;

    return {
        asset,
        endDate,
        forceRefresh: needsFrontfill,
        mode,
        needsFrontfill,
        shouldSync: needsFrontfill || needsTrailingSync,
        startDate,
    };
};

export class HistoryBackfillService {
    private readonly deps: HistoryBackfillDeps;

    private readonly ports: {
        metadataBackfill: Pick<MetadataBackfillService, 'ensureHistoricalMetadata'>;
        priceSync: PriceSyncPort;
    };

    private readonly logger?: LoggerLike;

    constructor(
        deps: HistoryBackfillDeps,
        ports: {
            metadataBackfill: Pick<MetadataBackfillService, 'ensureHistoricalMetadata'>;
            priceSync: PriceSyncPort;
        },
        logger?: LoggerLike,
    ) {
        this.deps = deps;
        this.ports = ports;
        this.logger = logger;
    }

    async syncFiveYearHistoryForAsset(
        assetId: string,
        priority: SyncTaskPriority = 'background',
        endDate = currentIsoDate(),
    ): Promise<PriceSyncSummary> {
        const asset = this.deps.assets.list().find((entry) => entry.id === assetId);

        if (!asset) {
            return createEmptyPriceSyncSummary();
        }

        return await this.syncFiveYearHistoryForAssets([asset], { priority, endDate, mode: 'background' });
    }

    async syncIncompleteFiveYearHistory(
        priority: SyncTaskPriority = 'background',
        endDate = currentIsoDate(),
    ): Promise<PriceSyncSummary> {
        return await this.syncFiveYearHistoryForAssets(this.deps.assets.list(), { priority, endDate, mode: 'background' });
    }

    async ensureAllocationHistory(
        assetIds: string[],
        options: { startDate?: string; endDate?: string; historyHorizon?: AssetHistoryHorizon; priority?: SyncTaskPriority } = {},
    ): Promise<PriceSyncSummary> {
        const { endDate = currentIsoDate(), historyHorizon, priority = 'interactive', startDate } = options;
        const requestedAssetIds = [...new Set(assetIds)];
        const assetsById = new Map(this.deps.assets.list().map((asset) => [asset.id, asset]));
        const assets: StoredAsset[] = [];
        const missingAssetIds: string[] = [];

        for (const assetId of requestedAssetIds) {
            const asset = assetsById.get(assetId);
            if (asset) {
                assets.push(asset);
                continue;
            }

            missingAssetIds.push(assetId);
        }

        const missingAssetWarning = missingAssetIds.length > 0
            ? [{
                attemptedSources: [],
                code: 'unknown_asset_id',
                kind: 'price' as const,
                message: `Unknown assetIds requested for allocation history sync: ${missingAssetIds.join(', ')}`,
                target: JSON.stringify(missingAssetIds),
            }]
            : [];

        if (assets.length === 0) {
            return createEmptyPriceSyncSummary({
                skippedAssetIds: missingAssetIds,
                warnings: missingAssetWarning,
            });
        }

        const summary = await this.syncFiveYearHistoryForAssets(assets, {
            endDate,
            historyHorizon,
            mode: priority === 'interactive' ? 'interactive' : 'background',
            priority,
            requestedStartDate: startDate,
        });
        if (missingAssetIds.length === 0) {
            return summary;
        }

        return {
            ...summary,
            skippedAssetIds: [...new Set([...summary.skippedAssetIds, ...missingAssetIds])],
            warnings: [...summary.warnings, ...missingAssetWarning],
        };
    }

    queueFiveYearHistoryForAsset(assetId: string) {
        void this.syncFiveYearHistoryForAsset(assetId, 'background').catch((error) => {
            this.logger?.warn('main', 'five_year_history_sync_failed', {
                assetId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    private async syncFiveYearHistoryForAssets(
        assets: StoredAsset[],
        options: {
            priority: SyncTaskPriority;
            endDate: string;
            historyHorizon?: AssetHistoryHorizon;
            mode: 'interactive' | 'background';
            requestedStartDate?: string;
        },
    ): Promise<PriceSyncSummary> {
        const { priority, endDate, historyHorizon, mode, requestedStartDate } = options;
        if (assets.length === 0) {
            return createEmptyPriceSyncSummary();
        }

        const summaries: PriceSyncSummary[] = [];
        const skippedAssetIds: string[] = [];

        for (const candidate of assets) {
            const hydratedAsset = await this.ports.metadataBackfill.ensureHistoricalMetadata(candidate);
            const plan = buildHistoricalBackfillPlan({
                asset: hydratedAsset,
                endDate,
                historyHorizon,
                mode,
                prices: this.deps.prices,
                requestedStartDate,
            });

            if (!plan.shouldSync) {
                skippedAssetIds.push(hydratedAsset.id);
                continue;
            }

            const summary = await this.ports.priceSync.syncPrices({
                assetIds: [hydratedAsset.id],
                endDate: plan.endDate,
                forceRefresh: plan.forceRefresh,
                priority,
                startDate: plan.startDate,
            });
            summaries.push(summary);

            await this.persistObservedHistoryFloor(plan);
        }

        const fxPairs = [...new Set(summaries.flatMap((summary) => summary.fxPairs))];
        const synchronizedAssetIds = [...new Set(summaries.flatMap((summary) => summary.synchronizedAssetIds))];
        const summarySkipped = [...new Set([
            ...skippedAssetIds,
            ...summaries.flatMap((summary) => summary.skippedAssetIds),
        ])];

        return {
            fxPairs,
            insertedRows: summaries.reduce((total, summary) => total + summary.insertedRows, 0),
            skippedAssetIds: summarySkipped,
            synchronizedAssetIds,
            syncStatus: summaries.at(-1)?.syncStatus ?? createIdleSyncStatus(),
            warnings: summaries.flatMap((summary) => summary.warnings),
        };
    }

    private async persistObservedHistoryFloor(plan: HistoricalBackfillPlan) {
        if (plan.mode !== 'background') {
            return;
        }
        if (!plan.needsFrontfill) {
            return;
        }

        const bounds = this.deps.prices.getDateBounds(plan.asset.id);
        if (bounds.earliestDate == null || bounds.earliestDate <= plan.startDate) {
            return;
        }

        const nextMetadata = {
            ...(plan.asset.metadata ?? {}),
            priceHistoryFloorDate: bounds.earliestDate,
            priceHistoryFloorSource: 'observed-history',
        };

        const unchanged = JSON.stringify(plan.asset.metadata ?? {}) === JSON.stringify(nextMetadata);
        if (unchanged) {
            return;
        }

        this.deps.assets.update({
            ...plan.asset,
            metadata: nextMetadata,
        });
    }
}
