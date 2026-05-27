import { describe, expect, test, vi } from 'vitest';

import { preferenceKeys } from '../preferences/preference-keys';
import {
    buildMarketDataPriceRows,
    createInMemoryDataServices,
    createTestMarketDataOrchestrator,
    toSidecarPriceRows,
} from './market-data-test-support';
import type { SyncQueue } from './sync-queue';

describe('Market data orchestration', () => {
    test('requests only the missing fresh date range before syncing prices and FX rows', async () => {
        const { services } = createInMemoryDataServices();
        const call = vi.fn(async (method: string, params?: unknown) => {
            if (method === 'fetch_prices') {
                const request = params as {
                    end: string;
                    market: string;
                    start: string;
                    symbol: string;
                };

                if (
                    request.end === '2026-01-05'
                    && request.market === 'US'
                    && request.start === '2026-01-04'
                    && request.symbol === 'SPY'
                ) {
                    return {
                        attemptedSources: ['yfinance'],
                        prices: [
                            {
                                adjusted_close: 589,
                                close: 589,
                                date: '2026-01-04',
                                high: 590,
                                low: 587,
                                open: 588,
                                source: 'yfinance-test',
                                volume: 117_000_000,
                            },
                            {
                                adjusted_close: 592,
                                close: 592,
                                date: '2026-01-05',
                                high: 593,
                                low: 590,
                                open: 591,
                                source: 'yfinance-test',
                                volume: 116_000_000,
                            },
                        ],
                        symbol: 'SPY',
                        warnings: [],
                    };
                }
            }

            if (method === 'fetch_fx_rates') {
                const request = params as {
                    end: string;
                    pair: string;
                    start: string;
                };

                if (
                    request.end === '2026-01-05'
                    && request.pair === 'USD/CNY'
                    && request.start === '2026-01-02'
                ) {
                    return {
                        attemptedSources: ['yfinance', 'frankfurter'],
                        pair: 'USD/CNY',
                        rates: [
                            { date: '2026-01-02', rate: 7.11, source: 'fx-test' },
                            { date: '2026-01-03', rate: 7.12, source: 'fx-test' },
                            { date: '2026-01-04', rate: 7.13, source: 'fx-test' },
                            { date: '2026-01-05', rate: 7.14, source: 'fx-test' },
                        ],
                        warnings: [],
                    };
                }
            }

            throw new Error(`Unexpected RPC ${method} ${JSON.stringify(params)}`);
        });
        const marketDataService = createTestMarketDataOrchestrator({ call, services });

        services.repositories.assetRepository.create({
            assetClass: 'equity',
            currency: 'USD',
            id: 'asset-spy',
            market: 'US',
            metadata: {},
            name: 'SPDR S&P 500 ETF Trust',
            symbol: 'SPY',
            tags: ['core'],
        });

        const freshFetchedAt = new Date().toISOString();
        services.repositories.priceRepository.insertMany([
            {
                adjustedClose: 584,
                assetId: 'asset-spy',
                close: 584,
                date: '2026-01-02',
                fetchedAt: freshFetchedAt,
                high: 585,
                low: 579,
                open: 580,
                source: 'yfinance',
                volume: 120_000_000,
            },
            {
                adjustedClose: 588,
                assetId: 'asset-spy',
                close: 588,
                date: '2026-01-03',
                fetchedAt: freshFetchedAt,
                high: 589,
                low: 583,
                open: 584,
                source: 'yfinance',
                volume: 118_000_000,
            },
        ]);

        const summary = await marketDataService.syncPrices({
            assetIds: ['asset-spy'],
            endDate: '2026-01-05',
            startDate: '2026-01-02',
        });

        expect(call).toHaveBeenCalledWith('fetch_prices', {
            enabledSources: ['yfinance'],
            end: '2026-01-05',
            market: 'US',
            start: '2026-01-04',
            symbol: 'SPY',
        });
        expect(call).toHaveBeenCalledWith('fetch_fx_rates', {
            enabledSources: ['akshare', 'yfinance', 'frankfurter'],
            end: '2026-01-05',
            pair: 'USD/CNY',
            start: '2026-01-02',
        });
        expect(summary).toEqual({
            fxPairs: ['USD/CNY'],
            insertedRows: 2,
            skippedAssetIds: [],
            syncStatus: expect.objectContaining({
                activeTask: null,
                failedTasks: 0,
                queuedTasks: 0,
                running: false,
            }),
            synchronizedAssetIds: ['asset-spy'],
            warnings: [],
        });
        expect(
            services.repositories.priceRepository.listByAsset('asset-spy').map((row) => row.date),
        ).toEqual(['2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
        expect(services.repositories.fxRateRepository.getLatestRate('USD/CNY', '2026-01-05')).toEqual(
            expect.objectContaining({
                date: '2026-01-05',
                rate: 7.14,
                source: 'fx-test',
            }),
        );
    });

    test('accepts real price history when the requested start date lands before the first trading day', async () => {
        const { services } = createInMemoryDataServices();
        const call = vi.fn(async (method: string, params?: unknown) => {
            if (method !== 'fetch_prices') {
                throw new Error(`Unexpected RPC ${method} ${JSON.stringify(params)}`);
            }

            expect(params).toEqual({
                enabledSources: ['tushare', 'akshare'],
                end: '2026-01-11',
                market: 'A',
                start: '2026-01-01',
                symbol: '159253',
            });

            return {
                attemptedSources: ['tushare'],
                prices: toSidecarPriceRows(buildMarketDataPriceRows({
                    assetId: 'unused-sidecar-id',
                    dates: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'],
                })),
                symbol: '159919',
                warnings: ['TuShare used adjusted daily prices for 159919.'],
            };
        });
        const marketDataService = createTestMarketDataOrchestrator({ call, services });

        services.repositories.assetRepository.create({
            assetClass: 'equity',
            currency: 'CNY',
            id: 'asset-159253',
            market: 'A',
            metadata: {},
            name: '银行ETF博时',
            symbol: '159253',
            tags: ['core'],
        });

        const summary = await marketDataService.syncPrices({
            assetIds: ['asset-159253'],
            endDate: '2026-01-11',
            startDate: '2026-01-01',
        });

        expect(summary.synchronizedAssetIds).toEqual(['asset-159253']);
        expect(summary.insertedRows).toBe(5);
        expect(summary.warnings).toEqual([
            expect.objectContaining({
                code: 'SOURCE_WARNING',
                target: 'asset-159253',
            }),
        ]);
        expect(
            services.repositories.priceRepository.listByAsset('asset-159253').map((row) => row.date),
        ).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']);
    });

    test('skips fresh price sync when cached trading-day rows already cover market-closed boundaries', async () => {
        const { services } = createInMemoryDataServices();
        const call = vi.fn();
        const marketDataService = createTestMarketDataOrchestrator({ call, services });

        services.repositories.assetRepository.create({
            assetClass: 'equity',
            currency: 'CNY',
            id: 'asset-159820',
            market: 'A',
            metadata: {},
            name: '中证500ETF天弘',
            symbol: '159820',
            tags: ['core'],
        });
        services.repositories.priceRepository.insertMany(
            buildMarketDataPriceRows({
                assetId: 'asset-159820',
                dates: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'],
            }),
        );

        const summary = await marketDataService.syncPrices({
            assetIds: ['asset-159820'],
            endDate: '2026-01-11',
            startDate: '2026-01-03',
        });

        expect(call).not.toHaveBeenCalled();
        expect(summary.synchronizedAssetIds).toEqual([]);
        expect(summary.skippedAssetIds).toEqual(['asset-159820']);
        expect(summary.insertedRows).toBe(0);
        expect(summary.warnings).toEqual([]);
    });

    test('rejects FX sync immediately when every provider is disabled', async () => {
        const { services } = createInMemoryDataServices();
        services.repositories.preferencesRepository.set(preferenceKeys.dataSource.akshareEnabled, 'false');
        services.repositories.preferencesRepository.set(preferenceKeys.dataSource.yfinanceEnabled, 'false');
        services.repositories.preferencesRepository.set(preferenceKeys.dataSource.frankfurterEnabled, 'false');

        const call = vi.fn();
        const syncQueue = {
            enqueue: vi.fn(),
        } as unknown as SyncQueue;

        const service = createTestMarketDataOrchestrator({ call, services, syncQueue });

        await expect(service.syncFxRates(['USD/CNY'], '2026-04-01')).rejects.toThrow(
            'All FX data providers are disabled.',
        );
        expect(call).not.toHaveBeenCalled();
        expect(syncQueue.enqueue).not.toHaveBeenCalled();
    });

    test('syncs five-year history from issueDate and persists observed history floor', async () => {
        const { services } = createInMemoryDataServices();
        const today = new Date().toISOString().slice(0, 10);
        const call = vi.fn(async (method: string, params?: unknown) => {
            if (method === 'fetch_prices') {
                expect(params).toEqual({
                    assetMetadata: {
                        issueDate: '2024-01-01',
                        issueDateSource: 'akshare-xq',
                        tsCode: '159941.SZ',
                    },
                    enabledSources: ['tushare', 'akshare'],
                    end: today,
                    market: 'A',
                    start: '2024-01-01',
                    symbol: '159941',
                });

                return {
                    attemptedSources: ['tushare'],
                    prices: toSidecarPriceRows(buildMarketDataPriceRows({
                        assetId: 'unused-sidecar-id',
                        dates: ['2024-01-05', '2024-01-08', today],
                        source: 'tushare',
                    })),
                    symbol: '159941',
                    warnings: [],
                };
            }

            throw new Error(`Unexpected RPC ${method} ${JSON.stringify(params)}`);
        });
        const marketDataService = createTestMarketDataOrchestrator({ call, services });

        services.repositories.assetRepository.create({
            assetClass: 'equity',
            currency: 'CNY',
            id: 'asset-159941',
            market: 'A',
            metadata: {
                issueDate: '2024-01-01',
                issueDateSource: 'akshare-xq',
                tsCode: '159941.SZ',
            },
            name: '纳斯达克100ETF',
            symbol: '159941',
            tags: ['growth'],
        });

        const summary = await marketDataService.syncFiveYearHistoryForAsset('asset-159941');

        expect(summary.synchronizedAssetIds).toEqual(['asset-159941']);
        expect(summary.insertedRows).toBe(3);
        expect(call).toHaveBeenCalledTimes(1);
        expect(services.repositories.assetRepository.list()[0]?.metadata).toMatchObject({
            issueDate: '2024-01-01',
            priceHistoryFloorDate: '2024-01-05',
            priceHistoryFloorSource: 'observed-history',
        });
    });

    test('backfills metadata for known assets and exposes startup scan status', async () => {
        const { services } = createInMemoryDataServices();
        const call = vi.fn(async (method: string, params?: unknown) => {
            if (method === 'search_assets') {
                return [{
                    assetClass: 'equity',
                    currency: 'CNY',
                    market: 'A',
                    metadata: {
                        issueDate: '2012-05-28',
                        issueDateSource: 'akshare-fund-name',
                    },
                    name: '沪深300ETF',
                    source: 'akshare',
                    symbol: '510300',
                }];
            }

            throw new Error(`Unexpected RPC ${method} ${JSON.stringify(params)}`);
        });
        const marketDataService = createTestMarketDataOrchestrator({ call, services });

        services.repositories.assetRepository.create({
            assetClass: 'equity',
            currency: 'CNY',
            id: 'asset-510300',
            market: 'A',
            metadata: {},
            name: '沪深300ETF',
            symbol: '510300',
            tags: [],
        });
        services.repositories.priceRepository.insertMany(
            buildMarketDataPriceRows({
                assetId: 'asset-510300',
                dates: ['2021-01-04', '2021-01-05'],
                source: 'akshare',
            }),
        );

        const status = await marketDataService.backfillMetadataForKnownAssets();

        expect(status).toMatchObject({
            failedAssets: 0,
            scannedAssets: 1,
            state: 'completed',
            updatedAssets: 1,
        });
        expect(services.repositories.assetRepository.list()[0]?.metadata).toMatchObject({
            issueDate: '2012-05-28',
            issueDateSource: 'akshare-fund-name',
        });
        expect(marketDataService.getMetadataBackfillStatus()).toMatchObject({
            scannedAssets: 1,
            state: 'completed',
            updatedAssets: 1,
        });
        expect(call).toHaveBeenCalledWith('search_assets', expect.objectContaining({
            market: 'A',
            query: '510300',
        }));
    });

    test('syncs only incomplete assets during hourly five-year history scan', async () => {
        const { services } = createInMemoryDataServices();
        const today = new Date().toISOString().slice(0, 10);
        const call = vi.fn(async (method: string, params?: unknown) => {
            if (method === 'fetch_prices') {
                expect(params).toEqual({
                    assetMetadata: {
                        issueDate: '2023-01-01',
                        tsCode: '510300.SH',
                    },
                    enabledSources: ['tushare', 'akshare'],
                    end: today,
                    market: 'A',
                    start: '2023-01-01',
                    symbol: '510300',
                });

                return {
                    attemptedSources: ['tushare'],
                    prices: toSidecarPriceRows(buildMarketDataPriceRows({
                        assetId: 'unused-sidecar-id',
                        dates: ['2023-01-03', today],
                        source: 'tushare',
                    })),
                    symbol: '510300',
                    warnings: [],
                };
            }

            throw new Error(`Unexpected RPC ${method} ${JSON.stringify(params)}`);
        });
        const marketDataService = createTestMarketDataOrchestrator({ call, services });

        services.repositories.assetRepository.create({
            assetClass: 'equity',
            currency: 'CNY',
            id: 'asset-complete',
            market: 'A',
            metadata: {
                issueDate: today,
                tsCode: '511990.SH',
            },
            name: '现金管理ETF',
            symbol: '511990',
            tags: [],
        });
        services.repositories.priceRepository.insertMany(
            buildMarketDataPriceRows({
                assetId: 'asset-complete',
                dates: [today],
                source: 'akshare',
            }),
        );

        services.repositories.assetRepository.create({
            assetClass: 'equity',
            currency: 'CNY',
            id: 'asset-gap',
            market: 'A',
            metadata: {
                issueDate: '2023-01-01',
                tsCode: '510300.SH',
            },
            name: '沪深300ETF',
            symbol: '510300',
            tags: [],
        });
        services.repositories.priceRepository.insertMany(
            buildMarketDataPriceRows({
                assetId: 'asset-gap',
                dates: ['2024-01-10', today],
                source: 'akshare',
            }),
        );

        const summary = await marketDataService.syncIncompleteFiveYearHistory();

        expect(summary.skippedAssetIds).toContain('asset-complete');
        expect(summary.synchronizedAssetIds).toEqual(['asset-gap']);
        expect(call).toHaveBeenCalledTimes(1);
        expect(
            services.repositories.assetRepository.list().find((asset) => asset.id === 'asset-gap')?.metadata,
        ).toMatchObject({
            issueDate: '2023-01-01',
            priceHistoryFloorDate: '2023-01-03',
        });
    });
});