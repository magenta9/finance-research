import type {
    MetadataBackfillStatus,
    StoredAsset,
} from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import type { LoggerLike } from '../logger';
import { normalizeMetadataDate } from './date-utils';

export interface AssetLookupPort {
    lookupAssets: (query: string, market?: string) => Promise<Array<{
        assetClass: StoredAsset['assetClass'];
        currency: StoredAsset['currency'];
        market: StoredAsset['market'];
        metadata: Record<string, unknown>;
        name: string;
        source: string;
        symbol: string;
    }>>;
}

export interface MetadataBackfillDeps {
    assets: Pick<Repositories['assetRepository'], 'list' | 'update'>;
}

export class MetadataBackfillService {
    private readonly deps: MetadataBackfillDeps;

    private readonly assetLookup: AssetLookupPort;

    private readonly logger?: LoggerLike;

    private metadataBackfillStatus: MetadataBackfillStatus = {
        completedAt: null,
        failedAssets: 0,
        lastError: null,
        scannedAssets: 0,
        startedAt: null,
        state: 'idle',
        updatedAssets: 0,
    };

    constructor(
        deps: MetadataBackfillDeps,
        assetLookup: AssetLookupPort,
        logger?: LoggerLike,
    ) {
        this.deps = deps;
        this.assetLookup = assetLookup;
        this.logger = logger;
    }

    getMetadataBackfillStatus() {
        return { ...this.metadataBackfillStatus };
    }

    async backfillMetadataForKnownAssets() {
        const assets = this.deps.assets.list();
        const startedAt = new Date().toISOString();

        this.metadataBackfillStatus = {
            completedAt: null,
            failedAssets: 0,
            lastError: null,
            scannedAssets: 0,
            startedAt,
            state: 'running',
            updatedAssets: 0,
        };
        this.logger?.info('main', 'asset_metadata_backfill_started', {
            assetCount: assets.length,
            startedAt,
        });

        let updatedAssets = 0;
        let failedAssets = 0;

        try {
            for (const asset of assets) {
                const before = JSON.stringify(asset.metadata ?? {});
                const hydrated = await this.ensureHistoricalMetadata(asset);
                const after = JSON.stringify(hydrated.metadata ?? {});

                if (before !== after) {
                    updatedAssets += 1;
                }

                this.metadataBackfillStatus = {
                    ...this.metadataBackfillStatus,
                    failedAssets,
                    scannedAssets: this.metadataBackfillStatus.scannedAssets + 1,
                    updatedAssets,
                };
            }

            const completedAt = new Date().toISOString();
            this.metadataBackfillStatus = {
                ...this.metadataBackfillStatus,
                completedAt,
                failedAssets,
                lastError: null,
                state: 'completed',
                updatedAssets,
            };
            this.logger?.info('main', 'asset_metadata_backfill_completed', {
                completedAt,
                failedAssets,
                scannedAssets: this.metadataBackfillStatus.scannedAssets,
                updatedAssets,
            });

            return this.getMetadataBackfillStatus();
        } catch (error) {
            failedAssets += 1;
            const message = error instanceof Error ? error.message : String(error);
            const completedAt = new Date().toISOString();
            this.metadataBackfillStatus = {
                ...this.metadataBackfillStatus,
                completedAt,
                failedAssets,
                lastError: message,
                state: 'failed',
                updatedAssets,
            };
            this.logger?.warn('main', 'asset_metadata_backfill_failed', {
                completedAt,
                error: message,
                failedAssets,
                scannedAssets: this.metadataBackfillStatus.scannedAssets,
                updatedAssets,
            });
            throw error;
        }
    }

    async ensureHistoricalMetadata(asset: StoredAsset): Promise<StoredAsset> {
        let nextAsset = asset;
        const metadata = nextAsset.metadata ?? {};
        const issueDate = normalizeMetadataDate(metadata.issueDate);
        const hasTuShareTsCode = typeof metadata.tsCode === 'string' && metadata.tsCode.trim().length > 0;

        if (issueDate != null && hasTuShareTsCode) {
            return nextAsset;
        }

        try {
            const lookupResults = await this.assetLookup.lookupAssets(nextAsset.symbol, nextAsset.market);
            const exactMatch = lookupResults.find((candidate) => (
                candidate.symbol === nextAsset.symbol && candidate.market === nextAsset.market
            ));

            if (!exactMatch) {
                return nextAsset;
            }

            const patch: Record<string, unknown> = {};
            const nextIssueDate = normalizeMetadataDate(exactMatch.metadata.issueDate);
            if (nextIssueDate != null) {
                patch.issueDate = nextIssueDate;
                patch.issueDateSource = typeof exactMatch.metadata.issueDateSource === 'string'
                    ? exactMatch.metadata.issueDateSource
                    : exactMatch.source;
            }

            if (typeof exactMatch.metadata.tsCode === 'string' && exactMatch.metadata.tsCode.trim().length > 0) {
                patch.tsCode = exactMatch.metadata.tsCode.trim().toUpperCase();
            }

            if (typeof exactMatch.metadata.tsCodeAsset === 'string' && exactMatch.metadata.tsCodeAsset.trim().length > 0) {
                patch.tsCodeAsset = exactMatch.metadata.tsCodeAsset.trim().toUpperCase();
            }

            if (Object.keys(patch).length === 0) {
                return nextAsset;
            }

            nextAsset = this.updateAssetMetadata(nextAsset, patch);
            return nextAsset;
        } catch (error) {
            this.logger?.warn('main', 'historical_metadata_lookup_failed', {
                assetId: nextAsset.id,
                error: error instanceof Error ? error.message : String(error),
                market: nextAsset.market,
                symbol: nextAsset.symbol,
            });
            return nextAsset;
        }
    }

    private updateAssetMetadata(
        asset: StoredAsset,
        patch: Record<string, unknown>,
    ): StoredAsset {
        const nextMetadata = {
            ...(asset.metadata ?? {}),
            ...patch,
        };

        const unchanged = JSON.stringify(asset.metadata ?? {}) === JSON.stringify(nextMetadata);
        if (unchanged) {
            return asset;
        }

        return this.deps.assets.update({
            ...asset,
            metadata: nextMetadata,
        });
    }
}