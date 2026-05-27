import type { QuantdeskApi } from '@quantdesk/shared/types/api';

let overrideClient: QuantdeskApi | null = null;

export const setApiClientOverride = (client: QuantdeskApi | null) => {
    overrideClient = client;
};

export const getApiClient = (): QuantdeskApi => overrideClient ?? globalThis.window.api;

export const apiClient = new Proxy({} as QuantdeskApi, {
    get(_target, property) {
        return getApiClient()[property as keyof QuantdeskApi];
    },
});