import { describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';
import { shiftIsoDateByDays } from '@quantdesk/shared/date-utils';

import {
    buildHistoricalBackfillPlan,
    HistoryBackfillService,
} from './history-backfill-service';

describe('HistoryBackfillService', () => {
    test('builds a backfill plan from issueDate and existing bounds', () => {
        const asset: StoredAsset = {
            assetClass: 'equity',
            createdAt: '2026-04-15T00:00:00.000Z',
            currency: 'CNY',
            id: 'asset-510300',
            market: 'A',
            metadata: { issueDate: '2023-01-01' },
            name: '沪深300ETF',
            symbol: '510300',
            tags: [],
            updatedAt: '2026-04-15T00:00:00.000Z',
        };

        const plan = buildHistoricalBackfillPlan({
            asset,
            endDate: '2026-04-15',
            prices: {
                getDateBounds: () => ({ earliestDate: '2024-01-10', latestDate: '2026-04-15' }),
                getRange: () => [{ date: '2026-04-15' }] as never,
                isFresh: () => true,
            },
        });

        expect(plan.startDate).toBe('2023-01-01');
        expect(plan.needsFrontfill).toBe(true);
        expect(plan.shouldSync).toBe(true);
    });

    test('background backfill expands stale observed floors to the 30-year window when requested', () => {
        const endDate = '2026-04-15';
        const asset: StoredAsset = {
            assetClass: 'equity',
            createdAt: '2026-04-15T00:00:00.000Z',
            currency: 'CNY',
            id: 'asset-510300',
            market: 'A',
            // 旧 floor 仍停留在 5Y 观测边界，background 路径不应被它卡住
            metadata: {
                issueDate: '1990-01-01',
                priceHistoryFloorDate: '2024-01-10',
                priceHistoryFloorSource: 'observed-history',
            },
            name: '沪深300ETF',
            symbol: '510300',
            tags: [],
            updatedAt: '2026-04-15T00:00:00.000Z',
        };

        const plan = buildHistoricalBackfillPlan({
            asset,
            endDate,
            historyHorizon: '30y',
            prices: {
                getDateBounds: () => ({ earliestDate: '2024-01-10', latestDate: endDate }),
                getRange: () => [{ date: endDate }] as never,
                isFresh: () => true,
            },
        });

        expect(plan.startDate).toBe(shiftIsoDateByDays(endDate, -10950));
        expect(plan.needsFrontfill).toBe(true);
        expect(plan.shouldSync).toBe(true);
    });

    test('tracks unknown allocation asset ids as warnings and skipped ids', async () => {
        const asset: StoredAsset = {
            assetClass: 'equity',
            createdAt: '2026-04-15T00:00:00.000Z',
            currency: 'USD',
            id: 'known-asset',
            market: 'US',
            metadata: { issueDate: '2019-01-01' },
            name: 'Known Asset',
            symbol: 'KNOWN',
            tags: [],
            updatedAt: '2026-04-15T00:00:00.000Z',
        };
        const service = new HistoryBackfillService({
            assets: {
                list: () => [asset],
                update: vi.fn((next) => next),
            },
            prices: {
                getDateBounds: () => ({ earliestDate: null, latestDate: null }),
                getRange: () => [],
                isFresh: () => false,
            },
        }, {
            metadataBackfill: {
                ensureHistoricalMetadata: async (candidate) => candidate,
            },
            priceSync: {
                syncFxRates: async () => ({ insertedRows: 0, pairs: [], warnings: [] }),
                syncPrices: async () => ({
                    fxPairs: [],
                    insertedRows: 1,
                    skippedAssetIds: [],
                    syncStatus: {
                        activeTask: null,
                        completedTasks: 1,
                        failedTasks: 0,
                        lastWarning: null,
                        queuedTasks: 0,
                        recentEvents: [],
                        running: false,
                    },
                    synchronizedAssetIds: ['known-asset'],
                    warnings: [],
                }),
            },
        });

        const summary = await service.ensureAllocationHistory(['known-asset', 'unknown-asset']);

        expect(summary.synchronizedAssetIds).toEqual(['known-asset']);
        expect(summary.skippedAssetIds).toContain('unknown-asset');
        expect(summary.warnings).toContainEqual(expect.objectContaining({
            code: 'unknown_asset_id',
            message: 'Unknown assetIds requested for allocation history sync: unknown-asset',
        }));
    });

    test('interactive allocation ignores stale priceHistoryFloorDate and honors requested startDate', () => {
        const asset: StoredAsset = {
            assetClass: 'equity',
            createdAt: '2026-04-15T00:00:00.000Z',
            currency: 'CNY',
            id: 'asset-510300',
            market: 'A',
            // 旧 floor 在 2024-01-10，3Y/5Y 交互式请求不应被这个观测值卡住
            metadata: {
                issueDate: '1990-01-01',
                priceHistoryFloorDate: '2024-01-10',
                priceHistoryFloorSource: 'observed-history',
            },
            name: '沪深300ETF',
            symbol: '510300',
            tags: [],
            updatedAt: '2026-04-15T00:00:00.000Z',
        };

        const interactivePlan = buildHistoricalBackfillPlan({
            asset,
            endDate: '2026-04-15',
            mode: 'interactive',
            prices: {
                getDateBounds: () => ({ earliestDate: '2024-01-10', latestDate: '2026-04-15' }),
                getRange: () => [{ date: '2026-04-15' }] as never,
                isFresh: () => true,
            },
            requestedStartDate: '2021-04-16',
        });

        expect(interactivePlan.startDate).toBe('2021-04-16');
        expect(interactivePlan.needsFrontfill).toBe(true);
        expect(interactivePlan.shouldSync).toBe(true);

        const backgroundPlan = buildHistoricalBackfillPlan({
            asset,
            endDate: '2026-04-15',
            mode: 'background',
            prices: {
                getDateBounds: () => ({ earliestDate: '2024-01-10', latestDate: '2026-04-15' }),
                getRange: () => [{ date: '2026-04-15' }] as never,
                isFresh: () => true,
            },
        });
        // background 默认仍以 10Y 作为最低回补窗口，旧 floor 不能继续压缩历史范围
        expect(backgroundPlan.startDate).toBe(shiftIsoDateByDays('2026-04-15', -3650));
        expect(backgroundPlan.needsFrontfill).toBe(true);
        expect(backgroundPlan.shouldSync).toBe(true);

        const extendedBackgroundPlan = buildHistoricalBackfillPlan({
            asset,
            endDate: '2026-04-15',
            historyHorizon: '30y',
            mode: 'background',
            prices: {
                getDateBounds: () => ({ earliestDate: '2024-01-10', latestDate: '2026-04-15' }),
                getRange: () => [{ date: '2026-04-15' }] as never,
                isFresh: () => true,
            },
        });

        expect(extendedBackgroundPlan.startDate).toBe(shiftIsoDateByDays('2026-04-15', -10950));
        expect(extendedBackgroundPlan.needsFrontfill).toBe(true);
        expect(extendedBackgroundPlan.shouldSync).toBe(true);
    });
});
