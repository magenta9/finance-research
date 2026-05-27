import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRuntimeHandlers } from './runtime';

class MemoryPreferencesStore {
    private readonly values = new Map<string, string>();

    delete(key: string) {
        return this.values.delete(key);
    }

    get(key: string) {
        return this.values.get(key) ?? null;
    }

    set(key: string, value: string) {
        this.values.set(key, value);
        return value;
    }
}

describe('createRuntimeHandlers', () => {
    let preferences: MemoryPreferencesStore;

    beforeEach(() => {
        preferences = new MemoryPreferencesStore();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    test('returns browser-live mode and reduced capabilities for ws bridge requests', async () => {
        const handlers = createRuntimeHandlers({
            getSidecarStatus: () => ({ sidecarPort: 9876 }),
            preferences,
        });

        await expect(handlers.getMode({ transport: 'ws-bridge' })).resolves.toBe('browser-live');
        await expect(handlers.getCapabilities({ transport: 'ws-bridge' })).resolves.toEqual({
            hasKeytarSecrets: false,
            hasNativeFileDialog: false,
            hasNativeNotifications: false,
            hasSidecarAutoStart: false,
        });
        await expect(handlers.getMode({})).resolves.toBe('electron');
    });

    test('persists runtime config through the preferences store', async () => {
        const handlers = createRuntimeHandlers({
            getSidecarStatus: () => ({ sidecarPort: 9123 }),
            preferences,
        });

        await expect(handlers.getConfig()).resolves.toEqual({
            lastConnectedAt: null,
            lastConnectionError: null,
            lastInitializationError: null,
            sidecarUrl: 'ws://127.0.0.1:9123',
        });

        await handlers.updateConfig({
            lastInitializationError: 'bridge init failed',
            sidecarUrl: 'ws://127.0.0.1:9100',
        });

        await expect(handlers.getConfig()).resolves.toEqual({
            lastConnectedAt: null,
            lastConnectionError: null,
            lastInitializationError: 'bridge init failed',
            sidecarUrl: 'ws://127.0.0.1:9100',
        });
    });

    test('validates provider connectivity and returns available models', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ models: [{ name: 'qwen3:latest' }] }),
            ok: true,
        }));

        const handlers = createRuntimeHandlers({
            getSidecarStatus: () => ({ sidecarPort: 8765 }),
            preferences,
        });

        await expect(handlers.validateProviderConnection({
            baseUrl: 'http://127.0.0.1:11434/',
            model: 'qwen3:latest',
        })).resolves.toEqual({
            availableModels: ['qwen3:latest'],
            ok: true,
        });
    });
});