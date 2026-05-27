import type { ResearchRole, ResearchTaskType, ResearchActionIntent } from '@quantdesk/shared';

export type PiNativeResearchAgentRole = ResearchRole;

export interface PiNativeResearchRoleDefinition {
    allowedToolNames: string[];
    description: string;
    role: PiNativeResearchAgentRole;
    taskInstruction: string;
}

const commonAssetTools = ['search_assets', 'resolve_market_assets', 'ensure_asset_history', 'get_asset_snapshot', 'analyze_asset'];

export const piNativeResearchRoleDefinitions: PiNativeResearchRoleDefinition[] = [
    {
        allowedToolNames: [...commonAssetTools, 'get_portfolio_summary', 'macro_scan', 'compare_assets', 'correlation_breakdown'],
        description: 'Portfolio allocation and rebalance analyst.',
        role: 'allocation',
        taskInstruction: 'Judge whether the request supports observe, prepare, or rebalance research. Focus on portfolio constraints, diversification, risk budget, and allocation evidence.',
    },
    {
        allowedToolNames: [...commonAssetTools, 'search_market_sources', 'fetch_market_source', 'search_news_catalysts', 'compare_assets'],
        description: 'Trend and price-action analyst.',
        role: 'trend',
        taskInstruction: 'Evaluate verified price trend, momentum, drawdown, and invalidation windows. Do not infer live prices without tool evidence.',
    },
    {
        allowedToolNames: ['search_assets', 'resolve_market_assets', 'get_asset_snapshot', 'analyze_asset', 'get_portfolio_summary', 'macro_scan', 'get_macro_series_snapshot', 'search_market_sources', 'fetch_market_source'],
        description: 'Macro regime analyst.',
        role: 'macro',
        taskInstruction: 'Evaluate macro conditions, liquidity, rates, FX, and cross-asset effects using available QuantDesk tools and explicit provenance.',
    },
    {
        allowedToolNames: [...commonAssetTools, 'get_fundamental_snapshot', 'search_market_sources', 'fetch_market_source', 'search_news_catalysts'],
        description: 'Fundamental analyst.',
        role: 'fundamental',
        taskInstruction: 'Evaluate fundamental quality, earnings, valuation, and entity-specific evidence. For ETF/fund assets, do not treat issuer-style fundamentals as missing stock fundamentals; use explicit underlying-index valuation sources if available and fetch material catalyst references before final answers.',
    },
    {
        allowedToolNames: [...commonAssetTools, 'get_portfolio_summary', 'compare_assets', 'correlation_breakdown', 'analyze_execution_liquidity'],
        description: 'Risk analyst.',
        role: 'risk',
        taskInstruction: 'Evaluate drawdown, volatility, concentration, correlation, liquidity risk, and risk-profile constraints. Downgrade action if sizing evidence is insufficient.',
    },
    {
        allowedToolNames: [...commonAssetTools, 'compare_assets', 'correlation_breakdown', 'search_market_sources', 'fetch_market_source'],
        description: 'Factor and style analyst.',
        role: 'factor',
        taskInstruction: 'Evaluate style, factor, and risk-adjusted return evidence. Treat missing factor provider data as an explicit gap.',
    },
    {
        allowedToolNames: ['search_assets', 'resolve_market_assets', 'get_asset_snapshot', 'analyze_asset', 'search_news_catalysts', 'get_flow_sentiment_snapshot', 'search_market_sources', 'fetch_market_source'],
        description: 'Flow, sentiment, and catalyst analyst.',
        role: 'flow_sentiment',
        taskInstruction: 'Evaluate verified flows, sentiment, news catalysts, and announcement evidence. Snippets are not evidence until fetched or provenance-qualified.',
    },
    {
        allowedToolNames: [...commonAssetTools, 'get_portfolio_summary', 'analyze_execution_liquidity', 'compare_assets'],
        description: 'Execution analyst.',
        role: 'execution',
        taskInstruction: 'Evaluate liquidity, stale prices, gaps, slippage proxies, staged execution, and operational blockers. Never output trade execution instructions.',
    },
];

export const piNativeResearchRoles = piNativeResearchRoleDefinitions.map((definition) => definition.role);

export const getPiNativeResearchRoleDefinition = (role: PiNativeResearchAgentRole) => {
    const definition = piNativeResearchRoleDefinitions.find((candidate) => candidate.role === role);

    if (!definition) {
        throw new Error(`Unknown Pi native research role: ${role}`);
    }

    return definition;
};

export const selectPiNativeResearchRoles = (input: {
    actionIntent: ResearchActionIntent;
    taskType: ResearchTaskType;
}): ResearchRole[] => {
    if (input.taskType === 'allocation' || input.actionIntent === 'rebalance') {
        return ['allocation', 'macro', 'risk', 'execution'];
    }

    if (input.taskType === 'short_term_trade') {
        return ['trend', 'flow_sentiment', 'execution', 'risk'];
    }

    if (input.taskType === 'single_asset') {
        return ['fundamental', 'trend', 'factor', 'risk'];
    }

    if (input.taskType === 'macro') {
        return ['macro', 'risk', 'allocation'];
    }

    if (input.taskType === 'portfolio_review') {
        return ['allocation', 'risk', 'macro'];
    }

    return ['trend', 'risk'];
};