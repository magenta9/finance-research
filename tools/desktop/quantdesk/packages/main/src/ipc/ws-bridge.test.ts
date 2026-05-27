import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import WebSocket from 'ws';

import { IpcChannel } from '@quantdesk/shared/ipc-channels';
import type { SyncStatus } from '@quantdesk/shared/types/market';

const mocks = vi.hoisted(() => ({
    app: {
        getPath: vi.fn(() => '/tmp/quantdesk'),
    },
    ipcMain: {
        handle: vi.fn(),
        on: vi.fn(),
    },
    shell: {
        openPath: vi.fn(),
    },
    webContents: {
        getAllWebContents: vi.fn(() => []),
    },
}));

vi.mock('electron', () => ({
    app: mocks.app,
    ipcMain: mocks.ipcMain,
    shell: mocks.shell,
    webContents: mocks.webContents,
}));

import { registerIpcHandlers } from './register';
import { createStubDataServices, createStubRegisterIpcRuntime } from './test-support';
import { WsBridgeServer } from './ws-bridge-server';

const connectClient = async (port: number) => {
    return await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`);

        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });
};

const readMessage = async (socket: WebSocket) => {
    return await new Promise<unknown>((resolve, reject) => {
        socket.once('message', (data) => {
            try {
                resolve(JSON.parse(data.toString()));
            } catch (error) {
                reject(error);
            }
        });
    });
};

describe('WsBridgeServer', () => {
    let server: WsBridgeServer | null = null;
    let socket: WebSocket | null = null;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => {
            if (!socket) {
                resolve();
                return;
            }

            socket.once('close', () => resolve());
            socket.close();
            socket = null;
        });

        await server?.stop();
        server = null;
    });

    test('routes invoke requests through the ws bridge', async () => {
        server = new WsBridgeServer();
        const handlerMap = registerIpcHandlers({
            eventBroadcast: (channel, payload) => server?.broadcastEvent(channel, payload),
            registrar: { handle: vi.fn(), on: vi.fn() },
            dataServices: createStubDataServices({ baseCurrency: 'CNY' }),
            systemHandlers: {
                checkNativeBindings: async () => ({
                    driver: 'better-sqlite3',
                    memoryDbReady: true,
                    sqliteVersion: '3.47.0',
                }),
                getRuntimeStatus: async () => ({
                    lastError: null,
                    logDir: null,
                    sidecarPid: null,
                    sidecarPort: null,
                    sidecarReady: false,
                }),
                ping: async () => ({
                    appVersion: '0.1.0-test',
                    message: 'pong',
                    timestamp: '2026-04-10T00:00:00.000Z',
                }),
                runDummyPython: async () => ({
                    command: 'python3',
                    exitCode: 0,
                    scriptPath: '/tmp/dummy.py',
                    stderr: '',
                    stdout: 'dummy-ok',
                }),
            },
        });

        server.useHandlers(handlerMap);
        const port = await server.start(0);
        socket = await connectClient(port);

        socket.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: IpcChannel.SystemPing, params: [] }));
        await expect(readMessage(socket)).resolves.toMatchObject({
            id: 1,
            result: {
                appVersion: '0.1.0-test',
                message: 'pong',
            },
        });

        socket.send(JSON.stringify({ id: 2, jsonrpc: '2.0', method: IpcChannel.SettingsGetAll, params: [] }));
        await expect(readMessage(socket)).resolves.toMatchObject({
            id: 2,
            result: {
                baseCurrency: 'CNY',
            },
        });
    });

    test('broadcasts subscribe events to connected ws clients', async () => {
        let syncStatusListener: ((status: SyncStatus) => void) | null = null;

        server = new WsBridgeServer();
        const handlerMap = registerIpcHandlers({
            eventBroadcast: (channel, payload) => server?.broadcastEvent(channel, payload),
            registrar: { handle: vi.fn(), on: vi.fn() },
            dataServices: createStubDataServices({ baseCurrency: 'CNY' }),
            runtime: createStubRegisterIpcRuntime({
                priceSyncService: {
                    subscribeSyncStatus(listener: (status: SyncStatus) => void) {
                        syncStatusListener = listener;
                        return () => undefined;
                    },
                },
            }),
            systemHandlers: {
                checkNativeBindings: async () => ({
                    driver: 'better-sqlite3',
                    memoryDbReady: true,
                    sqliteVersion: '3.47.0',
                }),
                getRuntimeStatus: async () => ({
                    lastError: null,
                    logDir: null,
                    sidecarPid: null,
                    sidecarPort: null,
                    sidecarReady: false,
                }),
                ping: async () => ({
                    appVersion: '0.1.0-test',
                    message: 'pong',
                    timestamp: '2026-04-10T00:00:00.000Z',
                }),
                runDummyPython: async () => ({
                    command: 'python3',
                    exitCode: 0,
                    scriptPath: '/tmp/dummy.py',
                    stderr: '',
                    stdout: 'dummy-ok',
                }),
            },
        });

        server.useHandlers(handlerMap);
        const port = await server.start(0);
        socket = await connectClient(port);

        if (!syncStatusListener) {
            throw new Error('Expected syncStatusListener to be registered.');
        }

        const listener = syncStatusListener as (status: SyncStatus) => void;

        listener({
            activeTask: null,
            completedTasks: 1,
            failedTasks: 0,
            lastWarning: null,
            queuedTasks: 0,
            recentEvents: [],
            running: false,
        });

        await expect(readMessage(socket)).resolves.toMatchObject({
            jsonrpc: '2.0',
            method: IpcChannel.DataSyncStatusUpdated,
            params: [
                expect.objectContaining({
                    completedTasks: 1,
                    running: false,
                }),
            ],
        });
    });

    test('returns a structured error for unknown channels', async () => {
        server = new WsBridgeServer().useHandlers({ invoke: {}, send: {} });
        const port = await server.start(0);
        socket = await connectClient(port);

        socket.send(JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'missing:channel', params: [] }));
        await expect(readMessage(socket)).resolves.toMatchObject({
            error: {
                code: -32000,
                message: 'Unknown invoke channel: missing:channel',
            },
            id: 1,
            jsonrpc: '2.0',
        });
    });

    test('returns timeout errors when handlers do not resolve', async () => {
        server = new WsBridgeServer().useHandlers({
            invoke: {
                [IpcChannel.SystemPing]: async () => await new Promise(() => undefined),
            },
            send: {},
        });
        (
            server as unknown as { timeoutByChannel: Map<string, number> }
        ).timeoutByChannel.set(IpcChannel.SystemPing, 10);
        const port = await server.start(0);
        socket = await connectClient(port);

        socket.send(JSON.stringify({ id: 99, jsonrpc: '2.0', method: IpcChannel.SystemPing, params: [] }));
        await expect(readMessage(socket)).resolves.toMatchObject({
            error: {
                code: -32000,
                message: 'WS bridge handler timed out: system:ping (10ms)',
            },
            id: 99,
            jsonrpc: '2.0',
        });
    });
});