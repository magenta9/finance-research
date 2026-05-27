// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import type {
    AssetMetricsResult,
    AssetSeriesAnalyticsRequest,
    AssetSeriesAnalyticsResult,
    PricePatternAnalogSearchRequest,
    PricePatternAnalogSearchResult,
    StoredAsset,
} from '@quantdesk/shared';
import type { QuantdeskApi } from '@quantdesk/shared/types/api';

import { AssetDetailPanel } from './asset-detail-panel';

const asset: StoredAsset = {
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
};

const buildDates = (startDate: string, count: number) => {
    const dates: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);

    for (let index = 0; index < count; index += 1) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
};

const buildAnalytics = (
    request: AssetSeriesAnalyticsRequest,
    options?: {
        canShowRawObservation?: boolean;
        effectiveDisplayMode?: 'analysis' | 'raw';
        includeNonPositive?: boolean;
        source?: string;
        unavailable?: boolean;
    },
): AssetSeriesAnalyticsResult => {
    const dates = buildDates(request.displayStartDate, 8);
    const displayMode = options?.effectiveDisplayMode ?? 'analysis';
    const source = options?.source ?? 'yahoo';
    const rawValues = options?.includeNonPositive
        ? [100, 101, 0, 104, 106, 108, 109, 111]
        : [100, 101, 103, 104, 106, 108, 109, 111];
    const analysisValues = options?.unavailable ? rawValues.map(() => null) : rawValues;
    const baseAnalysisValue = analysisValues.find((value) => value != null && value > 0) ?? null;
    const points = dates.map((date, index) => ({
        analysisValue: analysisValues[index],
        cumulativeLogReturn: analysisValues[index] != null && baseAnalysisValue != null && analysisValues[index] > 0
            ? Math.log(analysisValues[index] / baseAnalysisValue)
            : null,
        date,
        displayValue: rawValues[index],
    }));

    return {
        drawdown: options?.unavailable ? {
            currentDrawdown: 0,
            durationDays: 0,
            maxDrawdown: 0,
            maxDrawdownDate: null,
            points: [],
            recoveryDays: null,
            unrecoveredDays: null,
        } : {
            currentDrawdown: -0.04,
            durationDays: 3,
            maxDrawdown: -0.08,
            maxDrawdownDate: dates[3],
            points: dates.map((date, index) => ({
                date,
                daysSincePeak: Math.max(0, index - 2),
                drawdown: index < 2 ? 0 : -0.02 * (index - 1),
                peakDate: dates[Math.max(0, index - 2)],
                peakValue: 104 + index,
            })),
            recoveryDays: 2,
            unrecoveredDays: null,
        },
        meta: {
            adjustedCloseMissingRatio: 0,
            analyticsAvailability: options?.unavailable ? 'unavailable' : 'ok',
            analysisSeries: options?.unavailable ? null : 'close',
            canShowRawObservation: options?.canShowRawObservation ?? false,
            dataSource: source,
            degradationReason: options?.unavailable ? 'insufficient_samples' : null,
            displaySeries: 'close',
            effectiveDisplaySeriesMode: displayMode,
            tradingDaysPerYear: 252,
        },
        points,
        regression: options?.unavailable ? {
            actualEndDate: null,
            actualStartDate: null,
            alpha: null,
            beta: null,
            fitFull: [],
            muAnnualLog: null,
            muAnnualSimple: null,
            n: 0,
            r2: null,
            regressionSkippedNonPositiveCount: 0,
            sigmaAnnual: null,
            sigmaRes: null,
            status: 'disabled',
        } : {
            actualEndDate: dates[dates.length - 1],
            actualStartDate: dates[0],
            alpha: 4.6,
            beta: 0.002,
            fitFull: dates.map((date, index) => ({
                date,
                lower: 98 + index,
                mid: 101 + index,
                upper: 104 + index,
            })),
            muAnnualLog: 0.18,
            muAnnualSimple: 0.197,
            n: dates.length,
            r2: 0.84,
            regressionSkippedNonPositiveCount: 0,
            sigmaAnnual: 0.21,
            sigmaRes: 0.013,
            status: 'ok',
        },
        rollingVol: options?.unavailable ? {
            mean: null,
            points: [],
            window: request.volWindow,
        } : {
            mean: 0.18,
            points: dates.map((date, index) => ({
                date,
                maxDailyReturn: index < 3 ? null : 0.03,
                minDailyReturn: index < 3 ? null : -0.02,
                value: index < 3 ? null : 0.16 + index * 0.005,
                windowEndDate: index < 3 ? null : date,
                windowStartDate: index < 3 ? null : dates[Math.max(0, index - 2)],
            })),
            window: request.volWindow,
        },
    };
};

const buildMetrics = (
    request: { startDate: string; endDate: string },
    options?: { unavailable?: boolean },
): AssetMetricsResult => ({
    actualEndDate: request.endDate,
    actualStartDate: request.startDate,
    adjustedCloseMissingRatio: options?.unavailable ? 0 : 0,
    analyticsAvailability: options?.unavailable ? 'unavailable' : 'ok',
    analysisSeries: options?.unavailable ? null : 'close',
    annualizedVol: options?.unavailable ? null : 0.18,
    dataSource: options?.unavailable ? 'unknown' : 'yahoo',
    degradationReason: options?.unavailable ? 'insufficient_samples' : null,
    displaySeries: 'close',
    latestValue: 111,
    periodReturn: options?.unavailable ? null : 0.11,
    priceBasis: 'close',
    riskFreeRate: 0.04,
    sharpeRatio: options?.unavailable ? null : 0.72,
    tradingDays: options?.unavailable ? 0 : 160,
});

const buildAnalogResult = (request: PricePatternAnalogSearchRequest): PricePatternAnalogSearchResult => ({
    candidateSummary: {
        comparableAssetCount: 2,
        dedupedWindowCount: 1,
        eligibleWindowCount: 3,
        localAssetCount: 2,
        rawWindowCount: 12,
    },
    query: {
        assetClass: 'equity',
        assetId: request.assetId,
        endDate: request.endDate ?? '2026-05-08',
        market: 'US',
        startDate: request.startDate ?? '2025-05-08',
        symbol: 'SPY',
        tradingDays: 8,
        window: request.window,
    },
    results: [{
        asset: {
            assetClass: 'equity',
            currency: 'USD',
            id: 'asset-qqq',
            market: 'US',
            name: 'Invesco QQQ Trust',
            symbol: 'QQQ',
        },
        diagnostics: {
            analogMaxDrawdown: -0.04,
            analogTotalReturn: 0.1,
            analogVolatility: 0.18,
            targetMaxDrawdown: -0.05,
            targetTotalReturn: 0.11,
            targetVolatility: 0.19,
        },
        forward: {
            '1M': { endDate: '2025-08-08', return: 0.03, startDate: '2025-07-08', status: 'complete', tradingDays: 21 },
            '3M': { endDate: '2025-10-08', return: -0.02, startDate: '2025-07-08', status: 'complete', tradingDays: 63 },
            '6M': { endDate: null, return: null, startDate: '2025-07-08', status: 'partial', tradingDays: 92 },
        },
        forwardPaths: {
            '3M': Array.from({ length: 3 }, (_, index) => ({
                date: buildDates('2025-07-02', 3)[index],
                index: index + 1,
                normalizedLogReturn: Math.log((108 + index * 1.1) / 107),
            })),
        },
        id: 'asset-qqq:2025-04-01:2025-07-01',
        match: {
            endDate: '2025-07-01',
            startDate: '2025-04-01',
            tradingDays: 8,
        },
        path: Array.from({ length: 8 }, (_, index) => ({
            date: buildDates(request.startDate ?? '2025-05-08', 8)[index],
            index,
            normalizedLogReturn: Math.log((100 + index * 1.4) / 100),
        })),
        similarity: {
            maxDrawdownDiff: 0.01,
            penalty: 4,
            score: 82.4,
            shapeDistance: 0.18,
            shapeScore: 86.4,
            totalReturnDiff: 0.01,
            volatilityDiff: 0.01,
        },
        sourceType: 'peer',
    }, {
        asset: {
            assetClass: 'equity',
            currency: 'USD',
            id: 'asset-dia',
            market: 'US',
            name: 'SPDR Dow Jones Industrial Average ETF Trust',
            symbol: 'DIA',
        },
        diagnostics: {
            analogMaxDrawdown: -0.03,
            analogTotalReturn: 0.08,
            analogVolatility: 0.16,
            targetMaxDrawdown: -0.05,
            targetTotalReturn: 0.11,
            targetVolatility: 0.19,
        },
        forward: {
            '1M': { endDate: '2024-08-08', return: 0.02, startDate: '2024-07-08', status: 'complete', tradingDays: 21 },
            '3M': { endDate: '2024-10-08', return: 0.04, startDate: '2024-07-08', status: 'complete', tradingDays: 63 },
            '6M': { endDate: null, return: null, startDate: '2024-07-08', status: 'partial', tradingDays: 92 },
        },
        forwardPaths: {
            '3M': Array.from({ length: 3 }, (_, index) => ({
                date: buildDates('2024-07-02', 3)[index],
                index: index + 1,
                normalizedLogReturn: Math.log((107 + index * 1.5) / 106),
            })),
        },
        id: 'asset-dia:2024-04-01:2024-07-01',
        match: {
            endDate: '2024-07-01',
            startDate: '2024-04-01',
            tradingDays: 8,
        },
        path: Array.from({ length: 8 }, (_, index) => ({
            date: buildDates(request.startDate ?? '2025-05-08', 8)[index],
            index,
            normalizedLogReturn: Math.log((100 + index * 1.2) / 100),
        })),
        similarity: {
            maxDrawdownDiff: 0.02,
            penalty: 6,
            score: 76.8,
            shapeDistance: 0.24,
            shapeScore: 80.1,
            totalReturnDiff: 0.03,
            volatilityDiff: 0.03,
        },
        sourceType: 'peer',
    }],
    status: 'degraded',
    targetPath: Array.from({ length: 8 }, (_, index) => ({
        date: buildDates(request.startDate ?? '2025-05-08', 8)[index],
        index,
        normalizedLogReturn: Math.log((100 + index * 1.5) / 100),
    })),
    warnings: ['six_month_forward_incomplete'],
});

const installMockApi = (options?: {
    analytics?: (request: AssetSeriesAnalyticsRequest) => AssetSeriesAnalyticsResult;
    analogs?: (request: PricePatternAnalogSearchRequest) => PricePatternAnalogSearchResult;
    metrics?: (request: { startDate: string; endDate: string; assetId: string }) => AssetMetricsResult;
}) => {
    const getAssetSeriesAnalytics = vi.fn(async (request: AssetSeriesAnalyticsRequest) => (
        options?.analytics?.(request) ?? buildAnalytics(request)
    ));
    const getAssetMetrics = vi.fn(async (request: { startDate: string; endDate: string; assetId: string }) => (
        options?.metrics?.(request) ?? buildMetrics(request)
    ));
    const searchPricePatternAnalogs = vi.fn(async (request: PricePatternAnalogSearchRequest) => (
        options?.analogs?.(request) ?? buildAnalogResult(request)
    ));
    const syncPrices = vi.fn(async () => ({
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
        synchronizedAssetIds: [asset.id],
        warnings: [],
    }));

    window.api = {
        data: {
            getAssetMetrics,
            getAssetSeriesAnalytics,
            searchPricePatternAnalogs,
            syncPrices,
        },
    } as unknown as QuantdeskApi;

    return {
        getAssetMetrics,
        getAssetSeriesAnalytics,
        searchPricePatternAnalogs,
        syncPrices,
    };
};

const waitForAssetDetailPanelReady = async (options?: { unavailableSeries?: boolean }) => {
    await screen.findByTestId('asset-detail-main-chart');
    if (options?.unavailableSeries) {
        await screen.findByTestId('asset-detail-drawdown-unavailable');
        await screen.findByTestId('asset-detail-rolling-vol-unavailable');
    } else {
        await screen.findByTestId('asset-detail-drawdown-chart');
        await screen.findByTestId('asset-detail-rolling-vol-chart');
    }

    await waitFor(() => {
        expect(screen.getByText('区间收益').parentElement).not.toHaveTextContent('加载中');
    });
};

describe('AssetDetailPanel', () => {
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

    afterEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    test('uses linear by default for 1Y and switches to log by default for 3Y', async () => {
        const user = userEvent.setup();

        installMockApi();

        render(
            <AssetDetailPanel
                allTags={['core', 'growth']}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady();

        await user.click(screen.getByTestId('asset-detail-window-3Y'));

        await waitForAssetDetailPanelReady();

        await waitFor(() => {
            expect(screen.getByTestId('asset-detail-yscale-log')).toHaveAttribute('aria-pressed', 'true');
        });
    });

    test('hides series-mode controls when display and calculation use the same series', async () => {
        const user = userEvent.setup();

        installMockApi();

        render(
            <AssetDetailPanel
                allTags={['core']}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady();

        expect(screen.queryByTestId('asset-detail-mode-analysis')).not.toBeInTheDocument();
        expect(screen.queryByTestId('asset-detail-mode-raw')).not.toBeInTheDocument();

        await user.click(screen.getByTestId('asset-detail-window-3Y'));

        await waitForAssetDetailPanelReady();

        await waitFor(() => {
            expect(screen.getByTestId('asset-detail-yscale-log')).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByTestId('asset-detail-regression-strip')).toBeInTheDocument();
        });
    });

    test('renders regression channel lines in log mode when regression is available', async () => {
        const user = userEvent.setup();

        installMockApi();

        render(
            <AssetDetailPanel
                allTags={['core']}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady();

        await user.click(screen.getByTestId('asset-detail-yscale-log'));

        await waitForAssetDetailPanelReady();

        await waitFor(() => {
            expect(screen.getByTestId('asset-detail-yscale-log')).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByTestId('asset-detail-regression-strip')).toBeInTheDocument();
        });

        await waitFor(() => {
            const regressionPathCount = screen
                .getByTestId('asset-detail-main-chart')
                .querySelectorAll('path[stroke]').length;

            expect(regressionPathCount).toBeGreaterThanOrEqual(4);
        });
    });

    test('toggles fullscreen inspector mode', async () => {
        const user = userEvent.setup();

        installMockApi();

        render(
            <AssetDetailPanel
                allTags={['core']}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady();

        const toggle = screen.getByTestId('asset-detail-fullscreen-toggle');
        await user.click(toggle);

        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('asset-detail-panel')).toHaveClass('max-w-none');
    });

    test('renders analog cards and toggles multiple selected overlays', async () => {
        const user = userEvent.setup();

        installMockApi();

        render(
            <AssetDetailPanel
                allTags={['core']}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady();

        await waitFor(() => {
            expect(screen.getByTestId('asset-analog-section')).toBeInTheDocument();
        });

        expect(screen.getByText('QQQ')).toBeInTheDocument();
        expect(screen.getByText('DIA')).toBeInTheDocument();
        expect(screen.getAllByText('6M 不完整')).toHaveLength(2);

        const cards = screen.getAllByTestId('asset-analog-card');

        await user.click(cards[0]);
        await user.click(cards[1]);

        await waitFor(() => {
            const chartPathCount = screen
                .getByTestId('asset-detail-main-chart')
                .querySelectorAll('path[stroke]').length;

            expect(chartPathCount).toBeGreaterThanOrEqual(3);
        });

        expect(cards[0]).toHaveAttribute('aria-pressed', 'true');
        expect(cards[1]).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('asset-detail-analog-legend')).toHaveTextContent('QQQ');
        expect(screen.getByTestId('asset-detail-analog-legend')).toHaveTextContent('DIA');
    });

    test('shows unavailable banner when analytics are unavailable', async () => {
        installMockApi({
            analytics: (request) => buildAnalytics(request, {
                unavailable: true,
            }),
            metrics: (request) => buildMetrics(request, { unavailable: true }),
        });

        render(
            <AssetDetailPanel
                allTags={[]}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady({ unavailableSeries: true });

        await waitFor(() => {
            expect(screen.getByTestId('asset-detail-analytics-banner')).toBeInTheDocument();
        });

        expect(screen.getByTestId('asset-detail-drawdown-unavailable')).toBeInTheDocument();
        expect(screen.getByTestId('asset-detail-rolling-vol-unavailable')).toBeInTheDocument();
    });

    test('prefers stored y-scale over window default', async () => {
        installMockApi();
        window.localStorage.setItem('asset-inspector.yscale.asset-spy', 'log');

        render(
            <AssetDetailPanel
                allTags={[]}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady();

        await waitFor(() => {
            expect(screen.getByTestId('asset-detail-yscale-log')).toHaveAttribute('aria-pressed', 'true');
        });
    });

    test('disables log scale when display values contain non-positive points', async () => {
        installMockApi({
            analytics: (request) => buildAnalytics(request, {
                includeNonPositive: true,
            }),
        });
        window.localStorage.setItem('asset-inspector.yscale.asset-spy', 'log');

        render(
            <AssetDetailPanel
                allTags={[]}
                asset={asset}
                onClose={() => undefined}
                onSaveTags={() => undefined}
                open
            />,
        );

        await waitForAssetDetailPanelReady();

        await waitFor(() => {
            expect(screen.getByTestId('asset-detail-yscale-linear')).toHaveAttribute('aria-pressed', 'true');
        });

        expect(screen.getByTestId('asset-detail-yscale-log')).toBeDisabled();
        expect(screen.getByTestId('asset-detail-log-disabled-reason')).toHaveTextContent('存在非正值，无法使用对数轴。');
    });
});