import type {
    AssetClass,
    Market,
    NormalizedResearchRequest,
    ResearchRequestInput,
} from '@quantdesk/shared';

const containsAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

export const normalizeResearchRequest = (input: ResearchRequestInput): NormalizedResearchRequest => {
    const text = input.query.trim().toLowerCase();
    const isAllocation = containsAny(text, ['配置', 'allocation', 'rebalance', '再平衡', '组合', 'portfolio']);
    const isShortTerm = containsAny(text, ['短线', '交易', '入场', '止损', 'breakout', 'trade', 'trend']);
    const isMacro = containsAny(text, ['宏观', '利率', '通胀', '美元', '流动性', 'macro']);
    const isSingleAsset = (input.assetIds?.length ?? 0) === 1 || containsAny(text, ['单股', '个股', 'single']);
    const isAggressive = containsAny(text, ['重仓', '大幅', '激进', 'all in', '加仓', '满仓', '高风险']);
    const isPrepare = containsAny(text, ['观察', '准备', '触发', 'watch', 'prepare']);
    const taskType = isAllocation
        ? 'allocation'
        : isShortTerm
            ? 'short_term_trade'
            : isSingleAsset
                ? 'single_asset'
                : isMacro
                    ? 'macro'
                    : containsAny(text, ['持仓', '回顾', 'review'])
                        ? 'portfolio_review'
                        : 'general';
    const actionIntent = isAllocation
        ? 'rebalance'
        : isShortTerm
            ? 'trade'
            : isPrepare
                ? 'prepare'
                : containsAny(text, ['复盘', 'review'])
                    ? 'review'
                    : 'observe';
    const assetScope = isAllocation || taskType === 'portfolio_review'
        ? 'portfolio'
        : isSingleAsset
            ? 'single_asset'
            : (input.assetIds?.length ?? 0) > 1
                ? 'multi_asset'
                : 'unknown';
    const assetType = containsAny(text, ['etf', '基金'])
        ? 'mixed'
        : containsAny(text, ['a股', '沪深', '中证'])
            ? 'A'
            : containsAny(text, ['港股', '恒生'])
                ? 'HK'
                : containsAny(text, ['美股', '纳斯达克', '纳指', 'spy', 'qqq', 'nasdaq', 's&p'])
                    ? 'US'
                    : 'unknown';
    const assetClassHint: AssetClass | null = containsAny(text, ['债', 'bond'])
        ? 'fixed_income'
        : containsAny(text, ['黄金', 'commodity', '商品'])
            ? 'commodity'
            : containsAny(text, ['现金', 'cash'])
                ? 'cash'
                : containsAny(text, ['股票', 'equity', 'etf', '基金'])
                    ? 'equity'
                    : null;

    return {
        actionIntensity: isAggressive ? 'high' : isShortTerm ? 'medium' : 'low',
        actionIntent,
        assetClassHint,
        assetScope,
        assetType: assetType as Market | 'mixed' | 'unknown',
        dataNeeds: [
            'local_asset_pool',
            'price_history',
            ...(isAllocation ? ['holdings', 'latest_allocation'] : []),
            ...(isMacro ? ['macro_context'] : []),
            ...(isSingleAsset ? ['asset_snapshot'] : []),
        ],
        riskLevel: isAggressive ? 'high' : isShortTerm ? 'medium' : 'unknown',
        taskType,
        timeHorizon: isShortTerm ? 'days_to_weeks' : isAllocation ? 'months_to_years' : 'weeks_to_months',
    };
};