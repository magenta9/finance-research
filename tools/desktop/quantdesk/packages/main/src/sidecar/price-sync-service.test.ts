import { describe, expect, test, vi } from 'vitest';

import type { DailyPriceRecord, StoredAsset } from '@quantdesk/shared';

import type { LoggerLike } from '../logger';
import { hasPriceCoverageThroughEndDate, resolvePriceWindow } from './price-sync-core';
import { PriceSyncService } from './price-sync-service';

const createLoggerStub = () => ({
    close: vi.fn(async () => undefined),
    error: vi.fn(),
    fatal: vi.fn(),
    getLogDirectory: vi.fn(() => null),
    info: vi.fn(),
    warn: vi.fn(),
    write: vi.fn(),
}) satisfies LoggerLike;

describe('PriceSyncService', () => {
    test('syncs only missing rows and writes reconciled prices', async () => {
        const asset: StoredAsset = {
            assetClass: 'equity',
            createdAt: '2026-04-15T00:00:00.000Z',
            currency: 'CNY',
            id: 'asset-159919',
            market: 'A',
            metadata: {},
            name: '沪深300ETF',
            symbol: '159919',
            tags: [],
            updatedAt: '2026-04-15T00:00:00.000Z',
        };
        const prices: DailyPriceRecord[] = [{
            adjustedClose: 10,
            assetId: asset.id,
            close: 10,
            date: '2026-01-02',
            fetchedAt: '2026-01-03T00:00:00.000Z',
            high: 10.5,
            low: 9.5,
            open: 10.1,
            source: 'akshare',
            volume: 100,
        }];
        const service = new PriceSyncService({
            assets: { list: () => [asset] },
            fxRates: {
                getDateBounds: () => ({ earliestDate: null, latestDate: null }),
                getLatestRate: () => null,
                getRange: () => [],
                insertMany: () => undefined,
            },
            preferences: { get: () => 'true' },
            prices: {
                getDateBounds: () => ({ earliestDate: prices[0]?.date ?? null, latestDate: prices.at(-1)?.date ?? null }),
                getRange: ({ startDate, endDate }) => prices.filter((row) => row.date >= startDate && row.date <= endDate),
                insertMany: (rows) => {
                    for (const row of rows) {
                        prices.push({ ...row, fetchedAt: row.fetchedAt ?? '2026-01-04T00:00:00.000Z' });
                    }
                },
                isFresh: () => false,
            },
        }, {
            fetchFxRates: vi.fn(),
            fetchPrices: vi.fn(async () => ({
                attemptedSources: ['tushare'],
                prices: [{
                    adjusted_close: 11,
                    close: 11,
                    date: '2026-01-03',
                    high: 11.5,
                    low: 10.5,
                    open: 10.9,
                    source: 'tushare',
                    volume: 120,
                }],
                symbol: asset.symbol,
                warnings: [],
            })),
        } as never);

        const summary = await service.syncPrices({
            assetIds: [asset.id],
            endDate: '2026-01-03',
            startDate: '2026-01-02',
        });

        expect(summary.synchronizedAssetIds).toEqual([asset.id]);
        expect(summary.insertedRows).toBe(1);
        expect(prices.map((row) => row.date)).toEqual(['2026-01-02', '2026-01-03']);
    });

    test('passes non-empty futures metadata through to the sidecar', async () => {
        const asset: StoredAsset = {
            assetClass: 'commodity',
            createdAt: '2026-04-15T00:00:00.000Z',
            currency: 'CNY',
            id: 'asset-rb-main',
            market: 'COMMODITY',
            metadata: {
                contractType: 'dominant_continuous',
                instrumentType: 'futures',
                notes: 'local-only annotation',
                tsCodeAsset: 'FT',
                underlyingSymbol: 'RB',
            },
            name: '螺纹钢主连',
            symbol: 'RB9999',
            tags: [],
            updatedAt: '2026-04-15T00:00:00.000Z',
        };
        const fetchPrices = vi.fn(async () => ({
            attemptedSources: ['tushare'],
            prices: [{
                adjusted_close: null,
                close: 3210,
                date: '2026-01-02',
                high: 3230,
                low: 3190,
                open: 3200,
                source: 'tushare-futures-main',
                volume: 100,
            }],
            symbol: asset.symbol,
            warnings: [],
        }));
        const prices: DailyPriceRecord[] = [];
        const service = new PriceSyncService({
            assets: { list: () => [asset] },
            fxRates: {
                getDateBounds: () => ({ earliestDate: null, latestDate: null }),
                getLatestRate: () => null,
                getRange: () => [],
                insertMany: () => undefined,
            },
            preferences: { get: () => 'true' },
            prices: {
                getDateBounds: () => ({ earliestDate: prices[0]?.date ?? null, latestDate: prices.at(-1)?.date ?? null }),
                getRange: ({ startDate, endDate }) => prices.filter((row) => row.date >= startDate && row.date <= endDate),
                insertMany: (rows) => {
                    prices.push(...rows.map((row) => ({ ...row, fetchedAt: row.fetchedAt ?? '2026-01-03T00:00:00.000Z' })));
                },
                isFresh: () => false,
            },
        }, {
            fetchFxRates: vi.fn(),
            fetchPrices,
        } as never);

        await service.syncPrices({
            assetIds: [asset.id],
            endDate: '2026-01-02',
            startDate: '2026-01-02',
        });

        expect(fetchPrices).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-rb-main',
            assetMetadata: {
                contractType: 'dominant_continuous',
                instrumentType: 'futures',
                tsCodeAsset: 'FT',
                underlyingSymbol: 'RB',
            },
            enabledSources: ['tushare', 'akshare'],
            market: 'COMMODITY',
            symbol: 'RB9999',
        }));
        expect(prices).toEqual([expect.objectContaining({
            adjustedClose: null,
            close: 3210,
            date: '2026-01-02',
            high: 3230,
            low: 3190,
            open: 3200,
            source: 'tushare-futures-main',
            volume: 100,
        })]);
    });

    test('logs raw futures main-continuous notices at info level after successful sync', async () => {
        const asset: StoredAsset = {
            assetClass: 'commodity',
            createdAt: '2026-04-15T00:00:00.000Z',
            currency: 'CNY',
            id: 'asset-rb-main',
            market: 'COMMODITY',
            metadata: {
                contractType: 'dominant_continuous',
                instrumentType: 'futures',
                tsCodeAsset: 'FT',
                underlyingSymbol: 'RB',
            },
            name: '螺纹钢主连',
            symbol: 'RB9999',
            tags: [],
            updatedAt: '2026-04-15T00:00:00.000Z',
        };
        const prices: DailyPriceRecord[] = [];
        const logger = createLoggerStub();
        const rawNotice = 'TuShare futures main contract series for RB9999 is raw continuous and not back-adjusted; returns and volatility may include roll jumps.';
        const service = new PriceSyncService({
            assets: { list: () => [asset] },
            fxRates: {
                getDateBounds: () => ({ earliestDate: null, latestDate: null }),
                getLatestRate: () => null,
                getRange: () => [],
                insertMany: () => undefined,
            },
            preferences: { get: () => 'true' },
            prices: {
                getDateBounds: () => ({ earliestDate: prices[0]?.date ?? null, latestDate: prices.at(-1)?.date ?? null }),
                getRange: ({ startDate, endDate }) => prices.filter((row) => row.date >= startDate && row.date <= endDate),
                insertMany: (rows) => {
                    prices.push(...rows.map((row) => ({ ...row, fetchedAt: row.fetchedAt ?? '2026-01-03T00:00:00.000Z' })));
                },
                isFresh: () => false,
            },
        }, {
            fetchFxRates: vi.fn(),
            fetchPrices: vi.fn(async () => ({
                attemptedSources: ['tushare'],
                prices: [{
                    adjusted_close: null,
                    close: 3210,
                    date: '2026-01-02',
                    high: 3230,
                    low: 3190,
                    open: 3200,
                    source: 'tushare-futures-main',
                    volume: 100,
                }],
                symbol: asset.symbol,
                warnings: [rawNotice],
            })),
        } as never, undefined, logger);

        const summary = await service.syncPrices({
            assetIds: [asset.id],
            endDate: '2026-01-02',
            startDate: '2026-01-02',
        });

        expect(summary.warnings.map((warning) => warning.message)).toContain(rawNotice);
        expect(logger.warn).not.toHaveBeenCalledWith('main', 'market_sync_warning', expect.anything());
        expect(logger.info).toHaveBeenCalledWith('main', 'market_sync_completed', expect.objectContaining({
            outcome: 'warning',
            symbolOrPair: 'RB9999',
            warnings: [rawNotice],
        }));
    });

    test('resolvePriceWindow requires full-window coverage and refuses fresh-but-left-truncated caches', () => {
        // 缓存从 2025-01-01 到 2026-04-15（约 470 天新鲜数据），
        // 但用户切到 5Y 请求 [2021-04-16, 2026-04-15]，不能被误判为已覆盖。
        const prices = {
            getDateBounds: () => ({ earliestDate: '2025-01-01', latestDate: '2026-04-15' }),
            getRange: ({ startDate, endDate }: { startDate: string; endDate: string }) => (
                startDate <= '2026-04-15' && endDate >= '2026-04-15'
                    ? [{ date: '2026-04-15' }] as never
                    : [] as never
            ),
            isFresh: () => true,
        };

        const window = resolvePriceWindow({
            assetId: 'asset-510300',
            endDate: '2026-04-15',
            forceRefresh: false,
            maxAgeHours: 18,
            prices,
            startDate: '2021-04-16',
        });

        expect(window.shouldSync).toBe(true);
        expect(window.isRangeCovered).toBe(false);
        expect(window.fetchStartDate).toBe('2021-04-16');
    });

    test('resolvePriceWindow still skips when cache covers the full requested window', () => {
        const prices = {
            getDateBounds: () => ({ earliestDate: '2021-04-16', latestDate: '2026-04-15' }),
            getRange: () => [{ date: '2026-04-15' }] as never,
            isFresh: () => true,
        };

        const window = resolvePriceWindow({
            assetId: 'asset-510300',
            endDate: '2026-04-15',
            forceRefresh: false,
            maxAgeHours: 18,
            prices,
            startDate: '2021-04-16',
        });

        expect(window.shouldSync).toBe(false);
        expect(window.isRangeCovered).toBe(true);
    });

    test('allows current-day domestic market lag without relaxing non-domestic price lag', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

        try {
            const navPrices = {
                getDateBounds: () => ({ earliestDate: '2026-04-01', latestDate: '2026-04-29' }),
                getRange: () => [{ date: '2026-04-29', source: 'akshare-nav' }] as never,
            };
            const domesticPrices = {
                getDateBounds: () => ({ earliestDate: '2026-04-01', latestDate: '2026-04-30' }),
                getRange: () => [{ date: '2026-04-30', source: 'akshare' }] as never,
            };
            const nonDomesticPrices = {
                getDateBounds: () => ({ earliestDate: '2026-04-01', latestDate: '2026-04-29' }),
                getRange: () => [{ date: '2026-04-29', source: 'yfinance' }] as never,
            };

            expect(hasPriceCoverageThroughEndDate({
                assetId: 'asset-000369',
                endDate: '2026-05-05',
                prices: navPrices,
            })).toBe(true);
            expect(hasPriceCoverageThroughEndDate({
                asset: { assetClass: 'equity', market: 'A' },
                assetId: 'asset-159740',
                endDate: '2026-05-05',
                prices: domesticPrices,
            })).toBe(true);
            expect(hasPriceCoverageThroughEndDate({
                asset: { assetClass: 'equity', market: 'US' },
                assetId: 'asset-spy',
                endDate: '2026-05-05',
                prices: nonDomesticPrices,
            })).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    test('uses fresh current-day FX cache without stale warning when providers have no newer row yet', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));

        try {
            const fetchFxRates = vi.fn(async () => ({
                attemptedSources: ['akshare', 'yfinance', 'frankfurter'],
                pair: 'HKD/CNY',
                rates: [],
                warnings: [],
            }));
            const service = new PriceSyncService({
                assets: { list: () => [] },
                fxRates: {
                    getDateBounds: () => ({ earliestDate: '2026-05-01', latestDate: '2026-05-07' }),
                    getLatestRate: () => ({
                        date: '2026-05-07',
                        pair: 'HKD/CNY',
                        rate: 0.92,
                        source: 'akshare',
                    }),
                    getRange: () => [],
                    insertMany: vi.fn(),
                },
                preferences: { get: () => 'true' },
                prices: {
                    getDateBounds: () => ({ earliestDate: null, latestDate: null }),
                    getRange: () => [],
                    insertMany: () => undefined,
                    isFresh: () => false,
                },
            }, {
                fetchFxRates,
                fetchPrices: vi.fn(),
            } as never);

            const summary = await service.syncFxRates(['HKD/CNY'], '2026-05-01', '2026-05-08');

            expect(fetchFxRates).not.toHaveBeenCalled();
            expect(summary.insertedRows).toBe(0);
            expect(summary.warnings).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    test('keeps stale FX warning when cached rate is outside current-day lag', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));

        try {
            const service = new PriceSyncService({
                assets: { list: () => [] },
                fxRates: {
                    getDateBounds: () => ({ earliestDate: '2026-05-01', latestDate: '2026-05-01' }),
                    getLatestRate: () => ({
                        date: '2026-05-01',
                        pair: 'HKD/CNY',
                        rate: 0.92,
                        source: 'akshare',
                    }),
                    getRange: () => [],
                    insertMany: vi.fn(),
                },
                preferences: { get: () => 'true' },
                prices: {
                    getDateBounds: () => ({ earliestDate: null, latestDate: null }),
                    getRange: () => [],
                    insertMany: () => undefined,
                    isFresh: () => false,
                },
            }, {
                fetchFxRates: vi.fn(async () => ({
                    attemptedSources: ['akshare', 'yfinance', 'frankfurter'],
                    pair: 'HKD/CNY',
                    rates: [],
                    warnings: [],
                })),
                fetchPrices: vi.fn(),
            } as never);

            const summary = await service.syncFxRates(['HKD/CNY'], '2026-05-01', '2026-05-08');

            expect(summary.warnings).toEqual([
                expect.objectContaining({
                    code: 'STALE_FX_CACHE_USED',
                    message: 'Using stale cached FX rates for HKD/CNY; remote providers returned no new rows.',
                }),
            ]);
        } finally {
            vi.useRealTimers();
        }
    });

    test('syncs A-market ETF when latest real row falls inside current holiday lag', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));

        try {
            const asset: StoredAsset = {
                assetClass: 'equity',
                createdAt: '2026-04-15T00:00:00.000Z',
                currency: 'CNY',
                id: 'asset-159740',
                market: 'A',
                metadata: {},
                name: '恒生科技ETF',
                symbol: '159740',
                tags: [],
                updatedAt: '2026-04-15T00:00:00.000Z',
            };
            const prices: DailyPriceRecord[] = [];
            const service = new PriceSyncService({
                assets: { list: () => [asset] },
                fxRates: {
                    getDateBounds: () => ({ earliestDate: null, latestDate: null }),
                    getLatestRate: () => null,
                    getRange: () => [],
                    insertMany: () => undefined,
                },
                preferences: { get: () => 'true' },
                prices: {
                    getDateBounds: () => ({ earliestDate: prices[0]?.date ?? null, latestDate: prices.at(-1)?.date ?? null }),
                    getRange: ({ startDate, endDate }) => prices.filter((row) => row.date >= startDate && row.date <= endDate),
                    insertMany: (rows) => {
                        for (const row of rows) {
                            prices.push({ ...row, fetchedAt: row.fetchedAt ?? '2026-05-05T12:00:00.000Z' });
                        }
                    },
                    isFresh: () => false,
                },
            }, {
                fetchFxRates: vi.fn(),
                fetchPrices: vi.fn(async () => ({
                    attemptedSources: ['akshare'],
                    prices: [{
                        adjusted_close: 6.18,
                        close: 6.18,
                        date: '2026-04-30',
                        high: 6.2,
                        low: 6.1,
                        open: 6.12,
                        source: 'akshare',
                        volume: 120_000,
                    }],
                    symbol: asset.symbol,
                    warnings: [],
                })),
            } as never);

            const summary = await service.syncPrices({
                assetIds: [asset.id],
                endDate: '2026-05-05',
                startDate: '2026-04-30',
            });

            expect(summary.synchronizedAssetIds).toEqual([asset.id]);
            expect(summary.insertedRows).toBe(1);
            expect(prices.map((row) => row.date)).toEqual(['2026-04-30']);
        } finally {
            vi.useRealTimers();
        }
    });
});
