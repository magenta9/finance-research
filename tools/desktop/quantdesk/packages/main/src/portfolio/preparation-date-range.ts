import { formatUtcDate, normalizeIsoDateString, shiftUtcDateByDays } from '@quantdesk/shared/date-utils';

import type { PreparedAllocationData } from './preprocessor';

export interface AllocationPreparationDateRange {
    endDate: string;
    startDate: string;
}

export const resolveAllocationPreparationDateRange = ({
    clock,
    endDate,
    startDate,
}: {
    clock: () => Date;
    startDate?: string;
    endDate?: string;
}): AllocationPreparationDateRange => {
    const today = clock();
    const todayStr = formatUtcDate(today);
    const defaultStartDate = shiftUtcDateByDays(today, -365);
    const minStartDate = shiftUtcDateByDays(today, -1825);

    let effectiveEndDate = normalizeIsoDateString(endDate) ?? todayStr;
    if (effectiveEndDate > todayStr) {
        effectiveEndDate = todayStr;
    }

    let effectiveStartDate = normalizeIsoDateString(startDate) ?? defaultStartDate;
    if (effectiveStartDate < minStartDate) {
        effectiveStartDate = minStartDate;
    }

    if (effectiveStartDate >= effectiveEndDate) {
        return {
            endDate: todayStr,
            startDate: defaultStartDate,
        };
    }

    return {
        endDate: effectiveEndDate,
        startDate: effectiveStartDate,
    };
};

export const resolvePreparedCalculationDateRange = (
    prepared: PreparedAllocationData,
    fallbackRange: AllocationPreparationDateRange,
): AllocationPreparationDateRange => ({
    endDate: prepared.alignedDates.at(-1) ?? fallbackRange.endDate,
    startDate: prepared.alignedDates[0] ?? fallbackRange.startDate,
});
