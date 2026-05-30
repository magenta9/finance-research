import { Fragment, type CSSProperties, type ReactNode } from 'react';

import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import type { AllocationResult } from '@quantdesk/shared';

import { Button } from '../button';
import { DataTable, type DataTableColumn } from '../data-table';
import type {
    PortfolioPathDrawdownPoint,
    PortfolioPathDrawdownSegment,
} from './portfolio-path-drawdowns';
import { TradeBehaviorSection } from './trade-behavior-section';

const chartPalette = ['#9c6237', '#bd8c58', '#d9bc9a', '#5d4638', '#b54b3c', '#6a7b6f'];

const modeLabelMap = {
    erc: '等风险贡献',
    inverse_volatility: '反波动率加权',
    max_diversification: '最大分散化',
} as const;

const strategyLabelMap = {
    ...modeLabelMap,
    max_diversification_research_v1: '最大分散化 MDP v3',
    ewmac_trend_following: 'EWMAC 趋势跟随',
    active_dual_momentum_gtaa: 'Active Dual Momentum',
} as const;

const cadenceLabelMap = {
    monthly: '月度调仓',
    none: '买入持有',
    quarterly: '季度调仓',
    weekly: '周度调仓',
} as const;

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const directionLabelMap = {
    long: '多',
    short: '空',
} as const;

const chartPercentFormatter = (value: string | number) => `${Number(value).toFixed(1)}%`;

const chartValueFormatter = (value: number | null) => {
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

const correlationToneClassName = (value: number) => {
    if (value > 0.05) {
        return 'correlation-heat-cell-positive';
    }

    if (value < -0.05) {
        return 'correlation-heat-cell-negative';
    }

    return 'correlation-heat-cell-neutral';
};

const correlationHeatCellStyle = (value: number) => {
    const magnitude = Math.min(Math.abs(value), 1);

    return {
        '--correlation-alpha': (0.1 + magnitude * 0.44).toFixed(3),
        '--correlation-glow-alpha': (0.06 + magnitude * 0.18).toFixed(3),
    } as CSSProperties;
};

const ChartCard = ({
    children,
    title,
}: {
    children: ReactNode;
    title: string;
}) => (
    <article className="rounded-[24px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.82)] p-4 shadow-[0_16px_38px_rgba(61,43,31,0.05)]">
        <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">{title}</p>
        <div className="mt-4">{children}</div>
    </article>
);

const assetChipClassName = [
    'inline-flex items-center rounded-full border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-highlight)] transition',
    'hover:bg-[rgba(156,98,55,0.14)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(188,140,88,0.28)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
].join(' ');

const AssetChipButton = ({
    label,
    onClick,
    title,
}: {
    label: string;
    onClick: () => void;
    title?: string;
}) => (
    <Button
        aria-label={title ?? `打开 ${label} 详情`}
        className={`${assetChipClassName} h-auto min-h-0 shadow-none`}
        onClick={onClick}
        size="sm"
        title={title ?? `打开 ${label} 详情`}
        tone="ghost"
        type="button"
    >
        {label}
    </Button>
);

type AssetDateCoverageRow = NonNullable<AllocationResult['diagnostics']['assetDateCoverage']>[number];
type ActiveDualMomentumRebalanceRecord = NonNullable<AllocationResult['diagnostics']['activeDualMomentum']>['rebalanceRecords'][number];
type WeightRow = AllocationResult['allocations'][number];
type PortfolioPathRow = NonNullable<AllocationResult['portfolioPath']>[number];
type ScenarioRow = NonNullable<AllocationResult['scenarioAnalysis']>[number];

interface HoldingDisplayRow {
    assetId?: string;
    direction?: 'long' | 'short';
    symbol: string;
    weight: number;
}

const findActiveDualMomentumRecordForDate = (
    records: ActiveDualMomentumRebalanceRecord[],
    date: string,
) => {
    let matchedRecord: ActiveDualMomentumRebalanceRecord | undefined;

    records.forEach((record) => {
        if (record.date <= date) {
            matchedRecord = record;
        }
    });

    return matchedRecord;
};

const buildHoldingRowsFromRebalanceRecord = (record?: ActiveDualMomentumRebalanceRecord): HoldingDisplayRow[] =>
    (record?.holdings ?? [])
        .map((holding) => ({
            assetId: holding.assetId,
            direction: holding.direction,
            symbol: holding.symbol,
            weight: holding.weight,
        }))
        .sort((left, right) => right.weight - left.weight);

const buildHoldingRowsFromAllocations = (allocations: WeightRow[]): HoldingDisplayRow[] =>
    allocations
        .map((allocation) => ({
            assetId: allocation.assetId,
            direction: allocation.direction,
            symbol: allocation.symbol,
            weight: allocation.weight,
        }))
        .sort((left, right) => right.weight - left.weight);

const formatHoldingLabel = (holding: HoldingDisplayRow) => [
    holding.symbol,
    holding.direction ? directionLabelMap[holding.direction] : null,
    formatPercent(holding.weight),
].filter(Boolean).join(' ');

export interface AllocationVisualizationSectionsProps {
    assetCoverageById: Map<string, AssetDateCoverageRow>;
    assetIdBySymbol: Map<string, string>;
    chartRows: Array<{
        riskContribution: number;
        symbol: string;
        weight: number;
    }>;
    correlationLabels: string[];
    fallbackAssetIds: Set<string>;
    onOpenAssetDetail: (assetId: string) => void;
    portfolioPath: NonNullable<AllocationResult['portfolioPath']>;
    portfolioPathWithDrawdowns: {
        segments: PortfolioPathDrawdownSegment[];
        series: PortfolioPathDrawdownPoint[];
    };
    result: AllocationResult;
    scenarioAnalysis: ScenarioRow[];
}

const scenarioAssetClassPriorityMap: Record<string, Array<WeightRow['assetClass']>> = {
    '利率上升': ['fixed_income', 'cash', 'commodity'],
    '股市暴跌': ['equity', 'cash', 'fixed_income'],
    '通胀飙升': ['commodity', 'equity', 'fixed_income'],
    '经济衰退': ['fixed_income', 'equity', 'cash'],
    '温和增长': ['equity', 'fixed_income', 'commodity', 'alternative'],
};

export const AllocationVisualizationSections = ({
    assetCoverageById,
    assetIdBySymbol,
    chartRows,
    correlationLabels,
    fallbackAssetIds,
    onOpenAssetDetail,
    portfolioPath,
    portfolioPathWithDrawdowns,
    result,
    scenarioAnalysis,
}: AllocationVisualizationSectionsProps) => {
    const activeDualMomentumRecords = result.diagnostics.activeDualMomentum?.rebalanceRecords ?? [];
    const latestActiveDualMomentumRecord = activeDualMomentumRecords.at(-1);
    const latestHoldingRows = latestActiveDualMomentumRecord
        ? buildHoldingRowsFromRebalanceRecord(latestActiveDualMomentumRecord)
        : buildHoldingRowsFromAllocations(result.allocations);
    const latestCashWeight = latestActiveDualMomentumRecord?.cashWeight ?? 0;
    const hasCorrelationMatrix = correlationLabels.length > 0
        && result.correlationMatrix.matrix.length === correlationLabels.length
        && result.correlationMatrix.matrix.every((row) => row.length === correlationLabels.length);

    const getScenarioAssets = (scenarioName: string) => {
        const prioritizedClasses = scenarioAssetClassPriorityMap[scenarioName] ?? [];
        const prioritizedAllocations = prioritizedClasses.length > 0
            ? prioritizedClasses.flatMap((assetClass) => result.allocations.filter((allocation) => allocation.assetClass === assetClass))
            : result.allocations;
        const dedupedAllocations = Array.from(new Map(prioritizedAllocations.map((allocation) => [allocation.assetId, allocation])).values());

        return (dedupedAllocations.length > 0 ? dedupedAllocations : result.allocations).slice(0, 3);
    };

    const openAssetDetailBySymbol = (symbol: string) => {
        const assetId = assetIdBySymbol.get(symbol);

        if (assetId) {
            onOpenAssetDetail(assetId);
        }
    };

    const columns: Array<DataTableColumn<WeightRow>> = [
        {
            header: '标的',
            key: 'symbol',
            render: (row) => {
                const coverage = assetCoverageById.get(row.assetId);

                return (
                    <div>
                        <span className="font-display text-lg text-[var(--color-foreground)]">{row.symbol}</span>
                        <p className="mt-1 text-sm text-[var(--color-copy)]">{row.name}</p>
                        {coverage && (
                            <p
                                className={[
                                    'mt-1 text-xs',
                                    coverage.isFallback ? 'text-[rgba(159,58,41,0.8)]' : 'text-[var(--color-muted)]',
                                ].join(' ')}
                                data-testid={`allocation-coverage-${row.assetId}`}
                            >
                                {coverage.actualStartDate} ~ {coverage.actualEndDate}
                                {coverage.isFallback ? ' (数据降级)' : ''}
                            </p>
                        )}
                    </div>
                );
            },
        },
        {
            header: '权重',
            key: 'weight',
            render: (row) => formatPercent(row.weight),
        },
        {
            header: '风险贡献',
            key: 'riskContribution',
            render: (row) => formatPercent(row.riskContribution),
        },
        {
            header: '年化收益',
            key: 'annualizedReturn',
            render: (row) => formatPercent(row.annualizedReturn),
        },
        {
            header: '年化波动',
            key: 'annualizedVolatility',
            render: (row) => formatPercent(row.annualizedVolatility),
        },
    ];

    return (
        <>
            <ChartCard title="净值波动">
                {portfolioPath.length > 0 ? (
                    <div className="space-y-3">
                        <div className="h-[300px] w-full" data-testid="allocation-nav-chart">
                            <ResponsiveContainer height="100%" width="100%">
                                <LineChart data={portfolioPathWithDrawdowns.series} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                                    <CartesianGrid stroke="rgba(70,53,43,0.08)" vertical={false} />
                                    <XAxis
                                        axisLine={false}
                                        dataKey="date"
                                        minTickGap={28}
                                        tick={{ fill: 'rgba(89,71,54,0.72)', fontSize: 12 }}
                                        tickFormatter={(value: string) => value.slice(5)}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        allowDataOverflow={false}
                                        axisLine={false}
                                        domain={['auto', 'auto']}
                                        scale="log"
                                        tick={{ fill: 'rgba(89,71,54,0.72)', fontSize: 12 }}
                                        tickFormatter={(value: number) => chartValueFormatter(value)}
                                        tickLine={false}
                                        width={72}
                                    />
                                    <Tooltip
                                        content={({ active, label, payload }) => {
                                            if (!active || !payload || payload.length === 0) {
                                                return null;
                                            }

                                            const point = payload[0]?.payload as PortfolioPathRow;
                                            const drawdownPoint = payload.find((entry) => entry.dataKey === 'drawdownEquity')?.payload as PortfolioPathDrawdownPoint | undefined;
                                            const activeDualMomentumRecord = findActiveDualMomentumRecordForDate(activeDualMomentumRecords, point.date);
                                            const tooltipHoldings = buildHoldingRowsFromRebalanceRecord(activeDualMomentumRecord);

                                            return (
                                                <div className="min-w-[260px] rounded-[18px] border border-[rgba(168,141,109,0.22)] bg-[rgba(255,252,247,0.98)] px-4 py-3 text-sm text-[var(--color-copy)] shadow-[0_18px_42px_rgba(61,43,31,0.1)]">
                                                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
                                                    <div className="mt-3 space-y-2">
                                                        <div className="flex items-center justify-between gap-4">
                                                            <span>净值</span>
                                                            <strong className="font-medium text-[var(--color-foreground)]">{chartValueFormatter(point.equity)}</strong>
                                                        </div>
                                                        {drawdownPoint?.drawdownSegmentId && drawdownPoint.drawdownRatio != null && (
                                                            <div className="rounded-[14px] border border-[rgba(92,143,99,0.24)] bg-[rgba(92,143,99,0.08)] px-3 py-2">
                                                                <p className="text-[10px] uppercase tracking-[0.18em] text-[#5c8f63]">新高后最大回撤</p>
                                                                <div className="mt-2 space-y-1 text-xs text-[var(--color-foreground)]">
                                                                    <div className="flex items-center justify-between gap-4">
                                                                        <span>时间范围</span>
                                                                        <strong className="font-medium">
                                                                            {drawdownPoint.drawdownStartDate} ~ {drawdownPoint.drawdownTroughDate}
                                                                        </strong>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-4">
                                                                        <span>最大回撤</span>
                                                                        <strong className="font-medium text-[#5c8f63]">{formatPercent(drawdownPoint.drawdownRatio)}</strong>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {activeDualMomentumRecord && (
                                                            <div className="rounded-[14px] border border-[rgba(156,98,55,0.18)] bg-[rgba(156,98,55,0.07)] px-3 py-2" data-testid="allocation-nav-tooltip-holdings">
                                                                <div className="flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                                                                    <span>持仓</span>
                                                                    <span>{activeDualMomentumRecord.date}</span>
                                                                </div>
                                                                <div className="mt-2 space-y-1 text-xs text-[var(--color-foreground)]">
                                                                    {tooltipHoldings.slice(0, 5).map((holding) => (
                                                                        <div className="flex items-center justify-between gap-4" key={`${holding.symbol}-${holding.direction ?? 'net'}`}>
                                                                            <span>{holding.symbol}{holding.direction ? ` ${directionLabelMap[holding.direction]}` : ''}</span>
                                                                            <strong className="font-medium">{formatPercent(holding.weight)}</strong>
                                                                        </div>
                                                                    ))}
                                                                    {tooltipHoldings.length > 5 && (
                                                                        <p className="text-[var(--color-muted)]">另有 {tooltipHoldings.length - 5} 个持仓</p>
                                                                    )}
                                                                    {activeDualMomentumRecord.cashWeight > 0 && (
                                                                        <div className="flex items-center justify-between gap-4 text-[var(--color-muted)]">
                                                                            <span>现金</span>
                                                                            <strong className="font-medium">{formatPercent(activeDualMomentumRecord.cashWeight)}</strong>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <p className="pt-1 text-xs text-[var(--color-muted)]">横轴为时间，纵轴为净值的对数坐标。</p>
                                                    </div>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Line dataKey="equity" dot={false} isAnimationActive={false} stroke="#9c6237" strokeWidth={2.4} type="monotone" />
                                    {portfolioPathWithDrawdowns.segments.length > 0 && (
                                        <Line
                                            connectNulls={false}
                                            dataKey="drawdownEquity"
                                            dot={false}
                                            isAnimationActive={false}
                                            stroke="#5c8f63"
                                            strokeLinecap="round"
                                            strokeOpacity={0.9}
                                            strokeWidth={3.4}
                                            type="monotone"
                                        />
                                    )}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">
                            <p>横轴为时间，纵轴为净值的对数坐标</p>
                            {portfolioPathWithDrawdowns.segments.length > 0 && <p className="text-[#5c8f63]">绿色段表示新高后的最大回撤</p>}
                        </div>
                        {latestHoldingRows.length > 0 && (
                            <div className="rounded-[18px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.46)] p-3" data-testid="allocation-holdings-strip">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">
                                        {latestActiveDualMomentumRecord ? `${latestActiveDualMomentumRecord.date} 持仓比例` : '当前持仓比例'}
                                    </span>
                                    {latestHoldingRows.map((holding) => {
                                        const assetId = holding.assetId;

                                        return assetId ? (
                                            <Button
                                                className="h-auto min-h-0 rounded-full border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-highlight)] shadow-none hover:bg-[rgba(156,98,55,0.14)]"
                                                data-testid={`allocation-holding-chip-${holding.symbol}`}
                                                key={`${holding.symbol}-${holding.direction ?? 'net'}`}
                                                onClick={() => {
                                                    onOpenAssetDetail(assetId);
                                                }}
                                                size="sm"
                                                tone="ghost"
                                                type="button"
                                            >
                                                {formatHoldingLabel(holding)}
                                            </Button>
                                        ) : (
                                            <span className="rounded-full border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-highlight)]" key={`${holding.symbol}-${holding.direction ?? 'net'}`}>
                                                {formatHoldingLabel(holding)}
                                            </span>
                                        );
                                    })}
                                    {latestCashWeight > 0 && (
                                        <span className="rounded-full border border-[color:var(--color-border)] bg-white/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]" data-testid="allocation-holding-cash">
                                            现金 {formatPercent(latestCashWeight)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="rounded-[20px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-5 text-sm leading-6 text-[var(--color-copy)]">
                        当前结果未携带净值路径，暂时只展示统计结果。
                    </div>
                )}
            </ChartCard>

            {result.mode === 'max_diversification' && result.diversificationRatio != null && (
                <div className="rounded-[22px] border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] p-4 text-sm leading-6 text-[var(--color-foreground)]" data-testid="allocation-diversification-ratio">
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">分散化比率</p>
                    <p className="mt-2 font-display text-2xl">{result.diversificationRatio.toFixed(3)}</p>
                    <p className="mt-1 text-[var(--color-copy)]">单位组合波动所获得的加权单资产波动暴露效率。值越高说明分散化越有效。</p>
                </div>
            )}

            {result.mode === 'erc' && result.diagnostics.erc && (
                <div
                    className={[
                        'rounded-[22px] border p-4 text-sm leading-6',
                        result.diagnostics.erc.converged
                            ? 'border-[color:var(--color-border)] bg-[rgba(244,239,230,0.52)] text-[var(--color-foreground)]'
                            : 'border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.06)] text-[#7d2c22]',
                    ].join(' ')}
                    data-testid="allocation-erc-status"
                >
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--color-muted)]">ERC 收敛状态</p>
                    {result.diagnostics.erc.converged ? (
                        <p className="mt-2">已收敛（{result.diagnostics.erc.iterations} 轮，最大贡献偏差 {result.diagnostics.erc.maxContributionGap.toExponential(2)}）</p>
                    ) : (
                        <p className="mt-2">ERC 未收敛，当前结果近似于反波动率加权。最大贡献偏差 {result.diagnostics.erc.maxContributionGap.toFixed(4)}。</p>
                    )}
                </div>
            )}

            {result.diagnostics.fallbackUsed && result.mode !== 'erc' && (
                <div className="rounded-[22px] border border-[rgba(159,58,41,0.18)] bg-[rgba(159,58,41,0.06)] p-4 text-sm leading-6 text-[#7d2c22]" data-testid="allocation-fallback-warning">
                    <p className="text-xs uppercase tracking-[0.24em]">回退告警</p>
                    <p className="mt-2">优化器发生回退（原因：{result.diagnostics.fallbackReason}），当前结果近似于{result.diagnostics.fallbackEquivalentMode === 'equal_weight' ? '等权重' : '反波动率加权'}。</p>
                </div>
            )}

            <div className="space-y-6">
                <div className="grid gap-6 2xl:grid-cols-[1.02fr_0.98fr]">
                    <div className="space-y-6">
                        <ChartCard title="权重表">
                            <div data-testid="allocation-weights-table">
                                <DataTable
                                    columns={columns}
                                    emptyState="暂无权重结果。"
                                    getRowKey={(row) => row.assetId}
                                    onRowClick={(row) => {
                                        onOpenAssetDetail(row.assetId);
                                    }}
                                    rowClassName={(row) => (fallbackAssetIds.has(row.assetId) ? 'bg-[rgba(159,58,41,0.04)]' : '')}
                                    rows={result.allocations}
                                />
                            </div>
                        </ChartCard>
                    </div>

                    <div className="space-y-6">
                        <div className="grid gap-6 xl:grid-cols-2">
                            <ChartCard title="仓位饼图">
                                <div className="h-[280px] w-full" data-testid="allocation-weight-pie">
                                    <ResponsiveContainer height="100%" width="100%">
                                        <PieChart>
                                            <Pie
                                                cx="50%"
                                                cy="45%"
                                                data={chartRows}
                                                dataKey="weight"
                                                innerRadius="38%"
                                                nameKey="symbol"
                                                outerRadius="64%"
                                                paddingAngle={3}
                                            >
                                                {chartRows.map((entry, index) => (
                                                    <Cell fill={chartPalette[index % chartPalette.length]} key={entry.symbol} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={chartPercentFormatter} />
                                            <Legend />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </ChartCard>

                            <ChartCard title="风险贡献柱状图">
                                <div className="h-[280px] w-full" data-testid="allocation-risk-bar">
                                    <ResponsiveContainer height="100%" width="100%">
                                        <BarChart data={chartRows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                                            <CartesianGrid stroke="rgba(70,53,43,0.08)" vertical={false} />
                                            <XAxis dataKey="symbol" stroke="rgba(70,53,43,0.55)" tickLine={false} />
                                            <YAxis stroke="rgba(70,53,43,0.55)" tickFormatter={chartPercentFormatter} tickLine={false} width={44} />
                                            <Tooltip formatter={chartPercentFormatter} />
                                            <Bar dataKey="riskContribution" fill="#9c6237" radius={[10, 10, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </ChartCard>
                        </div>

                        <ChartCard title="组合诊断">
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.48)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                                    <p>策略：{strategyLabelMap[result.strategy ?? result.mode]}</p>
                                    <p>调仓频率：{cadenceLabelMap[result.rebalanceCadence]}</p>
                                    <p>基准货币：{result.baseCurrency}</p>
                                    <p>对齐交易日：{result.diagnostics.alignedDates}</p>
                                    <p>求解器：{result.diagnostics.optimizer.toUpperCase()}</p>
                                    {result.diagnostics.strategyMix?.trendFollowing && (
                                        <p>配置 / 趋势：{formatPercent(result.diagnostics.strategyMix.allocationSleeveWeight)} / {formatPercent(result.diagnostics.strategyMix.trendFollowing.sleeveWeight)}</p>
                                    )}
                                    {result.diagnostics.strategyMix?.allocation && (
                                        <p>配置标的：{result.diagnostics.strategyMix.allocation.assetIds.length}</p>
                                    )}
                                </div>
                                <div className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.48)] p-4 text-sm leading-6 text-[var(--color-copy)]">
                                    <p>生成时间：{result.generatedAt.slice(0, 19).replace('T', ' ')}</p>
                                    <p>排除资产：{result.diagnostics.excludedAssets.length}</p>
                                    <p>告警数量：{result.diagnostics.warnings.length}</p>
                                    {result.diagnostics.rebalanceEventCount != null && <p>实际调仓：{result.diagnostics.rebalanceEventCount} 次</p>}
                                    {result.diagnostics.strategyMix?.trendFollowing && (
                                        <p>趋势 FDM：{result.diagnostics.strategyMix.trendFollowing.forecastDiversificationMultiplier.toFixed(2)}</p>
                                    )}
                                    {result.diagnostics.strategyMix?.trendFollowing && (
                                        <p>趋势标的：{result.diagnostics.strategyMix.trendFollowing.assetIds?.length ?? 0}</p>
                                    )}
                                    {result.diagnostics.strategyMix?.trendFollowing && (
                                        <p>趋势槽位：{result.diagnostics.strategyMix.trendFollowing.ruleSlotCount}</p>
                                    )}
                                </div>
                            </div>
                            {result.diagnostics.warnings.length > 0 && (
                                <div className="mt-4 space-y-2 rounded-[20px] border border-[rgba(181,75,60,0.18)] bg-[rgba(181,75,60,0.06)] p-4 text-sm leading-6 text-[#7d2c22]">
                                    {result.diagnostics.warnings.map((warning) => (
                                        <p key={warning}>- {warning}</p>
                                    ))}
                                </div>
                            )}
                        </ChartCard>

                        <TradeBehaviorSection
                            onOpenAssetDetail={onOpenAssetDetail}
                            trades={result.diagnostics.trades ?? []}
                        />

                        {scenarioAnalysis.length > 0 && (
                            <ChartCard title="情景分析">
                                <div className="grid gap-4 md:grid-cols-2" data-testid="allocation-scenario-grid">
                                    {scenarioAnalysis.map((scenario) => {
                                        const relatedAssets = getScenarioAssets(scenario.name);

                                        return (
                                            <article
                                                className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(244,239,230,0.52)] p-4 text-sm leading-6 text-[var(--color-copy)]"
                                                key={scenario.name}
                                            >
                                                <h3 className="font-display text-lg text-[var(--color-foreground)]">{scenario.name}</h3>
                                                <div className="mt-3 space-y-1">
                                                    <p>预估收益：{formatPercent(scenario.estimatedReturn)}</p>
                                                    <p>预估回撤：{formatPercent(scenario.estimatedDrawdown)}</p>
                                                </div>
                                                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">风险因子</p>
                                                <p className="mt-2 text-sm text-[var(--color-foreground)]">{scenario.riskFactors.join(' / ')}</p>
                                                <div className="mt-4">
                                                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">关联标的</p>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {relatedAssets.map((asset) => (
                                                            <AssetChipButton
                                                                key={asset.assetId}
                                                                label={asset.symbol}
                                                                onClick={() => { onOpenAssetDetail(asset.assetId); }}
                                                                title={`打开 ${asset.symbol} 详情`}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            </ChartCard>
                        )}
                    </div>
                </div>

                <ChartCard title="相关性热力图">
                    {hasCorrelationMatrix ? (
                        <div
                            className="grid gap-2"
                            data-testid="allocation-correlation-grid"
                            style={{ gridTemplateColumns: `repeat(${Math.max(correlationLabels.length + 1, 1)}, minmax(0, 1fr))` }}
                        >
                            <div aria-hidden="true" />
                            {correlationLabels.map((symbol) => (
                                <div className="flex justify-center" key={`correlation-col-${symbol}`}>
                                    <AssetChipButton label={symbol} onClick={() => { openAssetDetailBySymbol(symbol); }} title={`打开 ${symbol} 详情`} />
                                </div>
                            ))}
                            {correlationLabels.map((rowSymbol, rowIndex) => (
                                <Fragment key={rowSymbol}>
                                    <div className="flex items-center justify-center">
                                        <AssetChipButton label={rowSymbol} onClick={() => { openAssetDetailBySymbol(rowSymbol); }} title={`打开 ${rowSymbol} 详情`} />
                                    </div>
                                    {correlationLabels.map((columnSymbol, columnIndex) => {
                                        const value = result.correlationMatrix.matrix[rowIndex]?.[columnIndex] ?? 0;

                                        return (
                                            <div
                                                className={`correlation-heat-cell ${correlationToneClassName(value)} rounded-[16px] p-3 text-center text-xs font-medium`}
                                                data-testid={`allocation-correlation-cell-${rowSymbol}-${columnSymbol}`}
                                                key={`${rowSymbol}-${columnSymbol}`}
                                                style={correlationHeatCellStyle(value)}
                                            >
                                                <p className="text-[10px] uppercase tracking-[0.18em] opacity-70">
                                                    {rowSymbol} / {columnSymbol}
                                                </p>
                                                <p className="mt-2 text-sm">{value.toFixed(2)}</p>
                                            </div>
                                        );
                                    })}
                                </Fragment>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-[20px] border border-dashed border-[color:var(--color-border)] bg-[rgba(244,239,230,0.44)] p-5 text-sm leading-6 text-[var(--color-copy)]" data-testid="allocation-correlation-empty">
                            当前结果未携带可用的相关性矩阵。
                        </div>
                    )}
                </ChartCard>
            </div>
        </>
    );
};
