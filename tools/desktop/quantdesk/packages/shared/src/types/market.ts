import type { AssetClass, Currency, Market } from './domain';

export type DataSourceId = 'akshare' | 'frankfurter' | 'tushare' | 'yfinance';

export type SyncTaskKind = 'fx' | 'price';

export type SyncTaskPriority = 'background' | 'interactive';

export interface SyncTaskSnapshot {
    taskId: string;
    key: string;
    kind: SyncTaskKind;
    target: string;
    startDate: string;
    endDate: string;
    priority: SyncTaskPriority;
    status: 'queued' | 'running';
}

export interface SyncEventRecord {
    taskId: string;
    kind: SyncTaskKind;
    target: string;
    startDate: string;
    endDate: string;
    priority: SyncTaskPriority;
    attemptedSources: string[];
    insertedRows: number;
    warnings: string[];
    durationMs: number;
    outcome: 'failed' | 'success' | 'warning';
    occurredAt: string;
    error?: string | null;
}

export interface SyncStatus {
    running: boolean;
    queuedTasks: number;
    activeTask: SyncTaskSnapshot | null;
    completedTasks: number;
    failedTasks: number;
    lastWarning: string | null;
    recentEvents: SyncEventRecord[];
}

export interface SyncWarning {
    code: string;
    kind: SyncTaskKind;
    target: string;
    message: string;
    attemptedSources: string[];
}

export interface AssetLookupResult {
    symbol: string;
    name: string;
    market: Market;
    assetClass: AssetClass;
    currency: Currency;
    exchange?: string;
    source: string;
    metadata: Record<string, unknown>;
}

export interface PriceSyncRequest {
    assetIds: string[];
    startDate?: string;
    endDate?: string;
    maxAgeHours?: number;
    forceRefresh?: boolean;
    priority?: SyncTaskPriority;
}

export interface PriceSyncSummary {
    synchronizedAssetIds: string[];
    skippedAssetIds: string[];
    insertedRows: number;
    fxPairs: string[];
    warnings: SyncWarning[];
    syncStatus: SyncStatus;
}

export interface FxSyncSummary {
    pairs: string[];
    insertedRows: number;
    warnings: SyncWarning[];
}

export interface CacheResetResult {
    cacheSummary: CacheSummary;
    syncStatus: SyncStatus;
}

export interface CacheSummary {
    assetCount: number;
    priceRowCount: number;
    fxRateRowCount: number;
    latestPriceFetchAt: string | null;
}

export interface CsvImportRow {
    symbol: string;
    name: string;
    market: Market;
    assetClass: AssetClass;
    currency: Currency;
    tags?: string[];
}

export interface CsvImportResult {
    successCount: number;
    skippedCount: number;
    errorCount: number;
    errors: string[];
}

export interface PositionImportRow {
    assetId: string;
    portfolioName?: string;
    shares: number;
    costBasis: number | null;
    currency: Currency;
}