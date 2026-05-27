import type { PriceSyncSummary, SyncStatus } from '@quantdesk/shared';

export const createIdleSyncStatus = (): SyncStatus => ({
    activeTask: null,
    completedTasks: 0,
    failedTasks: 0,
    lastWarning: null,
    queuedTasks: 0,
    recentEvents: [],
    running: false,
});

export const createEmptyPriceSyncSummary = (
    overrides: Partial<PriceSyncSummary> = {},
): PriceSyncSummary => ({
    fxPairs: [],
    insertedRows: 0,
    skippedAssetIds: [],
    synchronizedAssetIds: [],
    syncStatus: createIdleSyncStatus(),
    warnings: [],
    ...overrides,
});