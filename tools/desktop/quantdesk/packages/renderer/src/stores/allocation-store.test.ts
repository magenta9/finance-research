// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AllocationPlanRecord, AllocationResult } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import {
    getDateRangeBounds,
    getDefaultDateRange,
    resetAllocationStore,
    useAllocationStore,
} from './allocation-store';

const mockResult: AllocationResult = {
    allocations: [],
    baseCurrency: 'CNY',
    correlationMatrix: { labels: [], matrix: [] },
    diagnostics: {
        alignedDates: 252,
        dateRange: {
            endDate: '2026-04-15',
            startDate: '2025-04-15',
        },
        excludedAssets: [],
        metricComputation: 'portfolio_path_simulation',
        optimizer: 'js',
        rebalanceEventCount: 0,
        warnings: [],
    },
    generatedAt: '2026-04-15T12:00:00.000Z',
    mode: 'inverse_volatility',
    portfolioMetrics: {
        expectedReturn: 0.08,
        maxDrawdown: 0.12,
        sharpeRatio: 0.7,
        volatility: 0.11,
    },
    rebalanceCadence: 'none',
    riskContributions: {},
    scenarioAnalysis: [],
    weights: {},
};

const createPlan = (overrides: Partial<AllocationPlanRecord> = {}): AllocationPlanRecord => ({
    assets: overrides.assets ?? ['spy', 'agg'],
    baseCurrency: overrides.baseCurrency ?? 'CNY',
    constraints: overrides.constraints ?? {
        allowLeverage: false,
        allowShort: false,
        maxClassWeight: {},
        maxSingleWeight: 0.35,
    },
    createdAt: overrides.createdAt ?? '2026-04-15T12:00:00.000Z',
    endDate: overrides.endDate,
    id: overrides.id ?? 'plan-1',
    mode: overrides.mode ?? 'inverse_volatility',
    name: overrides.name ?? '时间窗口方案',
    rebalanceCadence: overrides.rebalanceCadence ?? 'monthly',
    result: overrides.result ?? mockResult,
    startDate: overrides.startDate,
    updatedAt: overrides.updatedAt ?? '2026-04-15T12:00:00.000Z',
});

describe('useAllocationStore', () => {
    let mockApi: QuantdeskApi;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
        resetAllocationStore();

        mockApi = {
            portfolio: {
                runAllocation: vi.fn().mockResolvedValue(mockResult),
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
            data: {
                getAssets: vi.fn().mockResolvedValue([]),
            },
            settings: {
                get: vi.fn().mockResolvedValue(null),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        setApiClientOverride(null);
        vi.useRealTimers();
    });

    test('clamps date range updates and ignores invalid ordering', () => {
        const { earliestStartDate, latestEndDate } = getDateRangeBounds();

        useAllocationStore.getState().setDateRange('2010-01-01', '2030-01-01');

        expect(useAllocationStore.getState().startDate).toBe(earliestStartDate);
        expect(useAllocationStore.getState().endDate).toBe(latestEndDate);

        useAllocationStore.getState().setDateRange(latestEndDate, earliestStartDate);

        expect(useAllocationStore.getState().startDate).toBe(earliestStartDate);
        expect(useAllocationStore.getState().endDate).toBe(latestEndDate);
    });

    test('restores plan date ranges and sends them in allocation requests', async () => {
        useAllocationStore.setState({
            rebalanceCadence: 'quarterly',
            selectedAssetIds: ['spy', 'agg'],
            startDate: '2024-01-01',
            endDate: '2024-12-31',
        });

        await useAllocationStore.getState().runAllocation();

        expect(mockApi.portfolio.runAllocation).toHaveBeenCalledWith(
            expect.objectContaining({
                endDate: '2024-12-31',
                rebalanceCadence: 'quarterly',
                startDate: '2024-01-01',
            }),
        );

        useAllocationStore.getState().applyPlan(
            createPlan({
                endDate: '2023-12-31',
                startDate: '2023-01-01',
            }),
        );

        expect(useAllocationStore.getState().startDate).toBe('2023-01-01');
        expect(useAllocationStore.getState().endDate).toBe('2023-12-31');
        expect(useAllocationStore.getState().rebalanceCadence).toBe('monthly');

        useAllocationStore.getState().applyPlan(createPlan({ endDate: undefined, startDate: undefined }));

        const defaultDateRange = getDefaultDateRange();
        expect(useAllocationStore.getState().startDate).toBe(defaultDateRange.startDate);
        expect(useAllocationStore.getState().endDate).toBe(defaultDateRange.endDate);
    });

    test('updates rebalance cadence through explicit setter', () => {
        useAllocationStore.getState().setRebalanceCadence('monthly');

        expect(useAllocationStore.getState().rebalanceCadence).toBe('monthly');
    });

    test('sends enabled trend-following strategy mix in allocation requests', async () => {
        useAllocationStore.setState({ selectedAssetIds: ['spy', 'agg'] });
        useAllocationStore.getState().setTrendFollowingEnabled(true);
        useAllocationStore.getState().setTrendFollowingSleeveWeight(0.4);
        useAllocationStore.getState().setTrendFollowingRuleEnabled(2, false);

        await useAllocationStore.getState().runAllocation();

        expect(mockApi.portfolio.runAllocation).toHaveBeenCalledWith(
            expect.objectContaining({
                strategyMix: {
                    trendFollowing: expect.objectContaining({
                        enabled: true,
                        rules: expect.arrayContaining([
                            expect.objectContaining({ enabled: false, fast: 2, slow: 8 }),
                        ]),
                        sleeveWeight: 0.4,
                    }),
                },
            }),
        );
    });

    test('limits trend-following sleeve to explicitly selected trend assets', async () => {
        useAllocationStore.setState({ selectedAssetIds: ['spy', 'agg'] });
        useAllocationStore.getState().setTrendFollowingEnabled(true);
        useAllocationStore.getState().setTrendFollowingAssetEnabled('agg', false);

        await useAllocationStore.getState().runAllocation();

        expect(mockApi.portfolio.runAllocation).toHaveBeenCalledWith(
            expect.objectContaining({
                strategyMix: {
                    trendFollowing: expect.objectContaining({
                        assetIds: ['spy'],
                        enabled: true,
                    }),
                },
            }),
        );
    });

    test('sends explicitly selected allocation sleeve assets in allocation requests', async () => {
        useAllocationStore.setState({ selectedAssetIds: ['spy', 'agg', 'gld'] });
        useAllocationStore.getState().setAllocationAssetEnabled('gld', false);

        await useAllocationStore.getState().runAllocation();

        expect(mockApi.portfolio.runAllocation).toHaveBeenCalledWith(
            expect.objectContaining({
                strategyMix: {
                    allocation: {
                        assetIds: ['spy', 'agg'],
                    },
                    trendFollowing: expect.objectContaining({ enabled: false }),
                },
            }),
        );
    });

    test('sets allocation sleeve assets in one operation', () => {
        useAllocationStore.setState({ selectedAssetIds: ['spy', 'agg', 'gld'] });

        useAllocationStore.getState().setAllocationAssetSelection(['agg', 'missing']);

        expect(useAllocationStore.getState().strategyMix.allocation?.assetIds).toEqual(['agg']);

        useAllocationStore.getState().setAllocationAssetSelection([]);

        expect(useAllocationStore.getState().strategyMix.allocation?.assetIds).toEqual([]);
    });

    test('sets trend-following assets in one operation', () => {
        useAllocationStore.setState({ selectedAssetIds: ['spy', 'agg', 'gld'] });
        useAllocationStore.getState().setTrendFollowingEnabled(true);

        useAllocationStore.getState().setTrendFollowingAssetSelection(['gld', 'spy', 'missing']);

        expect(useAllocationStore.getState().strategyMix.trendFollowing).toEqual(
            expect.objectContaining({
                assetIds: ['spy', 'gld'],
                enabled: true,
            }),
        );

        useAllocationStore.getState().setTrendFollowingAssetSelection([]);

        expect(useAllocationStore.getState().strategyMix.trendFollowing).toEqual(
            expect.objectContaining({
                assetIds: [],
                enabled: true,
            }),
        );
    });
});
