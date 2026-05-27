import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PiRuntimeDirectoryTarget } from '@quantdesk/shared/types/pi-runtime';
import type { RuntimeConfig, RuntimeMode } from '@quantdesk/shared/types/system';

import {
    acknowledgePiHighPrivilegeRisk,
    clearMarketDataCache,
    getPiRiskGateState,
    loadSettingsPageData,
    openLogDirectory,
    openPiRuntimeDirectory,
    refreshPiStatus,
    savePreferencesDraft,
    subscribeToSettingsSyncStatus,
    validateSidecarConnection as validateSidecarConnectionRequest,
} from './settings-client';
import {
    createDefaultPreferencesDraft,
    createEmptyRuntimeConfig,
    formatSettingsError,
    type PreferencesDraft,
} from './settings-types';

type PiModelStatus = Awaited<ReturnType<typeof refreshPiStatus>>['model'];

const splitAvailablePiModel = (entry: string) => {
    const [provider, ...modelParts] = entry.split('/');
    const model = modelParts.join('/');

    return model ? { model, provider } : { model: entry, provider: null };
};

export const formatPiModelDisplay = (modelStatus: PiModelStatus) => {
    const provider = modelStatus.provider?.trim() || null;
    const model = modelStatus.model?.trim() || null;

    if (!model) {
        return {
            detail: provider ?? 'provider 未解析',
            value: '未解析',
        };
    }

    const providerMatches = (modelStatus.availableModels ?? [])
        .map(splitAvailablePiModel)
        .filter((availableModel) => availableModel.provider === provider);
    const resolvedModel = providerMatches.find((availableModel) => availableModel.model === model)?.model
        ?? providerMatches.find((availableModel) => availableModel.model.startsWith(`${model}-`))?.model
        ?? model;

    return {
        detail: modelStatus.source === 'runtime' ? 'Pi runtime active model' : (provider ?? 'provider 未解析'),
        value: provider ? `${resolvedModel} [${provider}]` : resolvedModel,
    };
};

export const useSettingsPageController = () => {
    const [browserLiveConfig, setBrowserLiveConfig] = useState<RuntimeConfig>(createEmptyRuntimeConfig());
    const [cacheSummary, setCacheSummary] = useState<Awaited<ReturnType<typeof clearMarketDataCache>>['cacheSummary'] | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPreferencesModalOpen, setIsPreferencesModalOpen] = useState(false);
    const [isSavingPreferences, setIsSavingPreferences] = useState(false);
    const [isValidatingSidecar, setIsValidatingSidecar] = useState(false);
    const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
    const [piRiskGateState, setPiRiskGateState] = useState<Awaited<ReturnType<typeof getPiRiskGateState>> | null>(null);
    const [piStatus, setPiStatus] = useState<Awaited<ReturnType<typeof refreshPiStatus>> | null>(null);
    const [preferencesDraft, setPreferencesDraft] = useState<PreferencesDraft>(createDefaultPreferencesDraft());
    const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('electron');
    const [runtimeStatus, setRuntimeStatus] = useState<Awaited<ReturnType<typeof loadSettingsPageData>>['runtimeStatus'] | null>(null);
    const [sidecarUrlDraft, setSidecarUrlDraft] = useState('');
    const [syncStatus, setSyncStatus] = useState<Awaited<ReturnType<typeof loadSettingsPageData>>['syncStatus'] | null>(null);

    const hydrateSettings = useCallback(async () => {
        const {
            browserLiveConfig: nextBrowserLiveConfig,
            cacheSummary: nextCacheSummary,
            piRiskGateState: nextPiRiskGateState,
            piStatus: nextPiStatus,
            preferences,
            runtimeMode: nextRuntimeMode,
            runtimeStatus: nextRuntimeStatus,
            syncStatus: nextSyncStatus,
        } = await loadSettingsPageData();

        setBrowserLiveConfig(nextBrowserLiveConfig);
        setCacheSummary(nextCacheSummary);
        setPiRiskGateState(nextPiRiskGateState);
        setPiStatus(nextPiStatus);
        setPreferencesDraft({
            akshareEnabled: preferences['dataSource.akshare.enabled'] !== 'false',
            baseCurrency: (preferences.baseCurrency as PreferencesDraft['baseCurrency']) ?? 'CNY',
            defaultMarket: (preferences.defaultMarket as PreferencesDraft['defaultMarket']) ?? 'US',
            defaultMaxSingleWeight: preferences.defaultMaxSingleWeight ?? '0.35',
            frankfurterEnabled: preferences['dataSource.frankfurter.enabled'] !== 'false',
            language: (preferences.language as PreferencesDraft['language']) ?? 'zh-CN',
            tushareEnabled: preferences['dataSource.tushare.enabled'] !== 'false',
            yfinanceEnabled: preferences['dataSource.yfinance.enabled'] !== 'false',
        });
        setRuntimeMode(nextRuntimeMode);
        setRuntimeStatus(nextRuntimeStatus);
        setSidecarUrlDraft(nextBrowserLiveConfig.sidecarUrl);
        setSyncStatus(nextSyncStatus);
    }, []);

    const loadSettings = useCallback(async () => {
        setErrorMessage(null);
        setIsLoading(true);

        try {
            await hydrateSettings();
            setIsLoading(false);
        } catch (error) {
            setErrorMessage(formatSettingsError(error));
            setIsLoading(false);
        }
    }, [hydrateSettings]);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        const unsubscribe = subscribeToSettingsSyncStatus((status) => {
            setSyncStatus(status);
        });

        return unsubscribe;
    }, []);

    const savePreferences = useCallback(async () => {
        setErrorMessage(null);
        setIsSavingPreferences(true);

        try {
            await savePreferencesDraft(preferencesDraft);
            setNoticeMessage('设置已保存。');
            setIsSavingPreferences(false);
            return true;
        } catch (error) {
            setErrorMessage(formatSettingsError(error));
            setIsSavingPreferences(false);
            return false;
        }
    }, [preferencesDraft]);

    const refreshPiRuntime = useCallback(async () => {
        setErrorMessage(null);

        try {
            const [nextPiStatus, nextPiRiskGateState] = await Promise.all([
                refreshPiStatus(),
                getPiRiskGateState(),
            ]);
            setPiStatus(nextPiStatus);
            setPiRiskGateState(nextPiRiskGateState);
            setNoticeMessage('Pi runtime 状态已刷新。');
        } catch (error) {
            setErrorMessage(formatSettingsError(error));
        }
    }, []);

    const acknowledgePiRisk = useCallback(async () => {
        setErrorMessage(null);

        try {
            const nextState = await acknowledgePiHighPrivilegeRisk();
            setPiRiskGateState(nextState);
            setNoticeMessage('已确认 Pi Agent 高权限风险。');
        } catch (error) {
            setErrorMessage(formatSettingsError(error));
        }
    }, []);

    const openPiDirectory = useCallback(async (target: PiRuntimeDirectoryTarget) => {
        setErrorMessage(null);

        try {
            await openPiRuntimeDirectory(target);
            setNoticeMessage('Pi runtime 目录已打开。');
        } catch (error) {
            setErrorMessage(formatSettingsError(error));
        }
    }, []);

    const validateSidecarConnection = useCallback(async () => {
        setErrorMessage(null);
        setIsValidatingSidecar(true);

        try {
            const { runtimeConfig: nextRuntimeConfig, runtimeStatus: nextRuntimeStatus, validation } = await validateSidecarConnectionRequest(sidecarUrlDraft);

            setBrowserLiveConfig(nextRuntimeConfig);
            setRuntimeStatus(nextRuntimeStatus);
            setSidecarUrlDraft(nextRuntimeConfig.sidecarUrl);

            if (!validation.ok) {
                throw new Error(validation.error ?? nextRuntimeConfig.lastConnectionError ?? 'Sidecar 未就绪。');
            }

            setNoticeMessage('Sidecar 连接验证成功。');
            setIsValidatingSidecar(false);
        } catch (error) {
            setErrorMessage(formatSettingsError(error));
            setIsValidatingSidecar(false);
        }
    }, [sidecarUrlDraft]);

    const clearCache = useCallback(async () => {
        const confirmed = window.confirm('这会删除本地 daily_prices 和 fx_rates 缓存，但不会影响资产池、持仓和已保存方案。是否继续？');

        if (!confirmed) {
            return;
        }

        try {
            const result = await clearMarketDataCache();
            setCacheSummary(result.cacheSummary);
            setSyncStatus(result.syncStatus);
            setNoticeMessage('本地行情缓存已清除。');
        } catch (error) {
            setErrorMessage(formatSettingsError(error));
        }
    }, []);

    const handleClearMessages = useCallback(() => {
        setErrorMessage(null);
        setNoticeMessage(null);
    }, []);

    const handleRefreshPiRuntime = useCallback(() => {
        void refreshPiRuntime();
    }, [refreshPiRuntime]);

    const handleAcknowledgePiRisk = useCallback(() => {
        void acknowledgePiRisk();
    }, [acknowledgePiRisk]);

    const handleOpenPreferencesModal = useCallback(() => {
        setIsPreferencesModalOpen(true);
    }, []);

    const handleClearCache = useCallback(() => {
        void clearCache();
    }, [clearCache]);

    const handleReloadSettings = useCallback(() => {
        void loadSettings();
    }, [loadSettings]);

    const handleOpenLogDirectory = useCallback(() => {
        void openLogDirectory();
    }, []);

    const handleValidateSidecarConnection = useCallback(() => {
        void validateSidecarConnection();
    }, [validateSidecarConnection]);

    const handleClosePreferencesModal = useCallback(() => {
        setIsPreferencesModalOpen(false);
    }, []);

    const handleSavePreferences = useCallback(async () => {
        const saved = await savePreferences();

        if (saved) {
            setIsPreferencesModalOpen(false);
        }

        return saved;
    }, [savePreferences]);

    const dataSourceSummary = [
        `AKShare ${preferencesDraft.akshareEnabled ? '✓' : '×'}`,
        `TuShare ${preferencesDraft.tushareEnabled ? '✓' : '×'}`,
        `YFinance ${preferencesDraft.yfinanceEnabled ? '✓' : '×'}`,
        `Frankfurter ${preferencesDraft.frankfurterEnabled ? '✓' : '×'}`,
    ].join(' / ');

    const metrics = useMemo(() => {
        if (!piStatus || !piRiskGateState || !runtimeStatus) {
            return [
                { detail: '等待 Pi runtime 状态。', label: 'Pi Runtime', value: '加载中' },
                { detail: '等待模型列表。', label: 'Pi Model', value: 'n/a' },
                { detail: '等待 finance tools 状态。', label: 'Finance Tools', value: '0' },
                { detail: '等待高权限风险确认状态。', label: 'Pi Risk Gate', value: 'n/a' },
                { detail: '等待 sidecar 状态。', label: 'Sidecar', value: '加载中' },
            ];
        }

        const piModelDisplay = formatPiModelDisplay(piStatus.model);

        return [
            {
                detail: piStatus.lastError ?? `当前 ${piStatus.sessionCount} 个 Pi 会话。`,
                label: 'Pi Runtime',
                value: piStatus.state,
            },
            {
                detail: piModelDisplay.detail,
                label: 'Pi Model',
                value: piModelDisplay.value,
            },
            {
                detail: piStatus.financeTools.lastError ?? (piStatus.financeTools.available ? 'Finance tools 已就绪。' : 'Finance tools 不可用。'),
                label: 'Finance Tools',
                value: String(piStatus.financeTools.names.length),
            },
            {
                detail: piRiskGateState?.message ?? '发送消息前需要确认高权限风险。',
                label: 'Pi Risk Gate',
                value: piRiskGateState?.acknowledged ? '已确认' : '待确认',
            },
            {
                detail: runtimeStatus.lastError ?? `PID ${runtimeStatus.sidecarPid ?? 'n/a'} · Port ${runtimeStatus.sidecarPort ?? 'n/a'}`,
                label: 'Sidecar',
                value: runtimeStatus.sidecarReady ? 'ready' : 'offline',
            },
        ];
    }, [piRiskGateState, piStatus, runtimeStatus]);

    return {
        browserLiveConfig,
        cacheSummary,
        dataSourceSummary,
        errorMessage,
        handleAcknowledgePiRisk,
        handleClearCache,
        handleClearMessages,
        handleClosePreferencesModal,
        handleOpenLogDirectory,
        handleOpenPreferencesModal,
        handleRefreshPiRuntime,
        handleReloadSettings,
        handleSavePreferences,
        handleValidateSidecarConnection,
        isLoading,
        isPreferencesModalOpen,
        isSavingPreferences,
        isValidatingSidecar,
        metrics,
        noticeMessage,
        openPiDirectory,
        piRiskGateState,
        piStatus,
        preferencesDraft,
        runtimeMode,
        runtimeStatus,
        setPreferencesDraft,
        setSidecarUrlDraft,
        sidecarUrlDraft,
        syncStatus,
    };
};
