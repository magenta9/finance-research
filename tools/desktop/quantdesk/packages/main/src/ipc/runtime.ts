import { RpcClient } from '../sidecar/rpc-client';

import type {
    PreferenceMap,
    ProviderValidationResult,
    RuntimeCapabilities,
    RuntimeConfig,
    RuntimeMode,
    SidecarValidationResult,
} from '@quantdesk/shared';

import type { ContractBinder } from './contract-binder';

interface RuntimeStatusLike {
    sidecarPort: number | null;
}

interface RuntimeRequestSender {
    send?: (channel: string, data: unknown) => void;
}

export interface RuntimeRequestContext {
    sender?: RuntimeRequestSender;
    transport?: 'electron' | 'ws-bridge';
}

interface RuntimePreferencesStore {
    delete: (key: string) => boolean;
    get: (key: string) => string | null;
    getAll?: () => PreferenceMap;
    set: (key: string, value: string) => string;
}

export interface CreateRuntimeHandlersOptions {
    preferences: RuntimePreferencesStore;
    getSidecarStatus: () => RuntimeStatusLike;
}

const runtimePreferenceKeys = {
    lastConnectedAt: 'runtime.browser.lastConnectedAt',
    lastConnectionError: 'runtime.browser.lastConnectionError',
    lastInitializationError: 'runtime.browser.lastInitializationError',
    sidecarUrl: 'runtime.browser.sidecarUrl',
} as const;

const defaultDirectSidecarUrl = 'ws://127.0.0.1:8765';
const defaultFetchTimeoutMs = 5_000;

const normalizeBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/$/, '');

const withTimeout = async (input: string, init: RequestInit = {}, timeoutMs = defaultFetchTimeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error(`请求超时，超过 ${timeoutMs}ms。`);
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

const setNullablePreference = (preferences: RuntimePreferencesStore, key: string, value: string | null | undefined) => {
    if (typeof value === 'string') {
        preferences.set(key, value);
        return;
    }

    preferences.delete(key);
};

const readNullablePreference = (preferences: RuntimePreferencesStore, key: string) => {
    const value = preferences.get(key);
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const resolveRuntimeModeFromEvent = (event: unknown): RuntimeMode => {
    if (
        event != null
        && typeof event === 'object'
        && 'transport' in event
        && (event as RuntimeRequestContext).transport === 'ws-bridge'
    ) {
        return 'browser-live';
    }

    return 'electron';
};

const getCapabilitiesForMode = (mode: RuntimeMode): RuntimeCapabilities => {
    if (mode === 'browser-live') {
        return {
            hasKeytarSecrets: false,
            hasNativeFileDialog: false,
            hasNativeNotifications: false,
            hasSidecarAutoStart: false,
        };
    }

    return {
        hasKeytarSecrets: true,
        hasNativeFileDialog: true,
        hasNativeNotifications: true,
        hasSidecarAutoStart: true,
    };
};

const resolveDefaultSidecarUrl = (port: number | null) => (
    port != null ? `ws://127.0.0.1:${port}` : defaultDirectSidecarUrl
);

const readRuntimeConfig = (
    preferences: RuntimePreferencesStore,
    getSidecarStatus: () => RuntimeStatusLike,
): RuntimeConfig => ({
    lastConnectedAt: readNullablePreference(preferences, runtimePreferenceKeys.lastConnectedAt),
    lastConnectionError: readNullablePreference(preferences, runtimePreferenceKeys.lastConnectionError),
    lastInitializationError: readNullablePreference(preferences, runtimePreferenceKeys.lastInitializationError),
    sidecarUrl:
        readNullablePreference(preferences, runtimePreferenceKeys.sidecarUrl)
        ?? resolveDefaultSidecarUrl(getSidecarStatus().sidecarPort),
});

const persistRuntimeConfig = (
    preferences: RuntimePreferencesStore,
    nextConfig: RuntimeConfig,
) => {
    setNullablePreference(preferences, runtimePreferenceKeys.sidecarUrl, nextConfig.sidecarUrl.trim());
    setNullablePreference(preferences, runtimePreferenceKeys.lastConnectedAt, nextConfig.lastConnectedAt);
    setNullablePreference(preferences, runtimePreferenceKeys.lastConnectionError, nextConfig.lastConnectionError);
    setNullablePreference(preferences, runtimePreferenceKeys.lastInitializationError, nextConfig.lastInitializationError);
    return nextConfig;
};

const validateModels = (availableModels: string[], requestedModel?: string) => {
    if (requestedModel && !availableModels.includes(requestedModel)) {
        throw new Error(`模型 ${requestedModel} 不存在。`);
    }
};

const validateOllamaProvider = async (baseUrl: string, model?: string) => {
    const response = await withTimeout(`${baseUrl}/api/tags`, { method: 'GET' });

    if (!response.ok) {
        throw new Error(`Provider 连接检查失败：${response.status}`);
    }

    const payload = await response.json() as {
        models?: Array<{ model?: string; name?: string }>;
    };
    const availableModels = (payload.models ?? [])
        .map((entry) => entry.model ?? entry.name ?? '')
        .filter(Boolean);

    validateModels(availableModels, model);

    return availableModels;
};

const validateOpenAiCompatibleProvider = async (baseUrl: string, model?: string) => {
    const candidateUrls = baseUrl.endsWith('/v1')
        ? [`${baseUrl}/models`]
        : [`${baseUrl}/models`, `${baseUrl}/v1/models`];
    let lastError: Error | null = null;

    for (const url of candidateUrls) {
        try {
            const response = await withTimeout(url, { method: 'GET' });

            if (!response.ok) {
                lastError = new Error(`Provider 连接检查失败：${response.status}`);
                continue;
            }

            const payload = await response.json() as {
                data?: Array<{ id?: string }>;
            };
            const availableModels = (payload.data ?? [])
                .map((entry) => entry.id ?? '')
                .filter(Boolean);

            validateModels(availableModels, model);

            return availableModels;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }

    throw lastError ?? new Error('Provider 连接检查失败。');
};

const validateProviderConnectionInternal = async ({
    baseUrl,
    model,
}: {
    baseUrl: string;
    model?: string;
}): Promise<ProviderValidationResult> => {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

    try {
        const availableModels = await validateOllamaProvider(normalizedBaseUrl, model);

        return {
            availableModels,
            ok: true,
        };
    } catch (ollamaError) {
        try {
            const availableModels = await validateOpenAiCompatibleProvider(normalizedBaseUrl, model);

            return {
                availableModels,
                ok: true,
            };
        } catch (openAiError) {
            const fallbackError = openAiError instanceof Error ? openAiError.message : String(openAiError);
            const primaryError = ollamaError instanceof Error ? ollamaError.message : String(ollamaError);

            return {
                error: `Ollama 检查失败：${primaryError}；OpenAI-compatible 检查失败：${fallbackError}`,
                ok: false,
            };
        }
    }
};

const validateSidecarConnectionInternal = async (sidecarUrl: string): Promise<SidecarValidationResult> => {
    const client = new RpcClient();

    try {
        await client.connect(sidecarUrl);
        await client.call('health_check', undefined, 5_000);
        await client.close();

        return { ok: true };
    } catch (error) {
        const closeErrorMessage = await client.close().then(() => null).catch((closeError) => (
            closeError instanceof Error ? closeError.message : String(closeError)
        ));
        return {
            error: closeErrorMessage
                ? `${error instanceof Error ? error.message : String(error)} (cleanup: ${closeErrorMessage})`
                : (error instanceof Error ? error.message : String(error)),
            ok: false,
        };
    }
};

export const createRuntimeHandlers = ({
    preferences,
    getSidecarStatus,
}: CreateRuntimeHandlersOptions) => ({
    getMode: async (event?: unknown) => resolveRuntimeModeFromEvent(event),
    getCapabilities: async (event?: unknown) => getCapabilitiesForMode(resolveRuntimeModeFromEvent(event)),
    getConfig: async () => readRuntimeConfig(preferences, getSidecarStatus),
    updateConfig: async (updates: Partial<RuntimeConfig>) => {
        const current = readRuntimeConfig(preferences, getSidecarStatus);
        const nextConfig: RuntimeConfig = {
            ...current,
            ...updates,
            sidecarUrl: typeof updates.sidecarUrl === 'string' && updates.sidecarUrl.trim().length > 0
                ? updates.sidecarUrl.trim()
                : current.sidecarUrl,
        };

        return persistRuntimeConfig(preferences, nextConfig);
    },
    validateSidecarConnection: async (input?: { sidecarUrl?: string }) => {
        const current = readRuntimeConfig(preferences, getSidecarStatus);
        const sidecarUrl = input?.sidecarUrl?.trim() || current.sidecarUrl;
        const validation = await validateSidecarConnectionInternal(sidecarUrl);

        persistRuntimeConfig(preferences, {
            ...current,
            lastConnectedAt: validation.ok ? new Date().toISOString() : current.lastConnectedAt,
            lastConnectionError: validation.ok ? null : validation.error ?? 'Sidecar 未就绪。',
            sidecarUrl,
        });

        return validation;
    },
    validateProviderConnection: async (provider: { baseUrl: string; model?: string }) => {
        return await validateProviderConnectionInternal(provider);
    },
});

export const registerRuntimeIpc = (
    binder: ContractBinder,
    handlers: ReturnType<typeof createRuntimeHandlers>,
) => {
    binder.handleInvoke<'runtime', 'getMode'>('runtime', 'getMode', (context) => handlers.getMode(context.event));
    binder.handleInvoke<'runtime', 'getCapabilities'>('runtime', 'getCapabilities', (context) => handlers.getCapabilities(context.event));
    binder.registerInvokeNamespace<'runtime'>('runtime', {
        getConfig: handlers.getConfig,
        updateConfig: handlers.updateConfig,
        validateProviderConnection: handlers.validateProviderConnection,
        validateSidecarConnection: handlers.validateSidecarConnection,
    });
};