import type {
    LlmProviderConfig,
} from '@quantdesk/shared';
import type { RuntimeConfig, RuntimeStatusResponse } from '@quantdesk/shared/types/system';

export interface PreferencesDraft {
    akshareEnabled: boolean;
    baseCurrency: 'CNY' | 'USD' | 'HKD';
    defaultMarket: 'A' | 'HK' | 'US' | 'BOND' | 'COMMODITY';
    defaultMaxSingleWeight: string;
    frankfurterEnabled: boolean;
    language: 'zh-CN' | 'en-US';
    tushareEnabled: boolean;
    yfinanceEnabled: boolean;
}

export interface ProviderDraft {
    apiKey: string;
    baseUrl: string;
    enabled: boolean;
    model: string;
    name: string;
    type: LlmProviderConfig['type'];
}

export type AddProviderStep = 'select-type' | 'fill-form';

export const createDefaultPreferencesDraft = (): PreferencesDraft => ({
    akshareEnabled: true,
    baseCurrency: 'CNY',
    defaultMarket: 'US',
    defaultMaxSingleWeight: '0.35',
    frankfurterEnabled: true,
    language: 'zh-CN',
    tushareEnabled: true,
    yfinanceEnabled: true,
});

export const createNewProviderDraft = (type: LlmProviderConfig['type']): ProviderDraft => {
    if (type === 'openai-compatible') {
        return {
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            enabled: true,
            model: 'gpt-4.1-mini',
            name: '',
            type,
        };
    }

    return {
        apiKey: '',
        baseUrl: 'http://127.0.0.1:11434',
        enabled: true,
        model: 'qwen3:latest',
        name: '',
        type,
    };
};

export const formatSettingsError = (error: unknown) =>
    error instanceof Error ? error.message : '发生未知错误。';

export const buildProviderDraft = (provider: LlmProviderConfig): ProviderDraft => ({
    apiKey: '',
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    model: provider.model,
    name: provider.name,
    type: provider.type,
});

export const createEmptyRuntimeConfig = (): RuntimeConfig => ({
    lastConnectedAt: null,
    lastConnectionError: null,
    lastInitializationError: null,
    sidecarUrl: '',
});

export const formatMetadataBackfillSummary = (runtimeStatus: RuntimeStatusResponse | null) => {
    const status = runtimeStatus?.metadataBackfill;

    if (!status) {
        return '尚未上报';
    }

    if (status.state === 'running') {
        return `扫描中 · ${status.scannedAssets} 已检查`;
    }

    if (status.state === 'completed') {
        return `已完成 · 更新 ${status.updatedAssets} / ${status.scannedAssets}`;
    }

    if (status.state === 'failed') {
        return `失败 · ${status.lastError ?? '未知错误'}`;
    }

    return '空闲';
};