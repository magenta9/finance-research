// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AllocationPlanRecord } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { resetPlanStore, usePlanStore } from './plan-store';

const createPlanRecord = (overrides: Partial<AllocationPlanRecord> = {}): AllocationPlanRecord => ({
    assets: overrides.assets ?? ['spy', 'agg', 'gld'],
    baseCurrency: overrides.baseCurrency ?? 'CNY',
    constraints: overrides.constraints ?? {
        allowLeverage: false,
        allowShort: false,
        maxClassWeight: {},
        maxSingleWeight: 0.35,
    },
    createdAt: overrides.createdAt ?? '2026-04-11T12:00:00.000Z',
    endDate: overrides.endDate ?? '2026-04-11',
    id: overrides.id ?? 'plan-1',
    mode: overrides.mode ?? 'inverse_volatility',
    name: overrides.name ?? '全天候试算 v1',
    result: overrides.result ?? {
        allocations: [],
        baseCurrency: 'CNY',
        correlationMatrix: { labels: [], matrix: [] },
        diagnostics: {
            alignedDates: 252,
            dateRange: {
                endDate: '2026-04-11',
                startDate: '2025-04-11',
            },
            excludedAssets: [],
            metricComputation: 'portfolio_path_simulation',
            optimizer: 'js',
            rebalanceEventCount: 0,
            warnings: [],
        },
        generatedAt: '2026-04-11T12:00:00.000Z',
        mode: 'inverse_volatility',
        portfolioMetrics: {
            expectedReturn: 0.08,
            maxDrawdown: 0.12,
            sharpeRatio: 0.7,
            volatility: 0.11,
        },
        rebalanceCadence: 'monthly',
        riskContributions: {},
        scenarioAnalysis: [],
        weights: {},
    },
    rebalanceCadence: overrides.rebalanceCadence ?? 'monthly',
    startDate: overrides.startDate ?? '2025-04-11',
    updatedAt: overrides.updatedAt ?? '2026-04-11T12:00:00.000Z',
});

describe('usePlanStore', () => {
    beforeEach(() => {
        resetPlanStore();

        const initialPlans = [createPlanRecord()];

        window.api = {
            log: {
                openDirectory: vi.fn().mockResolvedValue(undefined),
                write: vi.fn(),
                writeBatch: vi.fn(),
            },
            data: {
                addAsset: vi.fn(),
                clearCache: vi.fn().mockResolvedValue({
                    cacheSummary: {
                        assetCount: 0,
                        fxRateRowCount: 0,
                        latestPriceFetchAt: null,
                        priceRowCount: 0,
                    },
                    syncStatus: {
                        activeTask: null,
                        completedTasks: 0,
                        failedTasks: 0,
                        lastWarning: null,
                        queuedTasks: 0,
                        recentEvents: [],
                        running: false,
                    },
                }),
                deleteAsset: vi.fn(),
                deletePosition: vi.fn(),
                getAssets: vi.fn(),
                getCacheSummary: vi.fn(),
                getSyncStatus: vi.fn().mockResolvedValue({
                    activeTask: null,
                    completedTasks: 0,
                    failedTasks: 0,
                    lastWarning: null,
                    queuedTasks: 0,
                    recentEvents: [],
                    running: false,
                }),
                getPositions: vi.fn(),
                getPriceRange: vi.fn(),
                getPrices: vi.fn(),
                importAssetsCsv: vi.fn(),
                importPositionsCsv: vi.fn(),
                importPricesCsv: vi.fn(),
                lookupAssets: vi.fn(),
                searchAssets: vi.fn(),
                subscribeSyncStatus: vi.fn().mockReturnValue(() => undefined),
                syncFxRates: vi.fn().mockResolvedValue({ insertedRows: 0, pairs: [], warnings: [] }),
                syncPrices: vi.fn(),
                updateAsset: vi.fn(),
                updatePosition: vi.fn(),
            },
            portfolio: {
                deletePlan: vi.fn().mockResolvedValue(true),
                getPlans: vi.fn().mockResolvedValue(initialPlans),
                runAllocation: vi.fn(),
                savePlan: vi.fn().mockImplementation(async (plan) => ({
                    ...plan,
                    createdAt: '2026-04-11T13:00:00.000Z',
                    updatedAt: '2026-04-11T13:00:00.000Z',
                })),
            },
            secrets: {
                delete: vi.fn(),
                get: vi.fn(),
                set: vi.fn(),
            },
            settings: {
                delete: vi.fn(),
                get: vi.fn(),
                getAll: vi.fn(),
                set: vi.fn(),
            },
            system: {
                checkNativeBindings: vi.fn(),
                getRuntimeStatus: vi.fn(),
                ping: vi.fn(),
                runDummyPython: vi.fn(),
            },
            runtime: {
                getCapabilities: vi.fn().mockResolvedValue({
                    hasKeytarSecrets: true,
                    hasNativeFileDialog: true,
                    hasNativeNotifications: true,
                    hasSidecarAutoStart: true,
                }),
                getConfig: vi.fn().mockResolvedValue({
                    lastConnectedAt: null,
                    lastConnectionError: null,
                    lastInitializationError: null,
                    sidecarUrl: 'ws://127.0.0.1:8765',
                }),
                getMode: vi.fn().mockResolvedValue('electron'),
                updateConfig: vi.fn(),
                validateProviderConnection: vi.fn().mockResolvedValue({ availableModels: ['qwen3:latest'], ok: true }),
                validateSidecarConnection: vi.fn().mockResolvedValue({ ok: true }),
            },
        } as unknown as QuantdeskApi;
    });

    test('加载、保存、导出与删除方案会正确更新状态', async () => {
        await usePlanStore.getState().loadPlans();

        expect(usePlanStore.getState().plans).toHaveLength(1);

        const saved = await usePlanStore.getState().savePlan({
            assets: ['spy', 'agg', 'gld'],
            baseCurrency: 'CNY',
            constraints: {
                allowLeverage: false,
                allowShort: false,
                maxClassWeight: {},
                maxSingleWeight: 0.35,
            },
            endDate: '2026-04-11',
            mode: 'inverse_volatility',
            name: '全天候试算 v2',
            rebalanceCadence: 'quarterly',
            result: createPlanRecord().result,
            startDate: '2025-04-11',
        });

        expect(saved?.name).toBe('全天候试算 v2');
        expect(saved?.startDate).toBe('2025-04-11');
        expect(saved?.endDate).toBe('2026-04-11');
        expect(saved?.rebalanceCadence).toBe('quarterly');
        expect(usePlanStore.getState().plans[0]?.name).toBe('全天候试算 v2');

        const exported = usePlanStore.getState().stageExport(saved!);
        const parsed = JSON.parse(exported.payload) as {
            exportedAt: string;
            plan: AllocationPlanRecord;
        };

        expect(exported.filename).toContain(saved!.id);
        expect(parsed.plan.name).toBe('全天候试算 v2');
        expect(parsed.plan.assets).toEqual(['spy', 'agg', 'gld']);
        expect(parsed.plan.rebalanceCadence).toBe('quarterly');

        await usePlanStore.getState().deletePlan(saved!.id);

        expect(usePlanStore.getState().plans.map((plan) => plan.id)).not.toContain(saved!.id);
    });
});