import { create } from 'zustand';

import type {
    AllocationConstraints,
    AllocationPlanRecord,
    AllocationResult,
    AllocationStrategy,
    AllocationStrategyMix,
    RebalanceCadence,
    AllocationType,
    AssetClass,
    Currency,
    StoredAsset,
    TrendFollowingStrategyConfig,
} from '@quantdesk/shared';
import { formatUtcDate, shiftUtcDateByDays } from '@quantdesk/shared/date-utils';

import { apiClient } from '../lib/api-client';

export interface AllocationStoreState {
    assets: StoredAsset[];
    baseCurrency: Currency;
    constraints: AllocationConstraints;
    endDate: string;
    errorMessage: string | null;
    filterQuery: string;
    isLoadingAssets: boolean;
    isRunning: boolean;
    lastDurationMs: number | null;
    mode: AllocationType;
    rebalanceCadence: RebalanceCadence;
    result: AllocationResult | null;
    selectedAssetIds: string[];
    startDate: string;
    strategy: AllocationStrategy;
    strategyMix: AllocationStrategyMix;
}

interface AllocationStoreActions {
    applyPlan: (plan: AllocationPlanRecord) => void;
    clearResult: () => void;
    loadAssets: () => Promise<void>;
    runAllocation: () => Promise<AllocationResult | null>;
    selectFirstAssets: (count: number) => void;
    setBaseCurrency: (baseCurrency: Currency) => void;
    setAllocationAssetEnabled: (assetId: string, enabled: boolean) => void;
    setAllocationAssetSelection: (assetIds: string[]) => void;
    setClassConstraint: (assetClass: AssetClass, value: number | null) => void;
    setDateRange: (startDate: string, endDate: string) => void;
    setFilterQuery: (filterQuery: string) => void;
    setMaxSingleWeight: (value: number) => void;
    setMode: (mode: AllocationType) => void;
    setStrategy: (strategy: AllocationStrategy) => void;
    setRebalanceCadence: (cadence: RebalanceCadence) => void;
    setTrendFollowingAssetEnabled: (assetId: string, enabled: boolean) => void;
    setTrendFollowingAssetSelection: (assetIds: string[]) => void;
    setTrendFollowingAllowShort: (enabled: boolean) => void;
    setTrendFollowingEnabled: (enabled: boolean) => void;
    setTrendFollowingRuleEnabled: (fast: number, enabled: boolean) => void;
    setTrendFollowingSleeveWeight: (value: number) => void;
    toggleSelectedAsset: (assetId: string) => void;
}

export type AllocationStore = AllocationStoreState & AllocationStoreActions;

const createDefaultConstraints = (): AllocationConstraints => ({
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 0.35,
});

const createDefaultTrendFollowingConfig = (): TrendFollowingStrategyConfig => ({
    allowShort: true,
    enabled: false,
    rules: [
        { enabled: true, fast: 2, scalar: 10.6, slow: 8, weight: 1 },
        { enabled: true, fast: 4, scalar: 7.5, slow: 16, weight: 1 },
        { enabled: true, fast: 8, scalar: 5.3, slow: 32, weight: 1 },
        { enabled: true, fast: 16, scalar: 3.75, slow: 64, weight: 1 },
        { enabled: true, fast: 32, scalar: 2.65, slow: 128, weight: 1 },
        { enabled: true, fast: 64, scalar: 1.87, slow: 256, weight: 1 },
    ],
    sleeveWeight: 0.3,
});

const createDefaultStrategyMix = (): AllocationStrategyMix => ({
    activeDualMomentum: {
        absoluteMomentumFilter: true,
        longLookbackWeeks: 25,
        shortLookbackWeeks: 10,
        slippageBps: 0,
        sleeveWeights: { long: 0.5, short: 0.5 },
        topK: 3,
        transactionCostBps: 0,
    },
    trendFollowing: createDefaultTrendFollowingConfig(),
});

const isConfigurationStrategy = (strategy: AllocationStrategy): strategy is AllocationType =>
    strategy === 'erc' || strategy === 'inverse_volatility' || strategy === 'max_diversification';

const getModeForStrategy = (strategy: AllocationStrategy): AllocationType =>
    isConfigurationStrategy(strategy) ? strategy : 'inverse_volatility';

const resolvePlanStrategy = (plan: AllocationPlanRecord): AllocationStrategy =>
    plan.strategy ?? plan.result?.strategy ?? plan.mode;

const restoreStrategyMixFromPlan = (plan: AllocationPlanRecord): AllocationStrategyMix => {
    const allocation = plan.result?.diagnostics.strategyMix?.allocation;
    const trendFollowing = plan.result?.diagnostics.strategyMix?.trendFollowing;
    const strategyMix = createDefaultStrategyMix();

    if (allocation?.assetIds) {
        strategyMix.allocation = { assetIds: allocation.assetIds };
    }

    if (!trendFollowing) {
        return strategyMix;
    }

    const enabledRuleKeys = new Set(trendFollowing.rules.map((rule) => `${rule.fast}:${rule.slow}`));

    return {
        allocation: strategyMix.allocation,
        trendFollowing: {
            allowShort: trendFollowing.allowShort ?? true,
            enabled: trendFollowing.enabled,
            forecastCap: trendFollowing.forecastCap,
            forecastDiversificationMultiplier: trendFollowing.forecastDiversificationMultiplier,
            rules: createDefaultTrendFollowingConfig().rules?.map((rule) => ({
                ...rule,
                enabled: enabledRuleKeys.has(`${rule.fast}:${rule.slow}`),
            })),
            assetIds: trendFollowing.assetIds,
            sleeveWeight: trendFollowing.sleeveWeight,
        },
    };
};

export const getDateRangeBounds = () => {
    const today = new Date();

    return {
        earliestStartDate: shiftUtcDateByDays(today, -1825),
        latestEndDate: formatUtcDate(today),
    };
};

export const getDefaultDateRange = () => {
    const today = new Date();

    return {
        endDate: formatUtcDate(today),
        startDate: shiftUtcDateByDays(today, -365),
    };
};

export const clampDateRange = (startDate: string, endDate: string) => {
    const { earliestStartDate, latestEndDate } = getDateRangeBounds();
    const clampedStartDate = startDate < earliestStartDate ? earliestStartDate : startDate;
    const clampedEndDate = endDate > latestEndDate ? latestEndDate : endDate;

    if (clampedStartDate >= clampedEndDate) {
        return null;
    }

    return {
        endDate: clampedEndDate,
        startDate: clampedStartDate,
    };
};

const cloneJson = <T,>(value: T): T => structuredClone(value);

const filterStrategyAssetIds = (
    strategyMix: AllocationStrategyMix,
    selectedAssetIds: string[],
): AllocationStrategyMix => {
    const allocation = strategyMix.allocation;
    const trendFollowing = strategyMix.trendFollowing;
    const selected = new Set(selectedAssetIds);

    return {
        ...strategyMix,
        allocation: allocation?.assetIds ? {
            ...allocation,
            assetIds: allocation.assetIds.filter((assetId) => selected.has(assetId)),
        } : allocation,
        trendFollowing: trendFollowing?.assetIds ? {
            ...trendFollowing,
            assetIds: trendFollowing.assetIds.filter((assetId) => selected.has(assetId)),
        } : trendFollowing,
    };
};

const buildRunnableStrategyMix = (
    strategy: AllocationStrategy,
    strategyMix: AllocationStrategyMix,
) => {
    if (strategy !== 'ewmac_trend_following') {
        return undefined;
    }

    const defaultTrendFollowing = createDefaultTrendFollowingConfig();
    const configuredTrendFollowing = strategyMix.trendFollowing;

    return cloneJson({
        trendFollowing: {
            enabled: true,
            forecastCap: configuredTrendFollowing?.forecastCap,
            forecastDiversificationMultiplier: configuredTrendFollowing?.forecastDiversificationMultiplier,
            allowShort: configuredTrendFollowing?.allowShort ?? defaultTrendFollowing.allowShort,
            rules: configuredTrendFollowing?.rules ?? defaultTrendFollowing.rules,
            sleeveWeight: 1,
            volatilitySpan: configuredTrendFollowing?.volatilitySpan,
        },
    });
};

const createInitialState = (): AllocationStoreState => {
    const defaultDateRange = getDefaultDateRange();

    return {
        assets: [],
        baseCurrency: 'CNY',
        constraints: createDefaultConstraints(),
        endDate: defaultDateRange.endDate,
        errorMessage: null,
        filterQuery: '',
        isLoadingAssets: false,
        isRunning: false,
        lastDurationMs: null,
        mode: 'inverse_volatility',
        rebalanceCadence: 'none',
        result: null,
        selectedAssetIds: [],
        startDate: defaultDateRange.startDate,
        strategy: 'inverse_volatility',
        strategyMix: createDefaultStrategyMix(),
    };
};

const normalizeError = (error: unknown) =>
    error instanceof Error ? error.message : '发生未知错误。';

export const selectVisibleAllocationAssets = (state: Pick<AllocationStoreState, 'assets' | 'filterQuery'>) => {
    const normalizedQuery = state.filterQuery.trim().toLowerCase();

    if (!normalizedQuery) {
        return state.assets;
    }

    return state.assets.filter((asset) =>
        asset.symbol.toLowerCase().includes(normalizedQuery)
        || asset.name.toLowerCase().includes(normalizedQuery)
        || asset.market.toLowerCase().includes(normalizedQuery)
        || asset.assetClass.toLowerCase().includes(normalizedQuery)
        || asset.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
    );
};

export const useAllocationStore = create<AllocationStore>((set, get) => ({
    ...createInitialState(),
    applyPlan(plan) {
        const defaultDateRange = getDefaultDateRange();
        const dateRange = clampDateRange(
            plan.startDate ?? defaultDateRange.startDate,
            plan.endDate ?? defaultDateRange.endDate,
        ) ?? defaultDateRange;

        set({
            baseCurrency: plan.baseCurrency,
            constraints: cloneJson(plan.constraints),
            endDate: dateRange.endDate,
            errorMessage: null,
            filterQuery: '',
            lastDurationMs: null,
            mode: plan.mode,
            rebalanceCadence: plan.rebalanceCadence ?? 'none',
            result: plan.result ? cloneJson(plan.result) : null,
            selectedAssetIds: [...plan.assets],
            startDate: dateRange.startDate,
            strategy: resolvePlanStrategy(plan),
            strategyMix: restoreStrategyMixFromPlan(plan),
        });
    },
    clearResult() {
        set({ errorMessage: null, lastDurationMs: null, result: null });
    },
    async loadAssets() {
        set({ errorMessage: null, isLoadingAssets: true });

        try {
            const [assets, baseCurrencyPreference, maxSingleWeightPreference] = await Promise.all([
                apiClient.data.getAssets(),
                apiClient.settings.get('baseCurrency'),
                apiClient.settings.get('defaultMaxSingleWeight'),
            ]);
            const parsedMaxSingleWeight = maxSingleWeightPreference == null
                ? Number.NaN
                : Number(maxSingleWeightPreference);
            const assetIds = new Set(assets.map((asset) => asset.id));
            const currentSelectedAssetIds = get().selectedAssetIds;
            const shouldUseDefaultSelection = get().assets.length === 0 && currentSelectedAssetIds.length === 0;
            const selectedAssetIds = currentSelectedAssetIds.length > 0
                ? currentSelectedAssetIds.filter((id) => assetIds.has(id))
                : shouldUseDefaultSelection
                    ? assets.slice(0, Math.min(5, assets.length)).map((asset) => asset.id)
                    : [];

            set({
                assets,
                baseCurrency: (baseCurrencyPreference as Currency | null) ?? get().baseCurrency,
                constraints: {
                    ...get().constraints,
                    maxSingleWeight: Number.isFinite(parsedMaxSingleWeight)
                        ? parsedMaxSingleWeight
                        : get().constraints.maxSingleWeight,
                },
                isLoadingAssets: false,
                selectedAssetIds,
                strategyMix: filterStrategyAssetIds(get().strategyMix, selectedAssetIds),
            });
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isLoadingAssets: false,
            });
        }
    },
    async runAllocation() {
        const { baseCurrency, constraints, endDate, mode, rebalanceCadence, selectedAssetIds, startDate, strategy, strategyMix } = get();

        if (selectedAssetIds.length < 2) {
            set({ errorMessage: '至少选择两个标的后才能运行配置。' });
            return null;
        }

        set({ errorMessage: null, isRunning: true });
        const startedAt = performance.now();

        try {
            const result = await apiClient.portfolio.runAllocation({
                assetIds: selectedAssetIds,
                baseCurrency,
                constraints,
                endDate,
                mode,
                rebalanceCadence,
                startDate,
                strategy,
                strategyMix: buildRunnableStrategyMix(strategy, strategyMix),
            });

            set({
                isRunning: false,
                lastDurationMs: Math.round(performance.now() - startedAt),
                result,
            });

            return result;
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isRunning: false,
                lastDurationMs: Math.round(performance.now() - startedAt),
            });

            return null;
        }
    },
    selectFirstAssets(count) {
        const assets = get().assets.slice(0, Math.min(count, get().assets.length));
        const selectedAssetIds = assets.map((asset) => asset.id);
        set({
            selectedAssetIds,
            strategyMix: filterStrategyAssetIds(get().strategyMix, selectedAssetIds),
        });
    },
    setBaseCurrency(baseCurrency) {
        set({ baseCurrency });
    },
    setAllocationAssetEnabled(assetId, enabled) {
        const selectedAllocationAssetIds = new Set(get().strategyMix.allocation?.assetIds ?? get().selectedAssetIds);

        if (enabled) {
            selectedAllocationAssetIds.add(assetId);
        } else {
            selectedAllocationAssetIds.delete(assetId);
        }

        set({
            strategyMix: {
                ...get().strategyMix,
                allocation: {
                    ...get().strategyMix.allocation,
                    assetIds: get().selectedAssetIds.filter((selectedAssetId) => selectedAllocationAssetIds.has(selectedAssetId)),
                },
            },
        });
    },
    setAllocationAssetSelection(assetIds) {
        const selectedAllocationAssetIds = new Set(assetIds);

        set({
            strategyMix: {
                ...get().strategyMix,
                allocation: {
                    ...get().strategyMix.allocation,
                    assetIds: get().selectedAssetIds.filter((selectedAssetId) => selectedAllocationAssetIds.has(selectedAssetId)),
                },
            },
        });
    },
    setClassConstraint(assetClass, value) {
        const nextConstraints = { ...get().constraints.maxClassWeight };

        if (value == null || Number.isNaN(value)) {
            delete nextConstraints[assetClass];
        } else {
            nextConstraints[assetClass] = value;
        }

        set({
            constraints: {
                ...get().constraints,
                maxClassWeight: nextConstraints,
            },
        });
    },
    setDateRange(startDate, endDate) {
        const nextDateRange = clampDateRange(startDate, endDate);

        if (!nextDateRange) {
            return;
        }

        set(nextDateRange);
    },
    setFilterQuery(filterQuery) {
        set({ filterQuery });
    },
    setMaxSingleWeight(value) {
        set({
            constraints: {
                ...get().constraints,
                maxSingleWeight: value,
            },
        });
    },
    setMode(mode) {
        set({ mode, strategy: mode });
    },
    setStrategy(strategy) {
        set({
            mode: getModeForStrategy(strategy),
            strategy,
        });
    },
    setRebalanceCadence(rebalanceCadence) {
        set({ rebalanceCadence });
    },
    setTrendFollowingAssetEnabled(assetId, enabled) {
        const baseConfig = {
            ...createDefaultTrendFollowingConfig(),
            ...get().strategyMix.trendFollowing,
        };
        const selectedTrendAssetIds = new Set(baseConfig.assetIds ?? get().selectedAssetIds);

        if (enabled) {
            selectedTrendAssetIds.add(assetId);
        } else {
            selectedTrendAssetIds.delete(assetId);
        }

        set({
            strategyMix: {
                ...get().strategyMix,
                trendFollowing: {
                    ...baseConfig,
                    assetIds: get().selectedAssetIds.filter((selectedAssetId) => selectedTrendAssetIds.has(selectedAssetId)),
                },
            },
        });
    },
    setTrendFollowingAssetSelection(assetIds) {
        const baseConfig = {
            ...createDefaultTrendFollowingConfig(),
            ...get().strategyMix.trendFollowing,
        };
        const selectedTrendAssetIds = new Set(assetIds);

        set({
            strategyMix: {
                ...get().strategyMix,
                trendFollowing: {
                    ...baseConfig,
                    assetIds: get().selectedAssetIds.filter((selectedAssetId) => selectedTrendAssetIds.has(selectedAssetId)),
                },
            },
        });
    },
    setTrendFollowingAllowShort(allowShort) {
        set({
            strategyMix: {
                ...get().strategyMix,
                trendFollowing: {
                    ...createDefaultTrendFollowingConfig(),
                    ...get().strategyMix.trendFollowing,
                    allowShort,
                },
            },
        });
    },
    setTrendFollowingEnabled(enabled) {
        set({
            strategyMix: {
                ...get().strategyMix,
                trendFollowing: {
                    ...createDefaultTrendFollowingConfig(),
                    ...get().strategyMix.trendFollowing,
                    enabled,
                },
            },
        });
    },
    setTrendFollowingRuleEnabled(fast, enabled) {
        const baseConfig = {
            ...createDefaultTrendFollowingConfig(),
            ...get().strategyMix.trendFollowing,
        };

        set({
            strategyMix: {
                ...get().strategyMix,
                trendFollowing: {
                    ...baseConfig,
                    rules: (baseConfig.rules ?? []).map((rule) =>
                        rule.fast === fast ? { ...rule, enabled } : rule),
                },
            },
        });
    },
    setTrendFollowingSleeveWeight(value) {
        set({
            strategyMix: {
                ...get().strategyMix,
                trendFollowing: {
                    ...createDefaultTrendFollowingConfig(),
                    ...get().strategyMix.trendFollowing,
                    sleeveWeight: Math.min(1, Math.max(0, value)),
                },
            },
        });
    },
    toggleSelectedAsset(assetId) {
        const selected = new Set(get().selectedAssetIds);

        if (selected.has(assetId)) {
            selected.delete(assetId);
        } else {
            selected.add(assetId);
        }

        const selectedAssetIds = [...selected];
        set({
            selectedAssetIds,
            strategyMix: filterStrategyAssetIds(get().strategyMix, selectedAssetIds),
        });
    },
}));

export const resetAllocationStore = () => {
    useAllocationStore.setState(createInitialState());
};
