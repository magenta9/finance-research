import { useEffect, useRef, useState } from 'react';

import type {
    AssetMetricsResult,
    AssetSeriesAnalyticsResult,
    DisplaySeriesMode,
    RegressionWindow,
    RollingVolWindow,
} from '@quantdesk/shared';

import { apiClient } from '../lib/api-client';

export type TimeWindow = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'ALL';

export const TIME_WINDOWS: TimeWindow[] = ['1M', '3M', '6M', '1Y', '3Y', '5Y', 'ALL'];

interface AssetDetailState {
    analytics: AssetSeriesAnalyticsResult | null;
    metrics: AssetMetricsResult | null;
    isLoadingAnalytics: boolean;
    isLoadingMetrics: boolean;
    isBackfilling: boolean;
    error: string | null;
    selectedWindow: TimeWindow;
    displaySeriesMode: DisplaySeriesMode;
    regressionWindow: RegressionWindow;
    channelWidthSigma: number;
    volWindow: RollingVolWindow;
}

const INITIAL_STATE: AssetDetailState = {
    analytics: null,
    metrics: null,
    isLoadingAnalytics: false,
    isLoadingMetrics: false,
    isBackfilling: false,
    error: null,
    selectedWindow: '1Y',
    displaySeriesMode: 'analysis',
    regressionWindow: 'display',
    channelWidthSigma: 2,
    volWindow: 60,
};

export const DEFAULT_DISPLAY_SERIES_MODE: DisplaySeriesMode = 'analysis';

export const DEFAULT_REGRESSION_WINDOW: RegressionWindow = 'display';

export const DEFAULT_CHANNEL_WIDTH_SIGMA = 2;

export const DEFAULT_VOL_WINDOW: RollingVolWindow = 60;

const WINDOW_MONTHS: Record<Exclude<TimeWindow, 'ALL'>, number> = {
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
    '3Y': 36,
    '5Y': 60,
};

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const shiftMonths = (endDate: string, months: number) => {
    const cursor = new Date(`${endDate}T00:00:00Z`);
    cursor.setUTCMonth(cursor.getUTCMonth() - months);
    return formatDate(cursor);
};

const buildQueryStartDate = (window: TimeWindow, endDate: string) =>
    window === 'ALL' ? '1970-01-01' : shiftMonths(endDate, WINDOW_MONTHS[window]);

const buildBackfillStartDate = (window: TimeWindow, endDate: string) =>
    window === 'ALL' ? null : shiftMonths(endDate, WINDOW_MONTHS[window]);

export const useAssetDetail = (assetId: string | null) => {
    const [state, setState] = useState(INITIAL_STATE);
    const activeRequestRef = useRef(0);
    const previousAssetIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!assetId) {
            activeRequestRef.current += 1;
            previousAssetIdRef.current = null;
            setState((current) => ({
                ...current,
                analytics: null,
                metrics: null,
                isBackfilling: false,
                isLoadingAnalytics: false,
                isLoadingMetrics: false,
                error: null,
            }));
            return;
        }

        const requestId = ++activeRequestRef.current;
        const endDate = formatDate(new Date());
        const startDate = buildQueryStartDate(state.selectedWindow, endDate);
        const backfillStartDate = buildBackfillStartDate(state.selectedWindow, endDate);
        const resetData = previousAssetIdRef.current !== assetId;

        previousAssetIdRef.current = assetId;

        const isStale = () => requestId !== activeRequestRef.current;

        const assignError = (message: string) => {
            if (isStale()) {
                return;
            }

            setState((current) => ({
                ...current,
                error: message,
            }));
        };

        const fetchCurrent = async (backgroundRefresh: boolean) => {
            if (!backgroundRefresh) {
                setState((current) => ({
                    ...current,
                    analytics: resetData ? null : current.analytics,
                    error: null,
                    isBackfilling: false,
                    isLoadingAnalytics: true,
                    isLoadingMetrics: true,
                    metrics: resetData ? null : current.metrics,
                }));
            }

            const analyticsPromise = apiClient.data.getAssetSeriesAnalytics({
                assetId,
                channelWidthSigma: state.channelWidthSigma,
                displayEndDate: endDate,
                displaySeriesMode: state.displaySeriesMode,
                displayStartDate: startDate,
                includeRegression: true,
                regressionWindow: state.regressionWindow,
                volWindow: state.volWindow,
            }).then((analytics) => {
                if (isStale()) {
                    return null;
                }

                setState((current) => ({
                    ...current,
                    analytics,
                    isLoadingAnalytics: false,
                }));

                return analytics;
            }).catch((error) => {
                if (!isStale()) {
                    setState((current) => ({
                        ...current,
                        isLoadingAnalytics: false,
                    }));
                    assignError(error instanceof Error ? error.message : '图表分析加载失败');
                }

                return null;
            });

            void apiClient.data.getAssetMetrics({
                assetId,
                endDate,
                startDate,
            }).then((metrics) => {
                if (isStale()) {
                    return;
                }

                setState((current) => ({
                    ...current,
                    isLoadingMetrics: false,
                    metrics,
                }));
            }).catch((error) => {
                if (!isStale()) {
                    setState((current) => ({
                        ...current,
                        isLoadingMetrics: false,
                    }));
                    assignError(error instanceof Error ? error.message : '指标加载失败');
                }
            });

            return analyticsPromise;
        };

        const run = async () => {
            const analytics = await fetchCurrent(false);

            if (isStale() || !backfillStartDate) {
                return;
            }

            const needsBackfill = analytics == null
                || analytics.points.length === 0
                || analytics.points[0].date > backfillStartDate;

            if (!needsBackfill) {
                return;
            }

            setState((current) => ({
                ...current,
                isBackfilling: true,
            }));

            try {
                await apiClient.data.syncPrices({
                    assetIds: [assetId],
                    endDate,
                    priority: 'background',
                    startDate: backfillStartDate,
                });
            } catch (error) {
                if (!isStale()) {
                    assignError(error instanceof Error ? error.message : '后台补数失败');
                    setState((current) => ({
                        ...current,
                        isBackfilling: false,
                    }));
                }
                return;
            }

            if (isStale()) {
                return;
            }

            await fetchCurrent(true);

            if (!isStale()) {
                setState((current) => ({
                    ...current,
                    isBackfilling: false,
                }));
            }
        };

        void run();
    }, [
        assetId,
        state.channelWidthSigma,
        state.displaySeriesMode,
        state.regressionWindow,
        state.selectedWindow,
        state.volWindow,
    ]);

    return {
        ...state,
        setWindow: (selectedWindow: TimeWindow) => {
            setState((current) => ({
                ...current,
                selectedWindow,
            }));
        },
        setDisplaySeriesMode: (displaySeriesMode: DisplaySeriesMode) => {
            setState((current) => ({
                ...current,
                displaySeriesMode,
            }));
        },
        setRegressionWindow: (regressionWindow: RegressionWindow) => {
            setState((current) => ({
                ...current,
                regressionWindow,
            }));
        },
        setChannelWidthSigma: (channelWidthSigma: number) => {
            setState((current) => ({
                ...current,
                channelWidthSigma,
            }));
        },
        setVolWindow: (volWindow: RollingVolWindow) => {
            setState((current) => ({
                ...current,
                volWindow,
            }));
        },
    };
};