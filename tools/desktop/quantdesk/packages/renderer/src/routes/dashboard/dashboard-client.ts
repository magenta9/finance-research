import type {
    PositionImportRow,
    PositionInput,
    PositionRecord,
    RuntimeStatusResponse,
    StoredAsset,
    SyncStatus,
    AllocationPlanRecord,
} from '@quantdesk/shared';

import { apiClient } from '../../lib/api-client';
import { parseLatestPrice } from './dashboard-utils';

export interface DashboardPageData {
    assets: StoredAsset[];
    latestPriceByAssetId: Record<string, number>;
    plans: AllocationPlanRecord[];
    positions: PositionRecord[];
    runtimeStatus: RuntimeStatusResponse;
    syncStatus: SyncStatus;
}

const loadLatestPriceByAssetId = async (positions: PositionRecord[]) => {
    const uniquePositionAssetIds = [...new Set(positions.map((position) => position.assetId))];
    const latestPrices = await Promise.all(
        uniquePositionAssetIds.map(async (assetId) => {
            const prices = await apiClient.data.getPrices(assetId);
            return [assetId, parseLatestPrice(prices)] as const;
        }),
    );

    return Object.fromEntries(
        latestPrices
            .filter((entry): entry is readonly [string, number] => entry[1] != null)
            .map(([assetId, latestPrice]) => [assetId, latestPrice]),
    );
};

export const loadDashboardPageData = async (): Promise<DashboardPageData> => {
    const [assets, plans, positions, runtimeStatus, syncStatus] = await Promise.all([
        apiClient.data.getAssets(),
        apiClient.portfolio.getPlans(),
        apiClient.data.getPositions(),
        apiClient.system.getRuntimeStatus(),
        apiClient.data.getSyncStatus(),
    ]);

    return {
        assets,
        latestPriceByAssetId: await loadLatestPriceByAssetId(positions),
        plans,
        positions,
        runtimeStatus,
        syncStatus,
    };
};

export const subscribeToDashboardSyncStatus = (listener: (syncStatus: SyncStatus) => void) =>
    apiClient.data.subscribeSyncStatus(listener);

export const savePosition = async (position: PositionInput) =>
    await apiClient.data.updatePosition(position);

export const importPositions = async (rows: PositionImportRow[]) =>
    await apiClient.data.importPositionsCsv(rows);

export const deletePosition = async (positionId: string) =>
    await apiClient.data.deletePosition(positionId);

export const runHeartbeatCheck = async () =>
    await apiClient.system.ping();

export const runNativeBindingsCheck = async () =>
    await apiClient.system.checkNativeBindings();

export const runAgentRuntimeProbeCheck = async () =>
    await apiClient.system.runDummyPython();