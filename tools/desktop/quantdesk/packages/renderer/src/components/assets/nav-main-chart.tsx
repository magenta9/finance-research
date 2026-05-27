import { useMemo } from 'react';

import type { AssetSeriesAnalyticsResult, PricePatternAnalog } from '@quantdesk/shared';
import {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import type { AssetInspectorYScale } from '../../hooks/use-asset-inspector-yscale';

interface NavMainChartProps {
    analytics: AssetSeriesAnalyticsResult;
    analogOverlays: PricePatternAnalog[];
    channelWidthSigma: number;
    seriesValueLabel: string;
    yScale: AssetInspectorYScale;
}

const analogOverlayPalette = ['#2f6d62', '#7a5caa', '#bf6f36', '#3f6f9f', '#9a4f64', '#5f7f31'];

type AnalogOverlayKey = `analogOverlayValue${number}`;
type AnalogForwardOverlayKey = `analogForwardOverlayValue${number}`;

type ChartDataRow = AssetSeriesAnalyticsResult['points'][number] & {
    regressionLower: number | null;
    regressionMid: number | null;
    regressionUpper: number | null;
} & Partial<Record<AnalogOverlayKey | AnalogForwardOverlayKey, number | null>>;

const analogOverlayKey = (index: number): AnalogOverlayKey => `analogOverlayValue${index}`;
const analogForwardOverlayKey = (index: number): AnalogForwardOverlayKey => `analogForwardOverlayValue${index}`;

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
        return '不可用';
    }

    return `${(value * 100).toFixed(2)}%`;
};

const regressionStatusLabelMap: Record<AssetSeriesAnalyticsResult['regression']['status'], string> = {
    ok: '回归可用',
    insufficient_samples: '样本不足',
    degenerate_series: '序列退化',
    disabled: '回归关闭',
};

export const NavMainChart = ({
    analytics,
    analogOverlays,
    channelWidthSigma,
    seriesValueLabel,
    yScale,
}: NavMainChartProps) => {
    const latestTargetDate = analytics.points.at(-1)?.date ?? null;
    const chartData = useMemo(() => {
        const fitMap = new Map(analytics.regression.fitFull.map((point) => [point.date, point]));
        const anchorValue = analytics.points.at(-1)?.displayValue ?? null;
        const targetEndIndex = analytics.points.length - 1;
        const maxForwardLength = Math.max(0, ...analogOverlays.map((analog) => analog.forwardPaths['3M']?.length ?? 0));

        const rows: ChartDataRow[] = analytics.points.map((point) => {
            const fit = fitMap.get(point.date);

            return {
                ...point,
                regressionLower: fit?.lower ?? null,
                regressionMid: fit?.mid ?? null,
                regressionUpper: fit?.upper ?? null,
            };
        });

        for (let index = 0; index < maxForwardLength; index += 1) {
            rows.push({
                analysisValue: null,
                cumulativeLogReturn: null,
                date: `+${index + 1}`,
                displayValue: null,
                regressionLower: null,
                regressionMid: null,
                regressionUpper: null,
            });
        }

        if (anchorValue == null || anchorValue <= 0 || targetEndIndex < 0) {
            return rows;
        }

        analogOverlays.forEach((analog, analogIndex) => {
            const historyKey = analogOverlayKey(analogIndex);
            const forwardKey = analogForwardOverlayKey(analogIndex);
            const anchorLogReturn = analog.path.at(-1)?.normalizedLogReturn ?? null;

            if (anchorLogReturn == null) {
                return;
            }

            analog.path.forEach((pathPoint, pathIndex) => {
                const targetIndex = targetEndIndex - (analog.path.length - 1 - pathIndex);

                if (targetIndex < 0 || targetIndex >= rows.length) {
                    return;
                }

                rows[targetIndex][historyKey] = anchorValue * Math.exp(pathPoint.normalizedLogReturn - anchorLogReturn);
            });

            rows[targetEndIndex][forwardKey] = anchorValue;

            analog.forwardPaths['3M']?.forEach((forwardPoint, forwardIndex) => {
                const row = rows[targetEndIndex + forwardIndex + 1];

                if (!row) {
                    return;
                }

                row[forwardKey] = anchorValue * Math.exp(forwardPoint.normalizedLogReturn);
            });
        });

        return rows;
    }, [analogOverlays, analytics.points, analytics.regression.fitFull]);
    const showRegression = yScale === 'log'
        && analytics.regression.status === 'ok'
        && analytics.meta.analyticsAvailability !== 'unavailable';

    if (chartData.length === 0) {
        return (
            <div className="flex h-[360px] items-center justify-center rounded-[24px] border border-[rgba(120,86,60,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,242,233,0.84))] text-sm text-[var(--color-copy)]">
                当前时间窗口暂无可展示的主图数据。
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex h-[400px] flex-col rounded-[24px] border border-[rgba(120,86,60,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,242,233,0.84))] p-3 sm:p-4" data-testid="asset-detail-main-chart">
                {analogOverlays.length > 0 && (
                    <div className="mb-2 flex justify-end" data-testid="asset-detail-analog-legend">
                        <div className="flex max-w-full flex-wrap justify-end gap-x-4 gap-y-2 rounded-[14px] border border-[rgba(120,86,60,0.12)] bg-white/60 px-3 py-2">
                            {analogOverlays.map((analog, index) => (
                                <span className="inline-flex max-w-[320px] items-center gap-2 text-xs text-[var(--color-copy)]" key={analog.id}>
                                    <span aria-hidden="true" className="flex items-center gap-0.5">
                                        <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: analogOverlayPalette[index % analogOverlayPalette.length] }} />
                                        <span className="h-0.5 w-1 rounded-full opacity-70" style={{ backgroundColor: analogOverlayPalette[index % analogOverlayPalette.length] }} />
                                        <span className="h-0.5 w-1 rounded-full opacity-70" style={{ backgroundColor: analogOverlayPalette[index % analogOverlayPalette.length] }} />
                                    </span>
                                    <span className="font-medium text-[var(--color-foreground)]">{analog.asset.symbol}</span>
                                    <span className="min-w-0 truncate text-[var(--color-muted)]">{analog.asset.name}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                <div className="min-h-0 flex-1">
                    <ResponsiveContainer height="100%" width="100%">
                        <LineChart data={chartData} margin={{ bottom: 0, left: 0, right: 12, top: 8 }} syncId="asset-detail-series" syncMethod="value">
                            <CartesianGrid stroke="rgba(82, 63, 43, 0.08)" vertical={false} />
                            <XAxis
                                axisLine={false}
                                dataKey="date"
                                minTickGap={30}
                                tick={{ fill: 'rgba(89, 71, 54, 0.72)', fontSize: 12 }}
                                tickFormatter={(value: string) => (value.startsWith('+') ? value : value.slice(5))}
                                tickLine={false}
                            />
                            <YAxis
                                allowDataOverflow={false}
                                axisLine={false}
                                domain={['auto', 'auto']}
                                scale={yScale === 'log' ? 'log' : 'auto'}
                                tick={{ fill: 'rgba(89, 71, 54, 0.72)', fontSize: 12 }}
                                tickFormatter={(value: number) => formatValue(value)}
                                tickLine={false}
                                width={88}
                            />
                            <Tooltip
                                content={({ active, label, payload }) => {
                                    if (!active || !payload || payload.length === 0) {
                                        return null;
                                    }

                                    const point = payload[0]?.payload as typeof chartData[number];
                                    const analogValues = analogOverlays.map((analog, index) => ({
                                        analog,
                                        color: analogOverlayPalette[index % analogOverlayPalette.length],
                                        value: (point[analogOverlayKey(index)] ?? point[analogForwardOverlayKey(index)]) as number | null | undefined,
                                    })).filter((entry) => entry.value != null);

                                    return (
                                        <div className="min-w-[220px] rounded-[18px] border border-[rgba(168,141,109,0.22)] bg-[rgba(255,252,247,0.98)] px-4 py-3 text-sm text-[var(--color-copy)] shadow-[0_18px_42px_rgba(61,43,31,0.1)]">
                                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
                                            <div className="mt-3 space-y-2">
                                                <div className="flex items-center justify-between gap-4">
                                                    <span>{seriesValueLabel}</span>
                                                    <strong className="font-medium text-[var(--color-foreground)]">{formatValue(point.displayValue)}</strong>
                                                </div>
                                                <div className="flex items-center justify-between gap-4">
                                                    <span>累计对数收益</span>
                                                    <strong className="font-medium text-[var(--color-foreground)]">{formatPercent(point.cumulativeLogReturn)}</strong>
                                                </div>
                                                {analogValues.map((entry) => (
                                                    <div className="flex items-center justify-between gap-4" key={entry.analog.id}>
                                                        <span className="inline-flex items-center gap-2">
                                                            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                            {entry.analog.asset.symbol} analog
                                                        </span>
                                                        <strong className="font-medium text-[var(--color-foreground)]">{formatValue(entry.value ?? null)}</strong>
                                                    </div>
                                                ))}
                                                <p className="pt-1 text-xs text-[var(--color-muted)]">
                                                    计算基于 {analytics.meta.analysisSeries ?? analytics.meta.displaySeries}。
                                                </p>
                                            </div>
                                        </div>
                                    );
                                }}
                            />
                            {showRegression ? <Line dataKey="regressionUpper" dot={false} isAnimationActive={false} stroke="rgba(118,82,29,0.28)" strokeDasharray="4 4" strokeWidth={1.35} type="monotone" /> : null}
                            {showRegression ? <Line dataKey="regressionMid" dot={false} isAnimationActive={false} stroke="#6f4520" strokeWidth={1.9} type="monotone" /> : null}
                            {showRegression ? <Line dataKey="regressionLower" dot={false} isAnimationActive={false} stroke="rgba(118,82,29,0.28)" strokeDasharray="4 4" strokeWidth={1.35} type="monotone" /> : null}
                            {latestTargetDate ? (
                                <ReferenceLine
                                    ifOverflow="extendDomain"
                                    label={{
                                        fill: 'rgba(89,71,54,0.72)',
                                        fontSize: 11,
                                        position: 'insideTopRight',
                                        value: '当前',
                                    }}
                                    stroke="rgba(47,109,98,0.34)"
                                    strokeDasharray="2 5"
                                    strokeWidth={1.4}
                                    x={latestTargetDate}
                                />
                            ) : null}
                            {analogOverlays.map((analog, index) => (
                                <Line
                                    connectNulls={false}
                                    dataKey={analogOverlayKey(index)}
                                    dot={false}
                                    isAnimationActive={false}
                                    key={`${analog.id}:history`}
                                    name={`${analog.asset.symbol} analog history`}
                                    stroke={analogOverlayPalette[index % analogOverlayPalette.length]}
                                    strokeWidth={2}
                                    type="monotone"
                                />
                            ))}
                            {analogOverlays.map((analog, index) => (
                                <Line
                                    connectNulls={false}
                                    dataKey={analogForwardOverlayKey(index)}
                                    dot={false}
                                    isAnimationActive={false}
                                    key={`${analog.id}:forward`}
                                    name={`${analog.asset.symbol} analog forward`}
                                    stroke={analogOverlayPalette[index % analogOverlayPalette.length]}
                                    strokeDasharray="6 3"
                                    strokeWidth={2}
                                    type="monotone"
                                />
                            ))}
                            <Line dataKey="displayValue" dot={false} isAnimationActive={false} stroke="#9f7a37" strokeWidth={2.4} type="monotone" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {yScale === 'log' && (
                <div className="rounded-[20px] border border-[rgba(120,86,60,0.14)] bg-[rgba(244,239,230,0.62)] px-4 py-3 text-sm text-[var(--color-copy)]" data-testid="asset-detail-regression-strip">
                    {analytics.regression.status === 'ok' ? (
                        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-7">
                            <span>年化对数收益 {formatPercent(analytics.regression.muAnnualLog)}</span>
                            <span>年化简单收益 {formatPercent(analytics.regression.muAnnualSimple)}</span>
                            <span>年化残差波动 {formatPercent(analytics.regression.sigmaAnnual)}</span>
                            <span>R² {analytics.regression.r2?.toFixed(3) ?? '—'}</span>
                            <span>N {analytics.regression.n}</span>
                            <span>{analytics.regression.actualStartDate} 至 {analytics.regression.actualEndDate}</span>
                            <span>±{channelWidthSigma}σ</span>
                        </div>
                    ) : (
                        <p>{regressionStatusLabelMap[analytics.regression.status]}，当前不渲染回归通道。</p>
                    )}
                    <p className="mt-2 text-xs text-[var(--color-muted)]">统计描述，非预测区间。σ 与 R² 来自当前回归窗口，而非仅当前可见窗口。</p>
                </div>
            )}
        </div>
    );
};