import type { CacheResetResult, CacheSummary, SyncStatus } from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import type { LoggerLike } from '../logger';

export interface CacheDeps {
    assets: Pick<Repositories['assetRepository'], 'list'>;
    fxRates: Pick<Repositories['fxRateRepository'], 'clearAll' | 'count'>;
    prices: Pick<Repositories['priceRepository'], 'clearAll' | 'count' | 'getLatestFetchedAt'>;
}

export class CacheService {
    private readonly deps: CacheDeps;

    private readonly getSyncStatus: () => SyncStatus;

    private readonly logger?: LoggerLike;

    constructor(
        deps: CacheDeps,
        getSyncStatus: () => SyncStatus,
        logger?: LoggerLike,
    ) {
        this.deps = deps;
        this.getSyncStatus = getSyncStatus;
        this.logger = logger;
    }

    getCacheSummary(): CacheSummary {
        return {
            assetCount: this.deps.assets.list().length,
            fxRateRowCount: this.deps.fxRates.count(),
            latestPriceFetchAt: this.deps.prices.getLatestFetchedAt(),
            priceRowCount: this.deps.prices.count(),
        };
    }

    clearCache(): CacheResetResult {
        this.logger?.warn('main', 'Clearing local market cache', {
            action: 'clear-cache',
            scope: ['daily_prices', 'fx_rates'],
        });

        this.deps.prices.clearAll();
        this.deps.fxRates.clearAll();

        const result = {
            cacheSummary: this.getCacheSummary(),
            syncStatus: this.getSyncStatus(),
        };

        this.logger?.info('main', 'Cleared local market cache', result);
        return result;
    }
}