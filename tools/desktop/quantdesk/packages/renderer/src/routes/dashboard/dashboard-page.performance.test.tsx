// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { memo } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../../lib/api-client';

const { positionOverviewRenderSpy } = vi.hoisted(() => ({
    positionOverviewRenderSpy: vi.fn(),
}));

vi.mock('./dashboard-sections', async () => {
    const actual = await vi.importActual<typeof import('./dashboard-sections')>('./dashboard-sections');

    return {
        ...actual,
        PositionOverviewSection: memo((props: { positionOverview: Array<{ positionId: string }> }) => {
            positionOverviewRenderSpy(props.positionOverview.map((row) => row.positionId).join(','));
            return <div data-testid="mock-position-overview-section">overview</div>;
        }),
    };
});

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
];

describe('DashboardPage performance', () => {
    let mockApi: QuantdeskApi;

    beforeEach(() => {
        positionOverviewRenderSpy.mockClear();

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
                getCacheSummary: vi.fn().mockResolvedValue({ assetCount: assets.length, fxRateRowCount: 0, latestPriceFetchAt: null, priceRowCount: 0 }),
                getSyncStatus: vi.fn().mockResolvedValue({ activeTask: null, completedTasks: 0, failedTasks: 0, lastWarning: null, queuedTasks: 0, recentEvents: [], running: false }),
                subscribeSyncStatus: vi.fn().mockReturnValue(() => undefined),
                getPositions: vi.fn().mockResolvedValue([]),
                getPriceRange: vi.fn().mockResolvedValue([]),
                getPrices: vi.fn().mockResolvedValue([]),
                importAssetsCsv: vi.fn(),
                importPositionsCsv: vi.fn(),
                importPricesCsv: vi.fn(),
                lookupAssets: vi.fn(),
                searchAssets: vi.fn(),
                syncFxRates: vi.fn(),
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
                checkNativeBindings: vi.fn(),
                getRuntimeStatus: vi.fn().mockResolvedValue({ lastError: null, logDir: null, sidecarPid: null, sidecarPort: null, sidecarReady: true }),
                ping: vi.fn(),
                runDummyPython: vi.fn(),
            },
            runtime: {
                getCapabilities: vi.fn(),
                getConfig: vi.fn(),
                getMode: vi.fn(),
                updateConfig: vi.fn(),
                validateProviderConnection: vi.fn(),
                validateSidecarConnection: vi.fn(),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        setApiClientOverride(null);
    });

    test('does not rerender position overview when only the position form changes', async () => {
        const user = userEvent.setup();

        render(
            <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }} initialEntries={['/']}>
                <DashboardPage />
            </MemoryRouter>,
        );

        await screen.findByTestId('dashboard-position-shares-input');
        await screen.findByTestId('mock-position-overview-section');
        positionOverviewRenderSpy.mockClear();

        await user.type(screen.getByTestId('dashboard-position-shares-input'), '123');

        expect(positionOverviewRenderSpy).not.toHaveBeenCalled();
    });
});