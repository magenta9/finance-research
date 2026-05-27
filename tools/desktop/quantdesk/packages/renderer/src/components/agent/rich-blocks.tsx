import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import type { AgentRichBlock } from '@quantdesk/shared';

import { Badge } from '../badge';
import { DataTable, type DataTableColumn } from '../data-table';

const formatValue = (value: unknown) => {
    if (typeof value === 'number') {
        if (Math.abs(value) <= 1.5) {
            return `${(value * 100).toFixed(1)}%`;
        }

        return value.toFixed(2);
    }

    return String(value);
};

const ChartBlock = ({ block }: { block: AgentRichBlock }) => {
    const allocations = Array.isArray(block.data.allocations)
        ? (block.data.allocations as Array<Record<string, unknown>>)
        : [];
    const rows = allocations.map((allocation) => ({
        riskContribution: Number(allocation.riskContribution ?? 0) * 100,
        symbol: String(allocation.symbol ?? 'N/A'),
        weight: Number(allocation.weight ?? 0) * 100,
    }));
    const metricEntries = Object.entries(
        (block.data.metrics ?? {}) as Record<string, unknown>,
    );

    if (rows.length === 0) {
        return (
            <div className="rounded-[20px] border border-dashed border-[color:var(--color-border)] bg-[rgba(255,255,255,0.66)] p-4 text-sm text-[var(--color-copy)]">
                当前图表块还没有可展示的数据。
            </div>
        );
    }

    return (
        <div className="space-y-4" data-testid="agent-rich-chart">
            <div className="h-[260px] w-full overflow-hidden rounded-[22px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.84)] p-3">
                <ResponsiveContainer height="100%" width="100%">
                    <BarChart data={rows} margin={{ bottom: 0, left: 0, right: 6, top: 6 }}>
                        <CartesianGrid stroke="rgba(70,53,43,0.08)" vertical={false} />
                        <XAxis dataKey="symbol" stroke="rgba(70,53,43,0.55)" tickLine={false} />
                        <YAxis stroke="rgba(70,53,43,0.55)" tickLine={false} width={46} />
                        <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                        <Bar dataKey="weight" fill="#9c6237" radius={[10, 10, 0, 0]} />
                        <Bar dataKey="riskContribution" fill="#d9bc9a" radius={[10, 10, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {metricEntries.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {metricEntries.map(([key, value]) => (
                        <Badge key={key} tone="accent">
                            {key}: {formatValue(value)}
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
};

const MetricGridBlock = ({ block }: { block: AgentRichBlock }) => {
    const rows = Array.isArray(block.data.rows)
        ? (block.data.rows as Array<{ label: string; value: unknown }>)
        : [];

    return (
        <div className="grid gap-3 md:grid-cols-2" data-testid="agent-rich-metric-grid">
            {rows.map((row) => (
                <article
                    className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.82)] p-4"
                    key={row.label}
                >
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]">
                        {row.label}
                    </p>
                    <p className="mt-3 font-display text-3xl text-[var(--color-foreground)]">
                        {formatValue(row.value)}
                    </p>
                </article>
            ))}
        </div>
    );
};

const TableBlock = ({ block }: { block: AgentRichBlock }) => {
    const rows = Array.isArray(block.data.rows)
        ? (block.data.rows as Array<Record<string, unknown>>)
        : [];
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    const columns: Array<DataTableColumn<Record<string, unknown>>> = keys.map((key) => ({
        header: key,
        key,
        render: (row) => formatValue(row[key]),
    }));

    return (
        <div data-testid="agent-rich-table">
            <DataTable
                columns={columns}
                emptyState="暂无表格数据。"
                getRowKey={(row) => JSON.stringify(row)}
                rows={rows}
            />
        </div>
    );
};

const CitationsBlock = ({ block }: { block: AgentRichBlock }) => {
    const citations = Array.isArray(block.data.citations)
        ? (block.data.citations as string[])
        : [];

    return (
        <div className="flex flex-wrap gap-2" data-testid="agent-rich-citations">
            {citations.map((citation) => (
                <Badge key={citation}>{citation}</Badge>
            ))}
        </div>
    );
};

const TextBlock = ({ block }: { block: AgentRichBlock }) => (
    <div
        className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.82)] p-4 text-sm leading-7 text-[var(--color-copy)]"
        data-testid="agent-rich-text"
    >
        {String(block.data.content ?? '')}
    </div>
);

export const AgentRichBlocks = ({ blocks }: { blocks: AgentRichBlock[] }) => {
    if (blocks.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4" data-testid="agent-rich-blocks">
            {blocks.map((block, index) => (
                <section
                    className="rounded-[24px] border border-[color:var(--color-border)] bg-[rgba(247,240,230,0.62)] p-4"
                    data-testid={`agent-rich-block-${index}`}
                    key={`${block.title}-${index}`}
                >
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h4 className="font-display text-2xl text-[var(--color-foreground)]">
                            {block.title}
                        </h4>
                        <Badge tone="accent">{block.type}</Badge>
                    </div>

                    {block.type === 'chart' && <ChartBlock block={block} />}
                    {block.type === 'metric-grid' && <MetricGridBlock block={block} />}
                    {block.type === 'table' && <TableBlock block={block} />}
                    {block.type === 'citations' && <CitationsBlock block={block} />}
                    {block.type === 'text' && <TextBlock block={block} />}
                </section>
            ))}
        </div>
    );
};
