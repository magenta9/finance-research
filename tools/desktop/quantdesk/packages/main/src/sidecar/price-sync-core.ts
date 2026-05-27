import type {
    DailyPriceInput,
    DailyPriceRecord,
    FxRateInput,
    FxRateRecord,
    StoredAsset,
    SyncWarning,
} from '@quantdesk/shared';
import { shiftIsoDateByDays } from '@quantdesk/shared/date-utils';

import {
    allIsoDatesMatch,
    currentIsoDate,
    isoDayGap,
    isWeekendIsoDate,
    nextIsoDate,
} from './date-utils';
import { getSourcePriority } from './provider-config';
import type { PriceSyncDeps, SyncWindow } from './price-sync-types';

const MAX_CURRENT_DAY_PRICE_LAG_DAYS = 4;
const MAX_CURRENT_DAY_NAV_LAG_DAYS = 7;
const MAX_CURRENT_DAY_DOMESTIC_PRICE_LAG_DAYS = 7;
const MAX_CURRENT_DAY_FX_LAG_DAYS = 4;
export const DEFAULT_PRICE_MAX_AGE_HOURS = 18;
const PRICE_VALUE_FIELDS: Array<keyof DailyPriceInput> = ['open', 'high', 'low', 'close', 'adjustedClose'];
type PriceCoverageAsset = Pick<StoredAsset, 'assetClass' | 'market'>;

const domesticMarkets = new Set(['A', 'BOND', 'COMMODITY']);

const isDomesticMarketAsset = (asset: PriceCoverageAsset | undefined) => asset !== undefined && domesticMarkets.has(asset.market);

export const mergeSyncWindow = (
    current: SyncWindow | undefined,
    incoming: SyncWindow,
): SyncWindow => ({
    endDate: current ? (current.endDate > incoming.endDate ? current.endDate : incoming.endDate) : incoming.endDate,
    startDate: current
        ? current.startDate < incoming.startDate
            ? current.startDate
            : incoming.startDate
        : incoming.startDate,
});

export const createWarning = (
    code: SyncWarning['code'],
    kind: SyncWarning['kind'],
    target: string,
    message: string,
    attemptedSources: string[],
): SyncWarning => ({
    code,
    kind,
    target,
    message,
    attemptedSources,
});

export const dedupeWarnings = (warnings: SyncWarning[]) => {
    const seen = new Set<string>();
    return warnings.filter((warning) => {
        const key = `${warning.code}:${warning.kind}:${warning.target}:${warning.message}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

const nonNullEntries = <T extends object>(input: T) =>
    Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== null && value !== undefined),
    ) as Partial<T>;

export const isFilledBy = (
    existing: DailyPriceInput | DailyPriceRecord,
    incoming: DailyPriceInput,
) => {
    for (const field of PRICE_VALUE_FIELDS) {
        if (existing[field] == null && incoming[field] != null) {
            return true;
        }
    }

    return false;
};

export const priceCompleteness = (row: DailyPriceInput | DailyPriceRecord) => {
    let completeness = 0;

    for (const field of PRICE_VALUE_FIELDS) {
        if (row[field] != null) {
            completeness += 1;
        }
    }

    return completeness;
};

export const choosePriceRow = (
    existing: DailyPriceRecord,
    incoming: DailyPriceInput,
    market: string,
) => {
    const existingPriority = getSourcePriority({ kind: 'price', market, source: existing.source });
    const incomingPriority = getSourcePriority({ kind: 'price', market, source: incoming.source });

    if (incomingPriority > existingPriority) {
        return incoming;
    }

    if (incomingPriority < existingPriority) {
        return existing;
    }

    if (incoming.source === existing.source) {
        return {
            ...existing,
            ...nonNullEntries(incoming),
            fetchedAt: incoming.fetchedAt ?? existing.fetchedAt,
        };
    }

    const existingCompleteness = priceCompleteness(existing);
    const incomingCompleteness = priceCompleteness(incoming);
    const fillsExistingRow = isFilledBy(existing, incoming);

    if (incomingCompleteness > existingCompleteness) {
        return incoming;
    }

    if (incomingCompleteness < existingCompleteness && !fillsExistingRow) {
        return existing;
    }

    if (fillsExistingRow) {
        return {
            ...existing,
            ...nonNullEntries(incoming),
            fetchedAt: incoming.fetchedAt ?? existing.fetchedAt,
            source: existing.source,
        };
    }

    return existing;
};

export const chooseFxRow = (existing: FxRateRecord, incoming: FxRateInput) => {
    const existingPriority = getSourcePriority({ kind: 'fx', source: existing.source });
    const incomingPriority = getSourcePriority({ kind: 'fx', source: incoming.source });

    if (incomingPriority > existingPriority) {
        return incoming;
    }

    if (incomingPriority < existingPriority) {
        return existing;
    }

    if (incoming.source === existing.source) {
        return incoming;
    }

    return existing;
};

export const reconcilePricesWithCache = ({
    assetId,
    incomingRows,
    market,
    prices,
}: {
    assetId: string;
    incomingRows: DailyPriceInput[];
    market: string;
    prices: Pick<PriceSyncDeps['prices'], 'getRange'>;
}) => {
    if (incomingRows.length === 0) {
        return [] as DailyPriceInput[];
    }

    const existingRows = prices.getRange({
        assetId,
        endDate: incomingRows.at(-1)?.date ?? incomingRows[0].date,
        startDate: incomingRows[0].date,
    });
    const existingByDate = new Map(existingRows.map((row) => [row.date, row]));
    const rowsToWrite: DailyPriceInput[] = [];

    for (const incoming of incomingRows) {
        const existing = existingByDate.get(incoming.date);
        if (!existing) {
            rowsToWrite.push(incoming);
            continue;
        }

        const chosen = choosePriceRow(existing, incoming, market);
        if (chosen !== existing) {
            rowsToWrite.push(chosen);
        }
    }

    return rowsToWrite;
};

export const reconcileFxWithCache = ({
    fxRates,
    incomingRows,
    pair,
}: {
    fxRates: Pick<PriceSyncDeps['fxRates'], 'getRange'>;
    incomingRows: FxRateInput[];
    pair: string;
}) => {
    if (incomingRows.length === 0) {
        return [] as FxRateInput[];
    }

    const existingRows = fxRates.getRange(
        pair,
        incomingRows[0].date,
        incomingRows.at(-1)?.date ?? incomingRows[0].date,
    );
    const existingByDate = new Map(existingRows.map((row) => [row.date, row]));
    const rowsToWrite: FxRateInput[] = [];

    for (const incoming of incomingRows) {
        const existing = existingByDate.get(incoming.date);
        if (!existing) {
            rowsToWrite.push(incoming);
            continue;
        }

        const chosen = chooseFxRow(existing, incoming);
        if (chosen !== existing) {
            rowsToWrite.push(chosen);
        }
    }

    return rowsToWrite;
};

export const hasPriceCoverageThroughEndDate = ({
    asset,
    assetId,
    endDate,
    prices,
}: {
    asset?: PriceCoverageAsset;
    assetId: string;
    endDate: string;
    prices: Pick<PriceSyncDeps['prices'], 'getDateBounds' | 'getRange'>;
}) => {
    const bounds = prices.getDateBounds(assetId);

    if (bounds.earliestDate == null || bounds.latestDate == null) {
        return false;
    }

    const rows = prices.getRange({
        assetId,
        endDate,
        startDate: bounds.latestDate,
    });

    if (rows.length === 0) {
        return false;
    }

    const lastRow = rows.at(-1);
    const lastObservedDate = lastRow?.date;

    if (!lastObservedDate) {
        return false;
    }

    const maxCurrentDayLagDays = lastRow?.source === 'akshare-nav'
        ? MAX_CURRENT_DAY_NAV_LAG_DAYS
        : isDomesticMarketAsset(asset)
            ? MAX_CURRENT_DAY_DOMESTIC_PRICE_LAG_DAYS
            : MAX_CURRENT_DAY_PRICE_LAG_DAYS;

    return lastObservedDate >= endDate
        || allIsoDatesMatch(nextIsoDate(lastObservedDate), endDate, isWeekendIsoDate)
        || (endDate === currentIsoDate() && isoDayGap(endDate, lastObservedDate) <= maxCurrentDayLagDays);
};

export const hasPriceCoverageForWindow = ({
    asset,
    assetId,
    startDate,
    endDate,
    prices,
}: {
    asset?: PriceCoverageAsset;
    assetId: string;
    startDate: string;
    endDate: string;
    prices: Pick<PriceSyncDeps['prices'], 'getDateBounds' | 'getRange'>;
}) => {
    const bounds = prices.getDateBounds(assetId);
    if (bounds.earliestDate == null) {
        return false;
    }
    // 允许左侧缺口仅由周末组成（与 hasPriceCoverageThroughEndDate 的尾部容忍一致）
    const leftCovered = bounds.earliestDate <= startDate
        || allIsoDatesMatch(startDate, shiftIsoDateByDays(bounds.earliestDate, -1), isWeekendIsoDate);
    if (!leftCovered) {
        return false;
    }
    return hasPriceCoverageThroughEndDate({ asset, assetId, endDate, prices });
};

export const resolvePriceWindow = ({
    asset,
    assetId,
    startDate,
    endDate,
    maxAgeHours,
    forceRefresh,
    prices,
}: {
    asset?: PriceCoverageAsset;
    assetId: string;
    startDate: string;
    endDate: string;
    maxAgeHours: number;
    forceRefresh: boolean;
    prices: Pick<PriceSyncDeps['prices'], 'getDateBounds' | 'getRange' | 'isFresh'>;
}) => {
    const isFresh = prices.isFresh({ assetId, maxAgeHours });
    const bounds = prices.getDateBounds(assetId);
    const isRangeCovered = hasPriceCoverageForWindow({ asset, assetId, startDate, endDate, prices });

    if (isFresh && isRangeCovered && !forceRefresh) {
        return { fetchStartDate: startDate, isRangeCovered, shouldSync: false };
    }

    // 仅当整体窗口都已在缓存内、只是尾部需要续新时，才做尾部增量同步
    const hasLeftCoverage = bounds.earliestDate != null
        && (bounds.earliestDate <= startDate
            || allIsoDatesMatch(startDate, shiftIsoDateByDays(bounds.earliestDate, -1), isWeekendIsoDate));
    if (
        isFresh
        && !forceRefresh
        && hasLeftCoverage
        && bounds.latestDate != null
        && bounds.latestDate >= startDate
        && bounds.latestDate < endDate
    ) {
        return {
            fetchStartDate: nextIsoDate(bounds.latestDate),
            isRangeCovered,
            shouldSync: true,
        };
    }

    return { fetchStartDate: startDate, isRangeCovered, shouldSync: true };
};

export const buildFxSyncWindowsFromAssetPrices = ({
    assets,
    startDate,
    endDate,
    prices,
}: {
    assets: StoredAsset[];
    startDate: string;
    endDate: string;
    prices: Pick<PriceSyncDeps['prices'], 'getRange'>;
}) => {
    const windows = new Map<string, SyncWindow>();

    for (const asset of assets) {
        if (asset.currency === 'CNY') {
            continue;
        }

        const priceRows = prices.getRange({
            assetId: asset.id,
            endDate,
            startDate,
        });

        if (priceRows.length === 0) {
            continue;
        }

        const pair = `${asset.currency}/CNY`;
        windows.set(pair, mergeSyncWindow(windows.get(pair), {
            endDate: priceRows.at(-1)?.date ?? priceRows[0].date,
            startDate: priceRows[0].date,
        }));
    }

    return windows;
};

export const hasFxCoverage = ({
    pair,
    startDate,
    endDate,
    fxRates,
}: {
    pair: string;
    startDate: string;
    endDate: string;
    fxRates: Pick<PriceSyncDeps['fxRates'], 'getDateBounds'>;
}) => {
    const bounds = fxRates.getDateBounds(pair);
    if (
        bounds.earliestDate == null
        || bounds.latestDate == null
        || bounds.earliestDate > startDate
    ) {
        return false;
    }

    return bounds.latestDate >= endDate
        || allIsoDatesMatch(nextIsoDate(bounds.latestDate), endDate, isWeekendIsoDate)
        || (endDate === currentIsoDate() && isoDayGap(endDate, bounds.latestDate) <= MAX_CURRENT_DAY_FX_LAG_DAYS);
};
