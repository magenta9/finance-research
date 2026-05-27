import { financeToolDefinitions } from '../agent/capabilities/finance/definitions';

export interface ResearchToolCapability {
    backingSkillName: string | null;
    evidenceKind: 'asset' | 'document' | 'fundamental' | 'liquidity' | 'macro' | 'market_source' | 'portfolio' | 'price' | 'risk';
    limitations: string[];
    requiredDataSources: string[];
    sourceScope: 'derived' | 'local' | 'provider' | 'remote';
    toolName: string;
}

export const financeResearchToolCapabilities: ResearchToolCapability[] = [
    {
        backingSkillName: null,
        evidenceKind: 'risk',
        limitations: ['Health check only; not market evidence.'],
        requiredDataSources: [],
        sourceScope: 'local',
        toolName: 'health_check',
    },
    {
        backingSkillName: null,
        evidenceKind: 'asset',
        limitations: ['Searches only the local QuantDesk asset pool; does not query remote providers.'],
        requiredDataSources: ['local.asset_universe'],
        sourceScope: 'local',
        toolName: 'search_assets',
    },
    {
        backingSkillName: null,
        evidenceKind: 'asset',
        limitations: ['Remote discovery returns candidates only; it does not create positions or trades.'],
        requiredDataSources: ['provider.asset_discovery'],
        sourceScope: 'remote',
        toolName: 'resolve_market_assets',
    },
    {
        backingSkillName: null,
        evidenceKind: 'price',
        limitations: ['May hydrate local asset price history only through controlled main-process services.'],
        requiredDataSources: ['local.daily_prices', 'provider.asset_discovery'],
        sourceScope: 'remote',
        toolName: 'ensure_asset_history',
    },
    {
        backingSkillName: null,
        evidenceKind: 'asset',
        limitations: ['Summarizes loaded local asset pool; not remote coverage.'],
        requiredDataSources: ['local.asset_universe'],
        sourceScope: 'local',
        toolName: 'get_asset_pool_summary',
    },
    {
        backingSkillName: null,
        evidenceKind: 'price',
        limitations: ['Uses local metadata and cached prices only.'],
        requiredDataSources: ['local.asset_universe', 'local.daily_prices'],
        sourceScope: 'local',
        toolName: 'get_asset_snapshot',
    },
    {
        backingSkillName: null,
        evidenceKind: 'portfolio',
        limitations: ['Uses default local portfolio and latest saved allocation plan.'],
        requiredDataSources: ['local.positions', 'local.allocation_plan'],
        sourceScope: 'local',
        toolName: 'get_portfolio_summary',
    },
    {
        backingSkillName: null,
        evidenceKind: 'portfolio',
        limitations: ['Generated proposal depends on local adjusted price coverage and constraints.'],
        requiredDataSources: ['local.daily_prices'],
        sourceScope: 'derived',
        toolName: 'run_allocation',
    },
    {
        backingSkillName: 'risk-decompose',
        evidenceKind: 'risk',
        limitations: ['Explains local portfolio and allocation risk; no external risk model.'],
        requiredDataSources: ['local.positions', 'local.risk_profile'],
        sourceScope: 'derived',
        toolName: 'explain_risk',
    },
    {
        backingSkillName: 'macro-scan',
        evidenceKind: 'macro',
        limitations: ['Infers macro exposure from local assets and allocation context; not a macro data provider.'],
        requiredDataSources: ['local.asset_universe'],
        sourceScope: 'derived',
        toolName: 'macro_scan',
    },
    {
        backingSkillName: null,
        evidenceKind: 'macro',
        limitations: ['Provider may return degraded coverage when series are unavailable.'],
        requiredDataSources: ['provider.macro'],
        sourceScope: 'provider',
        toolName: 'get_macro_series_snapshot',
    },
    {
        backingSkillName: null,
        evidenceKind: 'fundamental',
        limitations: ['ETF/fund issuer-style fundamentals are not applicable; current AkShare CSIndex valuation coverage can return PE/dividend for configured CSIndex codes, not PB.'],
        requiredDataSources: ['provider.fundamentals'],
        sourceScope: 'provider',
        toolName: 'get_fundamental_snapshot',
    },
    {
        backingSkillName: null,
        evidenceKind: 'market_source',
        limitations: ['Search results are source references only; snippets are not evidence until fetched; fetch directly relevant references before final answers.'],
        requiredDataSources: ['provider.news_catalysts'],
        sourceScope: 'provider',
        toolName: 'search_market_sources',
    },
    {
        backingSkillName: null,
        evidenceKind: 'market_source',
        limitations: ['Fetched and parsed sources may become citable evidence with provenance.'],
        requiredDataSources: ['provider.news_catalysts'],
        sourceScope: 'provider',
        toolName: 'fetch_market_source',
    },
    {
        backingSkillName: null,
        evidenceKind: 'market_source',
        limitations: ['Prioritizes official, regulatory, exchange, and company sources; fetch directly relevant references before final answers.'],
        requiredDataSources: ['provider.news_catalysts'],
        sourceScope: 'provider',
        toolName: 'search_announcements',
    },
    {
        backingSkillName: null,
        evidenceKind: 'market_source',
        limitations: ['Returns catalyst source references; fetch directly material references before final answers.'],
        requiredDataSources: ['provider.news_catalysts'],
        sourceScope: 'provider',
        toolName: 'search_news_catalysts',
    },
    {
        backingSkillName: null,
        evidenceKind: 'liquidity',
        limitations: ['Flow and sentiment may degrade to volume/turnover proxies.'],
        requiredDataSources: ['provider.flow_sentiment', 'local.daily_prices'],
        sourceScope: 'provider',
        toolName: 'get_flow_sentiment_snapshot',
    },
    {
        backingSkillName: 'rebalance-advisor',
        evidenceKind: 'portfolio',
        limitations: ['Compares current holdings with latest local target allocation.'],
        requiredDataSources: ['local.positions', 'local.allocation_plan'],
        sourceScope: 'derived',
        toolName: 'propose_rebalance',
    },
    {
        backingSkillName: 'asset-analysis',
        evidenceKind: 'price',
        limitations: ['Uses local price history and simple statistics.'],
        requiredDataSources: ['local.daily_prices'],
        sourceScope: 'derived',
        toolName: 'analyze_asset',
    },
    {
        backingSkillName: null,
        evidenceKind: 'document',
        limitations: ['Searches internal QuantDesk docs, not market news.'],
        requiredDataSources: ['local.docs'],
        sourceScope: 'local',
        toolName: 'search_quantdesk_docs',
    },
    {
        backingSkillName: null,
        evidenceKind: 'price',
        limitations: ['Requires aligned local adjusted price windows; emits coverage warnings.'],
        requiredDataSources: ['local.daily_prices'],
        sourceScope: 'derived',
        toolName: 'compare_assets',
    },
    {
        backingSkillName: null,
        evidenceKind: 'risk',
        limitations: ['Correlation uses common local price windows and can be unstable with short history.'],
        requiredDataSources: ['local.daily_prices'],
        sourceScope: 'derived',
        toolName: 'correlation_breakdown',
    },
    {
        backingSkillName: null,
        evidenceKind: 'liquidity',
        limitations: ['Liquidity is a local price/volume proxy unless provider flow data is available.'],
        requiredDataSources: ['local.daily_prices'],
        sourceScope: 'derived',
        toolName: 'analyze_execution_liquidity',
    },
];

const definitionToolNames = new Set(financeToolDefinitions.map((definition) => definition.name));

export const financeResearchToolCapabilityByName = new Map(
    financeResearchToolCapabilities.map((capability) => [capability.toolName, capability]),
);

export const getResearchToolCapability = (toolName: string) => financeResearchToolCapabilityByName.get(toolName);

export const unknownFinanceToolCapabilityNames = () => financeResearchToolCapabilities
    .filter((capability) => !definitionToolNames.has(capability.toolName))
    .map((capability) => capability.toolName);
