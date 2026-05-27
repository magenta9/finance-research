// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { RendererLogger } from './logger';

describe('RendererLogger', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        window.api = {
            log: {
                openDirectory: vi.fn().mockResolvedValue(undefined),
                write: vi.fn(),
                writeBatch: vi.fn(),
            },
            runtime: {
                getCapabilities: vi.fn().mockResolvedValue({
                    hasKeytarSecrets: true,
                    hasNativeFileDialog: true,
                    hasNativeNotifications: true,
                    hasSidecarAutoStart: true,
                }),
                getConfig: vi.fn().mockResolvedValue({
                    lastConnectedAt: null,
                    lastConnectionError: null,
                    lastInitializationError: null,
                    sidecarUrl: 'ws://127.0.0.1:8765',
                }),
                getMode: vi.fn().mockResolvedValue('electron'),
                updateConfig: vi.fn(),
                validateProviderConnection: vi.fn().mockResolvedValue({ availableModels: ['qwen3:latest'], ok: true }),
                validateSidecarConnection: vi.fn().mockResolvedValue({ ok: true }),
            },
        } as unknown as QuantdeskApi;
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    test('batches logs on the flush timer', () => {
        const rendererLogger = new RendererLogger({ flushIntervalMs: 300, maxBatchSize: 20 });

        rendererLogger.info('first');
        rendererLogger.warn('second');

        expect(window.api.log.writeBatch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);

        expect(window.api.log.writeBatch).toHaveBeenCalledTimes(1);
        expect(window.api.log.writeBatch).toHaveBeenCalledWith([
            expect.objectContaining({ level: 'info', message: 'first' }),
            expect.objectContaining({ level: 'warn', message: 'second' }),
        ]);
    });

    test('flushes immediately when the queue reaches maxBatchSize', () => {
        const rendererLogger = new RendererLogger({ flushIntervalMs: 300, maxBatchSize: 2 });

        rendererLogger.error('first', new Error('boom'));
        rendererLogger.error('second', new Error('bang'));

        expect(window.api.log.writeBatch).toHaveBeenCalledTimes(1);
        expect(window.api.log.writeBatch).toHaveBeenCalledWith([
            expect.objectContaining({ error: 'boom', level: 'error', message: 'first' }),
            expect.objectContaining({ error: 'bang', level: 'error', message: 'second' }),
        ]);
    });
});