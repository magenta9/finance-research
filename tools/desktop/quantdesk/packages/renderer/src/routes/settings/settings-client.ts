import type {
    CacheSummary,
    SyncStatus,
} from '@quantdesk/shared/types/market';
import type {
    PiRiskGateState,
    PiRuntimeDirectoryTarget,
    PiRuntimeStatus,
} from '@quantdesk/shared/types/pi-runtime';
import type {
    RuntimeConfig,
    RuntimeMode,
    RuntimeStatusResponse,
} from '@quantdesk/shared/types/system';

import { apiClient } from '../../lib/api-client';
import type { PreferencesDraft } from './settings-types';

export interface SettingsPageData {
    browserLiveConfig: RuntimeConfig;
    cacheSummary: CacheSummary;
    piRiskGateState: PiRiskGateState;
    piStatus: PiRuntimeStatus;
    preferences: Record<string, string>;
    runtimeMode: RuntimeMode;
    runtimeStatus: RuntimeStatusResponse;
    syncStatus: SyncStatus;
}

export const loadSettingsPageData = async (): Promise<SettingsPageData> => {
    const [
        preferences,
        cacheSummary,
        runtimeStatus,
        syncStatus,
        runtimeMode,
        browserLiveConfig,
        piRiskGateState,
        piStatus,
    ] = await Promise.all([
        apiClient.settings.getAll(),
        apiClient.data.getCacheSummary(),
        apiClient.system.getRuntimeStatus(),
        apiClient.data.getSyncStatus(),
        apiClient.runtime.getMode(),
        apiClient.runtime.getConfig(),
        apiClient.piRuntime.getRiskGateState(),
        apiClient.piRuntime.getStatus(),
    ]);

    return {
        browserLiveConfig,
        cacheSummary,
        piRiskGateState,
        piStatus,
        preferences,
        runtimeMode,
        runtimeStatus,
        syncStatus,
    };
};

export const subscribeToSettingsSyncStatus = (listener: (status: SyncStatus) => void) =>
    apiClient.data.subscribeSyncStatus(listener);

export const loadRuntimeConfig = async () => await apiClient.runtime.getConfig();

export const refreshPiStatus = async () => await apiClient.piRuntime.getStatus();

export const getPiRiskGateState = async () => await apiClient.piRuntime.getRiskGateState();

export const acknowledgePiHighPrivilegeRisk = async () => await apiClient.piRuntime.acknowledgeHighPrivilegeRisk();

export const openPiRuntimeDirectory = async (target: PiRuntimeDirectoryTarget) =>
    await apiClient.piRuntime.openDirectory(target);

export const savePreferencesDraft = async (preferencesDraft: PreferencesDraft) => {
    await Promise.all([
        apiClient.settings.set('baseCurrency', preferencesDraft.baseCurrency),
        apiClient.settings.set('defaultMarket', preferencesDraft.defaultMarket),
        apiClient.settings.set('defaultMaxSingleWeight', preferencesDraft.defaultMaxSingleWeight),
        apiClient.settings.set('language', preferencesDraft.language),
        apiClient.settings.set('dataSource.akshare.enabled', preferencesDraft.akshareEnabled ? 'true' : 'false'),
        apiClient.settings.set('dataSource.frankfurter.enabled', preferencesDraft.frankfurterEnabled ? 'true' : 'false'),
        apiClient.settings.set('dataSource.tushare.enabled', preferencesDraft.tushareEnabled ? 'true' : 'false'),
        apiClient.settings.set('dataSource.yfinance.enabled', preferencesDraft.yfinanceEnabled ? 'true' : 'false'),
    ]);
};

export const validateSidecarConnection = async (sidecarUrl: string) => {
    const trimmedSidecarUrl = sidecarUrl.trim();

    await apiClient.runtime.updateConfig({ sidecarUrl: trimmedSidecarUrl });

    const validation = await apiClient.runtime.validateSidecarConnection({ sidecarUrl: trimmedSidecarUrl });
    const [runtimeStatus, runtimeConfig] = await Promise.all([
        apiClient.system.getRuntimeStatus(),
        apiClient.runtime.getConfig(),
    ]);

    return {
        runtimeConfig,
        runtimeStatus,
        validation,
    };
};

export const clearMarketDataCache = async () =>
    await apiClient.data.clearCache();

export const openLogDirectory = async () =>
    await apiClient.log.openDirectory();