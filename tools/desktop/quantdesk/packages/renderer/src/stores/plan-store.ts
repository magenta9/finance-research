import { create } from 'zustand';

import type {
    AllocationConstraints,
    AllocationPlanRecord,
    AllocationResult,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import { apiClient } from '../lib/api-client';

interface SavePlanInput {
    assets: string[];
    baseCurrency: Currency;
    constraints: AllocationConstraints;
    endDate?: string;
    mode: AllocationType;
    name?: string;
    rebalanceCadence: RebalanceCadence;
    result: AllocationResult | null;
    startDate?: string;
}

interface PlanStoreState {
    activePlanId: string | null;
    errorMessage: string | null;
    exportFilename: string | null;
    exportPayload: string | null;
    isLoading: boolean;
    isSaving: boolean;
    noticeMessage: string | null;
    planNameDraft: string;
    plans: AllocationPlanRecord[];
}

interface PlanStoreActions {
    clearNotice: () => void;
    deletePlan: (id: string) => Promise<boolean>;
    loadPlans: () => Promise<void>;
    markActivePlan: (id: string | null) => void;
    savePlan: (input: SavePlanInput) => Promise<AllocationPlanRecord | null>;
    setPlanNameDraft: (value: string) => void;
    stageExport: (plan: AllocationPlanRecord) => { filename: string; payload: string };
}

export type PlanStore = PlanStoreState & PlanStoreActions;

const modeLabelMap: Record<AllocationType, string> = {
    erc: '等风险贡献',
    inverse_volatility: '反波动率加权',
    max_diversification: '最大分散化',
};

const normalizeError = (error: unknown) =>
    error instanceof Error ? error.message : '发生未知错误。';

const sortPlans = (plans: AllocationPlanRecord[]) =>
    [...plans].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

const cloneSerializable = <T,>(value: T): T => structuredClone(value);

const buildDefaultPlanName = (mode: AllocationType) => {
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return `${modeLabelMap[mode]} · ${timestamp}`;
};

const buildExportFilename = (plan: AllocationPlanRecord) => `quantdesk-plan-${plan.id}.json`;

const serializePlan = (plan: AllocationPlanRecord) =>
    JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            plan,
        },
        null,
        2,
    );

const createInitialState = (): PlanStoreState => ({
    activePlanId: null,
    errorMessage: null,
    exportFilename: null,
    exportPayload: null,
    isLoading: false,
    isSaving: false,
    noticeMessage: null,
    planNameDraft: '',
    plans: [],
});

export const usePlanStore = create<PlanStore>((set, get) => ({
    ...createInitialState(),
    clearNotice() {
        set({ errorMessage: null, noticeMessage: null });
    },
    async deletePlan(id) {
        set({ errorMessage: null });

        try {
            const deleted = await apiClient.portfolio.deletePlan(id);

            if (!deleted) {
                return false;
            }

            const nextPlans = get().plans.filter((plan) => plan.id !== id);
            set({
                activePlanId: get().activePlanId === id ? null : get().activePlanId,
                noticeMessage: '方案已删除。',
                plans: nextPlans,
            });
            return true;
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
            return false;
        }
    },
    async loadPlans() {
        set({ errorMessage: null, isLoading: true });

        try {
            const plans = await apiClient.portfolio.getPlans();
            set({
                isLoading: false,
                plans: sortPlans(plans),
            });
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isLoading: false,
            });
        }
    },
    markActivePlan(id) {
        set({ activePlanId: id });
    },
    async savePlan(input) {
        set({ errorMessage: null, isSaving: true });

        try {
            const record = await apiClient.portfolio.savePlan({
                assets: [...input.assets],
                baseCurrency: input.baseCurrency,
                constraints: cloneSerializable(input.constraints),
                endDate: input.endDate,
                id: crypto.randomUUID(),
                mode: input.mode,
                name: input.name?.trim() || buildDefaultPlanName(input.mode),
                rebalanceCadence: input.rebalanceCadence,
                result: input.result ? cloneSerializable(input.result) : null,
                startDate: input.startDate,
            });

            set({
                activePlanId: record.id,
                isSaving: false,
                noticeMessage: `方案已保存：${record.name}`,
                planNameDraft: record.name,
                plans: sortPlans([record, ...get().plans.filter((plan) => plan.id !== record.id)]),
            });

            return record;
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isSaving: false,
            });
            return null;
        }
    },
    setPlanNameDraft(value) {
        set({ planNameDraft: value });
    },
    stageExport(plan) {
        const payload = serializePlan(plan);
        const filename = buildExportFilename(plan);

        set({
            exportFilename: filename,
            exportPayload: payload,
            noticeMessage: `已生成导出文件：${filename}`,
        });

        return { filename, payload };
    },
}));

export const resetPlanStore = () => {
    usePlanStore.setState(createInitialState());
};
