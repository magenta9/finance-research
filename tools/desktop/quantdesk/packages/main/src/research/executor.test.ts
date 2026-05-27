import { describe, expect, test } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import { createDeterministicResearchExecutor } from './executor';
import type { ResearchContextSnapshot } from './context-snapshot';

const asset: StoredAsset = {
    assetClass: 'equity',
    createdAt: '2026-04-28T00:00:00.000Z',
    currency: 'CNY',
    id: 'asset-hstech',
    market: 'A',
    metadata: { underlyingMarket: 'HK' },
    name: '恒生科技ETF',
    symbol: '513180',
    tags: [],
    updatedAt: '2026-04-28T00:00:00.000Z',
};

const createContext = (priceStatus: 'pass' | 'warn'): ResearchContextSnapshot => ({
    assets: [asset],
    dataSources: [{
        id: 'local.daily_prices',
        kind: 'local',
        label: 'Daily price history',
        providerIds: ['daily_prices'],
        qualityStatus: priceStatus,
        roleAffinity: ['trend'],
        status: priceStatus === 'pass' ? 'available' : 'degraded',
        toolNames: ['get_asset_snapshot'],
        warnings: priceStatus === 'warn' ? ['Latest local price fetch is stale or missing fetched_at.'] : [],
    }],
    generatedAt: '2026-04-28T00:00:00.000Z',
    latestAllocationPlan: null,
    missingAssetIds: [],
    portfolioName: 'default',
    positions: [],
    priceCoverage: [{
        assetId: asset.id,
        cacheStatus: priceStatus === 'warn' ? 'stale' : 'hit',
        earliestDate: '2026-04-01',
        fallbackProviderIds: [],
        fetchedAt: '2026-04-28T00:00:00.000Z',
        latestDate: '2026-04-28',
        providerIds: ['akshare'],
        rowCount: 1,
        source: 'akshare',
        sourcePriority: ['akshare', 'yfinance'],
        status: priceStatus,
        symbol: asset.symbol,
        warnings: priceStatus === 'warn' ? ['Latest local price fetch is stale or missing fetched_at.'] : [],
    }],
    priceSignals: [{
        assetId: asset.id,
        latestClose: 0.6275,
        latestDate: '2026-04-27',
        returnOneMonth: 0.05,
        returnOneYear: -0.12,
        returnThreeMonths: -0.08,
        source: 'akshare-nav',
        symbol: asset.symbol,
    }],
    provenance: [{
        analysisWindow: { endDate: '2026-04-28', startDate: '2026-04-01' },
        cacheStatus: priceStatus === 'warn' ? 'stale' : 'hit',
        fallbackProviderIds: [],
        fetchedAt: '2026-04-28T00:00:00.000Z',
        providerIds: ['akshare'],
        qualityStatus: priceStatus,
        rowsUsed: 1,
        sourceId: `daily_prices:${asset.id}`,
        sourcePriority: ['akshare', 'yfinance'],
        warnings: priceStatus === 'warn' ? ['Latest local price fetch is stale or missing fetched_at.'] : [],
    }],
    riskProfile: null,
});

describe('createDeterministicResearchExecutor', () => {
    test('does not claim stale local prices when price coverage passes', async () => {
        const executor = createDeterministicResearchExecutor();
        const output = await executor.runResearcher({
            context: createContext('pass'),
            prompt: { allowedToolNames: [], manifest: [], policyTags: [], prompt: '' },
            query: '恒生科技',
            requestId: 'request-1',
            role: 'trend',
        });

        expect(output.invalidationConditions).not.toContain('Local price cache remains missing or stale.');
        expect(output.invalidationConditions).not.toContain('Risk budget is lower than the proposed exposure.');
        expect(output.invalidationConditions).toContain('Risk profile remains missing, so precise sizing stays unavailable.');
        expect(output.conclusion).toContain('Cached price signal: 513180 latest 0.6275 on 2026-04-27');
        expect(output.evidence[0]?.summary).toContain('Price signals: 513180 latest 0.6275 on 2026-04-27');
    });

    test('includes price cache invalidation only for stale or missing coverage', async () => {
        const executor = createDeterministicResearchExecutor();
        const output = await executor.runResearcher({
            context: createContext('warn'),
            prompt: { allowedToolNames: [], manifest: [], policyTags: [], prompt: '' },
            query: '恒生科技',
            requestId: 'request-1',
            role: 'trend',
        });

        expect(output.invalidationConditions).toContain('513180: local price cache remains missing or stale.');
    });
});