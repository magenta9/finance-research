// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import { resetAllocationStore } from '../stores/allocation-store';
import { resetAssetStore } from '../stores/asset-store';
import { resetPlanStore } from '../stores/plan-store';
import { AllocationPage } from './allocation-page';

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
    {
        assetClass: 'commodity',
        createdAt: '2026-04-18T00:00:00.000Z',
        currency: 'USD',
        id: 'asset-gold',
        market: 'COMMODITY',
        metadata: {},
        name: 'SPDR Gold Shares',
        symbol: 'GLD',
        tags: ['hedge'],
        updatedAt: '2026-04-18T00:00:00.000Z',
    },
];

describe('AllocationPage', () => {
    let mockApi: QuantdeskApi;

    beforeEach(() => {
        resetAllocationStore();
        resetAssetStore();
        resetPlanStore();

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
                getAssets: vi.fn().mockResolvedValue(assets),
            },
            portfolio: {
                deletePlan: vi.fn().mockResolvedValue(true),
                getPlans: vi.fn().mockResolvedValue([]),
                runAllocation: vi.fn(),
                savePlan: vi.fn(),
            },
            settings: {
                get: vi.fn().mockImplementation(async (key: string) => {
                    if (key === 'baseCurrency') {
                        return 'CNY';
                    }

                    if (key === 'defaultMaxSingleWeight') {
                        return '0.35';
                    }

                    return null;
                }),
            },
        } as unknown as QuantdeskApi;

        setApiClientOverride(mockApi);
    });

    afterEach(() => {
        resetAllocationStore();
        resetAssetStore();
        resetPlanStore();
        setApiClientOverride(null);
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    test('按策略、标的、运行参数的顺序组织配置方案流程', async () => {
        const user = userEvent.setup();

        render(<AllocationPage />);

        await waitFor(() => {
            expect(mockApi.data.getAssets).toHaveBeenCalledTimes(2);
            expect(mockApi.portfolio.getPlans).toHaveBeenCalledTimes(1);
        });

        expect(await screen.findByTestId('allocation-page')).toBeInTheDocument();
        expect(await screen.findByTestId('allocation-selected-asset-SPY')).toBeInTheDocument();
        await user.click(screen.getByTestId('allocation-filter-input'));
        expect(screen.getByTestId('allocation-asset-dropdown')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-asset-toggle-SPY')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-strategy-panel')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-strategy-inverse_volatility')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-strategy-ewmac_trend_following')).toBeInTheDocument();
        expect(screen.getByText('反波动率加权 参数')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-asset-list')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-run-button')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /配置结果总览与历史方案库/i })).not.toBeInTheDocument();
        expect(screen.queryByText('保存与回放')).not.toBeInTheDocument();
        expect(await screen.findByText('还没有保存过方案。先运行一次配置，再把结果归档到历史列表。')).toBeInTheDocument();
        expect(screen.queryByTestId('allocation-mode-description')).not.toBeInTheDocument();
        expect(screen.queryByTestId('allocation-sleeve-asset-list')).not.toBeInTheDocument();
        expect(screen.queryByTestId('allocation-trend-asset-list')).not.toBeInTheDocument();

        await user.click(screen.getByTestId('allocation-strategy-erc'));
        expect(screen.getByTestId('allocation-current-strategy')).toHaveTextContent('erc');
        expect(screen.getByText('等风险贡献 参数')).toBeInTheDocument();

        await user.click(screen.getByTestId('allocation-strategy-max_diversification'));
        expect(screen.getByText('最大分散化 参数')).toBeInTheDocument();

        await user.click(screen.getByTestId('allocation-strategy-ewmac_trend_following'));
        expect(screen.getByTestId('allocation-current-strategy')).toHaveTextContent('ewmac_trend_following');
        expect(screen.getByText('EWMAC 趋势跟随 参数')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-ewmac-allow-short')).toBeChecked();
        expect(screen.getByTestId('allocation-ewmac-rule-2-8')).toBeChecked();
        expect(screen.queryByTestId('allocation-max-single-input')).not.toBeInTheDocument();

        await user.click(screen.getByTestId('allocation-ewmac-rule-2-8'));
        expect(screen.getByTestId('allocation-ewmac-rule-2-8')).not.toBeChecked();
    });
});
