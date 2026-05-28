import { formatUtcDate, normalizeIsoDateString, shiftIsoDateByDays, shiftUtcDateByDays } from '@quantdesk/shared/date-utils';

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
): AllocationPreparationDateRange => {
    const calculationDates = prepared.alignedDates.filter((date) =>
        date >= fallbackRange.startDate && date <= fallbackRange.endDate,
    );

    return {
        endDate: calculationDates.at(-1) ?? prepared.alignedDates.at(-1) ?? fallbackRange.endDate,
        startDate: calculationDates[0] ?? prepared.alignedDates[0] ?? fallbackRange.startDate,
    };
};

export const resolveWarmupPreparationDateRange = (
    effectiveDateRange: AllocationPreparationDateRange,
    warmupDays = 0,
): AllocationPreparationDateRange => {
    if (warmupDays <= 0) {
        return effectiveDateRange;
    }

    return {
        endDate: effectiveDateRange.endDate,
        startDate: shiftIsoDateByDays(effectiveDateRange.startDate, -warmupDays),
    };
};
