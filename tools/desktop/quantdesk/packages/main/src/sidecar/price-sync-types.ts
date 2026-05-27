import type {
    FxSyncSummary,
    PriceSyncRequest,
    PriceSyncSummary,
    SyncTaskPriority,
    SyncWarning,
} from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';

export interface SyncWindow {
    endDate: string;
    startDate: string;
}

export interface PriceTaskDetails {
    assetId: string;
    attemptedSources: string[];
    insertedRows: number;
    warnings: SyncWarning[];
}

export interface FxTaskDetails {
    pair: string;
    attemptedSources: string[];
    insertedRows: number;
    warnings: SyncWarning[];
}

export interface PriceSyncDeps {
    assets: Pick<Repositories['assetRepository'], 'list'>;
    fxRates: Pick<
        Repositories['fxRateRepository'],
        'getDateBounds' | 'getLatestRate' | 'getRange' | 'insertMany'
    >;
    preferences: Pick<Repositories['preferencesRepository'], 'get'>;
    prices: Pick<
        Repositories['priceRepository'],
        'getDateBounds' | 'getRange' | 'insertMany' | 'isFresh'
    >;
}

export interface PriceSyncPort {
    syncPrices: (request: PriceSyncRequest) => Promise<PriceSyncSummary>;
    syncFxRates: (
        pairs: string[],
        startDate: string,
        endDate?: string,
        priority?: SyncTaskPriority,
    ) => Promise<FxSyncSummary>;
    subscribeSyncStatus?: (listener: (status: import('@quantdesk/shared').SyncStatus) => void) => () => void;
}