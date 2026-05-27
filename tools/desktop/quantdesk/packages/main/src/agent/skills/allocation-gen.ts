import type { AllocationConstraints, AllocationType } from '@quantdesk/shared';

import type { PortfolioEngine } from '../../portfolio/engine';
import type { AgentSkill } from './types';

const modeLabelMap: Record<AllocationType, string> = {
    erc: '等风险贡献',
    inverse_volatility: '反波动率加权',
    max_diversification: '最大分散化',
};

const parseMode = (message: string): AllocationType | null => {
    if (message.includes('风险平价') || message.includes('等风险贡献')) {
        return 'erc';
    }

    if (message.includes('反波动率') || message.includes('逆波动') || message.includes('inverse volatility')) {
        return 'inverse_volatility';
    }

    if (message.includes('最大分散化') || message.includes('分散化')) {
        return 'max_diversification';
    }

    if (message.includes('保守') || message.includes('低波动') || message.includes('简单稳健')) {
        return 'inverse_volatility';
    }

    if (message.includes('最大夏普') || message.includes('目标波动率')) {
        return null; // Deprecated
    }

    return 'inverse_volatility';
};

export const createAllocationGenSkill = (portfolioEngine: PortfolioEngine): AgentSkill => ({
    description: 'Generate an allocation using the current asset pool and user intent.',
    name: 'allocation-gen',
    async execute({ assets, baseCurrency, message }) {
        const selectedAssets = assets.slice(0, Math.min(5, assets.length));

        if (selectedAssets.length < 2) {
            return {
                citations: [],
                richBlocks: [],
                skill: 'allocation-gen',
                summary: '当前资产池不足两个标的，无法生成配置。请先补充资产池或切换到资产页添加标的。',
            };
        }

        const mode = parseMode(message);

        if (mode === null) {
            return {
                citations: [],
                richBlocks: [],
                skill: 'allocation-gen',
                summary: '目标波动率和最大夏普模式已废弃。当前支持的配置模式为：等风险贡献（ERC）、反波动率加权（IVW）、最大分散化（MDP）。请选择其中一种重新发起。',
            };
        }

        const constraints: AllocationConstraints = {
            allowLeverage: false,
            allowShort: false,
            maxClassWeight: {},
            maxSingleWeight: 0.35,
        };
        const result = await portfolioEngine.runAllocation({
            assetIds: selectedAssets.map((asset) => asset.id),
            baseCurrency,
            constraints,
            mode,
        });

        return {
            citations: ['[allocation:generated]', '[price-cache:local]'],
            richBlocks: [
                {
                    data: {
                        allocations: result.allocations,
                        metrics: result.portfolioMetrics,
                    },
                    title: '配置结果',
                    type: 'chart',
                },
            ],
            skill: 'allocation-gen',
            summary: `已根据当前资产池生成${modeLabelMap[result.mode]}方案。预期收益 ${(result.portfolioMetrics.expectedReturn * 100).toFixed(1)}%，波动 ${(result.portfolioMetrics.volatility * 100).toFixed(1)}%，最大回撤估计 ${(result.portfolioMetrics.maxDrawdown * 100).toFixed(1)}%。`,
        };
    },
});