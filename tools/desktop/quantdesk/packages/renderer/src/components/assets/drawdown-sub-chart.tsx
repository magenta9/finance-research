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

interface DrawdownSubChartProps {
    analytics: AssetSeriesAnalyticsResult;
}

const formatPercent = (value: number | null) => {
    if (value == null || Number.isNaN(value)) {
        return '不可用';
    }

    return `${(value * 100).toFixed(2)}%`;
};

const formatValue = (value: number | null) => {
    if (value == null || Number.isNaN(value)) {
        return '不可用';
    }

    return value.toFixed(value >= 10 ? 2 : 4);
};

const formatRecoveryLabel = (drawdown: AssetSeriesAnalyticsResult['drawdown']) => {
    if (drawdown.recoveryDays != null) {
        return `${drawdown.recoveryDays} 天`;
    }

    if (drawdown.unrecoveredDays != null) {
        return `未恢复 · 已 ${drawdown.unrecoveredDays} 天`;
    }

    return '—';
};

export const DrawdownSubChart = ({ analytics }: DrawdownSubChartProps) => {
    if (analytics.meta.analyticsAvailability === 'unavailable') {
        return (
            <div className="rounded-[24px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.05)] p-5 text-sm leading-6 text-[#7d2c22]" data-testid="asset-detail-drawdown-unavailable">
                回撤结构不可用：当前资产缺少可持续分析的价格序列。
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-4 text-sm text-[var(--color-copy)]">
                <div className="rounded-[18px] border border-[rgba(120,86,60,0.12)] bg-[rgba(244,239,230,0.5)] px-3 py-2">最大回撤 {formatPercent(analytics.drawdown.maxDrawdown)}</div>
                <div className="rounded-[18px] border border-[rgba(120,86,60,0.12)] bg-[rgba(244,239,230,0.5)] px-3 py-2">谷底日期 {analytics.drawdown.maxDrawdownDate ?? '—'}</div>
                <div className="rounded-[18px] border border-[rgba(120,86,60,0.12)] bg-[rgba(244,239,230,0.5)] px-3 py-2">持续时间 {analytics.drawdown.durationDays} 天</div>
                <div className="rounded-[18px] border border-[rgba(120,86,60,0.12)] bg-[rgba(244,239,230,0.5)] px-3 py-2">恢复时间 {formatRecoveryLabel(analytics.drawdown)}</div>
            </div>

            <div className="h-[170px] rounded-[24px] border border-[rgba(120,86,60,0.14)] bg-[rgba(255,255,255,0.84)] p-3" data-testid="asset-detail-drawdown-chart">
                <ResponsiveContainer height="100%" width="100%">
                    <LineChart data={analytics.drawdown.points} margin={{ bottom: 0, left: 0, right: 12, top: 8 }} syncId="asset-detail-series" syncMethod="value">
                        <CartesianGrid stroke="rgba(82, 63, 43, 0.08)" vertical={false} />
                        <XAxis axisLine={false} dataKey="date" hide tickLine={false} />
                        <YAxis
                            axisLine={false}
                            domain={['dataMin', 0]}
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

                                const point = payload[0]?.payload as AssetSeriesAnalyticsResult['drawdown']['points'][number];

                                return (
                                    <div className="min-w-[220px] rounded-[18px] border border-[rgba(168,141,109,0.22)] bg-[rgba(255,252,247,0.98)] px-4 py-3 text-sm text-[var(--color-copy)] shadow-[0_18px_42px_rgba(61,43,31,0.1)]">
                                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
                                        <div className="mt-3 space-y-2">
                                            <div className="flex items-center justify-between gap-4"><span>当日回撤</span><strong className="text-[var(--color-foreground)]">{formatPercent(point.drawdown)}</strong></div>
                                            <div className="flex items-center justify-between gap-4"><span>距前高</span><strong className="text-[var(--color-foreground)]">{point.daysSincePeak} 天</strong></div>
                                            <div className="flex items-center justify-between gap-4"><span>前高日期</span><strong className="text-[var(--color-foreground)]">{point.peakDate ?? '—'}</strong></div>
                                            <div className="flex items-center justify-between gap-4"><span>前高值</span><strong className="text-[var(--color-foreground)]">{formatValue(point.peakValue)}</strong></div>
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        <Line dataKey="drawdown" dot={false} isAnimationActive={false} stroke="#9f3a29" strokeWidth={2.2} type="monotone" />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};