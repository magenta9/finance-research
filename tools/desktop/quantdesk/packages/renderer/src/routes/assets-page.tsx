import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';

import { AssetDetailPanel } from '../components/assets/asset-detail-panel';
import { AssetLookupPanel } from '../components/assets/asset-lookup-panel';
import { AssetsTable } from '../components/assets/assets-table';
import { CsvImportModal } from '../components/assets/csv-import-modal';
import { InlineNotice } from '../components/inline-notice';
import { deriveActiveAsset, deriveAvailableTags, deriveVisibleAssets, useAssetStore } from '../stores/asset-store';

const MetricCard = memo(({ label, value }: { label: string; value: string | number }) => (
    <article className="min-w-0 overflow-hidden rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-3 shadow-[0_10px_26px_rgba(61,43,31,0.04)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">{label}</p>
        <p className="mt-2 font-display text-2xl leading-7 text-[var(--color-foreground)]">{value}</p>
    </article>
));

MetricCard.displayName = 'AssetsMetricCard';

export const AssetsPage = () => {
    const [isImportModalOpen, setImportModalOpen] = useState(false);
    const [isDetailOpen, setDetailOpen] = useState(false);
    const allAssets = useAssetStore((state) => state.assets);
    const activeAssetId = useAssetStore((state) => state.activeAssetId);
    const csvDraft = useAssetStore((state) => state.csvDraft);
    const csvImportResult = useAssetStore((state) => state.csvImportResult);
    const csvPreview = useAssetStore((state) => state.csvPreview);
    const errorMessage = useAssetStore((state) => state.errorMessage);
    const filters = useAssetStore((state) => state.filters);
    const isImporting = useAssetStore((state) => state.isImporting);
    const isLoading = useAssetStore((state) => state.isLoading);
    const isLookupLoading = useAssetStore((state) => state.isLookupLoading);
    const lookupMarket = useAssetStore((state) => state.lookupMarket);
    const lookupQuery = useAssetStore((state) => state.lookupQuery);
    const lookupResults = useAssetStore((state) => state.lookupResults);
    const noticeMessage = useAssetStore((state) => state.noticeMessage);
    const selectedAssetIds = useAssetStore((state) => state.selectedAssetIds);
    const addAssetFromLookup = useAssetStore((state) => state.addAssetFromLookup);
    const clearNotice = useAssetStore((state) => state.clearNotice);
    const deleteAsset = useAssetStore((state) => state.deleteAsset);
    const deleteSelectedAssets = useAssetStore((state) => state.deleteSelectedAssets);
    const importCsvDraft = useAssetStore((state) => state.importCsvDraft);
    const loadAssets = useAssetStore((state) => state.loadAssets);
    const lookupAssets = useAssetStore((state) => state.lookupAssets);
    const saveAssetTags = useAssetStore((state) => state.saveAssetTags);
    const setActiveAssetId = useAssetStore((state) => state.setActiveAssetId);
    const setCsvDraft = useAssetStore((state) => state.setCsvDraft);
    const setFilters = useAssetStore((state) => state.setFilters);
    const setLookupMarket = useAssetStore((state) => state.setLookupMarket);
    const setLookupQuery = useAssetStore((state) => state.setLookupQuery);
    const toggleSelectedAsset = useAssetStore((state) => state.toggleSelectedAsset);
    const deferredQuery = useDeferredValue(filters.query);
    const { assetClass, market, sortBy, tag } = filters;
    const deferredFilters = useMemo(
        () => ({ assetClass, market, query: deferredQuery, sortBy, tag }),
        [assetClass, deferredQuery, market, sortBy, tag],
    );

    const activeAsset = useMemo(
        () => deriveActiveAsset(allAssets, activeAssetId),
        [activeAssetId, allAssets],
    );
    const assets = useMemo(() => deriveVisibleAssets(allAssets, deferredFilters), [allAssets, deferredFilters]);
    const availableTags = useMemo(() => deriveAvailableTags(allAssets), [allAssets]);
    const lookupAssetsIndex = useMemo(
        () => allAssets.map((asset) => ({ market: asset.market, symbol: asset.symbol })),
        [allAssets],
    );

    useEffect(() => {
        void loadAssets();
    }, [loadAssets]);

    useEffect(() => {
        if (!activeAsset) {
            setDetailOpen(false);
        }
    }, [activeAsset]);

    const openAssetDetail = useCallback((assetId: string | null) => {
        setActiveAssetId(assetId);
        setDetailOpen(Boolean(assetId));
    }, [setActiveAssetId]);
    const handleAddAssetFromLookup = useCallback(async (candidate: Parameters<typeof addAssetFromLookup>[0]) => {
        const added = await addAssetFromLookup(candidate);

        if (added) {
            setDetailOpen(true);
        }
    }, [addAssetFromLookup]);
    const handleLookupAssets = useCallback(() => {
        void lookupAssets();
    }, [lookupAssets]);
    const handleDeleteAsset = useCallback((id: string) => {
        void deleteAsset(id);
    }, [deleteAsset]);
    const handleDeleteSelectedAssets = useCallback(() => {
        void deleteSelectedAssets();
    }, [deleteSelectedAssets]);
    const handleImportDraft = useCallback(() => {
        void importCsvDraft();
    }, [importCsvDraft]);
    const handleSaveAssetTags = useCallback((assetId: string, tags: string[]) => {
        void saveAssetTags(assetId, tags);
    }, [saveAssetTags]);
    const handleFilterAssetClass = useCallback((value: Parameters<typeof setFilters>[0]['assetClass']) => {
        setFilters({ assetClass: value });
    }, [setFilters]);
    const handleFilterMarket = useCallback((value: Parameters<typeof setFilters>[0]['market']) => {
        setFilters({ market: value });
    }, [setFilters]);
    const handleFilterQuery = useCallback((value: string) => {
        setFilters({ query: value });
    }, [setFilters]);
    const handleFilterSort = useCallback((value: Parameters<typeof setFilters>[0]['sortBy']) => {
        setFilters({ sortBy: value });
    }, [setFilters]);
    const handleFilterTag = useCallback((value: string) => {
        setFilters({ tag: value });
    }, [setFilters]);
    const handleOpenImport = useCallback(() => {
        setImportModalOpen(true);
    }, []);
    const handleCloseImport = useCallback(() => {
        setImportModalOpen(false);
    }, []);
    const handleCloseDetail = useCallback(() => {
        setDetailOpen(false);
    }, []);

    const totalMarkets = useMemo(
        () => new Set(allAssets.map((asset) => asset.market)).size,
        [allAssets],
    );
    const totalTags = availableTags.length;

    return (
        <section className="space-y-4" data-testid="assets-page">
            {(noticeMessage || errorMessage) && (
                <InlineNotice
                    message={errorMessage ?? noticeMessage}
                    messageTestId="asset-notice"
                    onDismiss={clearNotice}
                    tone={errorMessage ? 'danger' : 'default'}
                />
            )}

            <div className="grid gap-3 md:grid-cols-3">
                <MetricCard label="资产总数" value={allAssets.length} />
                <MetricCard label="覆盖市场" value={totalMarkets} />
                <MetricCard label="标签数量" value={totalTags} />
            </div>

            <AssetLookupPanel
                assets={lookupAssetsIndex}
                isLoading={isLookupLoading}
                lookupMarket={lookupMarket}
                lookupQuery={lookupQuery}
                onAdd={handleAddAssetFromLookup}
                onLookup={handleLookupAssets}
                onLookupMarketChange={setLookupMarket}
                onLookupQueryChange={setLookupQuery}
                results={lookupResults}
            />

            {isLoading ? (
                <div className="rounded-[16px] border border-[color:var(--color-border)] bg-[rgba(255,255,255,0.62)] p-6 text-sm text-[var(--color-copy)]">
                    正在加载资产池...
                </div>
            ) : (
                <AssetsTable
                    assetClass={filters.assetClass}
                    assets={assets}
                    availableTags={availableTags}
                    market={filters.market}
                    onAssetClassChange={handleFilterAssetClass}
                    onDelete={handleDeleteAsset}
                    onDeleteSelected={handleDeleteSelectedAssets}
                    onMarketChange={handleFilterMarket}
                    onOpenImport={handleOpenImport}
                    onQueryChange={handleFilterQuery}
                    onRowClick={openAssetDetail}
                    onSortChange={handleFilterSort}
                    onTagChange={handleFilterTag}
                    onToggleSelection={toggleSelectedAsset}
                    query={filters.query}
                    selectedAssetIds={selectedAssetIds}
                    sortBy={filters.sortBy}
                    tag={filters.tag}
                />
            )}

            <CsvImportModal
                csvDraft={csvDraft}
                importResult={csvImportResult}
                isImporting={isImporting}
                onChange={setCsvDraft}
                onClose={handleCloseImport}
                onImport={handleImportDraft}
                open={isImportModalOpen}
                preview={csvPreview}
            />

            <AssetDetailPanel
                allTags={availableTags}
                asset={activeAsset}
                contextLabel="资产池工作台"
                onClose={handleCloseDetail}
                onSaveTags={handleSaveAssetTags}
                open={isDetailOpen}
            />
        </section>
    );
};
