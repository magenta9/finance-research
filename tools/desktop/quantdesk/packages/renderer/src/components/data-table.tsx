import type { ReactNode } from 'react';

export interface DataTableColumn<Row> {
    className?: string;
    header: ReactNode;
    key: string;
    render: (row: Row) => ReactNode;
}

interface DataTableProps<Row> {
    columns: Array<DataTableColumn<Row>>;
    emptyState: ReactNode;
    getRowKey: (row: Row) => string;
    onRowClick?: (row: Row) => void;
    rowClassName?: (row: Row) => string;
    rows: Row[];
}

export const DataTable = <Row,>({
    columns,
    emptyState,
    getRowKey,
    onRowClick,
    rowClassName,
    rows,
}: DataTableProps<Row>) => {
    if (rows.length === 0) {
        return (
            <div className="rounded-[16px] border border-dashed border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-6 text-sm text-[var(--color-copy)]">
                {emptyState}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.72)] shadow-[0_10px_26px_rgba(61,43,31,0.04)]">
            <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-[color:var(--color-border)] bg-[rgba(244,239,230,0.74)] text-left text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                            {columns.map((column) => (
                                <th className={['px-4 py-3 font-medium', column.className ?? ''].join(' ')} key={column.key}>
                                    {column.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr
                                className={[
                                    'border-b border-[rgba(70,53,43,0.08)] last:border-b-0',
                                    onRowClick ? 'cursor-pointer transition-colors hover:bg-[rgba(156,98,55,0.05)]' : '',
                                    rowClassName?.(row) ?? '',
                                ].join(' ')}
                                key={getRowKey(row)}
                                onClick={onRowClick ? () => {
                                    onRowClick(row);
                                } : undefined}
                            >
                                {columns.map((column) => (
                                    <td className={['px-4 py-4 align-top text-[var(--color-copy)]', column.className ?? ''].join(' ')} key={column.key}>
                                        {column.render(row)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
