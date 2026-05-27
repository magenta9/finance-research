// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { memo } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import { resetAssetStore } from '../stores/asset-store';

const { assetLookupPanelRenderSpy } = vi.hoisted(() => ({
    assetLookupPanelRenderSpy: vi.fn(),
}));

vi.mock('../components/assets/asset-lookup-panel', () => ({
    AssetLookupPanel: memo((props: { lookupQuery: string }) => {
        assetLookupPanelRenderSpy(props.lookupQuery);
        return <div data-testid="mock-asset-lookup-panel">lookup panel</div>;
    }),
}));

import { AssetsPage } from './assets-page';

const assets: StoredAsset[] = [
    {
        assetClass: 'equity',
        createdAt: '2026-04-18T00:00:00.000Z',
        currency: 'USD',
        id: 'asset-spy',
        market: 'US',
        metadata: {},
        name: 'SPDR S&P 500 ETF Trust',
        symbol: 'SPY',
        tags: ['core'],
        updatedAt: '2026-04-18T00:00:00.000Z',
    },
    {
        assetClass: 'fixed_income',
        createdAt: '2026-04-18T00:00:00.000Z',
        currency: 'CNY',
        id: 'asset-bond',
        market: 'BOND',
        metadata: {},
        name: '国债 ETF',
        symbol: '511010',
        tags: ['defensive'],
        updatedAt: '2026-04-18T00:00:00.000Z',
    },
];

describe('AssetsPage performance', () => {
    let mockApi: QuantdeskApi;

    beforeAll(() => {
        vi.stubGlobal(
            'ResizeObserver',
            class ResizeObserver {
                disconnect() {
                    return undefined;
                }

                observe() {
                    return undefined;
                }

                unobserve() {
                    return undefined;
                }
            },
        );
    });

    beforeEach(() => {
        resetAssetStore();
        assetLookupPanelRenderSpy.mockClear();
        const consoleError = console.error.bind(console);
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            const message = args.map((value) => String(value)).join(' ');

            if (
                message.includes('not wrapped in act')
                || message.includes('current testing environment is not configured to support act')
            ) {
                return;
            }

            consoleError(...args);
        });

        mockApi = {
            data: {
                addAsset: vi.fn(),
                deleteAsset: vi.fn().mockResolvedValue(true),
                getAssetMetrics: vi.fn().mockImplementation(() => new Promise(() => undefined)),
                getAssetSeriesAnalytics: vi.fn().mockImplementation(() => new Promise(() => undefined)),
                getAssets: vi.fn().mockResolvedValue(assets),
                importAssetsCsv: vi.fn(),
                lookupAssets: vi.fn().mockResolvedValue([]),
                syncPrices: vi.fn(),
                updateAsset: vi.fn().mockImplementation(async (asset) => asset),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        resetAssetStore();
        setApiClientOverride(null);
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    test('does not rerender the lookup panel when only table query changes', async () => {
        const user = userEvent.setup();

        render(<AssetsPage />);

        await screen.findByTestId('asset-list-query');
        await screen.findByTestId('mock-asset-lookup-panel');
        assetLookupPanelRenderSpy.mockClear();

        await user.type(screen.getByTestId('asset-list-query'), 'SPY');

        expect(assetLookupPanelRenderSpy).not.toHaveBeenCalled();
    });
});