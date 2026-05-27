// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import type { AllocationResult } from '@quantdesk/shared';

import { AllocationVisualizationPanel } from './visualization-panel';

const mockResult: AllocationResult = {
    allocations: [
        {
            annualizedReturn: 0.11,
            annualizedVolatility: 0.21,
            assetClass: 'equity',
            assetId: 'spy',
            currency: 'USD',
            market: 'US',
            name: 'SPDR S&P 500 ETF Trust',
            riskContribution: 0.41,
            symbol: 'SPY',
            weight: 0.42,
        },
        {
            annualizedReturn: 0.048,
            annualizedVolatility: 0.09,
            assetClass: 'fixed_income',
            assetId: 'agg',
            currency: 'USD',
            market: 'US',
            name: 'iShares Core U.S. Aggregate Bond ETF',
            riskContribution: 0.31,
            symbol: 'AGG',
            weight: 0.33,
        },
        {
            annualizedReturn: 0.067,
            annualizedVolatility: 0.18,
            assetClass: 'commodity',
            assetId: 'gld',
            currency: 'USD',
            market: 'US',
            name: 'SPDR Gold Shares',
            riskContribution: 0.28,
            symbol: 'GLD',
            weight: 0.25,
        },
    ],
    baseCurrency: 'CNY',
    correlationMatrix: {
        labels: ['SPY', 'AGG', 'GLD'],
        matrix: [
            [1, 0.22, 0.31],
            [0.22, 1, 0.11],
            [0.31, 0.11, 1],
        ],
    },
    diagnostics: {
        alignedDates: 252,
        assetDateCoverage: [
            {
                actualEndDate: '2026-04-11',
                actualStartDate: '2025-04-11',
                assetId: 'spy',
                isFallback: true,
                requestedStartDate: '2025-04-11',
                symbol: 'SPY',
                tradingDays: 252,
            },
            {
                actualEndDate: '2026-04-11',
                actualStartDate: '2025-04-11',
                assetId: 'agg',
                isFallback: false,
                requestedStartDate: '2025-04-11',
                symbol: 'AGG',
                tradingDays: 252,
            },
        ],
        dateRange: {
            endDate: '2026-04-11',
            startDate: '2025-04-11',
        },
        excludedAssets: [],
        metricComputation: 'portfolio_path_simulation',
        optimizer: 'js',
        rebalanceEventCount: 3,
        warnings: [],
    },
    generatedAt: '2026-04-11T12:00:00.000Z',
    mode: 'inverse_volatility',
    portfolioPath: [
        { date: '2025-04-11', equity: 1 },
        { date: '2025-04-12', equity: 1.01 },
        { date: '2025-04-13', equity: 1.004 },
        { date: '2025-04-14', equity: 1.018 },
        { date: '2025-04-15', equity: 1.027 },
    ],
    portfolioMetrics: {
        expectedReturn: 0.083,
        maxDrawdown: 0.152,
        sharpeRatio: 0.73,
        volatility: 0.114,
    },
    rebalanceCadence: 'monthly',
    riskContributions: {
        agg: 0.31,
        gld: 0.28,
        spy: 0.41,
    },
    scenarioAnalysis: [
        {
            estimatedDrawdown: 0.08,
            estimatedReturn: -0.03,
            name: '利率上升',
            riskFactors: ['duration', 'real yields'],
        },
        {
            estimatedDrawdown: 0.15,
            estimatedReturn: -0.09,
            name: '股市暴跌',
            riskFactors: ['equity beta', 'liquidity'],
        },
        {
            estimatedDrawdown: 0.05,
            estimatedReturn: 0.04,
            name: '温和增长',
            riskFactors: ['balanced growth', 'risk appetite'],
        },
    ],
    weights: {
        agg: 0.33,
        gld: 0.25,
        spy: 0.42,
    },
};

describe('AllocationVisualizationPanel', () => {
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

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    test('接受 AllocationResult mock 后可稳定渲染图表与表格，且无 console error', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onOpenAssetDetail = vi.fn();

        render(
            <div style={{ height: 1600, width: 1280 }}>
                <AllocationVisualizationPanel onOpenAssetDetail={onOpenAssetDetail} result={mockResult} />
            </div>,
        );

        expect(screen.getByTestId('allocation-weights-table')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-nav-chart')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-weight-pie')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-risk-bar')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-correlation-grid')).toBeInTheDocument();
        expect(screen.getByTestId('allocation-correlation-cell-SPY-AGG')).toHaveClass('correlation-heat-cell-positive');
        expect(screen.getByTestId('allocation-correlation-cell-SPY-AGG')).toHaveStyle('--correlation-alpha: 0.197');
        expect(screen.getByTestId('allocation-scenario-grid')).toBeInTheDocument();
        expect(screen.queryByText('绿色段表示新高后的最大回撤')).not.toBeInTheDocument();
        expect(screen.getByTestId('allocation-coverage-spy')).toHaveTextContent('2025-04-11 ~ 2026-04-11 (数据降级)');
        expect(screen.getByText('横轴为时间，纵轴为净值的对数坐标')).toBeInTheDocument();
        expect(screen.getByText('月度调仓 · 3 次')).toBeInTheDocument();
        expect(screen.getAllByText('SPY').length).toBeGreaterThan(0);
        expect(screen.getByText('SPDR S&P 500 ETF Trust')).toBeInTheDocument();
        expect(screen.getByText('利率上升')).toBeInTheDocument();
        expect(screen.getByText('股市暴跌')).toBeInTheDocument();
        expect(screen.getByText('温和增长')).toBeInTheDocument();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(onOpenAssetDetail).not.toHaveBeenCalled();

        consoleErrorSpy.mockRestore();
    });

    test('点击权重表、相关性热力图和情景卡里的标的会回调打开详情', async () => {
        const user = userEvent.setup();
        const onOpenAssetDetail = vi.fn();

        render(
            <div style={{ height: 1600, width: 1280 }}>
                <AllocationVisualizationPanel onOpenAssetDetail={onOpenAssetDetail} result={mockResult} />
            </div>,
        );

        await user.click(within(screen.getByTestId('allocation-weights-table')).getByText('SPDR S&P 500 ETF Trust'));
        await user.click(within(screen.getByTestId('allocation-correlation-grid')).getAllByRole('button', { name: '打开 AGG 详情' })[0]);

        const scenarioCard = screen.getByRole('heading', { name: '利率上升' }).closest('article');

        expect(scenarioCard).not.toBeNull();

        await user.click(within(scenarioCard as HTMLElement).getByRole('button', { name: '打开 AGG 详情' }));

        expect(onOpenAssetDetail).toHaveBeenNthCalledWith(1, 'spy');
        expect(onOpenAssetDetail).toHaveBeenNthCalledWith(2, 'agg');
        expect(onOpenAssetDetail).toHaveBeenNthCalledWith(3, 'agg');
    });

    test('交易行为按每页 10 条分页展示', async () => {
        const user = userEvent.setup();
        const resultWithTrades: AllocationResult = {
            ...mockResult,
            diagnostics: {
                ...mockResult.diagnostics,
                trades: Array.from({ length: 12 }, (_, index) => {
                    const day = String(index + 1).padStart(2, '0');

                    return {
                        action: index % 2 === 0 ? 'buy' : 'sell',
                        assetId: `trade-${index + 1}`,
                        date: `2026-01-${day}`,
                        fromWeight: 0.01 * index,
                        name: `Trade Asset ${index + 1}`,
                        reason: `Trade reason ${index + 1}`,
                        source: index % 2 === 0 ? 'allocation' : 'trend_following',
                        symbol: `T${index + 1}`,
                        toWeight: 0.01 * (index + 1),
                        weightChange: 0.01,
                    };
                }),
            },
        };

        render(
            <div style={{ height: 1600, width: 1280 }}>
                <AllocationVisualizationPanel onOpenAssetDetail={vi.fn()} result={resultWithTrades} />
            </div>,
        );

        expect(screen.getByTestId('allocation-trades-page-summary')).toHaveTextContent('第 1 / 2 页 · 共 12 条');
        expect(screen.getByText('T12（Trade Asset 12）')).toBeInTheDocument();
        expect(screen.queryByText('T2（Trade Asset 2）')).not.toBeInTheDocument();

        await user.click(screen.getByTestId('allocation-trades-next'));

        expect(screen.getByTestId('allocation-trades-page-summary')).toHaveTextContent('第 2 / 2 页 · 共 12 条');
        expect(screen.getByText('T2（Trade Asset 2）')).toBeInTheDocument();
        expect(screen.queryByText('T12（Trade Asset 12）')).not.toBeInTheDocument();

        await user.click(screen.getByTestId('allocation-trades-prev'));

        expect(screen.getByTestId('allocation-trades-page-summary')).toHaveTextContent('第 1 / 2 页 · 共 12 条');
        expect(screen.getByText('T12（Trade Asset 12）')).toBeInTheDocument();
    });
});
