import { memo, useEffect, useMemo, useState } from 'react';

import type { StoredAsset } from '@quantdesk/shared';

import { isPriceAnalogWindow, useAssetAnalogs } from '../../hooks/use-asset-analogs';
import { useAssetDetail } from '../../hooks/use-asset-detail';
import { useAssetInspectorYScale } from '../../hooks/use-asset-inspector-yscale';
import { AssetDetailPanelContent } from './asset-detail-panel-content';

interface AssetDetailPanelProps {
    asset: StoredAsset | null;
    allTags: string[];
    contextLabel?: string;
    onClose: () => void;
    onSaveTags: (assetId: string, tags: string[]) => void | Promise<void>;
    open: boolean;
}

const AssetDetailPanelComponent = ({
    allTags,
    asset,
    contextLabel = '资产池工作台',
    onClose,
    onSaveTags,
    open,
}: AssetDetailPanelProps) => {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [tagDraft, setTagDraft] = useState('');
    const {
        analytics,
        channelWidthSigma,
        error,
        isBackfilling,
        isLoadingAnalytics,
        isLoadingMetrics,
        metrics,
        regressionWindow,
        selectedWindow,
        setChannelWidthSigma,
        setDisplaySeriesMode,
        setRegressionWindow,
        setWindow,
        setVolWindow,
        volWindow,
    } = useAssetDetail(asset?.id ?? null);

    useEffect(() => {
        setTagDraft('');
    }, [asset?.id]);

    useEffect(() => {
        if (!open) {
            setIsFullscreen(false);
            return undefined;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, open]);

    const suggestions = useMemo(
        () =>
            allTags.filter(
                (entry) =>
                    (!asset || !asset.tags.includes(entry))
                    && (!tagDraft.trim() || entry.toLowerCase().includes(tagDraft.trim().toLowerCase())),
            ),
        [allTags, asset, tagDraft],
    );
    const primarySource = analytics?.meta.dataSource ?? metrics?.dataSource ?? 'unknown';
    const coverageLabel = analytics?.points.length
        ? `${analytics.points[0].date} 至 ${analytics.points[analytics.points.length - 1].date}`
        : metrics?.actualStartDate && metrics.actualEndDate
            ? `${metrics.actualStartDate} 至 ${metrics.actualEndDate}`
            : '暂无覆盖区间';
    const currentDisplayMode = analytics?.meta.effectiveDisplaySeriesMode ?? 'analysis';
    const analogs = useAssetAnalogs({
        assetId: asset?.id ?? null,
        endDate: analytics?.points.at(-1)?.date ?? null,
        startDate: analytics?.points[0]?.date ?? null,
        window: selectedWindow,
    });
    const latestDisplayValue = analytics?.points[analytics.points.length - 1]?.displayValue ?? metrics?.latestValue ?? null;
    const { logDisabledReason, setPreferredScale, yScale } = useAssetInspectorYScale(
        asset?.id ?? null,
        selectedWindow,
        currentDisplayMode,
        analytics?.points.map((point) => point.displayValue) ?? [],
    );

    if (!asset && !open) {
        return null;
    }

    if (!asset) {
        return null;
    }

    const formatSource = (source: string) => {
        switch (source) {
            case 'akshare-nav':
                return 'AKShare 原始净值';
            case 'akshare':
                return 'AKShare';
            case 'yahoo':
                return 'Yahoo Finance';
            case 'browser-mock':
                return 'Browser Mock';
            case 'csv':
                return 'CSV 导入';
            default:
                return source;
        }
    };

    const formatBasisLabel = (basis: 'adjustedClose' | 'close' | null) => {
        if (basis == null) {
            return '不可用';
        }

        if (basis === 'adjustedClose') {
            return 'adjustedClose';
        }

        return primarySource === 'akshare-nav' ? '净值' : 'close';
    };

    const seriesLabel = analytics?.meta.displaySeries === 'adjustedClose'
        ? '主图 · adjustedClose 口径'
        : primarySource === 'akshare-nav'
            ? '主图 · 净值口径'
            : '主图 · close 口径';
    const latestValueLabel = '当前展示值';
    const analysisBasisLabel = formatBasisLabel(analytics?.meta.analysisSeries ?? metrics?.analysisSeries ?? null);
    const analyticsUnavailable = analytics?.meta.analyticsAvailability === 'unavailable';
    const analyticsDegraded = analytics?.meta.analyticsAvailability === 'degraded';

    const addTag = (tag: string) => {
        const normalized = tag.trim();

        if (!normalized || asset.tags.includes(normalized)) {
            return;
        }

        onSaveTags(asset.id, [...asset.tags, normalized]);
        setTagDraft('');
    };

    const removeTag = (tag: string) => {
        onSaveTags(
            asset.id,
            asset.tags.filter((entry) => entry !== tag),
        );
    };

    const formatValue = (value: number | null) => {
        if (value == null || Number.isNaN(value)) {
            return '不可用';
        }

        if (Math.abs(value) >= 1000) {
            return value.toLocaleString('zh-CN', {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
            });
        }

        const digits = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 3 : 4;
        return value.toFixed(digits);
    };

    const formatPercent = (value: number | null) => {
        if (value == null || Number.isNaN(value)) {
            return analyticsUnavailable ? '不可用' : '历史不足';
        }

        return `${(value * 100).toFixed(2)}%`;
    };

    const formatRatio = (value: number | null) => {
        if (value == null || Number.isNaN(value)) {
            return analyticsUnavailable ? '不可用' : '历史不足';
        }

        return value.toFixed(2);
    };

    const toneClass = (value: number | null) => {
        if (value == null || Number.isNaN(value)) {
            return 'text-[var(--color-copy)]';
        }

        if (value > 0) {
            return 'text-[#216448]';
        }

        if (value < 0) {
            return 'text-[#9f3a29]';
        }

        return 'text-[var(--color-foreground)]';
    };

    return (
        <AssetDetailPanelContent
            analytics={analytics}
            analyticsDegraded={analyticsDegraded}
            analogError={analogs.error}
            analogResult={analogs.result}
            analogUnsupported={!isPriceAnalogWindow(selectedWindow)}
            analyticsUnavailable={analyticsUnavailable}
            analysisBasisLabel={analysisBasisLabel}
            asset={asset}
            channelWidthSigma={channelWidthSigma}
            contextLabel={contextLabel}
            coverageLabel={coverageLabel}
            currentDisplayMode={currentDisplayMode}
            error={error}
            formattedLatestValue={formatValue(latestDisplayValue)}
            formattedPeriodReturn={metrics ? formatPercent(metrics.periodReturn) : isLoadingMetrics ? '加载中' : analyticsUnavailable ? '不可用' : '历史不足'}
            formattedSharpeRatio={metrics ? formatRatio(metrics.sharpeRatio) : isLoadingMetrics ? '加载中' : analyticsUnavailable ? '不可用' : '历史不足'}
            formattedSource={formatSource(primarySource)}
            formattedVolatility={metrics ? formatPercent(metrics.annualizedVol) : isLoadingMetrics ? '加载中' : analyticsUnavailable ? '不可用' : '历史不足'}
            isBackfilling={isBackfilling}
            isFullscreen={isFullscreen}
            isLoadingAnalogs={analogs.isLoading}
            isLoadingAnalytics={isLoadingAnalytics}
            latestValueLabel={latestValueLabel}
            logDisabledReason={logDisabledReason}
            metrics={metrics}
            onAddTag={addTag}
            onChannelWidthSigmaChange={setChannelWidthSigma}
            onClose={onClose}
            onDisplayModeChange={setDisplaySeriesMode}
            onDraftChange={setTagDraft}
            onRegressionWindowChange={setRegressionWindow}
            onRemoveTag={removeTag}
            onToggleAnalog={analogs.toggleAnalogSelection}
            onToggleFullscreen={() => {
                setIsFullscreen((current) => !current);
            }}
            onVolWindowChange={setVolWindow}
            onWindowChange={setWindow}
            onYScaleChange={setPreferredScale}
            open={open}
            periodReturnToneClassName={metrics ? toneClass(metrics.periodReturn) : undefined}
            regressionWindow={regressionWindow}
            selectedWindow={selectedWindow}
            selectedAnalogIds={analogs.selectedAnalogIds}
            selectedAnalogs={analogs.selectedAnalogs}
            seriesLabel={seriesLabel}
            sharpeRatioToneClassName={metrics ? toneClass(metrics.sharpeRatio) : undefined}
            suggestions={suggestions}
            tagDraft={tagDraft}
            volWindow={volWindow}
            yScale={yScale}
        />
    );
};

export const AssetDetailPanel = memo(AssetDetailPanelComponent);

AssetDetailPanel.displayName = 'AssetDetailPanel';

