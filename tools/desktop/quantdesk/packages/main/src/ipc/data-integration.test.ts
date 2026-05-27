import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { runMigrations } from '../db/database';
import { createRepositories } from '../db/repositories';
import { createDataServices } from '../db/services';
import { createQuantdeskApi } from '../../../preload/src/api';

const mocks = vi.hoisted(() => ({
  appMock: {
    getVersion: () => '0.1.0-test',
    isPackaged: false,
  },
  ipcMainMock: {
    handle: vi.fn(),
  },
  webContentsMock: {
    getAllWebContents: vi.fn(() => []),
  },
}));

vi.mock('electron', () => ({
  app: mocks.appMock,
  ipcMain: mocks.ipcMainMock,
  webContents: mocks.webContentsMock,
}));

import { registerIpcHandlers } from './register';
import { createStubRegisterIpcRuntime } from './test-support';

class MemorySecretStore {
  private readonly values = new Map<string, string>();

  async get(service: string, account: string) {
    return this.values.get(`${service}:${account}`) ?? null;
  }

  async set(service: string, account: string, password: string) {
    this.values.set(`${service}:${account}`, password);
  }

  async delete(service: string, account: string) {
    this.values.delete(`${service}:${account}`);
  }

  isAvailable() {
    return true;
  }

  maskSecret(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    return `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
}

describe('IPC persistence smoke', () => {
  let database: Database.Database;

  beforeEach(() => {
    database = new Database(':memory:');
    runMigrations(database);
  });

  afterEach(() => {
    database?.close();
  });

  test('routes preload calls through main handlers into persisted data, settings, and secrets', async () => {
    const registrations = new Map<
      string,
      (event: unknown, ...args: unknown[]) => unknown
    >();
    const services = createDataServices({
      repositories: createRepositories(database),
      secretStore: new MemorySecretStore(),
    });

    registerIpcHandlers({
      registrar: {
        handle(channel, handler) {
          registrations.set(channel, handler);
        },
      },
      dataServices: services,
      runtime: createStubRegisterIpcRuntime(),
      systemHandlers: {
        checkNativeBindings: async () => ({
          driver: 'better-sqlite3',
          memoryDbReady: true,
          sqliteVersion: '3.47.0',
        }),
        ping: async () => ({
          appVersion: '0.1.0-test',
          message: 'pong',
          timestamp: '2026-04-10T00:00:00.000Z',
        }),
        getRuntimeStatus: async () => ({
          lastError: null,
          logDir: null,
          sidecarPid: null,
          sidecarPort: null,
          sidecarReady: false,
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

    const api = createQuantdeskApi(
      (channel, ...args) => {
        const handler = registrations.get(channel);

        if (!handler) {
          throw new Error(`Missing IPC handler for ${channel}.`);
        }

        return Promise.resolve(handler({}, ...args));
      },
      () => undefined,
    );

    await api.data.addAsset({
      id: 'asset-spy',
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF Trust',
      market: 'US',
      assetClass: 'equity',
      currency: 'USD',
      tags: ['core'],
      metadata: {},
    });

    await api.settings.set('baseCurrency', 'HKD');
    await api.secrets.set('quantdesk', 'openai', 'sk-test');

    expect(await api.data.getAssets()).toEqual([
      expect.objectContaining({
        id: 'asset-spy',
        symbol: 'SPY',
      }),
    ]);

    expect(await api.settings.get('baseCurrency')).toBe('HKD');
    expect(await api.secrets.get('quantdesk', 'openai')).toBe('sk-test');

    await api.secrets.delete('quantdesk', 'openai');
    expect(await api.secrets.get('quantdesk', 'openai')).toBeNull();
  });
});
