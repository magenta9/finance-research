import type { ResearchRole, ReviewerRole } from '@quantdesk/shared';

export interface ResearchRoleDefinition {
    description: string;
    label: string;
    role: ResearchRole;
    toolAllowlist: string[];
}

export interface ReviewerRoleDefinition {
    description: string;
    label: string;
    role: ReviewerRole;
    toolAllowlist: string[];
}

export const researchRoleDefinitions: ResearchRoleDefinition[] = [
    {
        description: 'Asset allocation, target weights, rebalance bands, diversification and risk budget.',
        label: 'Allocation Researcher',
        role: 'allocation',
        toolAllowlist: ['get_asset_pool_summary', 'get_asset_snapshot', 'get_portfolio_summary', 'run_allocation', 'explain_risk', 'compare_assets', 'correlation_breakdown', 'get_macro_series_snapshot'],
    },
    {
        description: 'Trend, momentum, breakout, stop and invalidation levels from local price history.',
        label: 'Trend Researcher',
        role: 'trend',
        toolAllowlist: ['search_assets', 'resolve_market_assets', 'get_asset_snapshot', 'analyze_asset'],
    },
    {
        description: 'Macro exposures from scoped context, local macro scan and provider-backed macro proxies. Must not search the local asset pool unless search_assets is explicitly allowed.',
        label: 'Macro Researcher',
        role: 'macro',
        toolAllowlist: ['get_asset_pool_summary', 'get_asset_snapshot', 'macro_scan', 'get_macro_series_snapshot', 'search_market_sources', 'fetch_market_source'],
    },
    {
        description: 'Fundamental quality, valuation and catalysts. Must report data gaps without fabricating data; ETF/fund issuer-style fundamentals are not applicable and require explicit underlying-index valuation sources.',
        label: 'Fundamental Researcher',
        role: 'fundamental',
        toolAllowlist: ['resolve_market_assets', 'get_asset_snapshot', 'get_fundamental_snapshot', 'search_news_catalysts', 'search_announcements', 'fetch_market_source', 'search_quantdesk_docs'],
    },
    {
        description: 'Drawdown, concentration, tail risk and position downgrade authority.',
        label: 'Risk Researcher',
        role: 'risk',
        toolAllowlist: ['get_portfolio_summary', 'explain_risk', 'get_asset_snapshot', 'compare_assets', 'correlation_breakdown', 'analyze_execution_liquidity'],
    },
    {
        description: 'Factor exposure and base-rate framing. Weak statistics must stay weak.',
        label: 'Factor Researcher',
        role: 'factor',
        toolAllowlist: ['get_asset_snapshot', 'analyze_asset'],
    },
    {
        description: 'Flow, sentiment and crowding. News/social signals cannot become factual proof.',
        label: 'Flow Sentiment Researcher',
        role: 'flow_sentiment',
        toolAllowlist: ['resolve_market_assets', 'get_asset_snapshot', 'get_flow_sentiment_snapshot', 'search_news_catalysts', 'fetch_market_source'],
    },
    {
        description: 'Liquidity, slippage, order slicing, entry, stop, exit and review triggers.',
        label: 'Execution Researcher',
        role: 'execution',
        toolAllowlist: ['get_asset_snapshot', 'get_portfolio_summary', 'analyze_execution_liquidity'],
    },
];

export const reviewerRoleDefinitions: ReviewerRoleDefinition[] = [
    {
        description: 'Hard data-quality gate. Blocks strong conclusions when critical data is absent or stale.',
        label: 'Data Quality Reviewer',
        role: 'data_quality',
        toolAllowlist: ['get_asset_pool_summary', 'get_asset_snapshot', 'get_portfolio_summary'],
    },
    {
        description: 'Soft adversarial review. Finds hidden assumptions, counter-evidence and downgrade paths.',
        label: 'Devil Advocate Reviewer',
        role: 'devil_advocate',
        toolAllowlist: ['get_asset_snapshot', 'explain_risk'],
    },
];

export const allResearchRoles = researchRoleDefinitions.map((definition) => definition.role);
export const allReviewerRoles = reviewerRoleDefinitions.map((definition) => definition.role);

export const getResearchRoleDefinition = (role: ResearchRole) => {
    const definition = researchRoleDefinitions.find((entry) => entry.role === role);

    if (!definition) {
        throw new Error(`Unknown research role: ${role}`);
    }

    return definition;
};

export const getReviewerRoleDefinition = (role: ReviewerRole) => {
    const definition = reviewerRoleDefinitions.find((entry) => entry.role === role);

    if (!definition) {
        throw new Error(`Unknown reviewer role: ${role}`);
    }

    return definition;
};