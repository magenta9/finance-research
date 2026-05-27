import { describe, expect, test } from 'vitest';

import { SidecarManager } from './manager';
import {
  createFailingProviderScript,
  createFixtureProviderScript,
  pythonCommand,
  sidecarScriptPath,
  waitFor,
} from './market-data-test-support';

describe('SidecarManager integration', () => {
  test('starts the Python sidecar and serves health and discovery RPC methods', async () => {
    const fixtureProviderServer = await createFixtureProviderScript();
    const manager = new SidecarManager({
      pythonCommand,
      resolveScriptPath: () => fixtureProviderServer.scriptPath,
    });

    try {
      await manager.start();

      expect(manager.getStatus()).toEqual(
        expect.objectContaining({
          lastError: null,
          sidecarPid: expect.any(Number),
          sidecarPort: expect.any(Number),
          sidecarReady: true,
        }),
      );

      await expect(manager.call('health_check')).resolves.toEqual({ status: 'ok' });
      await expect(manager.call<{ methods: string[] }>('get_capabilities')).resolves.toEqual(
        expect.objectContaining({
          methods: expect.arrayContaining(['health_check', 'search_assets', 'fetch_prices']),
        }),
      );
      await expect(
        manager.call<Array<{ symbol: string }>>('search_assets', {
          market: 'US',
          query: 'SPY',
        }),
      ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ symbol: 'SPY' })]));
      await expect(
        manager.call<{
          attemptedSources: string[];
          prices: Array<{ date: string; source: string }>;
          warnings: string[];
        }>('fetch_prices', {
          end: '2026-01-09',
          market: 'US',
          start: '2026-01-02',
          symbol: 'SPY',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          attemptedSources: expect.arrayContaining(['yfinance']),
          prices: expect.arrayContaining([expect.objectContaining({ date: '2026-01-02' })]),
          warnings: expect.any(Array),
        }),
      );
    } finally {
      await manager.stop();
      await fixtureProviderServer.cleanup();
    }
  }, 15_000);

  test('restarts the sidecar after the child process exits unexpectedly', async () => {
    const manager = new SidecarManager({
      pythonCommand,
      resolveScriptPath: () => sidecarScriptPath,
    });

    try {
      await manager.start();
      const firstPid = manager.getStatus().sidecarPid;

      if (!firstPid) {
        throw new Error('Expected a running sidecar pid.');
      }

      process.kill(firstPid, 'SIGTERM');

      await waitFor(() => {
        const status = manager.getStatus();
        return status.sidecarReady && status.sidecarPid != null && status.sidecarPid !== firstPid;
      });

      await expect(manager.call('health_check')).resolves.toEqual({ status: 'ok' });
    } finally {
      await manager.stop();
    }
  });

  test('stops the sidecar cleanly when the app quits', async () => {
    const manager = new SidecarManager({
      pythonCommand,
      resolveScriptPath: () => sidecarScriptPath,
    });

    await manager.start();
    const pid = manager.getStatus().sidecarPid;

    if (!pid) {
      throw new Error('Expected a running sidecar pid.');
    }

    expect(() => process.kill(pid, 0)).not.toThrow();

    await manager.stop();
    await waitFor(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });

    expect(manager.getStatus()).toMatchObject({
      sidecarPid: null,
      sidecarPort: null,
      sidecarReady: false,
    });
  });

  test('returns a structured error on provider failure without crashing the sidecar', async () => {
    const failingProviderServer = await createFailingProviderScript();
    const manager = new SidecarManager({
      pythonCommand,
      resolveScriptPath: () => failingProviderServer.scriptPath,
    });

    try {
      await manager.start();

      const failure = await manager
        .call('fetch_prices', {
          end: '2026-01-09',
          market: 'US',
          start: '2026-01-02',
          symbol: 'SPY',
        })
        .then(
          () => {
            throw new Error('Expected fetch_prices to fail.');
          },
          (error: unknown) => error as Error,
        );

      expect(failure.message).toBe('simulated provider failure');
      expect(failure.cause).toEqual({ method: 'fetch_prices' });
      expect(manager.getStatus()).toEqual(
        expect.objectContaining({
          sidecarPid: expect.any(Number),
          sidecarReady: true,
        }),
      );

      await expect(manager.call('health_check')).resolves.toEqual({ status: 'ok' });
    } finally {
      await manager.stop();
      await failingProviderServer.cleanup();
    }
  });
});