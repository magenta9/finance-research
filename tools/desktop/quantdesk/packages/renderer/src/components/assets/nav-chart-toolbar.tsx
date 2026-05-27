import type {
    EffectiveDisplaySeriesMode,
    RegressionWindow,
    RollingVolWindow,
} from '@quantdesk/shared';

import { Button } from '../button';
import type { AssetInspectorYScale } from '../../hooks/use-asset-inspector-yscale';

interface NavChartToolbarProps {
    analyticsAvailable: boolean;
    canShowRawObservation: boolean;
    channelWidthSigma: number;
    currentDisplayMode: EffectiveDisplaySeriesMode;
    logDisabledReason: string | null;
    onChannelWidthSigmaChange: (nextValue: number) => void;
    onDisplayModeChange: (nextValue: 'analysis' | 'raw') => void;
    onRegressionWindowChange: (nextValue: RegressionWindow) => void;
    onVolWindowChange: (nextValue: RollingVolWindow) => void;
    onYScaleChange: (nextValue: AssetInspectorYScale) => void;
    regressionWindow: RegressionWindow;
    volWindow: RollingVolWindow;
    yScale: AssetInspectorYScale;
}

const pillClass = (selected: boolean, disabled = false) => [
    'inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-medium transition',
    selected
        ? 'border-[var(--color-highlight-soft)] bg-[rgba(156,98,55,0.14)] text-[var(--color-foreground)] shadow-[0_8px_20px_rgba(156,98,55,0.14)]'
        : 'border-[color:var(--color-border)] bg-white/80 text-[var(--color-copy)] hover:border-[var(--color-highlight-soft)] hover:text-[var(--color-foreground)]',
    disabled ? 'cursor-not-allowed opacity-50' : '',
].join(' ');

const regressionWindowOptions: RegressionWindow[] = ['display', '1Y', '3Y', '5Y', 'ALL'];
const sigmaOptions = [1, 1.5, 2] as const;
const volOptions: RollingVolWindow[] = [20, 60, 120, 252];

const regressionWindowLabelMap: Record<RegressionWindow, string> = {
    display: '当前区间',
    '1Y': '1Y',
    '3Y': '3Y',
    '5Y': '5Y',
    ALL: 'ALL',
};

export const NavChartToolbar = ({
    analyticsAvailable,
    canShowRawObservation,
    channelWidthSigma,
    currentDisplayMode,
    logDisabledReason,
    onChannelWidthSigmaChange,
    onDisplayModeChange,
    onRegressionWindowChange,
    onVolWindowChange,
    onYScaleChange,
    regressionWindow,
    volWindow,
    yScale,
}: NavChartToolbarProps) => {
    const regressionDisabled = !analyticsAvailable;
    const rawDisabled = !canShowRawObservation && currentDisplayMode !== 'raw';
    const analysisDisabled = !analyticsAvailable;
    const headerGridClass = canShowRawObservation
        ? 'grid gap-4 lg:grid-cols-[1.2fr_1fr_1.2fr]'
        : 'grid gap-4 lg:grid-cols-[1fr_1.2fr]';

    return (
        <div className="rounded-[24px] border border-[rgba(120,86,60,0.14)] bg-[rgba(255,255,255,0.82)] p-4 shadow-[0_18px_48px_rgba(61,43,31,0.05)]">
            <div className={headerGridClass}>
                {canShowRawObservation && (
                    <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">序列模式</p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                aria-pressed={currentDisplayMode === 'analysis'}
                                className={pillClass(currentDisplayMode === 'analysis', analysisDisabled)}
                                data-testid="asset-detail-mode-analysis"
                                disabled={analysisDisabled}
                                onClick={() => {
                                    onDisplayModeChange('analysis');
                                }}
                                size="sm"
                                title={analysisDisabled ? '当前资产没有可用的计算序列。' : undefined}
                                tone="ghost"
                                type="button"
                            >
                                分析口径
                            </Button>
                            <Button
                                aria-pressed={currentDisplayMode === 'raw'}
                                className={pillClass(currentDisplayMode === 'raw', rawDisabled)}
                                data-testid="asset-detail-mode-raw"
                                disabled={rawDisabled}
                                onClick={() => {
                                    onDisplayModeChange('raw');
                                }}
                                size="sm"
                                title={rawDisabled ? '当前资产没有独立的原始观察序列。' : undefined}
                                tone="ghost"
                                type="button"
                            >
                                原始观察
                            </Button>
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Y 轴</p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            aria-pressed={yScale === 'linear'}
                            className={pillClass(yScale === 'linear')}
                            data-testid="asset-detail-yscale-linear"
                            onClick={() => {
                                onYScaleChange('linear');
                            }}
                            size="sm"
                            tone="ghost"
                            type="button"
                        >
                            线性
                        </Button>
                        <Button
                            aria-pressed={yScale === 'log'}
                            className={pillClass(yScale === 'log', logDisabledReason != null)}
                            data-testid="asset-detail-yscale-log"
                            disabled={logDisabledReason != null}
                            onClick={() => {
                                onYScaleChange('log');
                            }}
                            size="sm"
                            title={logDisabledReason ?? undefined}
                            tone="ghost"
                            type="button"
                        >
                            对数
                        </Button>
                    </div>
                    {logDisabledReason && (
                        <p className="text-xs text-[#9f6a22]" data-testid="asset-detail-log-disabled-reason">
                            {logDisabledReason}
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">Vol 窗口</p>
                    <div className="flex flex-wrap gap-2">
                        {volOptions.map((option) => (
                            <Button
                                aria-pressed={volWindow === option}
                                className={pillClass(volWindow === option)}
                                data-testid={`asset-detail-vol-window-${option}`}
                                key={option}
                                onClick={() => {
                                    onVolWindowChange(option);
                                }}
                                size="sm"
                                tone="ghost"
                                type="button"
                            >
                                {option}
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">回归窗口</p>
                    <div className="flex flex-wrap gap-2">
                        {regressionWindowOptions.map((option) => (
                            <Button
                                aria-pressed={regressionWindow === option}
                                className={pillClass(regressionWindow === option, regressionDisabled)}
                                data-testid={`asset-detail-regression-window-${option}`}
                                disabled={regressionDisabled}
                                key={option}
                                onClick={() => {
                                    onRegressionWindowChange(option);
                                }}
                                size="sm"
                                title={regressionDisabled ? '当前没有可用的价格序列用于回归。' : undefined}
                                tone="ghost"
                                type="button"
                            >
                                {regressionWindowLabelMap[option]}
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted)]">通道宽度</p>
                    <div className="flex flex-wrap gap-2">
                        {sigmaOptions.map((option) => (
                            <Button
                                aria-pressed={channelWidthSigma === option}
                                className={pillClass(channelWidthSigma === option, regressionDisabled)}
                                data-testid={`asset-detail-sigma-${String(option).replace('.', '-')}`}
                                disabled={regressionDisabled}
                                key={option}
                                onClick={() => {
                                    onChannelWidthSigmaChange(option);
                                }}
                                size="sm"
                                title={regressionDisabled ? '当前没有可用的价格序列用于回归。' : undefined}
                                tone="ghost"
                                type="button"
                            >
                                {option}σ
                            </Button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};