import { describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { createPiToolHost } from './tool-host';
import type { FinanceCapabilityContext } from '../agent/capabilities/finance';

const buildAsset = (overrides: Partial<StoredAsset> = {}): StoredAsset => ({
  assetClass: overrides.assetClass ?? 'equity',
  createdAt: overrides.createdAt ?? '2026-04-13T00:00:00.000Z',
  currency: overrides.currency ?? 'CNY',
  id: overrides.id ?? `asset-${overrides.symbol ?? '159919'}`,
  market: overrides.market ?? 'A',
  metadata: overrides.metadata ?? {},
  name: overrides.name ?? '沪深300ETF嘉实',
  symbol: overrides.symbol ?? '159919',
  tags: overrides.tags ?? [],
  updatedAt: overrides.updatedAt ?? '2026-04-13T00:00:00.000Z',
});

const createContext = (assets: StoredAsset[]): FinanceCapabilityContext => ({
  dataServices: {
    repositories: {
      allocationPlanRepository: {
        getById: () => null,
        list: () => [],
      },
      assetRepository: {
        list: () => assets,
        search: () => assets,
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
    search: vi.fn(async (query: string) => ({
      citations: ['[docs:quantdesk]'],
      chunks: [],
      summary: `docs:${query}`,
    })),
  },
  getSkillContext: (message: string) => ({
    assets,
    baseCurrency: 'CNY',
    latestAllocation: null,
    message,
  }),
  portfolioEngine: {
    runAllocation: vi.fn(),
  },
});

describe('createPiToolHost', () => {
  test('validates tool input against the shared finance schema', async () => {
    const host = createPiToolHost(createContext([buildAsset()]));

    await expect(host.execute({
      args: {},
      runId: 'run-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'search_quantdesk_docs',
    })).rejects.toThrow('Invalid arguments');
  });

  test('accepts compatibility allocation fields on asset pool summaries', async () => {
    const host = createPiToolHost(createContext([buildAsset()]));

    const response = await host.execute({
      args: {
        limit: 1,
        mode: 'max_diversification',
      },
      runId: 'run-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'get_asset_pool_summary',
    });

    expect(response.payload.citations).toEqual(['[asset-pool:local]']);
    expect(response.payload.payload).toMatchObject({
      totalAssets: 1,
    });
    expect(response.payload.summary).toContain('当前本地资产池共有 1 个标的');
  });

  test('executes shared finance handlers through the host', async () => {
    const host = createPiToolHost(createContext([buildAsset()]));

    const response = await host.execute({
      args: { query: 'allocation' },
      runId: 'run-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'search_quantdesk_docs',
    });

    expect(response.payload.citations).toEqual(['[docs:quantdesk]']);
    expect(response.payload.summary).toBe('docs:allocation');
  });
});