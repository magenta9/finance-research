// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../../lib/api-client';
import { DashboardPage } from './dashboard-page';

const assets: StoredAsset[] = [
    {
        assetClass: 'equity',
        createdAt: '2026-04-11T00:00:00.000Z',
        currency: 'USD',
        id: 'asset-1',
        market: 'US',
        metadata: {},
        name: 'SPDR S&P 500 ETF Trust',
        symbol: 'SPY',
        tags: ['core'],
        updatedAt: '2026-04-11T00:00:00.000Z',
    },
    {
        assetClass: 'fixed_income',
        createdAt: '2026-04-11T00:00:00.000Z',
        currency: 'CNY',
        id: 'asset-2',
        market: 'BOND',
        metadata: {},
        name: '国债 ETF',
        symbol: '511010',
        tags: ['core'],
        updatedAt: '2026-04-11T00:00:00.000Z',
    },
];

describe('DashboardPage', () => {
    let mockApi: QuantdeskApi;

    beforeEach(() => {
        mockApi = {
            log: {
                openDirectory: vi.fn().mockResolvedValue(undefined),
                write: vi.fn(),
                writeBatch: vi.fn(),
            },
            data: {
                addAsset: vi.fn(),
                clearCache: vi.fn(),
                deleteAsset: vi.fn(),
                deletePosition: vi.fn(),
                getAssets: vi.fn().mockResolvedValue(assets),
                getCacheSummary: vi.fn().mockResolvedValue({
                    assetCount: assets.length,
                    fxRateRowCount: 0,
                    latestPriceFetchAt: null,
                    priceRowCount: 0,
                }),
                getSyncStatus: vi.fn().mockResolvedValue({
                    activeTask: null,
                    completedTasks: 1,
                    failedTasks: 0,
                    lastWarning: '使用旧缓存',
                    queuedTasks: 2,
                    recentEvents: [],
                    running: true,
                }),
                subscribeSyncStatus: vi.fn().mockReturnValue(() => undefined),
                getPositions: vi.fn().mockResolvedValue([]),
                getPriceRange: vi.fn().mockResolvedValue([]),
                getPrices: vi.fn().mockResolvedValue([]),
                importAssetsCsv: vi.fn(),
                importPositionsCsv: vi.fn(),
                importPricesCsv: vi.fn(),
                lookupAssets: vi.fn(),
                searchAssets: vi.fn(),
                syncFxRates: vi.fn().mockResolvedValue({ insertedRows: 0, pairs: [], warnings: [] }),
                syncPrices: vi.fn(),
                updateAsset: vi.fn(),
                updatePosition: vi.fn().mockResolvedValue({}),
            },
            portfolio: {
                deletePlan: vi.fn(),
                getPlans: vi.fn().mockResolvedValue([]),
                runAllocation: vi.fn(),
                savePlan: vi.fn(),
            },
            secrets: {
                delete: vi.fn(),
                get: vi.fn(),
                set: vi.fn(),
            },
            settings: {
                delete: vi.fn(),
                get: vi.fn().mockResolvedValue(null),
                getAll: vi.fn().mockResolvedValue({}),
                set: vi.fn(),
            },
            system: {
                checkNativeBindings: vi.fn().mockResolvedValue({
                    driver: 'better-sqlite3',
                    memoryDbReady: true,
                    sqliteVersion: '3.47.0',
                }),
                getRuntimeStatus: vi.fn().mockResolvedValue({
                    lastError: null,
                    logDir: null,
                    sidecarPid: null,
                    sidecarPort: null,
                    sidecarReady: true,
                }),
                ping: vi.fn().mockResolvedValue({
                    appVersion: '0.1.0-test',
                    message: 'pong',
                    timestamp: '2026-04-12T00:00:00.000Z',
                }),
                runDummyPython: vi.fn().mockResolvedValue({
                    command: 'python3',
                    exitCode: 0,
                    scriptPath: '/workspace/sidecar/scripts/dummy.py',
                    stderr: '',
                    stdout: 'dummy-ok',
                }),
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
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        setApiClientOverride(null);
    });

    test('选择资产后不会崩溃，并会同步更新持仓表单币种', async () => {
        const user = userEvent.setup();

        render(
            <MemoryRouter
                future={{
                    v7_relativeSplatPath: true,
                    v7_startTransition: true,
                }}
                initialEntries={['/']}
            >
                <DashboardPage />
            </MemoryRouter>,
        );

        const assetSelect = await screen.findByTestId('dashboard-position-asset-select');
        const sharesInput = screen.getByTestId('dashboard-position-shares-input');

        await user.selectOptions(assetSelect, 'asset-1');
        await user.type(sharesInput, '12');

        expect((assetSelect as HTMLSelectElement).value).toBe('asset-1');

        await user.click(screen.getByTestId('dashboard-manual-position-save'));

        await waitFor(() => {
            expect(mockApi.data.updatePosition).toHaveBeenCalledWith(
                expect.objectContaining({
                    assetId: 'asset-1',
                    currency: 'USD',
                    shares: 12,
                }),
            );
        });

        expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
        expect(screen.getByTestId('dashboard-sync-status-banner')).toBeInTheDocument();
        expect(screen.getByText('Pi Agent 工作台')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /投资组合指挥中心/i })).not.toBeInTheDocument();
    });
});