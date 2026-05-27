import type {
    AllocationResult,
    Currency,
    SyncTaskPriority,
} from '@quantdesk/shared';
import { formatUtcDate, normalizeIsoDateString, shiftUtcDateByDays } from '@quantdesk/shared/date-utils';

import {
    prepareAllocationData,
    type PreparedAllocationData,
} from './preprocessor';
import type { AllocationPreparationReader } from './preparation-repository-adapter';

const emptyPreparedAllocationData: PreparedAllocationData = {
    alignedDates: [],
    assetDateCoverage: [],
    excludedAssets: [],
    series: [],
    warnings: [],
};

export interface AllocationPreparationDateRange {
    endDate: string;
    startDate: string;
}

export type AllocationPreparationOutcome =
    | {
        ok: true;
        prepared: PreparedAllocationData;
        calculationDateRange: AllocationPreparationDateRange;
        effectiveDateRange: AllocationPreparationDateRange;
    }
    | {
        ok: false;
        error: NonNullable<AllocationResult['error']>;
        prepared: PreparedAllocationData;
        calculationDateRange: AllocationPreparationDateRange;
    };

export interface AllocationPreparationServiceDeps {
    marketDataOrchestrator: {
        ensure: (request: {
            assetIds: string[];
            intent: 'allocation';
            priority?: SyncTaskPriority;
            window: { endDate: string; startDate: string };
        }) => Promise<{ warnings: Array<{ message: string }> }>;
    };
    reader: AllocationPreparationReader;
    clock?: () => Date;
    shouldSkipInteractiveSync?: () => boolean;
}

const resolveEffectiveDateRange = ({
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

const resolveActualDateRange = (
    prepared: PreparedAllocationData,
    fallbackRange: AllocationPreparationDateRange,
): AllocationPreparationDateRange => ({
    endDate: prepared.alignedDates.at(-1) ?? fallbackRange.endDate,
    startDate: prepared.alignedDates[0] ?? fallbackRange.startDate,
});

const classifyPreparationError = (
    error: unknown,
): NonNullable<AllocationResult['error']> => {
    if (error instanceof Error && 'code' in error && error.code === 'MARKET_DATA_UNAVAILABLE') {
        return {
            code: 'MARKET_DATA_UNAVAILABLE',
            message: error.message,
            suggestions: ['Enable at least one market data provider.', 'Refresh the asset after the provider recovers.'],
        };
    }

    if (error instanceof Error && 'code' in error && error.code === 'FX_RATE_UNAVAILABLE') {
        return {
            code: 'FX_RATE_UNAVAILABLE',
            message: error.message,
            suggestions: ['Enable at least one FX provider.', 'Refresh FX cache before running allocation.'],
        };
    }

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('60') || message.includes('history') || message.includes('共同覆盖')) {
        return {
            code: 'INSUFFICIENT_HISTORY',
            message,
            suggestions: ['缩短时间窗口。', '减少已选标的数量。'],
        };
    }

    if (message.includes('FX rate')) {
        return {
            code: 'FX_RATE_MISSING',
            message,
            suggestions: ['Synchronize FX rates before running allocation.', 'Switch the base currency to match cached assets.'],
        };
    }

    return {
        code: 'ALLOCATION_PREPARATION_FAILED',
        message,
        suggestions: ['Review asset history coverage and cached prices.', 'Retry after refreshing market data.'],
    };
};

export class AllocationPreparationService {
    private readonly deps: AllocationPreparationServiceDeps;

    private readonly clock: () => Date;

    private readonly shouldSkipInteractiveSync: () => boolean;

    constructor(deps: AllocationPreparationServiceDeps) {
        this.deps = deps;
        this.clock = deps.clock ?? (() => new Date());
        this.shouldSkipInteractiveSync = deps.shouldSkipInteractiveSync ?? (() => false);
    }

    async prepare({
        assetIds,
        baseCurrency,
        endDate,
        startDate,
    }: {
        assetIds: string[];
        baseCurrency: Currency;
        endDate?: string;
        startDate?: string;
    }): Promise<AllocationPreparationOutcome> {
        const effectiveDateRange = resolveEffectiveDateRange({
            clock: this.clock,
            endDate,
            startDate,
        });
        let prepared = emptyPreparedAllocationData;
        let syncWarnings: string[] = [];

        try {
            const { assets } = this.deps.reader.readPreparationContext({
                assetIds,
                endDate: effectiveDateRange.endDate,
                startDate: effectiveDateRange.startDate,
            });
            this.assertAllAssetsPresent(assetIds, assets);

            if (!this.shouldSkipInteractiveSync()) {
                const syncSummary = await this.deps.marketDataOrchestrator.ensure({
                    assetIds,
                    intent: 'allocation',
                    priority: 'interactive',
                    window: {
                        endDate: effectiveDateRange.endDate,
                        startDate: effectiveDateRange.startDate,
                    },
                });
                syncWarnings = syncSummary.warnings.map((warning) => warning.message);
            }

            prepared = prepareAllocationData({
                assets,
                baseCurrency,
                endDate: effectiveDateRange.endDate,
                reader: this.deps.reader,
                startDate: effectiveDateRange.startDate,
            });
            prepared = {
                ...prepared,
                warnings: [...syncWarnings, ...prepared.warnings],
            };

            return {
                calculationDateRange: resolveActualDateRange(prepared, effectiveDateRange),
                effectiveDateRange,
                ok: true,
                prepared,
            };
        } catch (error) {
            return {
                calculationDateRange: resolveActualDateRange(prepared, effectiveDateRange),
                error: classifyPreparationError(error),
                ok: false,
                prepared,
            };
        }
    }

    private assertAllAssetsPresent(assetIds: string[], assets: Array<{ id: string }>) {
        if (assets.length === assetIds.length) {
            return;
        }

        const foundIds = new Set(assets.map((asset) => asset.id));
        const missing = assetIds.filter((assetId) => !foundIds.has(assetId));
        throw new Error(`Missing assets for allocation: ${missing.join(', ')}`);
    }
}