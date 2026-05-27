// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type {
    StoredAsset,
} from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import { resetAssetStore } from '../stores/asset-store';
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

describe('AssetsPage', () => {
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

        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
            configurable: true,
            value: 960,
        });
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
            configurable: true,
            value: 320,
        });
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
            configurable: true,
            value: 960,
        });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            value: 320,
        });
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                bottom: 320,
                height: 320,
                left: 0,
                right: 960,
                toJSON: () => ({}),
                top: 0,
                width: 960,
                x: 0,
                y: 0,
            }),
        });
    });

    beforeEach(() => {
        resetAssetStore();
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
                syncPrices: vi.fn().mockResolvedValue({
                    fxPairs: [],
                    insertedRows: 0,
                    skippedAssetIds: [],
                    syncStatus: {
                        activeTask: null,
                        completedTasks: 0,
                        failedTasks: 0,
                        lastWarning: null,
                        queuedTasks: 0,
                        recentEvents: [],
                        running: false,
                    },
                    synchronizedAssetIds: ['asset-spy'],
                    warnings: [],
                }),
                updateAsset: vi.fn().mockImplementation(async (asset) => asset),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        resetAssetStore();
        setApiClientOverride(null);
        window.localStorage.clear();
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    test('移除静态说明卡和能力徽标，但保留查找、列表与真实详情抽屉', async () => {
        const user = userEvent.setup();

        render(<AssetsPage />);

        expect(await screen.findByTestId('asset-table-panel')).toBeInTheDocument();
        expect(screen.getByTestId('asset-lookup-input')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /查看 SPY 详情/i })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /标的池与跨市场候选管理/i })).not.toBeInTheDocument();
        expect(screen.queryByText('Asset Inspector')).not.toBeInTheDocument();
        expect(screen.queryByText(/标的详情改成右侧抽屉/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/点击资产行展开详情/i)).not.toBeInTheDocument();
        expect(screen.queryByTestId('asset-detail-reopen')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /查看 SPY 详情/i }));

        expect(await screen.findByTestId('asset-detail-panel')).toBeInTheDocument();
        expect(await screen.findByTestId('asset-detail-close')).toBeInTheDocument();
    });
});