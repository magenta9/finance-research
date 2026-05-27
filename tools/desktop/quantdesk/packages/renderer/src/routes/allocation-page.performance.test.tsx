// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { memo } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AllocationResult, StoredAsset } from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { setApiClientOverride } from '../lib/api-client';
import { resetAllocationStore, useAllocationStore } from '../stores/allocation-store';
import { resetAssetStore } from '../stores/asset-store';
import { resetPlanStore } from '../stores/plan-store';

const { allocationVisualizationRenderSpy } = vi.hoisted(() => ({
    allocationVisualizationRenderSpy: vi.fn(),
}));

vi.mock('../components/allocation/visualization-panel', () => ({
    AllocationVisualizationPanel: memo((props: { result: AllocationResult }) => {
        allocationVisualizationRenderSpy(props.result.generatedAt);
        return <div data-testid="mock-allocation-visualization">visualization</div>;
    }),
}));

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
];

const result: AllocationResult = {
    allocations: [],
    baseCurrency: 'CNY',
    correlationMatrix: { labels: [], matrix: [] },
    diagnostics: {
        alignedDates: 252,
        dateRange: {
            endDate: '2026-04-15',
            startDate: '2025-04-15',
        },
        excludedAssets: [],
        metricComputation: 'portfolio_path_simulation',
        optimizer: 'js',
        rebalanceEventCount: 0,
        warnings: [],
    },
    generatedAt: '2026-04-15T12:00:00.000Z',
    mode: 'inverse_volatility',
    portfolioMetrics: {
        expectedReturn: 0.08,
        maxDrawdown: 0.12,
        sharpeRatio: 0.7,
        volatility: 0.11,
    },
    rebalanceCadence: 'none',
    riskContributions: {},
    scenarioAnalysis: [],
    weights: {},
};

describe('AllocationPage performance', () => {
    let mockApi: QuantdeskApi;

    beforeEach(() => {
        resetAllocationStore();
        resetAssetStore();
        resetPlanStore();
        allocationVisualizationRenderSpy.mockClear();
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

        useAllocationStore.setState({ result });

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
                get: vi.fn().mockResolvedValue(null),
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

    test('does not rerender visualization when only the plan name draft changes', async () => {
        const user = userEvent.setup();

        render(<AllocationPage />);

        await waitFor(() => {
            expect(mockApi.data.getAssets).toHaveBeenCalledTimes(2);
        });
        await screen.findByTestId('allocation-plan-name-input');
        await screen.findByTestId('mock-allocation-visualization');
        allocationVisualizationRenderSpy.mockClear();

        await user.type(screen.getByTestId('allocation-plan-name-input'), '全天候 v2');

        expect(allocationVisualizationRenderSpy).not.toHaveBeenCalled();
    });
});