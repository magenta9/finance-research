import { describe, expect, test } from 'vitest';

import type { DailyPriceRecord } from '@quantdesk/shared';

import { reconcilePricesWithCache } from './price-sync-service';

describe('price cache reconciliation', () => {
    test('keeps existing row when incoming cannot improve it', () => {
        const existing: DailyPriceRecord = {
            adjustedClose: 10,
            assetId: 'asset-1',
            close: 10,
            date: '2026-01-02',
            fetchedAt: '2026-01-03T00:00:00.000Z',
            high: 10.5,
            low: 9.5,
            open: 10.1,
            source: 'tushare',
            volume: 100,
        };
        const rows = reconcilePricesWithCache({
            assetId: 'asset-1',
            incomingRows: [{
                adjustedClose: 10,
                assetId: 'asset-1',
                close: 10,
                date: '2026-01-02',
                fetchedAt: '2026-01-04T00:00:00.000Z',
                high: null,
                low: null,
                open: null,
                source: 'yfinance-derived',
                volume: null,
            }],
            market: 'A',
            prices: {
                getRange: () => [existing],
            },
        });

        expect(rows).toEqual([]);
    });

    test('writes a merged row when cached data gains missing same-source fields', () => {
        const existing: DailyPriceRecord = {
            adjustedClose: 10,
            assetId: 'asset-1',
            close: 10,
            date: '2026-01-02',
            fetchedAt: '2026-01-03T00:00:00.000Z',
            high: null,
            low: 9,
            open: null,
            source: 'akshare',
            volume: null,
        };
        const rows = reconcilePricesWithCache({
            assetId: 'asset-1',
            incomingRows: [{
                adjustedClose: 10,
                assetId: 'asset-1',
                close: 10,
                date: '2026-01-02',
                fetchedAt: '2026-01-04T00:00:00.000Z',
                high: 10.5,
                low: null,
                open: 10.1,
                source: 'akshare',
                volume: null,
            }],
            market: 'A',
            prices: {
                getRange: () => [existing],
            },
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            adjustedClose: 10,
            assetId: 'asset-1',
            close: 10,
            date: '2026-01-02',
            fetchedAt: '2026-01-04T00:00:00.000Z',
            high: 10.5,
            low: 9,
            open: 10.1,
            source: 'akshare',
        });
    });

    test('returns unseen incoming dates for insertion', () => {
        const rows = reconcilePricesWithCache({
            assetId: 'asset-1',
            incomingRows: [{
                adjustedClose: 11,
                assetId: 'asset-1',
                close: 11,
                date: '2026-01-03',
                fetchedAt: '2026-01-04T00:00:00.000Z',
                high: 11.5,
                low: 10.5,
                open: 10.8,
                source: 'akshare',
                volume: 120,
            }],
            market: 'A',
            prices: {
                getRange: () => [],
            },
        });

        expect(rows).toEqual([
            expect.objectContaining({
                adjustedClose: 11,
                assetId: 'asset-1',
                close: 11,
                date: '2026-01-03',
                source: 'akshare',
            }),
        ]);
    });
});