import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createPiToolHost } from './tool-host';
import { PiManager } from './manager';
import type { FinanceCapabilityContext } from '../agent/capabilities/finance';
import type { PiSendMessageInput, PiSendMessageResult, PiToolHostExecuteRequest } from './types';

const fakeWrapperPath = path.resolve(__dirname, 'testing/fake-wrapper.js');

const createContext = (): FinanceCapabilityContext => ({
  dataServices: {
    repositories: {
      allocationPlanRepository: {
        getById: () => null,
        list: () => [],
      },
      assetRepository: {
        list: () => [],
        search: () => [],
      },
      positionRepository: {
        listByPortfolio: () => [],
      },
      preferencesRepository: {
        get: () => 'CNY',
      },
      priceRepository: {
        listByAsset: () => [],
      },
    },
  } as unknown as FinanceCapabilityContext['dataServices'],
  docsRagService: {
    search: async () => ({
      citations: [],
      chunks: [],
      summary: '',
    }),
  },
  getSkillContext: (message: string) => ({
    assets: [],
    baseCurrency: 'CNY',
    latestAllocation: null,
    message,
  }),
  portfolioEngine: {
    runAllocation: async () => ({
      allocations: [],
      mode: 'inverse_volatility',
      portfolioMetrics: {
        expectedReturn: 0,
        maxDrawdown: 0,
        sharpe: 0,
        volatility: 0,
      },
    }) as never,
  },
});

describe('PiManager', () => {
  const managers: PiManager[] = [];

  afterEach(async () => {
    while (managers.length > 0) {
      await managers.pop()!.stop();
    }
  });

  test('starts the wrapper and exposes diagnostics', async () => {
    const manager = new PiManager({
      directories: {
        agentDir: '/tmp/pi-agent/config',
        sessionDir: '/tmp/pi-agent/sessions',
        toolInvocationDir: '/tmp/pi-agent/tool-invocations',
        workspaceDir: '/tmp/pi-agent/workspace',
      },
      spawnSpec: () => ({
        args: [fakeWrapperPath],
        command: process.execPath,
        cwd: process.cwd(),
        env: process.env,
      }),
      toolHost: createPiToolHost(createContext()),
    });
    managers.push(manager);

    await manager.start();
    const status = await manager.getStatus();

    expect(status.state).toBe('ready');
    expect(status.wrapperVersion).toBe('fake-wrapper');
    expect(status.currentSessionId).toBe('pi-session-1');
  });

  test('forwards notification stream and sendMessage results', async () => {
    const manager = new PiManager({
      directories: {
        agentDir: '/tmp/pi-agent/config',
        sessionDir: '/tmp/pi-agent/sessions',
        toolInvocationDir: '/tmp/pi-agent/tool-invocations',
        workspaceDir: '/tmp/pi-agent/workspace',
      },
      spawnSpec: () => ({
        args: [fakeWrapperPath],
        command: process.execPath,
        cwd: process.cwd(),
        env: process.env,
      }),
      toolHost: createPiToolHost(createContext()),
    });
    managers.push(manager);

    const completed = new Promise<void>((resolve) => {
      manager.subscribe((event) => {
        if (event.type === 'run_completed') {
          resolve();
        }
      });
    });

    const response = await manager.sendMessage({ message: 'hello pi' });

    expect(response).toEqual({ runId: 'fake-run-1', sessionId: 'pi-session-1' });
    await completed;
  });

  test('backfills a generated title after session_created when upstream name is missing', async () => {
    const manager = new PiManager({
      directories: {
        agentDir: '/tmp/pi-agent/config',
        sessionDir: '/tmp/pi-agent/sessions',
        toolInvocationDir: '/tmp/pi-agent/tool-invocations',
        workspaceDir: '/tmp/pi-agent/workspace',
      },
      spawnSpec: () => ({
        args: [fakeWrapperPath],
        command: process.execPath,
        cwd: process.cwd(),
        env: process.env,
      }),
      toolHost: createPiToolHost(createContext()),
    });
    managers.push(manager);

    const titleUpdated = new Promise<void>((resolve) => {
      manager.subscribe((event) => {
        if (event.type === 'session_updated' && event.session.title === 'Fake Generated Title') {
          resolve();
        }
      });
    });

    await manager.sendMessage({ message: '分析今天的市场情绪' });
    await titleUpdated;

    await expect(manager.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'pi-session-1',
        title: 'Fake Generated Title',
        titleSource: 'generated',
        titleStatus: 'ready',
      }),
    ]);
  });

  test('blocks disallowed finance tools at the host boundary for allowlisted runs', async () => {
    const execute = vi.fn(async () => ({
      payload: {
        audit: {
          generatedAt: '2026-04-28T00:00:00.000Z',
          toolName: 'search_assets',
        },
        citations: [],
        ok: true,
        payload: {},
        richBlocks: [],
        summary: 'ok',
      },
    }));
    const manager = new PiManager({
      directories: {
        agentDir: '/tmp/pi-agent/config',
        sessionDir: '/tmp/pi-agent/sessions',
        toolInvocationDir: '/tmp/pi-agent/tool-invocations',
        workspaceDir: '/tmp/pi-agent/workspace',
      },
      spawnSpec: () => ({
        args: [fakeWrapperPath],
        command: process.execPath,
        cwd: process.cwd(),
        env: process.env,
      }),
      toolHost: {
        execute,
        getStatus: () => ({ available: true, lastError: null, names: ['search_assets', 'run_allocation'] }),
      },
    });
    const internals = manager as unknown as {
      executeToolHostRequest: (request: PiToolHostExecuteRequest) => Promise<unknown>;
      registerRunToolPolicy: (result: PiSendMessageResult, input: PiSendMessageInput) => void;
    };

    internals.registerRunToolPolicy(
      { runId: 'run-1', sessionId: 'session-1' },
      { allowedToolNames: ['search_assets'], message: 'research' },
    );

    await expect(internals.executeToolHostRequest({
      args: {},
      runId: 'run-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'run_allocation',
    })).rejects.toThrow('Agent tool is not allowed for this run: run_allocation');
    expect(execute).not.toHaveBeenCalled();

    await expect(internals.executeToolHostRequest({
      args: { query: 'ETF' },
      runId: 'run-1',
      sessionId: 'session-1',
      toolCallId: 'tool-2',
      toolName: 'search_assets',
    })).resolves.toEqual(expect.objectContaining({ payload: expect.objectContaining({ ok: true }) }));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('rejects tool host requests for unknown Pi runs', async () => {
    const execute = vi.fn();
    const manager = new PiManager({
      directories: {
        agentDir: '/tmp/pi-agent/config',
        sessionDir: '/tmp/pi-agent/sessions',
        toolInvocationDir: '/tmp/pi-agent/tool-invocations',
        workspaceDir: '/tmp/pi-agent/workspace',
      },
      spawnSpec: () => ({
        args: [fakeWrapperPath],
        command: process.execPath,
        cwd: process.cwd(),
        env: process.env,
      }),
      toolHost: {
        execute,
        getStatus: () => ({ available: true, lastError: null, names: ['search_assets'] }),
      },
    });
    const internals = manager as unknown as {
      executeToolHostRequest: (request: PiToolHostExecuteRequest) => Promise<unknown>;
      registerRunToolPolicy: (result: PiSendMessageResult, input: PiSendMessageInput) => void;
    };

    await expect(internals.executeToolHostRequest({
      args: {},
      runId: 'unknown-run',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'search_assets',
    })).rejects.toThrow('registered run');
    expect(execute).not.toHaveBeenCalled();

    internals.registerRunToolPolicy(
      { runId: 'run-unrestricted', sessionId: 'session-1' },
      { message: 'general pi task' },
    );

    await expect(internals.executeToolHostRequest({
      args: {},
      runId: 'run-unrestricted',
      sessionId: 'session-1',
      toolCallId: 'tool-2',
      toolName: 'search_assets',
    })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});