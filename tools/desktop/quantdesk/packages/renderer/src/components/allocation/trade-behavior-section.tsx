import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { AllocationResult } from '@quantdesk/shared';

import { Button } from '../button';
import { DataTable, type DataTableColumn } from '../data-table';

const tradePageSize = 10;
const maxTradeRows = 80;

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const formatSignedPercent = (value: number) => `${value > 0 ? '+' : ''}${formatPercent(value)}`;

const assetChipClassName = [
    'inline-flex items-center rounded-full border border-[color:var(--color-highlight-soft)] bg-[rgba(156,98,55,0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-highlight)] transition',
    'hover:bg-[rgba(156,98,55,0.14)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(188,140,88,0.28)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
].join(' ');

type TradeRow = NonNullable<AllocationResult['diagnostics']['trades']>[number];

interface TradeBehaviorSectionProps {
    onOpenAssetDetail: (assetId: string) => void;
    trades: TradeRow[];
}

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

export const TradeBehaviorSection = ({
    onOpenAssetDetail,
    trades,
}: TradeBehaviorSectionProps) => {
    const [page, setPage] = useState(1);
    const tradeRows = useMemo(
        () => [...trades].sort((left, right) => right.date.localeCompare(left.date)).slice(0, maxTradeRows),
        [trades],
    );
    const totalPages = Math.max(1, Math.ceil(tradeRows.length / tradePageSize));
    const currentPage = Math.min(page, totalPages);
    const pageStart = (currentPage - 1) * tradePageSize;
    const visibleRows = tradeRows.slice(pageStart, pageStart + tradePageSize);
    const tradeColumns: Array<DataTableColumn<TradeRow>> = [
        {
            header: '日期',
            key: 'date',
            render: (row) => row.date,
        },
        {
            header: '来源',
            key: 'source',
            render: (row) => row.source === 'allocation' ? '配置' : '趋势',
        },
        {
            header: '方向',
            key: 'action',
            render: (row) => (
                <span className={row.action === 'buy' ? 'text-[#3f7a4a]' : 'text-[#9f3a29]'}>
                    {row.action === 'buy' ? '买入' : '卖出'}
                </span>
            ),
        },
        {
            header: '标的',
            key: 'asset',
            render: (row) => (
                <Button
                    aria-label={`打开 ${row.symbol} 详情`}
                    className={`${assetChipClassName} h-auto min-h-0 shadow-none`}
                    onClick={() => {
                        onOpenAssetDetail(row.assetId);
                    }}
                    size="sm"
                    title={`打开 ${row.symbol} 详情`}
                    tone="ghost"
                    type="button"
                >
                    {row.symbol}（{row.name}）
                </Button>
            ),
        },
        {
            className: 'text-right',
            header: '变动',
            key: 'change',
            render: (row) => formatSignedPercent(row.weightChange),
        },
        {
            className: 'text-right',
            header: '从 / 到',
            key: 'weights',
            render: (row) => `${formatPercent(row.fromWeight)} / ${formatPercent(row.toWeight)}`,
        },
        {
            header: '原因',
            key: 'reason',
            render: (row) => row.reason,
        },
    ];

    return (
        <ChartCard title="交易行为">
            <div className="space-y-3">
                <DataTable
                    columns={tradeColumns}
                    emptyState="暂无交易行为。"
                    getRowKey={(row) => `${row.date}-${row.source}-${row.assetId}-${row.fromWeight}-${row.toWeight}`}
                    rows={visibleRows}
                />
                {tradeRows.length > tradePageSize && (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-[var(--color-muted)]">
                        <p data-testid="allocation-trades-page-summary">
                            第 {currentPage} / {totalPages} 页 · 共 {tradeRows.length} 条
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                aria-label="上一页交易行为"
                                data-testid="allocation-trades-prev"
                                disabled={currentPage <= 1}
                                onClick={() => {
                                    setPage((value) => Math.max(1, value - 1));
                                }}
                                size="sm"
                                tone="ghost"
                            >
                                上一页
                            </Button>
                            <Button
                                aria-label="下一页交易行为"
                                data-testid="allocation-trades-next"
                                disabled={currentPage >= totalPages}
                                onClick={() => {
                                    setPage((value) => Math.min(totalPages, value + 1));
                                }}
                                size="sm"
                                tone="ghost"
                            >
                                下一页
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </ChartCard>
    );
};
