import type { AgentRichBlock } from '@quantdesk/shared';
import type { DataProvenance, StoredAsset } from '@quantdesk/shared';

import { createAssetAnalysisSkill } from '../../skills/asset-analysis';
import { createMacroScanSkill } from '../../skills/macro-scan';
import { createRebalanceAdvisorSkill } from '../../skills/rebalance-advisor';
import { createRiskDecomposeSkill } from '../../skills/risk-decompose';
import { financeToolDefinitions } from './definitions';
import { getEnabledSearchSources } from '../../../sidecar/provider-config';
import { searchPricePatternAnalogs } from '../../../portfolio/price-analog/search';
import type {
  FinanceCapabilityContext,
  FinanceHandler,
  FinanceToolPayload,
  LocalAssetList,
} from './types';

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const asNumber = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const asInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Math.trunc(asNumber(value, fallback));
  return Math.max(min, Math.min(max, parsed));
};

const asStringArray = (value: unknown) => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : undefined
);

const asOptionalStringArray = (value: unknown) => asStringArray(value) ?? [];

const asOptionalIsoDate = (value: unknown) => {
  const text = asString(value);

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
};

const asAnalogWindow = (value: unknown) => {
  if (value === '3M' || value === '6M' || value === '1Y') {
    return value;
  }

  return '6M';
};

const createProviderUnavailablePayload = (toolName: string, providerId: string) => createPayload(toolName, {
  citations: [`[${providerId}:unavailable]`],
  ok: false,
  payload: {
    reasonCode: 'provider_unavailable',
    status: 'unavailable',
    warnings: [`${providerId} is not configured for this runtime.`],
  },
  summary: `${providerId} 当前不可用；该工具只能产出结构化降级结果，不能作为事实证据。`,
});

const resultString = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];

  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

const nestedResultString = (payload: Record<string, unknown>, parentKey: string, key: string) => {
  const parent = payload[parentKey];

  if (typeof parent !== 'object' || parent === null || Array.isArray(parent)) {
    return null;
  }

  return resultString(parent as Record<string, unknown>, key);
};

const resultStringArray = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];

  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const createToolProvenance = (input: {
  qualityStatus?: DataProvenance['qualityStatus'];
  rowsUsed?: number | null;
  sourceId: string;
  warnings?: string[];
}): DataProvenance => ({
  fetchedAt: new Date().toISOString(),
  qualityStatus: input.qualityStatus ?? 'pass',
  rowsUsed: input.rowsUsed ?? null,
  sourceId: input.sourceId,
  warnings: input.warnings ?? [],
});

const resolveAssetBySymbol = (runtime: FinanceCapabilityContext, symbol: string): StoredAsset | null => {
  const normalized = symbol.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return runtime.dataServices.repositories.assetRepository.list()
    .find((asset) => asset.symbol.toLowerCase() === normalized)
    ?? runtime.dataServices.repositories.assetRepository.search(symbol)[0]
    ?? null;
};

const getAdjustedClose = (row: { adjustedClose?: number | null; close?: number | null }) => {
  const value = row.adjustedClose ?? row.close ?? null;

  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
};

const getVolume = (row: { volume?: number | null }) => (
  typeof row.volume === 'number' && Number.isFinite(row.volume) && row.volume >= 0 ? row.volume : null
);

const getPriceDate = (row: { date?: string | null; tradeDate?: string | null }) => row.date ?? row.tradeDate ?? null;

const returnsFromPrices = (prices: number[]) => prices.slice(1).map((price, index) => (price / prices[index]) - 1);

const average = (values: number[]) => values.length > 0
  ? values.reduce((total, value) => total + value, 0) / values.length
  : 0;

const volatility = (values: number[]) => {
  if (values.length < 2) {
    return null;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));

  return Math.sqrt(variance);
};

const maxDrawdown = (prices: number[]) => {
  if (prices.length < 2) {
    return null;
  }

  let peak = prices[0];
  let worst = 0;

  for (const price of prices) {
    peak = Math.max(peak, price);
    worst = Math.min(worst, (price / peak) - 1);
  }

  return worst;
};

const correlation = (left: number[], right: number[]) => {
  const length = Math.min(left.length, right.length);

  if (length < 2) {
    return null;
  }

  const leftValues = left.slice(-length);
  const rightValues = right.slice(-length);
  const leftMean = average(leftValues);
  const rightMean = average(rightValues);
  const numerator = leftValues.reduce((total, value, index) => total + ((value - leftMean) * (rightValues[index] - rightMean)), 0);
  const leftDenominator = Math.sqrt(leftValues.reduce((total, value) => total + ((value - leftMean) ** 2), 0));
  const rightDenominator = Math.sqrt(rightValues.reduce((total, value) => total + ((value - rightMean) ** 2), 0));

  if (leftDenominator === 0 || rightDenominator === 0) {
    return null;
  }

  return numerator / (leftDenominator * rightDenominator);
};

const buildLocalPriceSeries = (runtime: FinanceCapabilityContext, symbols: string[]) => symbols
  .map((symbol) => {
    const asset = resolveAssetBySymbol(runtime, symbol);
    const rows = asset ? runtime.dataServices.repositories.priceRepository.listByAsset(asset.id) : [];
    const prices = rows.map(getAdjustedClose).filter((value): value is number => value !== null);

    return {
      asset,
      prices,
      returns: returnsFromPrices(prices),
      rows,
      symbol,
      warnings: [
        ...(!asset ? [`${symbol} is not in the local asset pool.`] : []),
        ...(prices.length < 30 ? [`${symbol} has fewer than 30 usable local price rows.`] : []),
      ],
    };
  });

const resolveSelectedAssets = (
  assets: LocalAssetList,
  symbols?: string[],
) => {
  if (!symbols || symbols.length === 0) {
    return assets.slice(0, Math.min(5, assets.length));
  }

  const normalized = symbols.map((symbol) => symbol.trim().toLowerCase()).filter(Boolean);
  return assets.filter((asset) => normalized.includes(asset.symbol.toLowerCase()));
};

const summarizeAssetSearch = (
  results: ReturnType<FinanceCapabilityContext['dataServices']['repositories']['assetRepository']['search']>,
) => {
  if (results.length === 0) {
    return '没有匹配到本地资产池中的标的。';
  }

  return results
    .slice(0, 8)
    .map((asset) => `${asset.symbol} (${asset.name}) / ${asset.market} / ${asset.assetClass}`)
    .join('\n');
};

const summarizeAssetPreview = (assets: LocalAssetList, limit: number) => (
  assets
    .slice(0, Math.min(limit, assets.length))
    .map((asset) => `${asset.symbol} (${asset.name})`)
    .join('、')
);

const buildAssetPoolSnapshot = (assets: LocalAssetList, limit: number) => {
  const assetClassBreakdown = Object.entries(
    assets.reduce<Record<string, number>>((accumulator, asset) => {
      accumulator[asset.assetClass] = (accumulator[asset.assetClass] ?? 0) + 1;
      return accumulator;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([assetClass, count]) => ({ assetClass, count }));
  const marketBreakdown = Object.entries(
    assets.reduce<Record<string, number>>((accumulator, asset) => {
      accumulator[asset.market] = (accumulator[asset.market] ?? 0) + 1;
      return accumulator;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([market, count]) => ({ count, market }));
  const previewAssets = assets.slice(0, Math.min(limit, assets.length));
  const tagCount = new Set(assets.flatMap((asset) => asset.tags)).size;

  return {
    assetClassBreakdown,
    marketBreakdown,
    previewAssets,
    symbols: assets.map((asset) => asset.symbol),
    tagCount,
    totalAssets: assets.length,
  };
};

const summarizeAssetPool = (assets: LocalAssetList, limit: number) => {
  const snapshot = buildAssetPoolSnapshot(assets, limit);

  if (snapshot.totalAssets === 0) {
    return '当前本地资产池为空。';
  }

  const preview = summarizeAssetPreview(assets, limit);
  const suffix = snapshot.totalAssets > snapshot.previewAssets.length
    ? ` 等 ${snapshot.totalAssets} 个标的。`
    : '。';

  return `当前本地资产池共有 ${snapshot.totalAssets} 个标的，覆盖 ${snapshot.marketBreakdown.length} 个市场：${preview}${suffix}`;
};

const createPayload = (toolName: string, input: {
  citations?: string[];
  ok?: boolean;
  payload?: unknown;
  richBlocks?: AgentRichBlock[];
  summary: string;
}): FinanceToolPayload => ({
  audit: {
    generatedAt: new Date().toISOString(),
    toolName,
  },
  citations: input.citations ?? [],
  ok: input.ok ?? true,
  payload: input.payload ?? null,
  richBlocks: input.richBlocks ?? [],
  summary: input.summary,
});

export const createFinanceHandlers = (runtime: FinanceCapabilityContext) => {
  const assetAnalysisSkill = createAssetAnalysisSkill((assetId) => (
    runtime.dataServices.repositories.priceRepository
      .listByAsset(assetId)
      .map((row) => row.adjustedClose ?? row.close ?? 0)
      .filter((value) => value > 0)
  ));
  const riskDecomposeSkill = createRiskDecomposeSkill();
  const macroScanSkill = createMacroScanSkill();
  const rebalanceSkill = createRebalanceAdvisorSkill(() => (
    runtime.dataServices.repositories.positionRepository.listByPortfolio('default')
  ));

  const handlers: Record<string, FinanceHandler> = {
    async health_check() {
      return createPayload('health_check', {
        payload: {
          tools: financeToolDefinitions.map((definition) => definition.name),
        },
        summary: 'QuantDesk finance bridge 已就绪。',
      });
    },
    async search_assets(args) {
      const query = asString(args.query);
      const results = runtime.dataServices.repositories.assetRepository.search(query);

      return createPayload('search_assets', {
        citations: ['[asset-pool:local]'],
        payload: results,
        summary: summarizeAssetSearch(results),
      });
    },
    async resolve_market_assets(args) {
      const query = asString(args.query);
      const market = asString(args.market);

      if (!runtime.marketDataPort) {
        return createProviderUnavailablePayload('resolve_market_assets', 'market-data.asset-discovery');
      }

      const results = await runtime.marketDataPort.searchAssets({
        enabledSources: getEnabledSearchSources(runtime.dataServices.repositories.preferencesRepository, market || undefined),
        market: market || undefined,
        query,
      });

      return createPayload('resolve_market_assets', {
        citations: ['[market-data:asset-discovery]'],
        payload: {
          candidates: results.map((candidate, index) => ({
            ...candidate,
            confidence: index === 0 ? 'high' : 'medium',
            currency: candidate.currency,
            market: candidate.market,
            providerIds: [candidate.source],
            sourceId: `market_asset:${candidate.source}:${candidate.market}:${candidate.symbol}`,
            symbol: candidate.symbol,
            warnings: [],
          })),
          dataProvenance: [createToolProvenance({ rowsUsed: results.length, sourceId: 'market-data:asset-discovery' })],
        },
        summary: results.length > 0
          ? `远端资产发现返回 ${results.length} 个候选：${results.slice(0, 5).map((item) => `${item.symbol}/${item.market}`).join('、')}。`
          : `远端资产发现未匹配到 ${query}。`,
      });
    },
    async ensure_asset_history(args) {
      const assetId = asString(args.assetId);
      const forceRefresh = args.forceRefresh === true;
      const asset = runtime.dataServices.repositories.assetRepository.list().find((item) => item.id === assetId);

      if (!runtime.priceSyncService) {
        return createProviderUnavailablePayload('ensure_asset_history', 'market-data.price-sync');
      }

      if (!asset) {
        return createPayload('ensure_asset_history', {
          citations: ['[asset-pool:local]'],
          ok: false,
          payload: { assetId, reasonCode: 'requested_asset_missing' },
          summary: `未找到 ${assetId} 对应的本地资产，不能补齐历史行情。`,
        });
      }

      const result = await runtime.priceSyncService.syncPrices({
        assetIds: [assetId],
        forceRefresh,
        priority: 'interactive',
      });

      return createPayload('ensure_asset_history', {
        citations: ['[market-data:price-sync]', `[asset:${asset.symbol}]`],
        ok: result.warnings.length === 0,
        payload: {
          ...result,
          dataProvenance: [createToolProvenance({ rowsUsed: result.insertedRows, sourceId: `daily_prices:${assetId}`, warnings: result.warnings.map((warning) => warning.message) })],
        },
        summary: `已通过受控行情同步检查 ${asset.symbol}，新增 ${result.insertedRows} 行，跳过 ${result.skippedAssetIds.length} 个资产。`,
      });
    },
    async get_asset_pool_summary(args) {
      const limit = asInteger(args.limit, 8, 1, 20);
      const assets = runtime.getSkillContext('asset-pool-summary').assets;

      return createPayload('get_asset_pool_summary', {
        citations: ['[asset-pool:local]'],
        payload: buildAssetPoolSnapshot(assets, limit),
        summary: summarizeAssetPool(assets, limit),
      });
    },
    async get_asset_snapshot(args) {
      const symbol = asString(args.symbol);
      const skillContext = runtime.getSkillContext(symbol);
      const selected = resolveSelectedAssets(skillContext.assets, [symbol])[0]
        ?? runtime.dataServices.repositories.assetRepository.search(symbol)[0];

      if (!selected) {
        return createPayload('get_asset_snapshot', {
          citations: ['[asset-pool:local]'],
          ok: false,
          summary: `未找到 ${symbol} 对应的本地标的。`,
        });
      }

      const prices = runtime.dataServices.repositories.priceRepository.listByAsset(selected.id).slice(-30);
      const latest = prices.at(-1) ?? null;

      return createPayload('get_asset_snapshot', {
        citations: [`[asset:${selected.symbol}]`, '[price-cache:local]'],
        payload: {
          asset: selected,
          latestPrice: latest,
          recentPrices: prices,
        },
        richBlocks: latest
          ? [{
            data: {
              rows: [
                { label: '已缓存交易日', value: prices.length },
                { label: '最近收盘价', value: latest.adjustedClose ?? latest.close ?? null },
              ],
            },
            title: `${selected.symbol} 快照`,
            type: 'metric-grid',
          }]
          : [],
        summary: latest
          ? `${selected.symbol} 最近收盘价 ${latest.close ?? latest.adjustedClose ?? 0}，最近 ${prices.length} 个交易日已缓存。`
          : `${selected.symbol} 已在本地资产池中，但当前没有价格缓存。`,
      });
    },
    async search_price_pattern_analogs(args) {
      const symbol = asString(args.symbol);
      const asset = resolveAssetBySymbol(runtime, symbol);

      if (!asset) {
        return createPayload('search_price_pattern_analogs', {
          citations: ['[asset-pool:local]'],
          ok: false,
          payload: { reasonCode: 'requested_asset_missing', symbol },
          summary: `未找到 ${symbol} 对应的本地资产，无法检索历史 analog。`,
        });
      }

      const result = searchPricePatternAnalogs({
        dependencies: {
          assetRepository: runtime.dataServices.repositories.assetRepository,
          priceRepository: runtime.dataServices.repositories.priceRepository,
        },
        request: {
          assetId: asset.id,
          endDate: asString(args.endDate) || undefined,
          limit: asInteger(args.limit, 10, 1, 20),
          window: asAnalogWindow(args.window),
        },
      });

      return createPayload('search_price_pattern_analogs', {
        citations: [`[asset:${asset.symbol}]`, '[price-cache:local]'],
        ok: result.status !== 'unavailable',
        payload: result,
        summary: result.results.length > 0
          ? `${asset.symbol} ${result.query.window} 历史 analog 返回 ${result.results.length} 条，状态 ${result.status}；最相似分数 ${result.results[0].similarity.score.toFixed(1)}。`
          : `${asset.symbol} ${result.query.window} 历史 analog 当前不可用：${result.warnings.join(' / ') || '本地候选不足'}。`,
      });
    },
    async get_portfolio_summary() {
      const skillContext = runtime.getSkillContext('portfolio-summary');
      const positions = runtime.dataServices.repositories.positionRepository.listByPortfolio('default');
      const assetPool = buildAssetPoolSnapshot(skillContext.assets, 8);
      const assetPoolSummary = assetPool.totalAssets > 0
        ? `本地资产池共有 ${assetPool.totalAssets} 个标的，例如 ${summarizeAssetPreview(skillContext.assets, 3)}。`
        : '本地资产池当前为空。';

      return createPayload('get_portfolio_summary', {
        citations: ['[positions:default]', skillContext.latestAllocation ? '[allocation:latest]' : '[allocation:none]', '[asset-pool:local]'],
        payload: {
          assetPool,
          latestAllocation: skillContext.latestAllocation,
          positions,
        },
        summary: skillContext.latestAllocation
          ? `当前持仓 ${positions.length} 条，最近一次配置包含 ${skillContext.latestAllocation.allocations.length} 个标的。${assetPoolSummary}`
          : `当前持仓 ${positions.length} 条，但还没有可用的最近一次配置结果。${assetPoolSummary}`,
      });
    },
    async run_allocation(args) {
      const skillContext = runtime.getSkillContext('run-allocation');
      const mode = asString(args.mode) || 'inverse_volatility';
      const maxSingleWeight = asNumber(args.maxSingleWeight, 0.35);
      const selectedAssets = resolveSelectedAssets(skillContext.assets, asStringArray(args.symbols));
      const result = await runtime.portfolioEngine.runAllocation({
        assetIds: selectedAssets.map((asset) => asset.id),
        baseCurrency: skillContext.baseCurrency,
        constraints: {
          allowLeverage: false,
          allowShort: false,
          maxClassWeight: {},
          maxSingleWeight,
        },
        mode: mode === 'erc' || mode === 'max_diversification' ? mode : 'inverse_volatility',
      });

      return createPayload('run_allocation', {
        citations: ['[allocation:generated]', '[price-cache:local]'],
        ok: !result.error,
        payload: result,
        richBlocks: result.error
          ? []
          : [{
            data: {
              allocations: result.allocations,
              metrics: result.portfolioMetrics,
            },
            title: '配置结果',
            type: 'chart',
          }],
        summary: result.error
          ? `配置运行失败：${result.error.message}`
          : `已生成 ${result.mode} 方案，预期收益 ${(result.portfolioMetrics.expectedReturn * 100).toFixed(1)}%，波动 ${(result.portfolioMetrics.volatility * 100).toFixed(1)}%。`,
      });
    },
    async explain_risk() {
      const skillContext = runtime.getSkillContext('explain-risk');
      const execution = await riskDecomposeSkill.execute(skillContext);

      return createPayload('explain_risk', {
        citations: execution.citations,
        payload: execution,
        richBlocks: execution.richBlocks,
        summary: execution.summary,
      });
    },
    async macro_scan() {
      const skillContext = runtime.getSkillContext('macro-scan');
      const execution = await macroScanSkill.execute(skillContext);

      return createPayload('macro_scan', {
        citations: execution.citations,
        payload: execution,
        richBlocks: execution.richBlocks,
        summary: execution.summary,
      });
    },
    async get_macro_series_snapshot(args) {
      if (!runtime.researchProviderService?.getMacroSeriesSnapshot) {
        return createProviderUnavailablePayload('get_macro_series_snapshot', 'provider.macro');
      }

      const snapshot = await runtime.researchProviderService.getMacroSeriesSnapshot({ symbols: asOptionalStringArray(args.symbols) });

      return createPayload('get_macro_series_snapshot', {
        citations: snapshot.dataProvenance.map((item) => `[${item.sourceId}]`),
        ok: snapshot.status === 'available',
        payload: snapshot,
        summary: snapshot.summary,
      });
    },
    async get_fundamental_snapshot(args) {
      const symbol = asString(args.symbol);

      if (!runtime.researchProviderService?.getFundamentalSnapshot) {
        return createProviderUnavailablePayload('get_fundamental_snapshot', 'provider.fundamentals');
      }

      const snapshot = await runtime.researchProviderService.getFundamentalSnapshot({ symbol });

      return createPayload('get_fundamental_snapshot', {
        citations: snapshot.dataProvenance.map((item) => `[${item.sourceId}]`),
        ok: snapshot.status === 'available',
        payload: snapshot,
        summary: snapshot.summary,
      });
    },
    async search_market_sources(args) {
      const market = asString(args.market) || undefined;
      const query = asString(args.query);
      const symbol = asString(args.symbol) || undefined;

      if (!runtime.marketSourceService) {
        return createProviderUnavailablePayload('search_market_sources', 'provider.news_catalysts');
      }

      const sources = await runtime.marketSourceService.searchSources({
        ...(market === undefined ? {} : { market }),
        query,
        symbol,
      });

      return createPayload('search_market_sources', {
        citations: [],
        payload: {
          sources,
          warnings: [
            'Search snippets are not evidence. Call fetch_market_source before citing factual claims.',
            'Fetch directly relevant source references before final answers instead of asking permission.',
          ],
        },
        summary: `市场资料搜索返回 ${sources.length} 条 source reference；未 fetch 前不能作为事实证据。`,
      });
    },
    async fetch_market_source(args) {
      const sourceId = asString(args.sourceId) || undefined;
      const url = asString(args.url) || undefined;

      if (!runtime.marketSourceService) {
        return createProviderUnavailablePayload('fetch_market_source', 'provider.news_catalysts');
      }

      if (!sourceId && !url) {
        return createPayload('fetch_market_source', {
          citations: ['[provider.news_catalysts:invalid_request]'],
          ok: false,
          payload: { reasonCode: 'schema_invalid', sourceId: null, url: null },
          summary: 'fetch_market_source requires either sourceId or url.',
        });
      }

      const source = await runtime.marketSourceService.fetchSource(sourceId
        ? { ...(url === undefined ? {} : { url }), sourceId }
        : { url: url! });

      return createPayload('fetch_market_source', {
        citations: [`[${source.sourceId}]`],
        payload: {
          ...source,
          dataProvenance: source.provenance,
        },
        summary: source.summary,
      });
    },
    async search_announcements(args) {
      const market = asString(args.market) || undefined;
      const query = asString(args.query);
      const symbol = asString(args.symbol) || undefined;

      if (!runtime.marketSourceService) {
        return createProviderUnavailablePayload('search_announcements', 'provider.news_catalysts');
      }

      const sources = await runtime.marketSourceService.searchAnnouncements({
        ...(market === undefined ? {} : { market }),
        query,
        symbol,
      });

      return createPayload('search_announcements', {
        citations: [],
        payload: {
          sources,
          warnings: [
            'Announcement snippets are not evidence. Fetch the source before using factual claims.',
            'Fetch directly relevant announcement references before final answers instead of asking permission.',
          ],
        },
        summary: `公告搜索返回 ${sources.length} 条 source reference；优先官方/监管/交易所来源。`,
      });
    },
    async search_news_catalysts(args) {
      const market = asString(args.market) || undefined;
      const query = asString(args.query);
      const symbol = asString(args.symbol) || undefined;

      if (!runtime.researchProviderService?.searchNewsCatalysts) {
        return createProviderUnavailablePayload('search_news_catalysts', 'provider.news_catalysts');
      }

      const snapshot = await runtime.researchProviderService.searchNewsCatalysts({
        ...(market === undefined ? {} : { market }),
        query,
        symbol,
      });

      return createPayload('search_news_catalysts', {
        citations: [],
        ok: snapshot.status === 'available',
        payload: snapshot,
        summary: snapshot.summary,
      });
    },
    async get_flow_sentiment_snapshot(args) {
      const symbol = asString(args.symbol) || undefined;

      if (!runtime.researchProviderService?.getFlowSentimentSnapshot) {
        return createProviderUnavailablePayload('get_flow_sentiment_snapshot', 'provider.flow_sentiment');
      }

      const snapshot = await runtime.researchProviderService.getFlowSentimentSnapshot({ symbol });

      return createPayload('get_flow_sentiment_snapshot', {
        citations: snapshot.dataProvenance.map((item) => `[${item.sourceId}]`),
        ok: snapshot.status === 'available',
        payload: snapshot,
        summary: snapshot.summary,
      });
    },
    async analyze_futures_trend_observation(args) {
      const symbol = asString(args.symbol).toUpperCase();
      const market = asString(args.market).toUpperCase();

      if (!runtime.strategyCliService) {
        return createProviderUnavailablePayload('analyze_futures_trend_observation', 'strategy.futures_trend_observation');
      }

      try {
        const result = await runtime.strategyCliService.analyzeFuturesTrendObservation({
          end: asOptionalIsoDate(args.end),
          lookbackDays: args.lookbackDays === undefined ? undefined : asInteger(args.lookbackDays, 3650, 120, 10000),
          market,
          symbol,
        });
        const resultSymbol = resultString(result, 'symbol') ?? symbol;
        const statusLabel = resultString(result, 'overallStatusLabel') ?? nestedResultString(result, 'overall', 'statusLabel') ?? '不可用';
        const directionLabel = resultString(result, 'overallDirectionLabel') ?? nestedResultString(result, 'overall', 'directionLabel') ?? '不可用';
        const latestDate = resultString(result, 'latestDate') ?? nestedResultString(result, 'overall', 'latestDate') ?? null;
        const dataQualityStatus = resultString(result, 'dataQualityStatus');
        const dataGaps = resultStringArray(result, 'dataGaps');
        const ok = statusLabel !== '不可用' && dataQualityStatus !== 'unavailable';

        return createPayload('analyze_futures_trend_observation', {
          citations: ['[skill:futures-trend-observation]', `[strategy:futures-trend-observation:${resultSymbol}]`],
          ok,
          payload: result,
          summary: `${resultSymbol} 趋势观察：${statusLabel}，方向 ${directionLabel}${latestDate ? `，最新日期 ${latestDate}` : ''}${dataGaps.length > 0 ? `；数据缺口 ${dataGaps.length} 项` : ''}。`,
        });
      } catch (error) {
        return createPayload('analyze_futures_trend_observation', {
          citations: ['[skill:futures-trend-observation]'],
          ok: false,
          payload: {
            reasonCode: 'strategy_cli_failed',
            symbol,
          },
          summary: `趋势观察 CLI 调用失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    async propose_rebalance() {
      const skillContext = runtime.getSkillContext('propose-rebalance');
      const execution = await rebalanceSkill.execute(skillContext);

      return createPayload('propose_rebalance', {
        citations: execution.citations,
        payload: execution,
        richBlocks: execution.richBlocks,
        summary: execution.summary,
      });
    },
    async analyze_asset(args) {
      const query = asString(args.query) || 'analyze-asset';
      const execution = await assetAnalysisSkill.execute(runtime.getSkillContext(query));

      return createPayload('analyze_asset', {
        citations: execution.citations,
        payload: execution,
        richBlocks: execution.richBlocks,
        summary: execution.summary,
      });
    },
    async compare_assets(args) {
      const symbols = asOptionalStringArray(args.symbols);
      const series = buildLocalPriceSeries(runtime, symbols);
      const rows = series.map((entry) => {
        const returns = entry.returns;
        const latest = entry.prices.at(-1) ?? null;
        const first = entry.prices[0] ?? null;

        return {
          drawdown: maxDrawdown(entry.prices),
          latest,
          returnTotal: latest !== null && first !== null ? (latest / first) - 1 : null,
          rowsUsed: entry.prices.length,
          symbol: entry.asset?.symbol ?? entry.symbol,
          volatility: volatility(returns),
          warnings: entry.warnings,
        };
      });
      const warnings = series.flatMap((entry) => entry.warnings);

      return createPayload('compare_assets', {
        citations: series.flatMap((entry) => entry.asset ? [`[asset:${entry.asset.symbol}]`, `[daily_prices:${entry.asset.id}]`] : []),
        ok: warnings.length === 0,
        payload: {
          dataProvenance: series.filter((entry) => entry.asset).map((entry) => createToolProvenance({ rowsUsed: entry.prices.length, sourceId: `daily_prices:${entry.asset!.id}`, warnings: entry.warnings })),
          rows,
          warnings,
        },
        summary: rows.length > 0
          ? `已比较 ${rows.length} 个本地资产的收益、波动和回撤；${warnings.length > 0 ? `存在 ${warnings.length} 个覆盖警告。` : '覆盖满足首轮比较。'}`
          : '没有可比较的本地资产。',
      });
    },
    async correlation_breakdown(args) {
      const symbols = asOptionalStringArray(args.symbols);
      const series = buildLocalPriceSeries(runtime, symbols);
      const matrix = series.map((left) => ({
        correlations: Object.fromEntries(series.map((right) => [right.asset?.symbol ?? right.symbol, correlation(left.returns, right.returns)])),
        symbol: left.asset?.symbol ?? left.symbol,
      }));
      const commonWindowRows = Math.min(...series.map((entry) => entry.returns.length).filter((length) => length > 0), Number.POSITIVE_INFINITY);
      const warnings = [
        ...series.flatMap((entry) => entry.warnings),
        ...(Number.isFinite(commonWindowRows) && commonWindowRows < 60 ? ['Common return window has fewer than 60 rows; correlation is unstable.'] : []),
      ];

      return createPayload('correlation_breakdown', {
        citations: series.flatMap((entry) => entry.asset ? [`[daily_prices:${entry.asset.id}]`] : []),
        ok: warnings.length === 0,
        payload: {
          commonWindowRows: Number.isFinite(commonWindowRows) ? commonWindowRows : 0,
          dataProvenance: series.filter((entry) => entry.asset).map((entry) => createToolProvenance({ rowsUsed: entry.prices.length, sourceId: `daily_prices:${entry.asset!.id}`, warnings: entry.warnings })),
          matrix,
          warnings,
        },
        summary: `相关性矩阵已基于本地共同收益窗口生成；${warnings.length > 0 ? `存在 ${warnings.length} 个覆盖/稳定性警告。` : '未发现覆盖警告。'}`,
      });
    },
    async analyze_execution_liquidity(args) {
      const symbol = asString(args.symbol);
      const asset = resolveAssetBySymbol(runtime, symbol);

      if (!asset) {
        return createPayload('analyze_execution_liquidity', {
          citations: ['[asset-pool:local]'],
          ok: false,
          payload: { reasonCode: 'requested_asset_missing', symbol },
          summary: `未找到 ${symbol} 对应的本地资产，无法分析执行流动性。`,
        });
      }

      const rows = runtime.dataServices.repositories.priceRepository.listByAsset(asset.id).slice(-60);
      const usablePrices = rows.map(getAdjustedClose).filter((value): value is number => value !== null);
      const volumes = rows.map(getVolume).filter((value): value is number => value !== null);
      const latestDate = getPriceDate(rows.at(-1) ?? {});
      const averageVolume = volumes.length > 0 ? average(volumes) : null;
      const warnings = [
        ...(usablePrices.length < 30 ? ['Fewer than 30 usable local price rows for liquidity proxy.'] : []),
        ...(volumes.length === 0 ? ['No local volume rows; liquidity estimate is degraded.'] : []),
      ];

      return createPayload('analyze_execution_liquidity', {
        citations: [`[asset:${asset.symbol}]`, `[daily_prices:${asset.id}]`],
        ok: warnings.length === 0,
        payload: {
          averageVolume,
          dataProvenance: [createToolProvenance({ rowsUsed: rows.length, sourceId: `daily_prices:${asset.id}`, warnings })],
          latestDate,
          orderSlicingGuidance: warnings.length > 0
            ? 'Keep action conservative; confirm real-time liquidity before any operation.'
            : 'Use staged execution and avoid sizing above local liquidity comfort without live quote confirmation.',
          rowsUsed: rows.length,
          symbol: asset.symbol,
          warnings,
        },
        summary: `${asset.symbol} 执行流动性基于最近 ${rows.length} 条本地价格/成交量代理；${warnings.length > 0 ? warnings.join(' ') : '首轮未发现严重流动性缺口。'}`,
      });
    },
    async search_quantdesk_docs(args) {
      const query = asString(args.query);
      const result = await runtime.docsRagService.search(query);

      return createPayload('search_quantdesk_docs', {
        citations: result.citations,
        payload: result,
        summary: result.summary,
      });
    },
  };

  return handlers;
};