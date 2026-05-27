import { describe, expect, test, vi } from 'vitest';

import { MarketDataOrchestrator } from './market-data-orchestrator';
import { createInMemoryDataServices } from './market-data-test-support';

describe('MarketDataOrchestrator', () => {
    test('routes allocation intent through the history backfill planner', async () => {
        const { services } = createInMemoryDataServices();
        const ensureAllocationHistory = vi.fn().mockResolvedValue({
            fxPairs: [],
            insertedRows: 0,
            skippedAssetIds: [],
            syncStatus: {
                activeTask: null,
                completedTasks: 0,
                failedTasks: 0,
                lastWarning: null,
                queuedTasks: 0,
                recentEvents: [],
                running: false,
            },
            synchronizedAssetIds: ['asset-spy'],
            warnings: [],
        });
        const orchestrator = new MarketDataOrchestrator(services, {
            cacheService: {} as never,
            csvImportService: {} as never,
            historyBackfillService: {
                ensureAllocationHistory,
            } as never,
            marketDataPort: {} as never,
            marketSourceService: {} as never,
            metadataBackfillService: {} as never,
            priceSyncService: {
                getSyncStatus: vi.fn(() => ({
                    activeTask: null,
                    completedTasks: 0,
                    failedTasks: 0,
                    lastWarning: null,
                    queuedTasks: 0,
                    recentEvents: [],
                    running: false,
                })),
                subscribeSyncStatus: vi.fn(),
            } as never,
            researchProviderService: {} as never,
        });

        const result = await orchestrator.ensure({
            assetIds: ['asset-spy'],
            intent: 'allocation',
            priority: 'interactive',
            window: {
                endDate: '2026-04-15',
                startDate: '2025-04-15',
            },
        });

        expect(ensureAllocationHistory).toHaveBeenCalledWith(['asset-spy'], {
            endDate: '2026-04-15',
            priority: 'interactive',
            startDate: '2025-04-15',
        });
        expect(result.priceSummary?.synchronizedAssetIds).toEqual(['asset-spy']);
    });

    test('routes asset-history intent through single-asset ensure path', async () => {
        const { services } = createInMemoryDataServices();
        const ensureAllocationHistory = vi.fn().mockResolvedValue({
            fxPairs: [],
            insertedRows: 0,
            skippedAssetIds: [],
            syncStatus: {
                activeTask: null,
                completedTasks: 0,
                failedTasks: 0,
                lastWarning: null,
                queuedTasks: 0,
                recentEvents: [],
                running: false,
            },
            synchronizedAssetIds: ['asset-qqq'],
            warnings: [],
        });
        const orchestrator = new MarketDataOrchestrator(services, {
            cacheService: {} as never,
            csvImportService: {} as never,
            historyBackfillService: {
                ensureAllocationHistory,
            } as never,
            marketDataPort: {} as never,
            marketSourceService: {} as never,
            metadataBackfillService: {} as never,
            priceSyncService: {
                getSyncStatus: vi.fn(),
                subscribeSyncStatus: vi.fn(),
            } as never,
            researchProviderService: {} as never,
        });

        await orchestrator.ensure({
            assetId: 'asset-qqq',
            horizon: '30y',
            intent: 'asset-history',
            priority: 'background',
        });

        expect(ensureAllocationHistory).toHaveBeenCalledWith(['asset-qqq'], {
            endDate: undefined,
            historyHorizon: '30y',
            priority: 'background',
            startDate: undefined,
        });
    });
});