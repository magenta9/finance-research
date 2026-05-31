import type { AllocationStrategy } from '@quantdesk/shared';

import { defaultAllocationStrategyRegistry } from './strategy-registry';

export const resolveStrategyHandler = (strategyId: AllocationStrategy) => (
    defaultAllocationStrategyRegistry as Partial<typeof defaultAllocationStrategyRegistry>)[strategyId] ?? null;
