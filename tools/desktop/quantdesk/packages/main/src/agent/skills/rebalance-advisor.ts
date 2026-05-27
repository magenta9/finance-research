import type { PositionRecord } from '@quantdesk/shared';

import type { AgentSkill } from './types';

export const createRebalanceAdvisorSkill = (
    getPositions: () => PositionRecord[],
): AgentSkill => ({
    description: 'Compare current holdings with latest target allocation.',
    name: 'rebalance-advisor',
    async execute({ assets, latestAllocation }) {
        if (!latestAllocation) {
            return {
                citations: [],
                richBlocks: [],
                skill: 'rebalance-advisor',
                summary: '当前没有保存的目标配置，无法生成调仓建议。',
            };
        }

        const positions = getPositions();
        const totalMarketValue = positions.reduce((sum, position) => sum + Math.max(position.shares * (position.costBasis ?? 0), 0), 0);
        const rows = positions.map((position) => {
            const asset = assets.find((entry) => entry.id === position.assetId);
            const targetWeight = latestAllocation.weights[position.assetId] ?? 0;
            const currentWeight = totalMarketValue === 0 ? 0 : ((position.costBasis ?? 0) * position.shares) / totalMarketValue;

            return {
                currentWeight,
                drift: currentWeight - targetWeight,
                symbol: asset?.symbol ?? position.assetId,
                targetWeight,
            };
        });

        const worstDrift = rows.sort((left, right) => Math.abs(right.drift) - Math.abs(left.drift))[0];

        return {
            citations: ['[positions:default]', '[allocation:latest]'],
            richBlocks: [
                {
                    data: { rows },
                    title: '调仓偏离',
                    type: 'table',
                },
            ],
            skill: 'rebalance-advisor',
            summary: worstDrift
                ? `${worstDrift.symbol} 的当前仓位与目标仓位偏离 ${(Math.abs(worstDrift.drift) * 100).toFixed(1)}%。优先处理偏离最大的仓位，逐步向目标配置靠拢。`
                : '当前没有持仓数据，先录入持仓再生成调仓建议。',
        };
    },
});