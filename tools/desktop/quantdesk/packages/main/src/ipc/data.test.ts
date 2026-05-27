import { describe, expect, test, vi } from 'vitest';

import type { AssetInput, StoredAsset } from '@quantdesk/shared';

import { createDataHandlers } from './data';

const buildDates = (count: number, startDate = '2025-01-01') => {
    const dates: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);

    for (let index = 0; index < count; index += 1) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
};

describe('createDataHandlers', () => {
    test('queues background thirty-year history sync after adding an asset', () => {
        const createdAssets: StoredAsset[] = [];
        const ensure = vi.fn();
        const handlers = createDataHandlers({
            assetRepository: {
                create(asset: AssetInput) {
                    const created: StoredAsset = {
                        ...asset,
                        createdAt: '2026-04-15T00:00:00.000Z',
                        updatedAt: '2026-04-15T00:00:00.000Z',
                    };
                    createdAssets.push(created);
                    return created;
                },
                delete: vi.fn(),
                list: vi.fn(() => createdAssets),
                search: vi.fn(() => []),
                update: vi.fn(),
            },
            fxRateRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
            },
            marketDataOrchestrator: {
                ensure,
            },
            positionRepository: {
                delete: vi.fn(),
                listByPortfolio: vi.fn(() => []),
                save: vi.fn(),
            },
            priceRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
                getLatestFetchedAt: vi.fn(() => null),
                getRange: vi.fn(() => []),
                listByAsset: vi.fn(() => []),
            },
        });

        const created = handlers.addAsset({
            assetClass: 'equity',
            currency: 'USD',
            id: 'asset-spy',
            market: 'US',
            metadata: { issueDate: '1993-01-22' },
            name: 'SPDR S&P 500 ETF Trust',
            symbol: 'SPY',
            tags: [],
        });

        expect(created.id).toBe('asset-spy');
        expect(createdAssets).toHaveLength(1);
        expect(ensure).toHaveBeenCalledWith({
            assetId: 'asset-spy',
            horizon: '30y',
            intent: 'asset-history',
            priority: 'background',
        });
    });

    test('computes asset metrics from quant-data price history when available', async () => {
        const getRange = vi.fn(() => [
            {
                adjustedClose: 100,
                assetId: 'asset-510300',
                close: 99,
                date: '2025-01-01',
                fetchedAt: '2026-04-15T00:00:00.000Z',
                high: null,
                low: null,
                open: null,
                source: 'akshare',
                volume: null,
            },
            {
                adjustedClose: 110,
                assetId: 'asset-510300',
                close: 108,
                date: '2025-01-02',
                fetchedAt: '2026-04-15T00:00:00.000Z',
                high: null,
                low: null,
                open: null,
                source: 'akshare',
                volume: null,
            },
        ]);
        const localGetRange = vi.fn(() => []);
        const handlers = createDataHandlers({
            assetRepository: {
                create: vi.fn(),
                delete: vi.fn(),
                list: vi.fn(() => [{
                    assetClass: 'equity',
                    createdAt: '2026-04-15T00:00:00.000Z',
                    currency: 'CNY',
                    id: 'asset-510300',
                    market: 'A',
                    metadata: {},
                    name: '沪深300ETF',
                    symbol: '510300',
                    tags: [],
                    updatedAt: '2026-04-15T00:00:00.000Z',
                } satisfies StoredAsset]),
                search: vi.fn(() => []),
                update: vi.fn(),
            },
            fxRateRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
            },
            positionRepository: {
                delete: vi.fn(),
                listByPortfolio: vi.fn(() => []),
                save: vi.fn(),
            },
            priceReadService: {
                getRange,
                listByAsset: vi.fn(() => []),
            },
            priceRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
                getLatestFetchedAt: vi.fn(() => null),
                getRange: localGetRange,
                listByAsset: vi.fn(() => []),
            },
        });

        await expect(handlers.getAssetMetrics({
            assetId: 'asset-510300',
            endDate: '2025-01-31',
            startDate: '2025-01-01',
        })).resolves.toMatchObject({
            analysisSeries: 'close',
            analyticsAvailability: 'ok',
            dataSource: 'akshare',
            displaySeries: 'close',
            latestValue: 108,
            periodReturn: 9 / 99,
            priceBasis: 'close',
            riskFreeRate: 0.02,
            tradingDays: 2,
        });
        expect(getRange).toHaveBeenCalledWith({
            assetId: 'asset-510300',
            endDate: '2025-01-31',
            startDate: '2025-01-01',
        });
        expect(localGetRange).not.toHaveBeenCalled();
    });

    test('falls back to local price history when quant-data range is empty', async () => {
        const getRange = vi.fn(() => []);
        const localGetRange = vi.fn(() => [{
            adjustedClose: 100,
            assetId: 'asset-510300',
            close: 99,
            date: '2025-01-01',
            fetchedAt: '2026-04-15T00:00:00.000Z',
            high: null,
            low: null,
            open: null,
            source: 'tushare',
            volume: null,
        }]);
        const handlers = createDataHandlers({
            assetRepository: {
                create: vi.fn(),
                delete: vi.fn(),
                list: vi.fn(() => [{
                    assetClass: 'equity',
                    createdAt: '2026-04-15T00:00:00.000Z',
                    currency: 'CNY',
                    id: 'asset-510300',
                    market: 'A',
                    metadata: {},
                    name: '沪深300ETF',
                    symbol: '510300',
                    tags: [],
                    updatedAt: '2026-04-15T00:00:00.000Z',
                } satisfies StoredAsset]),
                search: vi.fn(() => []),
                update: vi.fn(),
            },
            fxRateRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
            },
            positionRepository: {
                delete: vi.fn(),
                listByPortfolio: vi.fn(() => []),
                save: vi.fn(),
            },
            priceReadService: {
                getRange,
                listByAsset: vi.fn(() => []),
            },
            priceRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
                getLatestFetchedAt: vi.fn(() => null),
                getRange: localGetRange,
                listByAsset: vi.fn(() => []),
            },
        });

        await expect(handlers.getAssetMetrics({
            assetId: 'asset-510300',
            endDate: '2025-01-31',
            startDate: '2025-01-01',
        })).resolves.toMatchObject({
            analyticsAvailability: 'ok',
            dataSource: 'tushare',
            latestValue: 99,
        });
        expect(getRange).toHaveBeenCalledWith({
            assetId: 'asset-510300',
            endDate: '2025-01-31',
            startDate: '2025-01-01',
        });
        expect(localGetRange).toHaveBeenCalledWith({
            assetId: 'asset-510300',
            endDate: '2025-01-31',
            startDate: '2025-01-01',
        });
    });

    test('returns asset series analytics from quant-data prices and logs skipped non-positive regression samples', async () => {
        const dates = buildDates(40);
        const listByAsset = vi.fn(() => Array.from({ length: 40 }, (_, index) => ({
            adjustedClose: index < 4 ? 0 : 100 + index,
            assetId: 'asset-spy',
            close: index < 4 ? 0 : 99 + index,
            date: dates[index],
            fetchedAt: '2026-04-15T00:00:00.000Z',
            high: null,
            low: null,
            open: null,
            source: 'yahoo',
            volume: null,
        })));
        const localListByAsset = vi.fn(() => []);
        const logger = {
            close: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
            getLogDirectory: vi.fn(() => null),
            info: vi.fn(),
            warn: vi.fn(),
            write: vi.fn(),
        };
        const handlers = createDataHandlers({
            assetRepository: {
                create: vi.fn(),
                delete: vi.fn(),
                list: vi.fn(() => [{
                    assetClass: 'equity',
                    createdAt: '2026-04-15T00:00:00.000Z',
                    currency: 'USD',
                    id: 'asset-spy',
                    market: 'US',
                    metadata: {},
                    name: 'SPDR S&P 500 ETF Trust',
                    symbol: 'SPY',
                    tags: [],
                    updatedAt: '2026-04-15T00:00:00.000Z',
                } satisfies StoredAsset]),
                search: vi.fn(() => []),
                update: vi.fn(),
            },
            fxRateRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
            },
            logger,
            positionRepository: {
                delete: vi.fn(),
                listByPortfolio: vi.fn(() => []),
                save: vi.fn(),
            },
            priceReadService: {
                getRange: vi.fn(() => []),
                listByAsset,
            },
            priceRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
                getLatestFetchedAt: vi.fn(() => null),
                getRange: vi.fn(() => []),
                listByAsset: localListByAsset,
            },
        });

        const analytics = await handlers.getAssetSeriesAnalytics({
            assetId: 'asset-spy',
            channelWidthSigma: 2,
            displayEndDate: dates[dates.length - 1],
            displaySeriesMode: 'analysis',
            displayStartDate: dates[0],
            includeRegression: true,
            regressionWindow: 'display',
            volWindow: 20,
        });

        expect(analytics.meta.analysisSeries).toBe('close');
        expect(analytics.regression.regressionSkippedNonPositiveCount).toBe(4);
        expect(listByAsset).toHaveBeenCalledWith('asset-spy');
        expect(localListByAsset).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            'main',
            'Asset series regression skipped non-positive samples.',
            expect.objectContaining({
                assetId: 'asset-spy',
                regressionWindow: 'display',
                skippedCount: 4,
            }),
        );
    });

    test('returns an empty FX sync summary when no market data service is available', () => {
        const handlers = createDataHandlers({
            assetRepository: {
                create: vi.fn(),
                delete: vi.fn(),
                list: vi.fn(() => []),
                search: vi.fn(() => []),
                update: vi.fn(),
            },
            fxRateRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
            },
            positionRepository: {
                delete: vi.fn(),
                listByPortfolio: vi.fn(() => []),
                save: vi.fn(),
            },
            priceRepository: {
                clearAll: vi.fn(),
                count: vi.fn(() => 0),
                getLatestFetchedAt: vi.fn(() => null),
                getRange: vi.fn(() => []),
                listByAsset: vi.fn(() => []),
            },
        });

        expect(handlers.syncFxRates(['USD/CNY'], '2026-04-01')).toEqual({
            insertedRows: 0,
            pairs: ['USD/CNY'],
            warnings: [],
        });
    });
});