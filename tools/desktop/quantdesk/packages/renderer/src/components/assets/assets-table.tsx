import { memo, useCallback, useMemo } from 'react';

import type { AssetClass, Market, StoredAsset } from '@quantdesk/shared';

import { DataTable, type DataTableColumn } from '../data-table';
import { Tag } from '../tag';
import { SearchInput } from '../search-input';
import { Button } from '../button';
import { Badge } from '../badge';
import { Checkbox } from '../checkbox';
import { Select } from '../select';

interface AssetRow extends StoredAsset {
    isSelected: boolean;
}

interface AssetsTableProps {
    assetClass: AssetClass | 'ALL';
    assets: StoredAsset[];
    availableTags: string[];
    market: Market | 'ALL';
    onAssetClassChange: (value: AssetClass | 'ALL') => void;
    onDelete: (id: string) => void;
    onMarketChange: (value: Market | 'ALL') => void;
    onOpenImport: () => void;
    onQueryChange: (value: string) => void;
    onRowClick: (id: string) => void;
    onSortChange: (value: 'added' | 'name') => void;
    onTagChange: (value: string) => void;
    onToggleSelection: (id: string) => void;
    query: string;
    selectedAssetIds: string[];
    sortBy: 'added' | 'name';
    tag: string;
    onDeleteSelected: () => void;
}

const marketOptions: Array<{ label: string; value: Market | 'ALL' }> = [
    { label: '全部市场', value: 'ALL' },
    { label: 'A 股', value: 'A' },
    { label: '港股', value: 'HK' },
    { label: '美股', value: 'US' },
    { label: '债券', value: 'BOND' },
    { label: '商品', value: 'COMMODITY' },
];

const assetClassOptions: Array<{ label: string; value: AssetClass | 'ALL' }> = [
    { label: '全部类别', value: 'ALL' },
    { label: '权益', value: 'equity' },
    { label: '固收', value: 'fixed_income' },
    { label: '商品', value: 'commodity' },
    { label: '另类', value: 'alternative' },
    { label: '现金', value: 'cash' },
];

const getAssetRowKey = (row: AssetRow) => row.id;

const getAssetRowClassName = (row: AssetRow) =>
    row.isSelected
        ? 'bg-[rgba(156,98,55,0.05)] hover:bg-[rgba(156,98,55,0.08)] cursor-pointer'
        : 'hover:bg-[rgba(156,98,55,0.03)] cursor-pointer';

const AssetsTableComponent = ({
    assetClass,
    assets,
    availableTags,
    market,
    onAssetClassChange,
    onDelete,
    onDeleteSelected,
    onMarketChange,
    onOpenImport,
    onQueryChange,
    onRowClick,
    onSortChange,
    onTagChange,
    onToggleSelection,
    query,
    selectedAssetIds,
    sortBy,
    tag,
}: AssetsTableProps) => {
    const rows: AssetRow[] = useMemo(() => {
        const selectedAssetIdSet = new Set(selectedAssetIds);

        return assets.map((asset) => ({
            ...asset,
            isSelected: selectedAssetIdSet.has(asset.id),
        }));
    }, [assets, selectedAssetIds]);
    const handleRowClick = useCallback((row: AssetRow) => {
        onRowClick(row.id);
    }, [onRowClick]);
    const visibleSymbols = useMemo(() => rows.map((row) => row.symbol).join(','), [rows]);
    const visibleClasses = useMemo(() => rows.map((row) => row.assetClass).join(','), [rows]);
    const visibleMarkets = useMemo(() => rows.map((row) => row.market).join(','), [rows]);

    const columns: Array<DataTableColumn<AssetRow>> = useMemo(() => [
        {
            header: '选择',
            key: 'selection',
            className: 'w-14',
            render: (row) => (
                <Checkbox
                    aria-label={`选择 ${row.symbol}`}
                    checked={row.isSelected}
                    onChange={() => {
                        onToggleSelection(row.id);
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                    }}
                />
            ),
        },
        {
            header: '标的',
            key: 'asset',
            className: 'min-w-[220px]',
            render: (row) => (
                <Button
                    aria-label={`查看 ${row.symbol} 详情`}
                    className="h-auto w-full justify-start border-0 bg-transparent px-0 py-0 text-left outline-none shadow-none hover:bg-transparent focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-[rgba(156,98,55,0.35)]"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRowClick(row.id);
                    }}
                    size="sm"
                    tone="ghost"
                    type="button"
                >
                    <p className="font-display text-xl text-[var(--color-foreground)]">{row.symbol}</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-copy)]">{row.name}</p>
                </Button>
            ),
        },
        {
            header: '市场 / 类别',
            key: 'meta',
            render: (row) => (
                <div className="flex flex-wrap gap-2">
                    <Badge>{row.market}</Badge>
                    <Badge tone="accent">{row.assetClass}</Badge>
                </div>
            ),
        },
        {
            header: '标签',
            key: 'tags',
            className: 'min-w-[210px]',
            render: (row) => (
                <div className="flex flex-wrap gap-2">
                    {row.tags.length === 0 ? (
                        <span className="text-xs text-[var(--color-muted)]">暂无标签</span>
                    ) : (
                        row.tags.map((entry) => <Tag key={`${row.id}-${entry}`}>{entry}</Tag>)
                    )}
                </div>
            ),
        },
        {
            header: '加入时间',
            key: 'createdAt',
            render: (row) => row.createdAt.slice(0, 10),
        },
        {
            header: '操作',
            key: 'actions',
            className: 'w-[120px]',
            render: (row) => (
                <Button
                    onClick={(event) => {
                        event.stopPropagation();
                        onDelete(row.id);
                    }}
                    size="sm"
                    tone="danger"
                    data-testid={`delete-asset-${row.symbol}-${row.market}`}
                >
                    删除
                </Button>
            ),
        },
    ], [onDelete, onRowClick, onToggleSelection]);

    return (
        <section className="rounded-[20px] border border-[color:var(--color-border)] bg-[rgba(255,252,248,0.78)] p-4 shadow-[0_12px_32px_rgba(61,43,31,0.05)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-muted)]">
                        资产列表
                    </p>
                    <h2 className="mt-2 font-display text-2xl text-[var(--color-foreground)]">
                        资产池与批量操作
                    </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button onClick={onOpenImport} tone="secondary" data-testid="open-import-modal">
                        CSV 导入
                    </Button>
                    <Button
                        disabled={selectedAssetIds.length === 0}
                        onClick={onDeleteSelected}
                        tone="danger"
                        data-testid="delete-selected-assets"
                    >
                        批量删除 {selectedAssetIds.length > 0 ? `(${selectedAssetIds.length})` : ''}
                    </Button>
                </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_repeat(4,minmax(0,0.6fr))]">
                <SearchInput
                    onChange={onQueryChange}
                    placeholder="按代码、名称或标签筛选"
                    value={query}
                    data-testid="asset-list-query"
                />
                <Select
                    className="h-10 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                    onChange={(event) => {
                        onMarketChange(event.currentTarget.value as Market | 'ALL');
                    }}
                    value={market}
                    data-testid="asset-filter-market"
                >
                    {marketOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </Select>
                <Select
                    className="h-10 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                    onChange={(event) => {
                        onAssetClassChange(event.currentTarget.value as AssetClass | 'ALL');
                    }}
                    value={assetClass}
                    data-testid="asset-filter-class"
                >
                    {assetClassOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </Select>
                <Select
                    className="h-10 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                    onChange={(event) => {
                        onTagChange(event.currentTarget.value);
                    }}
                    value={tag}
                    data-testid="asset-filter-tag"
                >
                    <option value="">全部标签</option>
                    {availableTags.map((entry) => (
                        <option key={entry} value={entry}>
                            {entry}
                        </option>
                    ))}
                </Select>
                <Select
                    className="h-10 rounded-[12px] border border-[color:var(--color-border)] bg-white/80 px-3 text-sm text-[var(--color-foreground)]"
                    onChange={(event) => {
                        onSortChange(event.currentTarget.value as 'added' | 'name');
                    }}
                    value={sortBy}
                    data-testid="asset-sort-by"
                >
                    <option value="added">按添加时间</option>
                    <option value="name">按名称</option>
                </Select>
            </div>

            <div className="mt-4" data-testid="asset-table-panel">
                <DataTable
                    columns={columns}
                    emptyState="当前没有匹配的资产。可以先在上方搜索候选标的，或通过 CSV 批量导入。"
                    getRowKey={getAssetRowKey}
                    onRowClick={handleRowClick}
                    rowClassName={getAssetRowClassName}
                    rows={rows}
                />
                <div className="sr-only" data-testid="asset-visible-count">
                    {rows.length}
                </div>
                <div className="sr-only" data-testid="asset-visible-symbols">
                    {visibleSymbols}
                </div>
                <div className="sr-only" data-testid="asset-visible-classes">
                    {visibleClasses}
                </div>
                <div className="sr-only" data-testid="asset-visible-markets">
                    {visibleMarkets}
                </div>
                {rows.map((row) => (
                    <Button
                        className="hidden h-auto w-auto border-0 bg-transparent px-0 py-0 shadow-none"
                        data-testid={`asset-row-${row.symbol}-${row.market}`}
                        key={`row-probe-${row.id}`}
                        onClick={() => {
                            onRowClick(row.id);
                        }}
                        size="sm"
                        tone="ghost"
                        type="button"
                    >
                        {row.symbol}
                    </Button>
                ))}
            </div>
        </section>
    );
};

export const AssetsTable = memo(AssetsTableComponent);

AssetsTable.displayName = 'AssetsTable';
