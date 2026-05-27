import { describe, expect, test } from 'vitest';

import type { DailyPriceRecord, StoredAsset } from '@quantdesk/shared';

import { searchPricePatternAnalogs } from './search';

const buildAsset = (overrides: Partial<StoredAsset>): StoredAsset => ({
    assetClass: overrides.assetClass ?? 'equity',
    createdAt: '2026-05-08T00:00:00.000Z',
    currency: overrides.currency ?? 'USD',
    id: overrides.id ?? `asset-${overrides.symbol ?? 'SPY'}`,
    market: overrides.market ?? 'US',
    metadata: {},
    name: overrides.name ?? overrides.symbol ?? 'SPY',
    symbol: overrides.symbol ?? 'SPY',
    tags: [],
    updatedAt: '2026-05-08T00:00:00.000Z',
});

const buildDates = (count: number, startDate = '2025-01-01') => {
    const dates: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);

    for (let index = 0; index < count; index += 1) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
};

const pattern = (length: number, base = 100) => Array.from({ length }, (_, index) => (
    base * Math.exp((index / length) * 0.08 + Math.sin(index / 7) * 0.035)
));

const buildPrices = (values: number[], assetId: string, startDate = '2025-01-01'): DailyPriceRecord[] => {
    const dates = buildDates(values.length, startDate);

    return values.map((value, index) => ({
        adjustedClose: value,
        assetId,
        close: value,
        date: dates[index],
        fetchedAt: '2026-05-08T00:00:00.000Z',
        high: null,
        low: null,
        open: null,
        source: 'test',
        volume: null,
    }));
};

describe('searchPricePatternAnalogs', () => {
    test('finds same-market same-class analogs and dedupes overlapping local windows', () => {
        const target = buildAsset({ id: 'asset-target', symbol: 'SPY' });
        const peer = buildAsset({ id: 'asset-peer', symbol: 'QQQ' });
        const otherMarket = buildAsset({ id: 'asset-other-market', market: 'A', symbol: '510300' });
        const targetPattern = pattern(60, 130);
        const selfHistory = [
            ...pattern(60, 90),
            ...Array.from({ length: 100 }, (_, index) => 98 + index * 0.1),
            ...targetPattern,
        ];
        const peerHistory = [
            ...Array.from({ length: 30 }, (_, index) => 80 + index * 0.05),
            ...pattern(60, 92),
            ...Array.from({ length: 150 }, (_, index) => 98 + index * 0.08),
        ];
        const prices = new Map([
            [target.id, buildPrices(selfHistory, target.id)],
            [peer.id, buildPrices(peerHistory, peer.id)],
            [otherMarket.id, buildPrices(peerHistory, otherMarket.id)],
        ]);
        const targetRows = prices.get(target.id)!;
        const result = searchPricePatternAnalogs({
            dependencies: {
                assetRepository: { list: () => [target, peer, otherMarket] },
                priceRepository: { listByAsset: (assetId) => prices.get(assetId) ?? [] },
            },
            request: {
                assetId: target.id,
                endDate: targetRows.at(-1)!.date,
                startDate: targetRows[targetRows.length - 60].date,
                window: '3M',
            },
        });

        expect(result.status).not.toBe('unavailable');
        expect(result.query.tradingDays).toBe(60);
        expect(result.candidateSummary.comparableAssetCount).toBe(2);
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.results.every((analog) => analog.asset.market === 'US')).toBe(true);
        expect(result.results.every((analog) => analog.forward['1M'].status === 'complete')).toBe(true);
        expect(result.results.every((analog) => analog.forward['3M'].status === 'complete')).toBe(true);
        expect(result.results.every((analog) => analog.forwardPaths['3M']?.length === 63)).toBe(true);
    });

    test('returns unavailable instead of inventing analogs when forward coverage is insufficient', () => {
        const target = buildAsset({ id: 'asset-target', symbol: 'SPY' });
        const peer = buildAsset({ id: 'asset-peer', symbol: 'QQQ' });
        const targetRows = buildPrices([...pattern(60, 90), ...pattern(60, 130)], target.id);
        const peerRows = buildPrices(pattern(70, 92), peer.id);
        const prices = new Map([
            [target.id, targetRows],
            [peer.id, peerRows],
        ]);

        const result = searchPricePatternAnalogs({
            dependencies: {
                assetRepository: { list: () => [target, peer] },
                priceRepository: { listByAsset: (assetId) => prices.get(assetId) ?? [] },
            },
            request: {
                assetId: target.id,
                endDate: targetRows.at(-1)!.date,
                startDate: targetRows[targetRows.length - 60].date,
                window: '3M',
            },
        });

        expect(result.status).toBe('unavailable');
        expect(result.results).toHaveLength(0);
        expect(result.warnings).toContain('no_high_quality_analogs');
    });

    test('scans candidate windows with a five-trading-day stride', () => {
        const target = buildAsset({ id: 'asset-target', symbol: 'SPY' });
        const peer = buildAsset({ id: 'asset-peer', symbol: 'QQQ' });
        const targetRows = buildPrices([...pattern(60, 90), ...pattern(60, 130)], target.id);
        const peerRows = buildPrices([...pattern(60, 92), ...Array.from({ length: 140 }, (_, index) => 100 + index * 0.04)], peer.id);
        const prices = new Map([
            [target.id, targetRows],
            [peer.id, peerRows],
        ]);

        const result = searchPricePatternAnalogs({
            dependencies: {
                assetRepository: { list: () => [target, peer] },
                priceRepository: { listByAsset: (assetId) => prices.get(assetId) ?? [] },
            },
            request: {
                assetId: target.id,
                endDate: targetRows.at(-1)!.date,
                startDate: targetRows[targetRows.length - 60].date,
                window: '3M',
            },
        });

        expect(result.candidateSummary.rawWindowCount).toBe(42);
    });

    test('rejects request ranges that exceed the strict selected window scale', () => {
        const target = buildAsset({ id: 'asset-target', symbol: 'SPY' });
        const targetRows = buildPrices(pattern(220, 100), target.id);

        const result = searchPricePatternAnalogs({
            dependencies: {
                assetRepository: { list: () => [target] },
                priceRepository: { listByAsset: () => targetRows },
            },
            request: {
                assetId: target.id,
                endDate: targetRows.at(-1)!.date,
                startDate: targetRows[0].date,
                window: '3M',
            },
        });

        expect(result.status).toBe('unavailable');
        expect(result.warnings).toContain('target_window_exceeds_supported_scale');
    });
});