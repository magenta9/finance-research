import type {
    AllocationConstraints,
    AllocationResult,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '../domain';

export interface AllocationPlanInput {
    id: string;
    name: string;
    mode: AllocationType;
    assets: string[];
    constraints: AllocationConstraints;
    result: AllocationResult | null;
    baseCurrency: Currency;
    startDate?: string;
    endDate?: string;
    rebalanceCadence?: RebalanceCadence;
}

export interface AllocationPlanRecord extends AllocationPlanInput {
    createdAt: string;
    updatedAt: string;
}