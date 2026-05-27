import { describe, expect, test, vi } from 'vitest';

import { listIpcContractEntries } from '@quantdesk/shared/ipc-contract';
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

describe('main IPC contract', () => {
    test('registers every invoke and send manifest entry', () => {
        const handle = vi.fn();
        const on = vi.fn();

        registerIpcHandlers({
            registrar: { handle, on },
            dataServices: createStubDataServices(),
        });

        const registeredInvokeChannels = [...new Set(handle.mock.calls.map(([channel]) => channel as string))].sort();
        const registeredSendChannels = [...new Set(on.mock.calls.map(([channel]) => channel as string))].sort();
        const expectedInvokeChannels = listIpcContractEntries()
            .filter((entry) => entry.transport === 'invoke')
            .map((entry) => entry.channel)
            .sort();
        const expectedSendChannels = listIpcContractEntries()
            .filter((entry) => entry.transport === 'send')
            .map((entry) => entry.channel)
            .sort();

        expect(registeredInvokeChannels).toEqual(expectedInvokeChannels);
        expect(registeredSendChannels).toEqual(expectedSendChannels);
    });

    test('broadcasts sync status only to window web contents', () => {
        const windowSend = vi.fn();
        const backgroundSend = vi.fn();

        mocks.webContents.getAllWebContents.mockReturnValue([
            {
                getType: () => 'window',
                send: windowSend,
            },
            {
                getType: () => 'service_worker',
                send: backgroundSend,
            },
        ] as never);

        registerIpcHandlers({
            registrar: { handle: vi.fn(), on: vi.fn() },
            dataServices: createStubDataServices(),
            runtime: createStubRegisterIpcRuntime({
                priceSyncService: {
                    subscribeSyncStatus(listener: (status: SyncStatus) => void) {
                        listener({ activeTask: null, completedTasks: 0, failedTasks: 0, lastWarning: null, queuedTasks: 0, recentEvents: [], running: false });
                        return () => undefined;
                    },
                },
            }),
        });

        expect(windowSend).toHaveBeenCalledWith(IpcChannel.DataSyncStatusUpdated, expect.objectContaining({
            completedTasks: 0,
            running: false,
        }));
        expect(backgroundSend).not.toHaveBeenCalled();
    });
});