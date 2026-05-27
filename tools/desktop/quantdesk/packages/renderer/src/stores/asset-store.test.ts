// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AssetInput, AssetLookupResult, StoredAsset } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import { resetAssetStore, selectAvailableTags, selectVisibleAssets, useAssetStore } from './asset-store';

const createStoredAsset = (overrides: Partial<StoredAsset> = {}): StoredAsset => ({
    id: overrides.id ?? crypto.randomUUID(),
    symbol: overrides.symbol ?? 'SPY',
    name: overrides.name ?? 'SPDR S&P 500 ETF Trust',
    market: overrides.market ?? 'US',
    assetClass: overrides.assetClass ?? 'equity',
    currency: overrides.currency ?? 'USD',
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? '2026-04-11T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-11T00:00:00.000Z',
});

describe('useAssetStore', () => {
    let mockApi: QuantdeskApi;

    const assets = [
        createStoredAsset({ id: 'spy', symbol: 'SPY', tags: ['core'] }),
        createStoredAsset({
            id: 'agg',
            symbol: 'AGG',
            name: 'iShares Core U.S. Aggregate Bond ETF',
            market: 'US',
            assetClass: 'fixed_income',
            tags: ['defensive'],
            createdAt: '2026-04-10T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
        }),
    ];

    beforeEach(() => {
        resetAssetStore();

        mockApi = {
            log: {
                openDirectory: vi.fn().mockResolvedValue(undefined),
                write: vi.fn(),
                writeBatch: vi.fn(),
            },
            system: {
                ping: vi.fn(),
                checkNativeBindings: vi.fn(),
                runDummyPython: vi.fn(),
                getRuntimeStatus: vi.fn(),
            },
            runtime: {
                getCapabilities: vi.fn().mockResolvedValue({
                    hasKeytarSecrets: true,
                    hasNativeFileDialog: true,
                    hasNativeNotifications: true,
                    hasSidecarAutoStart: true,
                }),
                getConfig: vi.fn().mockResolvedValue({
                    lastConnectedAt: null,
                    lastConnectionError: null,
                    lastInitializationError: null,
                    sidecarUrl: 'ws://127.0.0.1:8765',
                }),
                getMode: vi.fn().mockResolvedValue('electron'),
                updateConfig: vi.fn(),
                validateProviderConnection: vi.fn().mockResolvedValue({ availableModels: ['qwen3:latest'], ok: true }),
                validateSidecarConnection: vi.fn().mockResolvedValue({ ok: true }),
            },
            data: {
                getAssets: vi.fn().mockResolvedValue([...assets]),
                addAsset: vi.fn().mockImplementation(async (asset: AssetInput) => createStoredAsset(asset)),
                updateAsset: vi.fn().mockImplementation(async (asset: AssetInput) => ({
                    ...createStoredAsset(asset),
                    createdAt: assets[0].createdAt,
                    updatedAt: '2026-04-12T00:00:00.000Z',
                })),
                deleteAsset: vi.fn().mockResolvedValue(true),
                searchAssets: vi.fn(),
                lookupAssets: vi.fn().mockResolvedValue([
                    {
                        symbol: 'QQQ',
                        name: 'Invesco QQQ Trust',
                        market: 'US',
                        assetClass: 'equity',
                        currency: 'USD',
                        source: 'test',
                        metadata: {},
                    } satisfies AssetLookupResult,
                ]),
                importAssetsCsv: vi.fn().mockResolvedValue({
                    errorCount: 0,
                    errors: [],
                    skippedCount: 0,
                    successCount: 2,
                }),
                syncPrices: vi.fn(),
                importPricesCsv: vi.fn(),
                getPrices: vi.fn(),
                getPriceRange: vi.fn(),
                syncFxRates: vi.fn().mockResolvedValue({ insertedRows: 0, pairs: [], warnings: [] }),
                getCacheSummary: vi.fn(),
                getSyncStatus: vi.fn().mockResolvedValue({
                    activeTask: null,
                    completedTasks: 0,
                    failedTasks: 0,
                    lastWarning: null,
                    queuedTasks: 0,
                    recentEvents: [],
                    running: false,
                }),
                subscribeSyncStatus: vi.fn().mockReturnValue(() => undefined),
                clearCache: vi.fn().mockResolvedValue({
                    cacheSummary: {
                        assetCount: 0,
                        fxRateRowCount: 0,
                        latestPriceFetchAt: null,
                        priceRowCount: 0,
                    },
                    syncStatus: {
                        activeTask: null,
                        completedTasks: 0,
                        failedTasks: 0,
                        lastWarning: null,
                        queuedTasks: 0,
                        recentEvents: [],
                        running: false,
                    },
                }),
                getPositions: vi.fn(),
                updatePosition: vi.fn(),
                deletePosition: vi.fn(),
                importPositionsCsv: vi.fn(),
            },
            portfolio: {
                runAllocation: vi.fn(),
                savePlan: vi.fn(),
                getPlans: vi.fn(),
                deletePlan: vi.fn(),
            },
            settings: {
                get: vi.fn(),
                set: vi.fn(),
                getAll: vi.fn(),
                delete: vi.fn(),
            },
            secrets: {
                get: vi.fn(),
                set: vi.fn(),
                delete: vi.fn(),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        setApiClientOverride(null);
    });

    test('加载、添加、打标签和删除资产会正确更新状态', async () => {
        await useAssetStore.getState().loadAssets();

        expect(useAssetStore.getState().assets).toHaveLength(2);

        useAssetStore.getState().setLookupQuery('QQQ');
        await useAssetStore.getState().lookupAssets();
        expect(useAssetStore.getState().lookupResults).toHaveLength(1);

        const added = await useAssetStore.getState().addAssetFromLookup(useAssetStore.getState().lookupResults[0]);
        expect(added).toBe(true);
        expect(useAssetStore.getState().assets.map((asset) => asset.symbol)).toContain('QQQ');

        await useAssetStore.getState().saveAssetTags('spy', ['core', 'watchlist']);
        expect(useAssetStore.getState().assets.find((asset) => asset.id === 'spy')?.tags).toEqual(['core', 'watchlist']);

        await useAssetStore.getState().deleteAsset('agg');
        expect(useAssetStore.getState().assets.map((asset) => asset.id)).not.toContain('agg');
    });

    test('adds a commodity futures lookup result with contract metadata', async () => {
        const futuresCandidate: AssetLookupResult = {
            assetClass: 'commodity',
            currency: 'CNY',
            exchange: 'SHFE',
            market: 'COMMODITY',
            metadata: {
                contractType: 'dominant_continuous',
                exchange: 'SHFE',
                instrumentType: 'futures',
                priceSeriesSource: 'tushare-futures',
                seriesAdjustment: 'raw_main_continuous',
                sourceSymbol: 'RB.SHF',
                tsCode: 'RB.SHF',
                tsCodeAsset: 'FT',
                underlyingSymbol: 'RB',
            },
            name: '螺纹钢主连',
            source: 'tushare',
            symbol: 'RB9999',
        };

        await useAssetStore.getState().loadAssets();
        const added = await useAssetStore.getState().addAssetFromLookup(futuresCandidate);

        expect(added).toBe(true);
        expect(mockApi.data.addAsset).toHaveBeenCalledWith(expect.objectContaining({
            assetClass: 'commodity',
            currency: 'CNY',
            market: 'COMMODITY',
            metadata: futuresCandidate.metadata,
            name: '螺纹钢主连',
            symbol: 'RB9999',
        }));
        expect(useAssetStore.getState().assets.find((asset) => asset.symbol === 'RB9999')?.metadata).toEqual(futuresCandidate.metadata);
    });

    test('筛选、标签集合和 CSV 预览状态可正确派生', async () => {
        await useAssetStore.getState().loadAssets();
        useAssetStore.getState().setFilters({ assetClass: 'equity', query: 'SPY' });

        const visibleAssets = selectVisibleAssets(useAssetStore.getState());
        expect(visibleAssets.map((asset) => asset.symbol)).toEqual(['SPY']);
        expect(selectAvailableTags(useAssetStore.getState())).toEqual(['core', 'defensive']);

        useAssetStore.getState().setCsvDraft([
            'symbol,name,market,assetClass,currency',
            'QQQ,Invesco QQQ Trust,US,equity,USD',
            'GLD,SPDR Gold Shares,US,commodity,USD',
        ].join('\n'));

        expect(useAssetStore.getState().csvPreview).toMatchObject({
            isValid: true,
            totalRows: 2,
        });

        await useAssetStore.getState().importCsvDraft();

        expect(mockApi.data.importAssetsCsv).toHaveBeenCalledTimes(1);
        expect(useAssetStore.getState().csvImportResult?.successCount).toBe(2);
    });
});