import type { AgentSkill } from './types';

export const createRiskDecomposeSkill = (): AgentSkill => ({
    description: 'Explain allocation risk contributions and concentration.',
    name: 'risk-decompose',
    async execute({ latestAllocation }) {
        if (!latestAllocation) {
            return {
                citations: [],
                richBlocks: [],
                skill: 'risk-decompose',
                summary: '当前没有可用的配置结果，先运行一次配置生成。',
            };
        }

        const largestAllocation = latestAllocation.allocations[0];
        const concentration = largestAllocation ? largestAllocation.weight : 0;

        return {
            citations: ['[allocation:latest]'],
            richBlocks: [
                {
                    data: {
                        allocations: latestAllocation.allocations,
                    },
                    title: '风险贡献',
                    type: 'chart',
                },
            ],
            skill: 'risk-decompose',
            summary: `当前组合的最大单一权重约 ${(concentration * 100).toFixed(1)}%，主要风险贡献来自 ${largestAllocation?.symbol ?? '未知标的'}。相关性矩阵和风险贡献已经附在结果中，判断结论仅基于历史价格统计，不代表未来分布稳定。`,
        };
    },
});