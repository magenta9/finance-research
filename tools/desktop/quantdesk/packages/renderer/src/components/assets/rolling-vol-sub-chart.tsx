import type { AssetSeriesAnalyticsResult } from '@quantdesk/shared';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

interface RollingVolSubChartProps {
    analytics: AssetSeriesAnalyticsResult;
}

const formatPercent = (value: number | null) => {
    if (value == null || Number.isNaN(value)) {
        return '不可用';
    }

    return `${(value * 100).toFixed(2)}%`;
};

export const RollingVolSubChart = ({ analytics }: RollingVolSubChartProps) => {
    if (analytics.meta.analyticsAvailability === 'unavailable') {
        return (
            <div className="rounded-[24px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.05)] p-5 text-sm leading-6 text-[#7d2c22]" data-testid="asset-detail-rolling-vol-unavailable">
                滚动波动率不可用：当前资产缺少可持续分析的价格序列。
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm text-[var(--color-copy)]">
                <span className="rounded-[18px] border border-[rgba(120,86,60,0.12)] bg-[rgba(244,239,230,0.5)] px-3 py-2">窗口 {analytics.rollingVol.window} 日</span>
                <span className="rounded-[18px] border border-[rgba(120,86,60,0.12)] bg-[rgba(244,239,230,0.5)] px-3 py-2">均值 {formatPercent(analytics.rollingVol.mean)}</span>
            </div>

            <div className="h-[170px] rounded-[24px] border border-[rgba(120,86,60,0.14)] bg-[rgba(255,255,255,0.84)] p-3" data-testid="asset-detail-rolling-vol-chart">
                <ResponsiveContainer height="100%" width="100%">
                    <LineChart data={analytics.rollingVol.points} margin={{ bottom: 0, left: 0, right: 12, top: 8 }} syncId="asset-detail-series" syncMethod="value">
                        <CartesianGrid stroke="rgba(82, 63, 43, 0.08)" vertical={false} />
                        <XAxis
                            axisLine={false}
                            dataKey="date"
                            minTickGap={30}
                            tick={{ fill: 'rgba(89, 71, 54, 0.72)', fontSize: 12 }}
                            tickFormatter={(value: string) => value.slice(5)}
                            tickLine={false}
                        />
                        <YAxis
                            axisLine={false}
                            tick={{ fill: 'rgba(89, 71, 54, 0.72)', fontSize: 12 }}
                            tickFormatter={(value: number) => formatPercent(value)}
                            tickLine={false}
                            width={88}
                        />
                        <Tooltip
                            content={({ active, label, payload }) => {
                                if (!active || !payload || payload.length === 0) {
                                    return null;
                                }

                                const point = payload[0]?.payload as AssetSeriesAnalyticsResult['rollingVol']['points'][number];

                                return (
                                    <div className="min-w-[240px] rounded-[18px] border border-[rgba(168,141,109,0.22)] bg-[rgba(255,252,247,0.98)] px-4 py-3 text-sm text-[var(--color-copy)] shadow-[0_18px_42px_rgba(61,43,31,0.1)]">
                                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
                                        <div className="mt-3 space-y-2">
                                            <div className="flex items-center justify-between gap-4"><span>滚动年化波动率</span><strong className="text-[var(--color-foreground)]">{formatPercent(point.value)}</strong></div>
                                            <div className="flex items-center justify-between gap-4"><span>窗口起点</span><strong className="text-[var(--color-foreground)]">{point.windowStartDate ?? '—'}</strong></div>
                                            <div className="flex items-center justify-between gap-4"><span>窗口终点</span><strong className="text-[var(--color-foreground)]">{point.windowEndDate ?? '—'}</strong></div>
                                            <div className="flex items-center justify-between gap-4"><span>最大日收益</span><strong className="text-[var(--color-foreground)]">{formatPercent(point.maxDailyReturn)}</strong></div>
                                            <div className="flex items-center justify-between gap-4"><span>最小日收益</span><strong className="text-[var(--color-foreground)]">{formatPercent(point.minDailyReturn)}</strong></div>
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        <Line dataKey="value" dot={false} isAnimationActive={false} stroke="#216448" strokeWidth={2.2} type="monotone" />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};