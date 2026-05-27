import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import type { DataSourceId } from '@quantdesk/shared';

import { runMigrations } from '../db/database';
import { createRepositories } from '../db/repositories';
import { createResearchContextSnapshot } from './context-snapshot';

const hkFirstPriceProviderIds = (): DataSourceId[] => ['yfinance', 'akshare'];

describe('createResearchContextSnapshot', () => {
    test('limits free-form single target queries to matching local assets', () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            const now = new Date('2026-04-28T00:00:00.000Z');

            repositories.assetRepository.createMany([
                {
                    assetClass: 'equity',
                    currency: 'HKD',
                    id: 'asset-hstech',
                    market: 'HK',
                    metadata: {},
                    name: '恒生科技 ETF',
                    symbol: 'HSTECH',
                    tags: ['恒生科技'],
                },
                {
                    assetClass: 'equity',
                    currency: 'USD',
                    id: 'asset-no-price',
                    market: 'US',
                    metadata: {},
                    name: 'No Price Asset',
                    symbol: 'NOPRICE',
                    tags: [],
                },
            ]);
            repositories.priceRepository.insertMany([
                {
                    adjustedClose: 4.2,
                    assetId: 'asset-hstech',
                    close: 4.2,
                    date: '2026-04-28',
                    fetchedAt: now.toISOString(),
                    high: 4.3,
                    low: 4.1,
                    open: 4.15,
                    source: 'akshare',
                    volume: 1000,
                },
            ]);

            const context = createResearchContextSnapshot({ now: () => now, priceProviderIds: hkFirstPriceProviderIds, repositories })
                .build({ query: '研究一下恒生科技' }, null);

            expect(context.assets.map((asset) => asset.id)).toEqual(['asset-hstech']);
            expect(context.priceCoverage).toEqual([
                expect.objectContaining({
                    assetId: 'asset-hstech',
                    cacheStatus: 'hit',
                    earliestDate: '2026-04-28',
                    fallbackProviderIds: ['yfinance'],
                    providerIds: ['akshare'],
                    rowCount: 1,
                    source: 'akshare',
                    sourcePriority: ['yfinance', 'akshare'],
                    status: 'pass',
                    warnings: ['Price provider fallback observed before akshare: yfinance.'],
                }),
            ]);
            expect(context.priceSignals).toEqual([
                expect.objectContaining({
                    assetId: 'asset-hstech',
                    latestClose: 4.2,
                    latestDate: '2026-04-28',
                    source: 'akshare',
                }),
            ]);
            expect(context.provenance).toEqual([
                expect.objectContaining({
                    analysisWindow: { endDate: '2026-04-28', startDate: '2026-04-28' },
                    cacheStatus: 'hit',
                    fallbackProviderIds: ['yfinance'],
                    providerIds: ['akshare'],
                    rowsUsed: 1,
                    sourcePriority: ['yfinance', 'akshare'],
                }),
            ]);
            expect(context.dataSources).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'local.daily_prices', qualityStatus: 'pass', status: 'available' }),
                expect.objectContaining({ id: 'provider.fundamentals', qualityStatus: 'warn', status: 'degraded', toolNames: ['get_fundamental_snapshot'] }),
            ]));
        } finally {
            database.close();
        }
    });

    test('does not fall back to all assets when a target is unresolved', () => {
        const database = new Database(':memory:');
        runMigrations(database);

        try {
            const repositories = createRepositories(database);
            repositories.assetRepository.create({
                assetClass: 'equity',
                currency: 'USD',
                id: 'asset-spy',
                market: 'US',
                metadata: {},
                name: 'SPY ETF',
                symbol: 'SPY',
                tags: [],
            });

            const context = createResearchContextSnapshot({ repositories }).build({
                assetIds: [],
                query: '恒生科技',
                unresolvedTarget: '恒生科技',
            }, null);

            expect(context.assets).toEqual([]);
            expect(context.missingAssetIds).toEqual(['恒生科技']);
            expect(context.dataSources).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'local.asset_universe', qualityStatus: 'warn', status: 'degraded' }),
                expect.objectContaining({ id: 'local.daily_prices', qualityStatus: 'block', status: 'unavailable' }),
            ]));
        } finally {
            database.close();
        }
    });
});