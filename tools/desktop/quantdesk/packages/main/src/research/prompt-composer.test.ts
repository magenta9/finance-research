import { describe, expect, test } from 'vitest';

import type { ResearchContextSnapshot } from './context-snapshot';
import { composeResearchPrompt } from './prompt-composer';

const context: ResearchContextSnapshot = {
    assets: [
        {
            assetClass: 'equity',
            createdAt: '2026-04-28T00:00:00.000Z',
            currency: 'USD',
            id: 'asset-spy',
            market: 'US',
            metadata: {},
            name: 'SPY ETF',
            symbol: 'SPY',
            tags: [],
            updatedAt: '2026-04-28T00:00:00.000Z',
        },
    ],
    dataSources: [{
        id: 'local.daily_prices',
        kind: 'local',
        label: 'Daily price history',
        providerIds: ['daily_prices'],
        qualityStatus: 'warn',
        roleAffinity: ['trend'],
        status: 'degraded',
        toolNames: ['get_asset_snapshot'],
        warnings: ['Latest local price fetch is stale.'],
    }],
    generatedAt: '2026-04-28T00:00:00.000Z',
    latestAllocationPlan: null,
    missingAssetIds: [],
    portfolioName: 'default',
    positions: [],
    priceCoverage: [],
    priceSignals: [],
    provenance: [],
    riskProfile: null,
};

describe('composeResearchPrompt', () => {
    test('preserves hard policy tags and role tool allowlist', () => {
        const composed = composeResearchPrompt({
            context,
            normalizedRequest: {
                actionIntensity: 'low',
                actionIntent: 'observe',
                assetClassHint: null,
                assetScope: 'unknown',
                assetType: 'unknown',
                dataNeeds: ['local_asset_pool'],
                riskLevel: 'unknown',
                taskType: 'general',
                timeHorizon: 'weeks_to_months',
            },
            query: '研究 SPY',
            riskProfile: null,
            role: 'trend',
        });

        expect(composed.policyTags).toEqual(expect.arrayContaining([
            'no-fabrication',
            'risk-profile-required',
            'data-quality-hard-gate',
        ]));
        expect(composed.allowedToolNames).toEqual(expect.arrayContaining(['get_asset_snapshot', 'analyze_asset']));
        expect(composed.prompt).toContain('Do not provide precise position sizing');
        expect(composed.prompt).toContain('Data source registry');
        expect(composed.prompt).toContain('local.daily_prices: degraded/warn');
    });

    test('does not include precise risk budget values in prompt transcripts', () => {
        const composed = composeResearchPrompt({
            context,
            normalizedRequest: {
                actionIntensity: 'medium',
                actionIntent: 'prepare',
                assetClassHint: null,
                assetScope: 'portfolio',
                assetType: 'mixed',
                dataNeeds: ['risk_profile'],
                riskLevel: 'medium',
                taskType: 'portfolio_review',
                timeHorizon: 'weeks_to_months',
            },
            query: '检查组合风险',
            riskProfile: {
                baseCurrency: 'CNY',
                maxDrawdown: 0.137,
                maxSingleWeight: 0.083,
                riskTolerance: 'medium',
                singlePositionLossBudget: 0.019,
                updatedAt: '2026-04-28T00:00:00.000Z',
            },
            role: 'risk',
        });

        expect(composed.prompt).toContain('Risk profile: configured for CNY base currency with medium tolerance.');
        expect(composed.prompt).not.toContain('0.137');
        expect(composed.prompt).not.toContain('0.083');
        expect(composed.prompt).not.toContain('0.019');
    });

    test('aligns allocation, macro, and risk tool allowlists with evidence needs', () => {
        const normalizedRequest = {
            actionIntensity: 'medium' as const,
            actionIntent: 'rebalance' as const,
            assetClassHint: null,
            assetScope: 'portfolio' as const,
            assetType: 'mixed' as const,
            dataNeeds: ['local_daily_prices', 'portfolio_positions', 'risk_profile'],
            riskLevel: 'medium' as const,
            taskType: 'allocation' as const,
            timeHorizon: 'weeks_to_months',
        };
        const allocationPrompt = composeResearchPrompt({
            context,
            normalizedRequest,
            query: '给两个 ETF 做配置',
            riskProfile: null,
            role: 'allocation',
        });
        const macroPrompt = composeResearchPrompt({
            context,
            normalizedRequest,
            query: '给两个 ETF 做配置',
            riskProfile: null,
            role: 'macro',
        });
        const riskPrompt = composeResearchPrompt({
            context,
            normalizedRequest,
            query: '给两个 ETF 做配置',
            riskProfile: null,
            role: 'risk',
        });

        expect(allocationPrompt.allowedToolNames).toEqual(expect.arrayContaining([
            'get_asset_pool_summary',
            'get_asset_snapshot',
            'get_portfolio_summary',
            'run_allocation',
            'explain_risk',
        ]));
        expect(macroPrompt.allowedToolNames).toEqual(expect.arrayContaining([
            'get_asset_pool_summary',
            'get_asset_snapshot',
            'macro_scan',
        ]));
        expect(riskPrompt.allowedToolNames).toEqual(expect.arrayContaining([
            'get_asset_snapshot',
            'get_portfolio_summary',
            'explain_risk',
        ]));
    });
});