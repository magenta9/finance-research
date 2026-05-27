import { useShallow } from 'zustand/react/shallow';

import type { AssetStore } from '../../stores/asset-store';
import { useAssetStore } from '../../stores/asset-store';
import type { AllocationStore } from '../../stores/allocation-store';
import { getDateRangeBounds, useAllocationStore } from '../../stores/allocation-store';
import type { PlanStore } from '../../stores/plan-store';
import { usePlanStore } from '../../stores/plan-store';

type AllocationPageAllocationState = Pick<AllocationStore,
    | 'applyPlan'
    | 'assets'
    | 'baseCurrency'
    | 'clearResult'
    | 'constraints'
    | 'endDate'
    | 'errorMessage'
    | 'filterQuery'
    | 'isLoadingAssets'
    | 'isRunning'
    | 'lastDurationMs'
    | 'loadAssets'
    | 'mode'
    | 'rebalanceCadence'
    | 'result'
    | 'runAllocation'
    | 'selectedAssetIds'
    | 'selectFirstAssets'
    | 'setAllocationAssetEnabled'
    | 'setAllocationAssetSelection'
    | 'setBaseCurrency'
    | 'setDateRange'
    | 'setFilterQuery'
    | 'setMaxSingleWeight'
    | 'setMode'
    | 'setRebalanceCadence'
    | 'setTrendFollowingAssetEnabled'
    | 'setTrendFollowingAssetSelection'
    | 'startDate'
    | 'strategyMix'
    | 'setTrendFollowingEnabled'
    | 'setTrendFollowingRuleEnabled'
    | 'setTrendFollowingSleeveWeight'
    | 'toggleSelectedAsset'
>;

type AllocationPagePlanState = {
    activePlanId: PlanStore['activePlanId'];
    clearPlanNotice: PlanStore['clearNotice'];
    deletePlan: PlanStore['deletePlan'];
    exportFilename: PlanStore['exportFilename'];
    exportPayload: PlanStore['exportPayload'];
    isLoadingPlans: PlanStore['isLoading'];
    isSavingPlan: PlanStore['isSaving'];
    loadPlans: PlanStore['loadPlans'];
    markActivePlan: PlanStore['markActivePlan'];
    planErrorMessage: PlanStore['errorMessage'];
    planNameDraft: PlanStore['planNameDraft'];
    planNoticeMessage: PlanStore['noticeMessage'];
    plans: PlanStore['plans'];
    savePlan: PlanStore['savePlan'];
    setPlanNameDraft: PlanStore['setPlanNameDraft'];
    stageExport: PlanStore['stageExport'];
};

type AllocationPageDetailState = {
    detailAssets: AssetStore['assets'];
    loadDetailAssets: AssetStore['loadAssets'];
    saveDetailTags: AssetStore['saveAssetTags'];
};

export type AllocationPageState = AllocationPageAllocationState
    & AllocationPagePlanState
    & AllocationPageDetailState
    & ReturnType<typeof getDateRangeBounds>;

export const useAllocationPageState = (): AllocationPageState => {
    const allocation = useAllocationStore(useShallow((state) => ({
        applyPlan: state.applyPlan,
        assets: state.assets,
        baseCurrency: state.baseCurrency,
        clearResult: state.clearResult,
        constraints: state.constraints,
        endDate: state.endDate,
        errorMessage: state.errorMessage,
        filterQuery: state.filterQuery,
        isLoadingAssets: state.isLoadingAssets,
        isRunning: state.isRunning,
        lastDurationMs: state.lastDurationMs,
        loadAssets: state.loadAssets,
        mode: state.mode,
        rebalanceCadence: state.rebalanceCadence,
        result: state.result,
        runAllocation: state.runAllocation,
        selectedAssetIds: state.selectedAssetIds,
        selectFirstAssets: state.selectFirstAssets,
        setAllocationAssetEnabled: state.setAllocationAssetEnabled,
        setAllocationAssetSelection: state.setAllocationAssetSelection,
        setBaseCurrency: state.setBaseCurrency,
        setDateRange: state.setDateRange,
        setFilterQuery: state.setFilterQuery,
        setMaxSingleWeight: state.setMaxSingleWeight,
        setMode: state.setMode,
        setRebalanceCadence: state.setRebalanceCadence,
        setTrendFollowingAssetEnabled: state.setTrendFollowingAssetEnabled,
        setTrendFollowingAssetSelection: state.setTrendFollowingAssetSelection,
        startDate: state.startDate,
        strategyMix: state.strategyMix,
        setTrendFollowingEnabled: state.setTrendFollowingEnabled,
        setTrendFollowingRuleEnabled: state.setTrendFollowingRuleEnabled,
        setTrendFollowingSleeveWeight: state.setTrendFollowingSleeveWeight,
        toggleSelectedAsset: state.toggleSelectedAsset,
    })));

    const plan = usePlanStore(useShallow((state) => ({
        activePlanId: state.activePlanId,
        clearPlanNotice: state.clearNotice,
        deletePlan: state.deletePlan,
        exportFilename: state.exportFilename,
        exportPayload: state.exportPayload,
        isLoadingPlans: state.isLoading,
        isSavingPlan: state.isSaving,
        loadPlans: state.loadPlans,
        markActivePlan: state.markActivePlan,
        planErrorMessage: state.errorMessage,
        planNameDraft: state.planNameDraft,
        planNoticeMessage: state.noticeMessage,
        plans: state.plans,
        savePlan: state.savePlan,
        setPlanNameDraft: state.setPlanNameDraft,
        stageExport: state.stageExport,
    })));

    const detail = useAssetStore(useShallow((state) => ({
        detailAssets: state.assets,
        loadDetailAssets: state.loadAssets,
        saveDetailTags: state.saveAssetTags,
    })));

    return {
        ...allocation,
        ...plan,
        ...detail,
        ...getDateRangeBounds(),
    };
};
