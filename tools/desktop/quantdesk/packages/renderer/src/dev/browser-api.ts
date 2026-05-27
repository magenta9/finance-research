import type { QuantdeskApi } from '@quantdesk/shared/types/api';
import type { RuntimeConfig } from '@quantdesk/shared/types/system';
import { createQuantdeskApiFromPort, type QuantdeskPort } from '@quantdesk/shared/quantdesk-port';

import { createWsBridgeApi } from './ws-bridge-client';

let bridgeApiPromise: Promise<QuantdeskApi> | null = null;
let lastInitializationError: string | null = null;

const reportBridgeError = (message: string, error: unknown, context?: Record<string, unknown>) => {
    console.warn(`[renderer] ${message}`, {
        ...context,
        error: error instanceof Error ? error.message : String(error),
    });
};

const mergeRuntimeConfig = (config: RuntimeConfig): RuntimeConfig => ({
    ...config,
    lastInitializationError: lastInitializationError ?? config.lastInitializationError,
});

const resolveWsBridgeUrl = () => {
    const wsBridgePort = import.meta.env.VITE_WS_BRIDGE_PORT;

    if (!wsBridgePort) {
        throw new Error('缺少 VITE_WS_BRIDGE_PORT，无法建立浏览器调试桥。');
    }

    return `ws://127.0.0.1:${wsBridgePort}`;
};

const getBridgeApi = async () => {
    if (!bridgeApiPromise) {
        bridgeApiPromise = createWsBridgeApi(resolveWsBridgeUrl())
            .then((api) => {
                lastInitializationError = null;
                return api;
            })
            .catch((error) => {
                lastInitializationError = error instanceof Error ? error.message : String(error);
                bridgeApiPromise = null;
                throw error;
            });
    }

    return await bridgeApiPromise;
};

const callDeferred = async <T,>(
    namespace: keyof QuantdeskApi,
    method: string,
    args: unknown[],
) => {
    const api = await getBridgeApi();
    const target = api[namespace] as unknown as Record<string, (...methodArgs: unknown[]) => Promise<unknown>>;
    const result = await target[method](...args);

    if (namespace === 'runtime' && method === 'getConfig') {
        return mergeRuntimeConfig(result as RuntimeConfig) as T;
    }

    return result as T;
};

const createDeferredPort = (): QuantdeskPort => ({
    invoke: (namespace, method, _entry, args) =>
        callDeferred(namespace, method, args) as never,
    send: (namespace, method, _entry, args) => {
        void callDeferred(namespace, method, args).catch((error) => {
            reportBridgeError('Deferred renderer send failed.', error, { method, namespace });
        });
    },
    subscribe: (namespace, method, _entry, listener) => {
        let disposed = false;
        let cleanup: () => void = () => { };

        void callDeferred(namespace, method, [listener])
            .then((unsubscribe) => {
                if (disposed || typeof unsubscribe !== 'function') {
                    return;
                }

                cleanup = unsubscribe as () => void;
            })
            .catch((error) => {
                reportBridgeError('Deferred renderer subscribe failed.', error, { method, namespace });
            });

        return (() => {
            disposed = true;
            cleanup();
        }) as never;
    },
});

const createDeferredApi = (): QuantdeskApi => createQuantdeskApiFromPort(createDeferredPort());

export const ensureBrowserApi = () => {
    if (typeof window === 'undefined' || window.api) {
        return;
    }

    window.api = createDeferredApi();

    void getBridgeApi().catch((error) => {
        reportBridgeError('Deferred renderer bridge initialization failed.', error);
    });
};