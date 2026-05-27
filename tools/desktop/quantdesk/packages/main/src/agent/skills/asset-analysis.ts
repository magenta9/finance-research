import { annualizedReturns, annualizedVolatility, computeLogReturns, covarianceMatrix, shrinkCovarianceMatrix } from '../../portfolio/statistics';

import type { AgentSkill, SkillContext } from './types';

const analysisWindows = [
    { label: '最近1个月', lookbackDays: 21, pattern: /(最近|近)?\s*(1|一)\s*个?月/i },
    { label: '最近3个月', lookbackDays: 63, pattern: /(最近|近)?\s*(3|三)\s*个?月/i },
    { label: '最近6个月', lookbackDays: 126, pattern: /(最近|近)?\s*(6|六)\s*个?月/i },
    { label: '最近1年', lookbackDays: 252, pattern: /(最近|近)?\s*(1|一)\s*年/i },
] as const;

const detectAnalysisWindow = (message: string) => analysisWindows.find((window) => window.pattern.test(message));

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

export const createAssetAnalysisSkill = (
    getPriceSeries: (assetId: string) => number[],
): AgentSkill => ({
    description: 'Analyze historical price volatility and trend characteristics for an asset.',
    name: 'asset-analysis',
    async execute(context: SkillContext) {
        const normalizedMessage = context.message.trim().toLowerCase();
        const asset = context.assets.find(
            (entry) =>
                normalizedMessage.includes(entry.symbol.toLowerCase())
                || normalizedMessage.includes(entry.name.toLowerCase()),
        ) ?? context.assets[0];

        if (!asset) {
            return {
                citations: [],
                richBlocks: [],
                skill: 'asset-analysis',
                summary: '当前资产池为空，无法执行标的分析。',
            };
        }

        const prices = getPriceSeries(asset.id);
        const requestedWindow = detectAnalysisWindow(context.message);
        const scopedPrices = requestedWindow
            ? prices.slice(-(requestedWindow.lookbackDays + 1))
            : prices;
        const returns = computeLogReturns([scopedPrices]);
        const cov = shrinkCovarianceMatrix(covarianceMatrix(returns));
        const annualReturn = annualizedReturns(returns)[0] ?? 0;
        const annualVolatility = annualizedVolatility(cov)[0] ?? 0;
        const scopedStartPrice = scopedPrices[0] ?? 0;
        const scopedEndPrice = scopedPrices[scopedPrices.length - 1] ?? 0;
        const windowReturn = scopedStartPrice > 0 && scopedEndPrice > 0
            ? (scopedEndPrice / scopedStartPrice) - 1
            : 0;
        const coverageNote = requestedWindow && scopedPrices.length < requestedWindow.lookbackDays + 1
            ? `本地缓存不足以完整覆盖${requestedWindow.label}，以下结论基于最近 ${Math.max(scopedPrices.length - 1, 0)} 个交易日估算。`
            : null;
        const summary = requestedWindow
            ? [
                `${asset.symbol} 的分析基于本地缓存价格数据，不包含基本面。`,
                coverageNote,
                `${requestedWindow.label}区间收益约 ${formatPercent(windowReturn)}，区间年化波动约 ${formatPercent(annualVolatility)}。`,
            ].filter(Boolean).join('')
            : `${asset.symbol} 的分析基于本地缓存价格数据，不包含基本面。年化收益约 ${formatPercent(annualReturn)}，年化波动约 ${formatPercent(annualVolatility)}。若其波动明显高于组合平均值，更适合作为卫星仓位而不是核心底仓。`;

        return {
            citations: [`[price-cache:${asset.symbol}:local]`],
            richBlocks: [
                {
                    data: {
                        rows: [
                            requestedWindow
                                ? { label: `${requestedWindow.label}收益`, value: windowReturn }
                                : { label: '年化收益', value: annualReturn },
                            { label: requestedWindow ? `${requestedWindow.label}年化波动` : '年化波动', value: annualVolatility },
                        ],
                    },
                    title: requestedWindow ? `${asset.symbol} ${requestedWindow.label}价格统计` : `${asset.symbol} 价格统计`,
                    type: 'metric-grid',
                },
            ],
            skill: 'asset-analysis',
            summary,
        };
    },
});