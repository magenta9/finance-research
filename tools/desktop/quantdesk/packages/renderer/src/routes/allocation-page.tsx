import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

import type { AllocationPlanRecord } from '@quantdesk/shared';

import { MetricCard } from '../components/allocation/metric-card';
import { PlanLibrary } from '../components/allocation/plan-library';
import { AssetDetailPanel } from '../components/assets/asset-detail-panel';
import { InlineNotice } from '../components/inline-notice';
import { deriveAvailableTags } from '../stores/asset-store';
import { selectVisibleAllocationAssets } from '../stores/allocation-store';
import {
    AllocationControlsPanel,
    AllocationResultPanel,
    AllocationStrategyPanel,
    AssetSelectionPanel,
} from './allocation/allocation-panels';
import { useAllocationPageState } from './allocation/use-allocation-page-state';

const downloadJson = (filename: string, payload: string) => {
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
};

export const AllocationPage = () => {
    const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
    const [isDetailOpen, setDetailOpen] = useState(false);
    const {
        activePlanId,
        applyPlan,
        assets,
        baseCurrency,
        clearPlanNotice,
        clearResult,
        constraints,
        deletePlan,
        detailAssets,
        earliestStartDate,
        endDate,
        errorMessage,
        exportFilename,
        exportPayload,
        filterQuery,
        isLoadingAssets,
        isLoadingPlans,
        isRunning,
        isSavingPlan,
        lastDurationMs,
        latestEndDate,
        loadAssets,
        loadDetailAssets,
        loadPlans,
        markActivePlan,
        mode,
        planErrorMessage,
        planNameDraft,
        planNoticeMessage,
        plans,
        rebalanceCadence,
        result,
        runAllocation,
        savePlan,
        saveDetailTags,
        selectedAssetIds,
        selectFirstAssets,
        setBaseCurrency,
        setDateRange,
        setFilterQuery,
        setMaxSingleWeight,
        setPlanNameDraft,
        setRebalanceCadence,
        setTrendFollowingRuleEnabled,
        setStrategy,
        stageExport,
        startDate,
        strategy,
        strategyMix,
        toggleSelectedAsset,
    } = useAllocationPageState();

    useEffect(() => {
        void loadAssets();
        void loadPlans();
        void loadDetailAssets();
    }, [loadAssets, loadDetailAssets, loadPlans]);

    const deferredFilterQuery = useDeferredValue(filterQuery);
    const visibleAssets = useMemo(
        () => selectVisibleAllocationAssets({ assets, filterQuery: deferredFilterQuery }),
        [assets, deferredFilterQuery],
    );
    const selectedAssets = useMemo(
        () => {
            const selectedAssetIdSet = new Set(selectedAssetIds);

            return assets.filter((asset) => selectedAssetIdSet.has(asset.id));
        },
        [assets, selectedAssetIds],
    );
    const detailAsset = useMemo(
        () => detailAssets.find((asset) => asset.id === detailAssetId) ?? assets.find((asset) => asset.id === detailAssetId) ?? null,
        [assets, detailAssetId, detailAssets],
    );
    const detailAvailableTags = useMemo(
        () => deriveAvailableTags(detailAssets.length > 0 ? detailAssets : assets),
        [assets, detailAssets],
    );
    const detailAssetIdSet = useMemo(
        () => new Set(detailAssets.map((asset) => asset.id)),
        [detailAssets],
    );
    const canSaveCurrentPlan = Boolean(result && !result.error && result.allocations.length > 0);

    useEffect(() => {
        if (!detailAsset) {
            setDetailOpen(false);
        }
    }, [detailAsset]);

    const openAssetDetail = useCallback((assetId: string) => {
        setDetailAssetId(assetId);
        setDetailOpen(true);

        if (!detailAssetIdSet.has(assetId)) {
            void loadDetailAssets();
        }
    }, [detailAssetIdSet, loadDetailAssets]);

    const handleSaveAssetTags = useCallback(async (assetId: string, tags: string[]) => {
        if (!detailAssetIdSet.has(assetId)) {
            await loadDetailAssets();
        }

        await saveDetailTags(assetId, tags);
        await loadAssets();
    }, [detailAssetIdSet, loadAssets, loadDetailAssets, saveDetailTags]);

    const handleSaveCurrentPlan = useCallback(async () => {
        if (!canSaveCurrentPlan || !result) {
            return;
        }

        await savePlan({
            assets: selectedAssetIds,
            baseCurrency,
            constraints,
            endDate,
            mode,
            name: planNameDraft,
            rebalanceCadence,
            result,
            startDate,
            strategy,
        });
    }, [baseCurrency, canSaveCurrentPlan, constraints, endDate, mode, planNameDraft, rebalanceCadence, result, savePlan, selectedAssetIds, startDate, strategy]);

    const handleLoadPlan = useCallback((plan: AllocationPlanRecord) => {
        applyPlan(plan);
        markActivePlan(plan.id);
        setPlanNameDraft(plan.name);
    }, [applyPlan, markActivePlan, setPlanNameDraft]);

    const handleExportPlan = useCallback((plan: AllocationPlanRecord) => {
        const exported = stageExport(plan);
        downloadJson(exported.filename, exported.payload);
    }, [stageExport]);
    const handleDeletePlan = useCallback((plan: AllocationPlanRecord) => {
        void deletePlan(plan.id);
    }, [deletePlan]);
    const handleRunAllocation = useCallback(() => {
        void runAllocation();
    }, [runAllocation]);
    const handleCloseDetail = useCallback(() => {
        setDetailOpen(false);
    }, []);

    return (
        <section className="space-y-4" data-testid="allocation-page">
            {(errorMessage || result?.error) && (
                <div
                    className="rounded-[16px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.06)] p-4 text-sm leading-6 text-[#7d2c22]"
                    data-testid="allocation-error-panel"
                >
                    <p className="text-xs uppercase tracking-[0.24em]">配置异常</p>
                    <p className="mt-2">{result?.error?.message ?? errorMessage}</p>
                    {result?.error && (
                        <div className="mt-3 space-y-2">
                            <p data-testid="allocation-error-code">{result.error.code}</p>
                            {result.error.suggestions.map((suggestion) => (
                                <p key={suggestion}>- {suggestion}</p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {(planNoticeMessage || planErrorMessage) && (
                <InlineNotice
                    message={planErrorMessage ?? planNoticeMessage}
                    onDismiss={clearPlanNotice}
                    tone={planErrorMessage ? 'danger' : 'default'}
                />
            )}

            <div className="grid gap-3 md:grid-cols-4">
                <MetricCard hint="当前可参与计算的资产总数。" label="资产池" value={String(assets.length)} />
                <MetricCard hint="当前用于计算的标的数量。" label="已选择" value={String(selectedAssetIds.length)} />
                <MetricCard hint="最近一次计算耗时。" label="耗时" value={lastDurationMs == null ? '未运行' : `${lastDurationMs}ms`} />
                <MetricCard hint="最近一次结果来自哪一侧优化器。" label="执行侧" value={result?.diagnostics.optimizer ?? '待运行'} />
            </div>

            <AllocationStrategyPanel onSetStrategy={setStrategy} strategy={strategy} />

            <div className="grid gap-4 2xl:grid-cols-[1.08fr_0.92fr]">
                <AssetSelectionPanel
                    filterQuery={filterQuery}
                    isLoadingAssets={isLoadingAssets}
                    onClearResult={clearResult}
                    onFilterChange={setFilterQuery}
                    onOpenAssetDetail={openAssetDetail}
                    onSelectFirst={selectFirstAssets}
                    onToggleSelected={toggleSelectedAsset}
                    selectedAssetIds={selectedAssetIds}
                    visibleAssets={visibleAssets}
                />

                <AllocationControlsPanel
                    baseCurrency={baseCurrency}
                    constraints={constraints}
                    earliestStartDate={earliestStartDate}
                    endDate={endDate}
                    isRunning={isRunning}
                    latestEndDate={latestEndDate}
                    onRunAllocation={handleRunAllocation}
                    onSetBaseCurrency={(value) => {
                        setBaseCurrency(value as typeof baseCurrency);
                    }}
                    onSetDateRange={setDateRange}
                    onSetMaxSingleWeight={setMaxSingleWeight}
                    onSetRebalanceCadence={setRebalanceCadence}
                    onSetTrendFollowingRuleEnabled={setTrendFollowingRuleEnabled}
                    rebalanceCadence={rebalanceCadence}
                    selectedAssets={selectedAssets}
                    startDate={startDate}
                    strategy={strategy}
                    strategyMix={strategyMix}
                />
            </div>

            <AssetDetailPanel
                allTags={detailAvailableTags}
                asset={detailAsset}
                contextLabel="配置资产池"
                onClose={handleCloseDetail}
                onSaveTags={(assetId, tags) => {
                    void handleSaveAssetTags(assetId, tags);
                }}
                open={isDetailOpen}
            />

            <AllocationResultPanel onOpenAssetDetail={openAssetDetail} result={result} />

            <PlanLibrary
                activePlanId={activePlanId}
                canSaveCurrent={canSaveCurrentPlan}
                exportFilename={exportFilename}
                exportPayload={exportPayload}
                isLoading={isLoadingPlans}
                isSaving={isSavingPlan}
                onDeletePlan={handleDeletePlan}
                onExportPlan={handleExportPlan}
                onLoadPlan={handleLoadPlan}
                onPlanNameChange={setPlanNameDraft}
                onSaveCurrent={() => {
                    void handleSaveCurrentPlan();
                }}
                planNameDraft={planNameDraft}
                plans={plans}
            />

            <div className="sr-only" data-testid="allocation-current-mode">{mode}</div>
            <div className="sr-only" data-testid="allocation-current-strategy">{strategy}</div>
            <div className="sr-only" data-testid="allocation-duration-ms">{lastDurationMs ?? 0}</div>
            <div className="sr-only" data-testid="allocation-selected-count">{selectedAssetIds.length}</div>
        </section>
    );
};
