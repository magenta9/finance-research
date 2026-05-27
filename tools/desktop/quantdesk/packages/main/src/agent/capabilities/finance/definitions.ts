import type { ToolSchema } from '@quantdesk/shared';

import type { FinanceToolDefinition } from './types';

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  additionalProperties: false,
  properties,
  required,
  type: 'object',
});

export const financeToolDefinitions: FinanceToolDefinition[] = [
  {
    description: 'Check that the QuantDesk finance bridge is reachable.',
    inputSchema: objectSchema({}),
    name: 'health_check',
    visibility: 'always',
  },
  {
    description: 'Search within the QuantDesk local asset pool/watchlist by symbol or name.',
    inputSchema: objectSchema({
      query: {
        description: 'Free-form asset query by symbol or name.',
        minLength: 1,
        type: 'string',
      },
    }, ['query']),
    name: 'search_assets',
    visibility: 'always',
  },
  {
    description: 'Discover remote market assets through enabled market-data providers. This does not search the local asset pool and does not create trades.',
    inputSchema: objectSchema({
      market: {
        description: 'Optional market filter such as A, HK, or US.',
        type: 'string',
      },
      query: {
        description: 'Ticker, fund code, company name, or ETF name to resolve remotely.',
        minLength: 1,
        type: 'string',
      },
    }, ['query']),
    name: 'resolve_market_assets',
    visibility: 'contextual',
  },
  {
    description: 'Ensure local price history exists for a known local asset. This hydrates through controlled main-process market data services only.',
    inputSchema: objectSchema({
      assetId: {
        minLength: 1,
        type: 'string',
      },
      forceRefresh: {
        type: 'boolean',
      },
    }, ['assetId']),
    name: 'ensure_asset_history',
    visibility: 'contextual',
  },
  {
    description: 'List the assets currently loaded into the QuantDesk local asset pool/watchlist. Compatibility fields from allocation flows are ignored.',
    inputSchema: objectSchema({
      limit: {
        default: 8,
        maximum: 20,
        minimum: 1,
        type: 'number',
      },
      mode: {
        description: 'Ignored compatibility field from allocation flows.',
        type: 'string',
      },
    }),
    name: 'get_asset_pool_summary',
    visibility: 'always',
  },
  {
    description: 'Inspect one asset with the local price cache and metadata.',
    inputSchema: objectSchema({
      symbol: {
        description: 'Ticker symbol or short asset code.',
        minLength: 1,
        type: 'string',
      },
    }, ['symbol']),
    name: 'get_asset_snapshot',
    visibility: 'always',
  },
  {
    description: 'Search local same-market and same-asset-class historical price-pattern analogs for one asset. This is a historical analogy explorer, not a prediction engine.',
    inputSchema: objectSchema({
      endDate: {
        description: 'Optional YYYY-MM-DD end date. Defaults to the latest cached local price date.',
        type: 'string',
      },
      limit: {
        default: 10,
        maximum: 20,
        minimum: 1,
        type: 'number',
      },
      symbol: {
        description: 'Local asset ticker symbol or short code.',
        minLength: 1,
        type: 'string',
      },
      window: {
        default: '6M',
        enum: ['3M', '6M', '1Y'],
        type: 'string',
      },
    }, ['symbol']),
    name: 'search_price_pattern_analogs',
    visibility: 'contextual',
  },
  {
    description: 'Summarize current holdings and the latest saved allocation result. Use get_asset_pool_summary to inspect the full local asset pool/watchlist.',
    inputSchema: objectSchema({}),
    name: 'get_portfolio_summary',
    visibility: 'always',
  },
  {
    description: 'Generate a local allocation proposal over the current asset universe.',
    inputSchema: objectSchema({
      maxSingleWeight: {
        default: 0.35,
        maximum: 1,
        minimum: 0.05,
        type: 'number',
      },
      mode: {
        default: 'inverse_volatility',
        enum: ['erc', 'inverse_volatility', 'max_diversification'],
        type: 'string',
      },
      symbols: {
        items: {
          minLength: 1,
          type: 'string',
        },
        type: 'array',
      },
    }),
    name: 'run_allocation',
    visibility: 'always',
  },
  {
    description: 'Use the local risk decomposition logic on the latest allocation result.',
    inputSchema: objectSchema({}),
    name: 'explain_risk',
    visibility: 'always',
  },
  {
    description: 'Use the local asset universe to produce a macro exposure snapshot.',
    inputSchema: objectSchema({}),
    name: 'macro_scan',
    visibility: 'contextual',
  },
  {
    description: 'Get provider-backed macro series or proxy status with freshness, warnings, and provenance.',
    inputSchema: objectSchema({
      symbols: {
        items: { type: 'string' },
        type: 'array',
      },
    }),
    name: 'get_macro_series_snapshot',
    visibility: 'contextual',
  },
  {
    description: 'Get provider-backed fundamental snapshot for an asset. ETF/fund assets return fundFacts with issuerStyleFundamentals=asset_not_covered; do not infer PE/PB/ROE from issuer fundamentals. Underlying-index valuation is explicit source data; current AkShare CSIndex coverage can return PE/dividend, not PB.',
    inputSchema: objectSchema({
      symbol: { minLength: 1, type: 'string' },
    }, ['symbol']),
    name: 'get_fundamental_snapshot',
    visibility: 'contextual',
  },
  {
    description: 'Search market source references. Snippets are not evidence until fetch_market_source parses and caches the source. Fetch directly relevant source references before final answers instead of asking permission.',
    inputSchema: objectSchema({
      market: { type: 'string' },
      query: { minLength: 1, type: 'string' },
      symbol: { type: 'string' },
    }, ['query']),
    name: 'search_market_sources',
    visibility: 'contextual',
  },
  {
    description: 'Fetch and parse a market source so it becomes provenance-eligible evidence.',
    inputSchema: objectSchema({
      sourceId: { type: 'string' },
      url: { type: 'string' },
    }),
    name: 'fetch_market_source',
    visibility: 'contextual',
  },
  {
    description: 'Search official, regulatory, exchange, or company announcement source references. Fetch directly relevant announcements before final answers instead of asking permission.',
    inputSchema: objectSchema({
      market: { type: 'string' },
      query: { minLength: 1, type: 'string' },
      symbol: { type: 'string' },
    }, ['query']),
    name: 'search_announcements',
    visibility: 'contextual',
  },
  {
    description: 'Search provider-backed news catalyst source references. Results are not citable evidence until fetch_market_source succeeds; fetch material catalyst references before final answers instead of asking permission.',
    inputSchema: objectSchema({
      market: { type: 'string' },
      query: { minLength: 1, type: 'string' },
      symbol: { type: 'string' },
    }, ['query']),
    name: 'search_news_catalysts',
    visibility: 'contextual',
  },
  {
    description: 'Get provider-backed flow/sentiment snapshot or local liquidity proxy with source status.',
    inputSchema: objectSchema({
      symbol: { type: 'string' },
    }),
    name: 'get_flow_sentiment_snapshot',
    visibility: 'contextual',
  },
  {
    description: 'Run the repository futures trend observation deterministic CLI for a futures main contract. This returns observation status only and never trade execution advice.',
    inputSchema: objectSchema({
      end: {
        description: 'Optional YYYY-MM-DD end date. Defaults to the CLI current date.',
        type: 'string',
      },
      lookbackDays: {
        default: 3650,
        maximum: 10000,
        minimum: 120,
        type: 'number',
      },
      market: {
        description: 'quant-data market, usually COMMODITY for domestic futures.',
        minLength: 1,
        type: 'string',
      },
      symbol: {
        description: 'Futures symbol or main continuous symbol, for example LH or LH9999.',
        minLength: 1,
        type: 'string',
      },
    }, ['symbol', 'market']),
    name: 'analyze_futures_trend_observation',
    visibility: 'contextual',
  },
  {
    description: 'Compare current holdings against the latest target allocation.',
    inputSchema: objectSchema({}),
    name: 'propose_rebalance',
    visibility: 'contextual',
  },
  {
    description: 'Analyze one asset from local price history and portfolio statistics.',
    inputSchema: objectSchema({
      query: {
        description: 'Optional natural-language analysis prompt.',
        type: 'string',
      },
    }),
    name: 'analyze_asset',
    visibility: 'contextual',
  },
  {
    description: 'Compare multiple assets using local adjusted price history over a common window.',
    inputSchema: objectSchema({
      symbols: {
        items: { minLength: 1, type: 'string' },
        minItems: 2,
        type: 'array',
      },
    }),
    name: 'compare_assets',
    visibility: 'contextual',
  },
  {
    description: 'Compute correlation matrix and common-window coverage from local adjusted price history.',
    inputSchema: objectSchema({
      symbols: {
        items: { minLength: 1, type: 'string' },
        minItems: 2,
        type: 'array',
      },
    }),
    name: 'correlation_breakdown',
    visibility: 'contextual',
  },
  {
    description: 'Analyze local execution liquidity using volume, stale-price, gap, and price-history proxies.',
    inputSchema: objectSchema({
      symbol: { minLength: 1, type: 'string' },
    }, ['symbol']),
    name: 'analyze_execution_liquidity',
    visibility: 'contextual',
  },
  {
    description: 'Search internal QuantDesk docs and specs.',
    inputSchema: objectSchema({
      query: {
        description: 'Document search query.',
        minLength: 1,
        type: 'string',
      },
    }, ['query']),
    name: 'search_quantdesk_docs',
    visibility: 'contextual',
  },
];

export const financeToolSchemas: ToolSchema[] = financeToolDefinitions.map((definition) => ({
  description: definition.description,
  name: definition.name,
  parameters: definition.inputSchema,
  visibility: definition.visibility,
}));