import type { AgentSkill } from './types';

const toPercentage = (value: number, total: number) => (total <= 0 ? 0 : value / total);

export const createMacroScanSkill = (): AgentSkill => ({
    description: 'Summarize market and asset-class exposure from the local asset universe.',
    name: 'macro-scan',
    async execute({ assets, latestAllocation }) {
        if (assets.length === 0) {
            return {
                citations: [],
                richBlocks: [],
                skill: 'macro-scan',
                summary: '当前资产池为空，无法生成宏观扫描。先在资产池补充标的，再运行宏观扫描。',
            };
        }

        const marketBuckets = assets.reduce<Record<string, number>>((accumulator, asset) => {
            accumulator[asset.market] = (accumulator[asset.market] ?? 0) + 1;
            return accumulator;
        }, {});
        const assetClassBuckets = assets.reduce<Record<string, number>>((accumulator, asset) => {
            accumulator[asset.assetClass] = (accumulator[asset.assetClass] ?? 0) + 1;
            return accumulator;
        }, {});
        const dominantMarket = Object.entries(marketBuckets).sort((left, right) => right[1] - left[1])[0];
        const dominantAssetClass = Object.entries(assetClassBuckets).sort((left, right) => right[1] - left[1])[0];
        const weightsByMarket = latestAllocation
            ? latestAllocation.allocations.reduce<Record<string, number>>((accumulator, allocation) => {
                accumulator[allocation.market] = (accumulator[allocation.market] ?? 0) + allocation.weight;
                return accumulator;
            }, {})
            : null;

        return {
            citations: latestAllocation ? ['[asset-pool]', '[allocation:latest]'] : ['[asset-pool]'],
            richBlocks: [
                {
                    data: {
                        rows: [
                            { label: '资产总数', value: assets.length },
                            { label: '市场数', value: Object.keys(marketBuckets).length },
                            { label: '主导市场占比', value: toPercentage(dominantMarket?.[1] ?? 0, assets.length) },
                            { label: '主导资产类别占比', value: toPercentage(dominantAssetClass?.[1] ?? 0, assets.length) },
                        ],
                    },
                    title: '宏观暴露概览',
                    type: 'metric-grid',
                },
                {
                    data: {
                        rows: Object.entries(marketBuckets).map(([market, count]) => ({
                            allocationWeight: weightsByMarket?.[market] ?? 0,
                            assetCount: count,
                            market,
                        })),
                    },
                    title: '市场暴露拆分',
                    type: 'table',
                },
            ],
            skill: 'macro-scan',
            summary: latestAllocation
                ? `当前资产池一共覆盖 ${Object.keys(marketBuckets).length} 个市场，${dominantMarket?.[0] ?? '未知市场'} 占比最高。最近一次配置结果显示 ${Object.entries(weightsByMarket ?? {}).sort((left, right) => right[1] - left[1])[0]?.[0] ?? dominantMarket?.[0] ?? '未知市场'} 是当前组合的主要暴露来源，结论仅基于本地资产池和最近一次配置结果。`
                : `当前资产池一共覆盖 ${Object.keys(marketBuckets).length} 个市场，${dominantMarket?.[0] ?? '未知市场'} 占比最高，${dominantAssetClass?.[0] ?? '未知类别'} 是最主要的资产类别。由于还没有最近一次配置结果，本次扫描只基于资产池静态暴露。`,
        };
    },
});
