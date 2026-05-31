import type {
    AllocationResult,
    AllocationStrategy,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '@quantdesk/shared';

import { buildAllocationErrorResult } from './allocation-result-assembler';
import type { PreparedAllocationData } from './preprocessor';

export const buildStrategyErrorResult = ({
    baseCurrency,
    error,
    mode,
    prepared,
    rebalanceCadence,
    strategy,
}: {
    baseCurrency: Currency;
    error: NonNullable<AllocationResult['error']>;
    mode: AllocationType;
    prepared: PreparedAllocationData;
    rebalanceCadence: RebalanceCadence;
    strategy: AllocationStrategy;
}) => buildAllocationErrorResult({
    baseCurrency,
    effectiveDateRange: {
        endDate: prepared.alignedDates.at(-1) ?? '',
        startDate: prepared.alignedDates[0] ?? '',
    },
    error,
    mode,
    prepared,
    rebalanceCadence,
    strategy,
});
