import { describe, expect, test, vi } from 'vitest';

import type { AllocationResult, PositionRecord, StoredAsset } from '@quantdesk/shared';

import type { PortfolioEngine } from '../../portfolio/engine';
import { createAllocationGenSkill } from './allocation-gen';
import { createAssetAnalysisSkill } from './asset-analysis';
import { createMacroScanSkill } from './macro-scan';
import { createRebalanceAdvisorSkill } from './rebalance-advisor';
import { createRiskDecomposeSkill } from './risk-decompose';

const assets: StoredAsset[] = [
    {
        assetClass: 'equity',
        createdAt: '2026-04-11T00:00:00.000Z',
        currency: 'USD',
        id: 'spy',
        market: 'US',
        metadata: {},
        name: 'SPDR S&P 500 ETF Trust',
        symbol: 'SPY',
        tags: ['core'],
        updatedAt: '2026-04-11T00:00:00.000Z',
    },
    {
        assetClass: 'fixed_income',
        createdAt: '2026-04-11T00:00:00.000Z',
        currency: 'USD',
        id: 'agg',
        market: 'US',
        metadata: {},
        name: 'iShares Core U.S. Aggregate Bond ETF',
        symbol: 'AGG',
        tags: ['defensive'],
        updatedAt: '2026-04-11T00:00:00.000Z',
    },
    {
        assetClass: 'commodity',
        createdAt: '2026-04-11T00:00:00.000Z',
        currency: 'USD',
        id: 'gld',
        market: 'US',
        metadata: {},
        name: 'SPDR Gold Shares',
        symbol: 'GLD',
        tags: ['hedge'],
        updatedAt: '2026-04-11T00:00:00.000Z',
    },
];

const latestAllocation: AllocationResult = {
    allocations: [
        {
            annualizedReturn: 0.11,
            annualizedVolatility: 0.19,
            assetClass: 'equity',
            assetId: 'spy',
            currency: 'USD',
            market: 'US',
            name: 'SPDR S&P 500 ETF Trust',
            riskContribution: 0.52,
            symbol: 'SPY',
            weight: 0.5,
        },
        {
            annualizedReturn: 0.04,
            annualizedVolatility: 0.08,
            assetClass: 'fixed_income',
            assetId: 'agg',
            currency: 'USD',
            market: 'US',
            name: 'iShares Core U.S. Aggregate Bond ETF',
            riskContribution: 0.28,
            symbol: 'AGG',
            weight: 0.3,
        },
        {
            annualizedReturn: 0.07,
            annualizedVolatility: 0.17,
            assetClass: 'commodity',
            assetId: 'gld',
            currency: 'USD',
            market: 'US',
            name: 'SPDR Gold Shares',
            riskContribution: 0.2,
            symbol: 'GLD',
            weight: 0.2,
        },
    ],
    baseCurrency: 'CNY',
    correlationMatrix: {
        labels: ['SPY', 'AGG', 'GLD'],
        matrix: [
            [1, 0.2, 0.3],
            [0.2, 1, 0.1],
            [0.3, 0.1, 1],
        ],
    },
    diagnostics: {
        alignedDates: 252,
        metricComputation: 'portfolio_path_simulation',
        rebalanceEventCount: 0,
        excludedAssets: [],
        optimizer: 'js',
        warnings: [],
    },
    generatedAt: '2026-04-11T12:00:00.000Z',
    mode: 'inverse_volatility',
    portfolioMetrics: {
        expectedReturn: 0.082,
        maxDrawdown: 0.14,
        sharpeRatio: 0.72,
        volatility: 0.114,
    },
    rebalanceCadence: 'none',
    riskContributions: {
        agg: 0.28,
        gld: 0.2,
        spy: 0.52,
    },
    scenarioAnalysis: [],
    weights: {
        agg: 0.3,
        gld: 0.2,
        spy: 0.5,
    },
};

describe('agent skills', () => {
    test('asset-analysis picks the requested symbol and emits a metric-grid block', async () => {
        const skill = createAssetAnalysisSkill((assetId) =>
            assetId === 'spy' ? [100, 102, 104, 107, 111] : [50, 49, 50, 51, 52],
        );

        const result = await skill.execute({
            assets,
            baseCurrency: 'CNY',
            latestAllocation,
            latestPlanId: 'plan-1',
            message: '分析 SPY',
        });

        expect(result.skill).toBe('asset-analysis');
        expect(result.citations).toEqual(['[price-cache:SPY:local]']);
        expect(result.richBlocks[0]).toMatchObject({
            title: 'SPY 价格统计',
            type: 'metric-grid',
        });
        expect(result.summary).toContain('SPY');
    });

    test('asset-analysis honors recent three month requests when enough price history exists', async () => {
        const priceSeries = Array.from({ length: 80 }, (_, index) => 100 + index);
        const skill = createAssetAnalysisSkill(() => priceSeries);

        const result = await skill.execute({
            assets,
            baseCurrency: 'CNY',
            latestAllocation,
            latestPlanId: 'plan-1',
            message: '看看标的 SPY 最近3个月表现如何',
        });

        expect(result.richBlocks[0]).toMatchObject({
            title: 'SPY 最近3个月价格统计',
            type: 'metric-grid',
        });
        expect(result.summary).toContain('最近3个月区间收益约');
        expect(result.summary).toContain('不包含基本面');
    });

    test('macro-scan includes allocation-aware market exposure rows when latest allocation exists', async () => {
        const skill = createMacroScanSkill();
        const result = await skill.execute({
            assets,
            baseCurrency: 'CNY',
            latestAllocation,
            latestPlanId: 'plan-1',
            message: '/macro',
        });

        expect(result.citations).toEqual(['[asset-pool]', '[allocation:latest]']);
        expect(result.richBlocks[1]).toMatchObject({
            title: '市场暴露拆分',
            type: 'table',
        });
        expect(result.summary).toContain('主要暴露来源');
    });

    test('risk-decompose returns a chart block and highlights the largest concentration', async () => {
        const skill = createRiskDecomposeSkill();
        const result = await skill.execute({
            assets,
            baseCurrency: 'CNY',
            latestAllocation,
            latestPlanId: 'plan-1',
            message: '/risk',
        });

        expect(result.richBlocks).toEqual([
            expect.objectContaining({
                title: '风险贡献',
                type: 'chart',
            }),
        ]);
        expect(result.summary).toContain('SPY');
        expect(result.summary).toContain('50.0%');
    });

    test('rebalance-advisor ranks the largest holding drift first', async () => {
        const positions: PositionRecord[] = [
            {
                assetId: 'spy',
                costBasis: 600,
                currency: 'USD',
                id: 'position-spy',
                portfolioName: 'default',
                shares: 10,
                updatedAt: '2026-04-11T12:00:00.000Z',
            },
            {
                assetId: 'agg',
                costBasis: 100,
                currency: 'USD',
                id: 'position-agg',
                portfolioName: 'default',
                shares: 5,
                updatedAt: '2026-04-11T12:00:00.000Z',
            },
        ];
        const skill = createRebalanceAdvisorSkill(() => positions);
        const result = await skill.execute({
            assets,
            baseCurrency: 'CNY',
            latestAllocation,
            latestPlanId: 'plan-1',
            message: '/rebalance',
        });

        expect(result.richBlocks[0]).toMatchObject({
            title: '调仓偏离',
            type: 'table',
        });
        expect(result.summary).toContain('SPY');
    });

    test('allocation-gen forwards the intended mode into the portfolio engine', async () => {
        const runAllocation = vi.fn(async ({ mode }: { mode: AllocationResult['mode'] }) => ({
            ...latestAllocation,
            mode,
        }));
        const skill = createAllocationGenSkill({
            runAllocation,
        } as unknown as PortfolioEngine);

        const result = await skill.execute({
            assets,
            baseCurrency: 'CNY',
            latestAllocation: null,
            latestPlanId: undefined,
            message: '生成最大分散化配置',
        });

        expect(runAllocation).toHaveBeenCalledWith(
            expect.objectContaining({
                assetIds: ['spy', 'agg', 'gld'],
                baseCurrency: 'CNY',
                mode: 'max_diversification',
            }),
        );
        expect(result.summary).toContain('最大分散化');
    });
});