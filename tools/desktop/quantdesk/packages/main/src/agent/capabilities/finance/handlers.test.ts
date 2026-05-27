import { describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { createFinanceHandlers } from './handlers';
import type { FinanceCapabilityContext } from './types';

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

const buildDates = (count: number, startDate = '2025-01-01') => {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);

  for (let index = 0; index < count; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

const buildPriceRows = (assetId: string, values: number[]) => {
  const dates = buildDates(values.length);

  return values.map((value, index) => ({
    adjustedClose: value,
    assetId,
    close: value,
    date: dates[index],
    fetchedAt: '2026-05-08T00:00:00.000Z',
    high: null,
    low: null,
    open: null,
    source: 'test',
    volume: null,
  }));
};

const pattern = (length: number, base = 100) => Array.from({ length }, (_, index) => (
  base * Math.exp((index / length) * 0.08 + Math.sin(index / 7) * 0.035)
));

const createContext = (
  assets: StoredAsset[],
  priceRowsByAssetId = new Map<string, ReturnType<typeof buildPriceRows>>(),
): FinanceCapabilityContext => ({
  dataServices: {
    repositories: {
      assetRepository: {
        list: () => assets,
        search: (query: string) => {
          const normalized = query.trim().toLowerCase();

          if (!normalized) {
            return assets;
          }

          return assets.filter((asset) => `${asset.symbol} ${asset.name}`.toLowerCase().includes(normalized));
        },
      },
      positionRepository: {
        listByPortfolio: () => [],
      },
      priceRepository: {
        listByAsset: (assetId: string) => priceRowsByAssetId.get(assetId) ?? (assetId === 'asset-159919'
          ? buildPriceRows(assetId, [3.21, 3.28])
          : []),
      },
      preferencesRepository: {
        get: () => null,
      },
    },
  } as unknown as FinanceCapabilityContext['dataServices'],
  docsRagService: {
    search: vi.fn(async (query: string) => ({
      citations: ['[docs:quantdesk]'],
      chunks: [{ citation: '[docs:quantdesk]', excerpt: 'allocation', path: '/tmp/spec.md', score: 0.9, title: 'Spec' }],
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

describe('createFinanceHandlers', () => {
  test('get_asset_snapshot includes local price snapshot rich blocks', async () => {
    const handlers = createFinanceHandlers(createContext([
      buildAsset({ name: '沪深300ETF嘉实', symbol: '159919' }),
    ]));

    const payload = await handlers.get_asset_snapshot({ symbol: '159919' });

    expect(payload.ok).toBe(true);
    expect(payload.citations).toEqual(['[asset:159919]', '[price-cache:local]']);
    expect(payload.richBlocks).toMatchObject([
      {
        title: '159919 快照',
        type: 'metric-grid',
      },
    ]);
    expect(payload.summary).toContain('最近收盘价');
  });

  test('search_quantdesk_docs forwards documentation search payload and citations', async () => {
    const context = createContext([buildAsset()]);
    const handlers = createFinanceHandlers(context);

    const payload = await handlers.search_quantdesk_docs({ query: 'allocation' });

    expect(context.docsRagService.search).toHaveBeenCalledWith('allocation');
    expect(payload.citations).toEqual(['[docs:quantdesk]']);
    expect(payload.summary).toBe('docs:allocation');
  });

  test('search_price_pattern_analogs returns structured local analog payload', async () => {
    const target = buildAsset({ id: 'asset-spy', market: 'US', symbol: 'SPY', currency: 'USD' });
    const peer = buildAsset({ id: 'asset-qqq', market: 'US', symbol: 'QQQ', currency: 'USD' });
    const targetRows = buildPriceRows(target.id, [
      ...pattern(60, 90),
      ...Array.from({ length: 100 }, (_, index) => 98 + index * 0.1),
      ...pattern(60, 130),
    ]);
    const priceRowsByAssetId = new Map([
      [target.id, targetRows],
      [peer.id, buildPriceRows(peer.id, [
        ...Array.from({ length: 30 }, (_, index) => 80 + index * 0.05),
        ...pattern(60, 92),
        ...Array.from({ length: 150 }, (_, index) => 98 + index * 0.08),
      ])],
    ]);
    const handlers = createFinanceHandlers(createContext([target, peer], priceRowsByAssetId));
    const payload = await handlers.search_price_pattern_analogs({
      endDate: targetRows.at(-1)!.date,
      symbol: 'SPY',
      window: '3M',
    });

    expect(payload.ok).toBe(true);
    expect(payload.citations).toEqual(['[asset:SPY]', '[price-cache:local]']);
    expect(payload.payload).toMatchObject({
      query: expect.objectContaining({ symbol: 'SPY', window: '3M' }),
      results: expect.arrayContaining([
        expect.objectContaining({ sourceType: expect.stringMatching(/self|peer/) }),
      ]),
    });
  });

  test('keeps search_assets local and uses resolve_market_assets for remote discovery', async () => {
    const context = {
      ...createContext([buildAsset({ name: '本地沪深300', symbol: '159919' })]),
      marketDataPort: {
        searchAssets: vi.fn(async () => [{
          assetClass: 'equity' as const,
          currency: 'CNY' as const,
          market: 'A' as const,
          metadata: {},
          name: '远端恒生科技ETF',
          source: 'akshare',
          symbol: '513180',
        }]),
      },
    } satisfies FinanceCapabilityContext;
    const handlers = createFinanceHandlers(context);

    const localPayload = await handlers.search_assets({ query: '513180' });
    const remotePayload = await handlers.resolve_market_assets({ query: '513180', market: 'A' });

    expect(localPayload.summary).toContain('没有匹配到本地资产池');
    expect(context.marketDataPort.searchAssets).toHaveBeenCalledWith(expect.objectContaining({ query: '513180' }));
    expect(remotePayload.summary).toContain('远端资产发现返回 1 个候选');
    expect(remotePayload.payload).toEqual(expect.objectContaining({
      candidates: [expect.objectContaining({ symbol: '513180', sourceId: 'market_asset:akshare:A:513180' })],
    }));
  });

  test('market source search returns unfetched references instead of evidence', async () => {
    const context = {
      ...createContext([buildAsset()]),
      marketSourceService: {
        fetchSource: vi.fn(),
        searchAnnouncements: vi.fn(async () => []),
        searchSources: vi.fn(async () => [{
          credibilityStatus: 'provider' as const,
          evidenceEligible: false as const,
          providerId: 'test-provider',
          publishedAt: '2026-04-28T00:00:00.000Z',
          snippet: 'snippet only',
          sourceId: 'source-1',
          title: 'Market note',
          url: 'https://example.test/source-1',
        }]),
      },
    } satisfies FinanceCapabilityContext;
    const handlers = createFinanceHandlers(context);
    const payload = await handlers.search_market_sources({ query: 'macro event' });

    expect(payload.citations).toEqual([]);
    expect(payload.payload).toEqual(expect.objectContaining({
      sources: [expect.objectContaining({ evidenceEligible: false, snippet: 'snippet only' })],
      warnings: expect.arrayContaining([
        expect.stringContaining('Search snippets are not evidence'),
        expect.stringContaining('Fetch directly relevant source references'),
      ]),
    }));
  });

  test('fetch_market_source returns provenance-eligible fetched evidence', async () => {
    const context = {
      ...createContext([buildAsset()]),
      marketSourceService: {
        fetchSource: vi.fn(async () => ({
          contentHash: 'sha256:test',
          evidenceEligible: true as const,
          fetchedAt: '2026-05-05T00:00:00.000Z',
          provenance: [{
            fetchedAt: '2026-05-05T00:00:00.000Z',
            providerIds: ['cninfo'],
            qualityStatus: 'pass' as const,
            rowsUsed: 1,
            sourceId: 'cninfo:announcement-1',
            warnings: [],
          }],
          sourceId: 'cninfo:announcement-1',
          summary: 'Fetched announcement source.',
          title: 'Announcement',
          url: 'https://example.test/announcement',
        })),
        searchAnnouncements: vi.fn(async () => []),
        searchSources: vi.fn(async () => []),
      },
    } satisfies FinanceCapabilityContext;
    const handlers = createFinanceHandlers(context);
    const payload = await handlers.fetch_market_source({ sourceId: 'cninfo:announcement-1' });

    expect(payload.ok).toBe(true);
    expect(payload.citations).toEqual(['[cninfo:announcement-1]']);
    expect(payload.payload).toEqual(expect.objectContaining({
      dataProvenance: [expect.objectContaining({ sourceId: 'cninfo:announcement-1' })],
      evidenceEligible: true,
    }));
  });

  test('search_news_catalysts returns available provider snapshots as ok', async () => {
    const context = {
      ...createContext([buildAsset({ symbol: 'AAPL', market: 'US', currency: 'USD' })]),
      researchProviderService: {
        searchNewsCatalysts: vi.fn(async () => ({
          dataProvenance: [{
            fetchedAt: '2026-05-05T00:00:00.000Z',
            providerIds: ['sec_edgar'],
            qualityStatus: 'pass' as const,
            rowsUsed: 1,
            sourceId: 'sec_edgar:filing-1',
            warnings: [],
          }],
          payload: { events: [{ title: 'AAPL 10-Q filing' }], inCatalystWindow: true },
          providerIds: ['sec_edgar'],
          status: 'available' as const,
          summary: '新闻催化搜索返回 1 条事件，处于催化窗口。',
          warnings: [],
        })),
      },
    } satisfies FinanceCapabilityContext;
    const handlers = createFinanceHandlers(context);
    const payload = await handlers.search_news_catalysts({ query: 'AAPL earnings', symbol: 'AAPL' });

    expect(payload.ok).toBe(true);
    expect(payload.citations).toEqual([]);
    expect(context.researchProviderService.searchNewsCatalysts).toHaveBeenCalledWith({ query: 'AAPL earnings', symbol: 'AAPL' });
  });

  test('search_news_catalysts keeps degraded and unknown windows non-ok', async () => {
    const context = {
      ...createContext([buildAsset()]),
      researchProviderService: {
        searchNewsCatalysts: vi.fn(async () => ({
          dataProvenance: [{
            fetchedAt: '2026-05-05T00:00:00.000Z',
            providerIds: [],
            qualityStatus: 'warn' as const,
            rowsUsed: 0,
            sourceId: 'provider.news_catalysts:unknown',
            warnings: ['market_unresolved'],
          }],
          payload: { events: [], inCatalystWindow: 'unknown', warnings: ['market_unresolved'] },
          providerIds: [],
          status: 'degraded' as const,
          summary: '新闻催化搜索返回 0 条事件，窗口状态未知。',
          warnings: ['market_unresolved'],
        })),
      },
    } satisfies FinanceCapabilityContext;
    const handlers = createFinanceHandlers(context);
    const payload = await handlers.search_news_catalysts({ query: '000001' });

    expect(payload.ok).toBe(false);
    expect(payload.payload).toEqual(expect.objectContaining({
      payload: expect.objectContaining({ inCatalystWindow: 'unknown' }),
      status: 'degraded',
    }));
  });

  test('provider-backed snapshots fail with structured unavailable payload when provider is absent', async () => {
    const handlers = createFinanceHandlers(createContext([buildAsset()]));
    const payload = await handlers.get_fundamental_snapshot({ symbol: '159919' });

    expect(payload.ok).toBe(false);
    expect(payload.payload).toEqual(expect.objectContaining({
      reasonCode: 'provider_unavailable',
      status: 'unavailable',
    }));
  });

  test('news catalyst search fails with structured unavailable payload when provider is absent', async () => {
    const handlers = createFinanceHandlers(createContext([buildAsset()]));
    const payload = await handlers.search_news_catalysts({ query: '159919' });

    expect(payload.ok).toBe(false);
    expect(payload.payload).toEqual(expect.objectContaining({
      reasonCode: 'provider_unavailable',
      status: 'unavailable',
    }));
  });
});