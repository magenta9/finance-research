import type { DailyPriceRecord, FxRateRecord, StoredAsset } from '@quantdesk/shared';

const fixtureTimestamp = '2026-04-11T00:00:00.000Z';

export const buildDate = (index: number, start = '2024-01-01') => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
};

export const buildDateRange = (length: number, start = '2024-01-01') =>
    Array.from({ length }, (_, index) => buildDate(index, start));

export const buildAsset = (
    id: string,
    symbol: string,
    assetClass: StoredAsset['assetClass'],
    options: {
        currency?: StoredAsset['currency'];
        market?: StoredAsset['market'];
        metadata?: StoredAsset['metadata'];
        name?: string;
        tags?: string[];
    } = {},
): StoredAsset => {
    const currency = options.currency ?? 'USD';

    return {
        assetClass,
        createdAt: fixtureTimestamp,
        currency,
        id,
        market: options.market ?? (currency === 'CNY' ? 'A' : 'US'),
        metadata: options.metadata ?? {},
        name: options.name ?? symbol,
        symbol,
        tags: options.tags ?? [],
        updatedAt: fixtureTimestamp,
    };
};

export const buildPriceRows = ({
    assetId,
    basePrice,
    length,
    startDate = '2024-01-01',
    step = 0.25,
    source = 'fixture',
}: {
    assetId: string;
    basePrice: number;
    length: number;
    startDate?: string;
    step?: number;
    source?: string;
}): DailyPriceRecord[] =>
    Array.from({ length }, (_, index) => {
        const close = Number((basePrice + index * step).toFixed(4));

        return {
            adjustedClose: close,
            assetId,
            close,
            date: buildDate(index, startDate),
            fetchedAt: fixtureTimestamp,
            high: close * 1.01,
            low: close * 0.99,
            open: close * 0.995,
            source,
            volume: 100_000 + index,
        };
    });

export const buildFxRateRows = ({
    pair,
    rate,
    length,
    startDate = '2024-01-01',
    source = 'fixture',
}: {
    pair: string;
    rate: number;
    length: number;
    startDate?: string;
    source?: string;
}): FxRateRecord[] =>
    Array.from({ length }, (_, index) => ({
        date: buildDate(index, startDate),
        pair,
        rate,
        source,
    }));

export const getLatestFxRate = (
    fxRatesByPair: Record<string, FxRateRecord[]>,
    pair: string,
    onOrBeforeDate: string,
) => [...(fxRatesByPair[pair] ?? [])]
    .filter((row) => row.date <= onOrBeforeDate)
    .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;