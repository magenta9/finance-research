import type {
    AssetMetricsResult,
    AssetSeriesAnalyticsResult,
    DisplaySeriesMode,
    EffectiveDisplaySeriesMode,
    PricePatternAnalog,
    PricePatternAnalogSearchResult,
    RegressionWindow,
    RollingVolWindow,
    StoredAsset,
} from '@quantdesk/shared';

import { Badge } from '../badge';
import { Button } from '../button';
import type { AssetInspectorYScale } from '../../hooks/use-asset-inspector-yscale';
import { TIME_WINDOWS, type TimeWindow } from '../../hooks/use-asset-detail';
import {
    AssetMetadataSection,
    AssetTagManagementSection,
} from './asset-detail-panel-sections';
import { AssetAnalogSection } from './asset-analog-section';
import { DrawdownSubChart } from './drawdown-sub-chart';
import { NavChartToolbar } from './nav-chart-toolbar';
import { NavMainChart } from './nav-main-chart';
import { RollingVolSubChart } from './rolling-vol-sub-chart';

interface AssetDetailPanelContentProps {
    analytics: AssetSeriesAnalyticsResult | null;
    analyticsDegraded: boolean;
    analyticsUnavailable: boolean;
    analogError: string | null;
    analogResult: PricePatternAnalogSearchResult | null;
    analogUnsupported: boolean;
    analysisBasisLabel: string;
    asset: StoredAsset;
    channelWidthSigma: number;
    contextLabel: string;
    coverageLabel: string;
    currentDisplayMode: EffectiveDisplaySeriesMode;
    error: string | null;
    formattedLatestValue: string;
    formattedPeriodReturn: string;
    formattedSharpeRatio: string;
    formattedSource: string;
    formattedVolatility: string;
    isBackfilling: boolean;
    isFullscreen: boolean;
    isLoadingAnalogs: boolean;
    isLoadingAnalytics: boolean;
    latestValueLabel: string;
    logDisabledReason: string | null;
    metrics: AssetMetricsResult | null;
    onAddTag: (tag: string) => void;
    onChannelWidthSigmaChange: (value: number) => void;
    onClose: () => void;
    onDisplayModeChange: (mode: DisplaySeriesMode) => void;
    onDraftChange: (value: string) => void;
    onRegressionWindowChange: (window: RegressionWindow) => void;
    onRemoveTag: (tag: string) => void;
    onToggleAnalog: (analogId: string) => void;
    onToggleFullscreen: () => void;
    onVolWindowChange: (window: RollingVolWindow) => void;
    onWindowChange: (window: TimeWindow) => void;
    onYScaleChange: (scale: AssetInspectorYScale) => void;
    open: boolean;
    periodReturnToneClassName?: string;
    regressionWindow: RegressionWindow;
    selectedAnalogIds: string[];
    selectedAnalogs: PricePatternAnalog[];
    selectedWindow: TimeWindow;
    seriesLabel: string;
    sharpeRatioToneClassName?: string;
    suggestions: string[];
    tagDraft: string;
    volWindow: RollingVolWindow;
    yScale: AssetInspectorYScale;
}

export const AssetDetailPanelContent = ({
    analytics,
    analyticsDegraded,
    analyticsUnavailable,
    analogError,
    analogResult,
    analogUnsupported,
    analysisBasisLabel,
    asset,
    channelWidthSigma,
    contextLabel,
    coverageLabel,
    currentDisplayMode,
    error,
    formattedLatestValue,
    formattedPeriodReturn,
    formattedSharpeRatio,
    formattedSource,
    formattedVolatility,
    isBackfilling,
    isFullscreen,
    isLoadingAnalogs,
    isLoadingAnalytics,
    latestValueLabel,
    logDisabledReason,
    metrics,
    onAddTag,
    onChannelWidthSigmaChange,
    onClose,
    onDisplayModeChange,
    onDraftChange,
    onRegressionWindowChange,
    onRemoveTag,
    onToggleAnalog,
    onToggleFullscreen,
    onVolWindowChange,
    onWindowChange,
    onYScaleChange,
    open,
    periodReturnToneClassName,
    regressionWindow,
    selectedAnalogIds,
    selectedAnalogs,
    selectedWindow,
    seriesLabel,
    sharpeRatioToneClassName,
    suggestions,
    tagDraft,
    volWindow,
    yScale,
}: AssetDetailPanelContentProps) => {
    const isVisible = open;

    return (
        <div
            aria-hidden={!isVisible}
            className={[
                'fixed inset-0 z-50 flex justify-end transition-[visibility] duration-300',
                isVisible ? 'visible pointer-events-auto' : 'invisible pointer-events-none',
            ].join(' ')}
        >
            <Button
                aria-label="关闭标的详情抽屉"
                className={[
                    'absolute inset-0 h-full w-full rounded-none border-0 bg-[rgba(23,19,16,0.42)] px-0 py-0 shadow-none backdrop-blur-[2px] transition-opacity duration-300 hover:bg-[rgba(23,19,16,0.42)]',
                    isVisible ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
                onClick={onClose}
                size="sm"
                tabIndex={isVisible ? 0 : -1}
                tone="ghost"
                type="button"
            >
                <span className="sr-only">关闭标的详情抽屉</span>
            </Button>

            <aside
                className={[
                    'relative flex h-full w-full flex-col overflow-hidden border-[rgba(120,86,60,0.18)] bg-[linear-gradient(180deg,rgba(255,251,245,0.98),rgba(246,239,228,0.98))] transition-transform duration-300 ease-out',
                    isFullscreen
                        ? 'max-w-none border-l-0 shadow-[0_0_120px_rgba(23,19,16,0.2)]'
                        : 'max-w-[840px] border-l shadow-[-36px_0_96px_rgba(23,19,16,0.16)]',
                    isVisible ? 'translate-x-0' : 'translate-x-full',
                ].join(' ')}
                data-testid="asset-detail-panel"
            >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(205,167,116,0.18),transparent_34%),radial-gradient(circle_at_78%_18%,rgba(139,92,52,0.12),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.28),transparent_60%)]" />
                <div className="pointer-events-none absolute inset-y-0 right-0 w-[220px] border-l border-[rgba(120,86,60,0.08)] opacity-60 [background-image:linear-gradient(rgba(120,86,60,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(120,86,60,0.08)_1px,transparent_1px)] [background-size:26px_26px]" />

                <div className="relative flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-5 lg:px-6">
                    <section className="relative overflow-hidden rounded-[20px] border border-[rgba(120,86,60,0.18)] bg-[linear-gradient(140deg,rgba(255,255,255,0.9),rgba(245,233,214,0.82))] p-4 shadow-[0_14px_38px_rgba(61,43,31,0.08)] sm:p-5">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(159,122,55,0.16),transparent_28%),linear-gradient(120deg,transparent,rgba(255,255,255,0.28)_38%,transparent_78%)]" />
                        <div className="relative flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-[11px] uppercase tracking-[0.34em] text-[var(--color-muted)]">
                                    Asset Inspector
                                </p>
                                <h2 className="mt-2 font-display text-3xl leading-none text-[var(--color-foreground)] sm:text-4xl">
                                    {asset.symbol}
                                </h2>
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-copy)]">{asset.name}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge tone="muted">{contextLabel}</Badge>
                                <Button
                                    aria-label={isFullscreen ? '退出全屏标的详情' : '全屏查看标的详情'}
                                    aria-pressed={isFullscreen}
                                    className="h-11 w-11 rounded-full bg-white/70 px-0 text-sm text-[var(--color-copy)] transition hover:text-[var(--color-foreground)]"
                                    data-testid="asset-detail-fullscreen-toggle"
                                    onClick={onToggleFullscreen}
                                    size="sm"
                                    tone="ghost"
                                    type="button"
                                >
                                    {isFullscreen ? '↙' : '↗'}
                                </Button>
                                <Button
                                    aria-label="关闭标的详情"
                                    className="h-11 w-11 rounded-full bg-white/70 px-0 text-lg text-[var(--color-copy)] transition hover:text-[var(--color-foreground)]"
                                    data-testid="asset-detail-close"
                                    onClick={onClose}
                                    size="sm"
                                    tone="ghost"
                                    type="button"
                                >
                                    ×
                                </Button>
                            </div>
                        </div>

                        <div className="relative mt-4 flex flex-wrap gap-2">
                            <Badge>{asset.market}</Badge>
                            <Badge tone="accent">{asset.assetClass}</Badge>
                            <Badge tone="accent">{asset.currency}</Badge>
                            <Badge tone="muted">{selectedWindow} 窗口</Badge>
                        </div>

                        <div className="relative mt-4 grid gap-3 sm:grid-cols-3">
                            <InspectorStatCard label="展示序列" value={seriesLabel} />
                            <InspectorStatCard label="数据来源" value={formattedSource} />
                            <InspectorStatCard label="分析口径" value={analysisBasisLabel} />
                        </div>
                    </section>

                    <div className={[
                        'mt-4 grid gap-4',
                        isFullscreen ? '2xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]' : 'xl:grid-cols-[1.15fr_0.85fr]',
                    ].join(' ')}>
                        <section className="rounded-[20px] border border-[rgba(120,86,60,0.16)] bg-[rgba(255,252,248,0.76)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.26em] text-[var(--color-muted)]">
                                        {seriesLabel}
                                    </p>
                                    <p className="mt-2 text-sm text-[var(--color-copy)]">
                                        区间：{coverageLabel}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {TIME_WINDOWS.map((window) => (
                                        <Button
                                            className={[
                                                'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                                                selectedWindow === window
                                                    ? 'border-[var(--color-highlight-soft)] bg-[rgba(156,98,55,0.14)] text-[var(--color-foreground)] shadow-[0_8px_24px_rgba(156,98,55,0.12)]'
                                                    : 'border-[color:var(--color-border)] bg-white/78 text-[var(--color-copy)] hover:border-[var(--color-highlight-soft)] hover:text-[var(--color-foreground)]',
                                            ].join(' ')}
                                            data-testid={`asset-detail-window-${window}`}
                                            key={window}
                                            onClick={() => {
                                                onWindowChange(window);
                                            }}
                                            size="sm"
                                            tone="ghost"
                                            type="button"
                                        >
                                            {window}
                                        </Button>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-4 space-y-4">
                                {analytics && (
                                    <NavChartToolbar
                                        analyticsAvailable={!analyticsUnavailable}
                                        canShowRawObservation={analytics.meta.canShowRawObservation}
                                        channelWidthSigma={channelWidthSigma}
                                        currentDisplayMode={currentDisplayMode}
                                        logDisabledReason={logDisabledReason}
                                        onChannelWidthSigmaChange={onChannelWidthSigmaChange}
                                        onDisplayModeChange={onDisplayModeChange}
                                        onRegressionWindowChange={onRegressionWindowChange}
                                        onVolWindowChange={onVolWindowChange}
                                        onYScaleChange={onYScaleChange}
                                        regressionWindow={regressionWindow}
                                        volWindow={volWindow}
                                        yScale={yScale}
                                    />
                                )}

                                {analyticsUnavailable && (
                                    <div className="rounded-[16px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.05)] p-4 text-sm leading-6 text-[#7d2c22]" data-testid="asset-detail-analytics-banner">
                                        当前时间窗口缺少可用于计算的有效价格点。区间收益、Sharpe、回撤、滚动波动率与回归分析暂不可用。
                                    </div>
                                )}
                                {analyticsDegraded && analytics?.meta.degradationReason === 'missing_adjusted_series' && (
                                    <div className="rounded-[16px] border border-[rgba(159,122,55,0.18)] bg-[rgba(159,122,55,0.08)] p-4 text-sm leading-6 text-[#87542f]" data-testid="asset-detail-degraded-banner">
                                        当前计算已统一使用 close 口径，便于先让回归、回撤和波动率功能可用。
                                    </div>
                                )}

                                {analytics ? (
                                    <>
                                        <NavMainChart
                                            analytics={analytics}
                                            analogOverlays={selectedAnalogs}
                                            channelWidthSigma={channelWidthSigma}
                                            seriesValueLabel={latestValueLabel}
                                            yScale={yScale}
                                        />
                                        <AssetAnalogSection
                                            analogError={analogError}
                                            analogResult={analogResult}
                                            analogUnsupported={analogUnsupported}
                                            isLoadingAnalogs={isLoadingAnalogs}
                                            onToggleAnalog={onToggleAnalog}
                                            selectedAnalogIds={selectedAnalogIds}
                                        />
                                        <DrawdownSubChart analytics={analytics} />
                                        <RollingVolSubChart analytics={analytics} />
                                    </>
                                ) : isLoadingAnalytics ? (
                                    <div className="flex h-[320px] items-center justify-center rounded-[16px] border border-[rgba(120,86,60,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,242,233,0.84))] text-sm text-[var(--color-copy)]">
                                        正在加载历史分析序列...
                                    </div>
                                ) : error ? (
                                    <div className="flex h-[320px] items-center justify-center rounded-[16px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.05)] px-6 text-center text-sm leading-6 text-[#9f3a29]">
                                        历史分析加载失败：{error}
                                    </div>
                                ) : (
                                    <div className="flex h-[320px] items-center justify-center rounded-[16px] border border-[rgba(120,86,60,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,242,233,0.84))] text-sm text-[var(--color-copy)]">
                                        当前时间窗口暂无可展示的历史分析数据。
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                                <MetricTile label={latestValueLabel} value={formattedLatestValue} />
                                <MetricTile
                                    label="区间收益"
                                    toneClassName={periodReturnToneClassName}
                                    value={formattedPeriodReturn}
                                />
                                <MetricTile
                                    hint={metrics?.tradingDays && metrics.tradingDays < 126 ? '至少 126 个交易日' : undefined}
                                    label="年化波动"
                                    value={formattedVolatility}
                                />
                                <MetricTile
                                    hint={metrics ? `Rf ${(metrics.riskFreeRate * 100).toFixed(2)}%` : undefined}
                                    label="Sharpe"
                                    toneClassName={sharpeRatioToneClassName}
                                    value={formattedSharpeRatio}
                                />
                            </div>

                            <div className="mt-4 rounded-[16px] border border-[rgba(120,86,60,0.14)] bg-[rgba(244,239,230,0.62)] px-4 py-3 text-sm leading-6 text-[var(--color-copy)]">
                                <p>
                                    当前统一口径：{analysisBasisLabel}，来源：{formattedSource}，年化因子按 252 个交易日。
                                </p>
                                {metrics?.analyticsAvailability === 'degraded' && metrics.degradationReason === 'missing_adjusted_series' && (
                                    <p className="text-[#9f6a22]">
                                        当前计算已统一使用 close 口径，后续再补充更精细的价格准确性优化。
                                    </p>
                                )}
                                {analyticsUnavailable && (
                                    <p className="text-[#9f3a29]">请先补齐当前窗口的有效价格点，再查看收益、回撤、波动率与回归结果。</p>
                                )}
                                {metrics?.tradingDays != null && metrics.tradingDays < 126 && (
                                    <p>当前仅有 {metrics.tradingDays} 个交易日，暂不展示年化波动与 Sharpe。</p>
                                )}
                                {isBackfilling && (
                                    <p className="text-[#9f6a22]">本地历史不足，正在后台补齐当前窗口所需区间。</p>
                                )}
                                {error && analytics && (
                                    <p className="text-[#9f3a29]">最近一次刷新失败：{error}</p>
                                )}
                            </div>
                        </section>

                        <div className="space-y-4">
                            <AssetTagManagementSection
                                assetTags={asset.tags}
                                onAddTag={onAddTag}
                                onDraftChange={onDraftChange}
                                onRemoveTag={onRemoveTag}
                                suggestions={suggestions}
                                tagDraft={tagDraft}
                            />

                            <AssetMetadataSection
                                assetMetadata={asset.metadata}
                                coverageLabel={coverageLabel}
                                createdAt={asset.createdAt.slice(0, 19).replace('T', ' ')}
                                updatedAt={asset.updatedAt.slice(0, 19).replace('T', ' ')}
                            />
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    );
};

interface InspectorStatCardProps {
    label: string;
    value: string;
}

const InspectorStatCard = ({ label, value }: InspectorStatCardProps) => (
    <div className="rounded-[20px] border border-[rgba(120,86,60,0.14)] bg-white/68 px-4 py-3 backdrop-blur-sm">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-muted)]">{label}</p>
        <p className="mt-2 text-sm font-medium text-[var(--color-foreground)]">{value}</p>
    </div>
);

interface MetricTileProps {
    hint?: string;
    label: string;
    toneClassName?: string;
    value: string;
}

const MetricTile = ({ hint, label, toneClassName, value }: MetricTileProps) => (
    <div className="rounded-[20px] border border-[rgba(120,86,60,0.14)] bg-white/82 px-4 py-3 shadow-[0_12px_30px_rgba(61,43,31,0.04)]">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">{label}</p>
        <p className={[
            'mt-2 font-display text-2xl leading-none text-[var(--color-foreground)]',
            toneClassName ?? '',
        ].join(' ')}>
            {value}
        </p>
        {hint && <p className="mt-2 text-xs text-[var(--color-copy)]">{hint}</p>}
    </div>
);