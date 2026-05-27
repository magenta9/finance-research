import { create } from 'zustand';

import type {
    AssetClass,
    AssetInput,
    AssetLookupResult,
    CsvImportResult,
    Market,
    StoredAsset,
} from '@quantdesk/shared';

import { apiClient } from '../lib/api-client';

export type AssetMarketFilter = Market | 'ALL';
export type AssetClassFilter = AssetClass | 'ALL';
export type AssetSortBy = 'added' | 'name';

export interface CsvPreviewRow {
    symbol: string;
    name: string;
    market: string;
    assetClass: string;
    currency: string;
}

export interface CsvPreview {
    error: string | null;
    isValid: boolean;
    rows: CsvPreviewRow[];
    totalRows: number;
}

export interface AssetFilters {
    assetClass: AssetClassFilter;
    market: AssetMarketFilter;
    query: string;
    sortBy: AssetSortBy;
    tag: string;
}

interface AssetStoreState {
    activeAssetId: string | null;
    assets: StoredAsset[];
    csvDraft: string;
    csvImportResult: CsvImportResult | null;
    csvPreview: CsvPreview | null;
    errorMessage: string | null;
    filters: AssetFilters;
    isImporting: boolean;
    isLoading: boolean;
    isLookupLoading: boolean;
    lookupMarket: AssetMarketFilter;
    lookupQuery: string;
    lookupResults: AssetLookupResult[];
    noticeMessage: string | null;
    selectedAssetIds: string[];
}

interface AssetStoreActions {
    addAssetFromLookup: (candidate: AssetLookupResult) => Promise<boolean>;
    clearNotice: () => void;
    deleteAsset: (id: string) => Promise<boolean>;
    deleteSelectedAssets: () => Promise<number>;
    importCsvDraft: () => Promise<CsvImportResult | null>;
    loadAssets: () => Promise<void>;
    lookupAssets: () => Promise<void>;
    saveAssetTags: (assetId: string, tags: string[]) => Promise<void>;
    setActiveAssetId: (assetId: string | null) => void;
    setCsvDraft: (draft: string) => void;
    setFilters: (patch: Partial<AssetFilters>) => void;
    setLookupMarket: (market: AssetMarketFilter) => void;
    setLookupQuery: (query: string) => void;
    toggleSelectedAsset: (assetId: string) => void;
}

export type AssetStore = AssetStoreState & AssetStoreActions;

const emptyFilters = (): AssetFilters => ({
    assetClass: 'ALL',
    market: 'ALL',
    query: '',
    sortBy: 'added',
    tag: '',
});

const createInitialState = (): AssetStoreState => ({
    activeAssetId: null,
    assets: [],
    csvDraft: '',
    csvImportResult: null,
    csvPreview: null,
    errorMessage: null,
    filters: emptyFilters(),
    isImporting: false,
    isLoading: false,
    isLookupLoading: false,
    lookupMarket: 'ALL',
    lookupQuery: '',
    lookupResults: [],
    noticeMessage: null,
    selectedAssetIds: [],
});

const parseCsvDraft = (draft: string): CsvPreview | null => {
    if (!draft.trim()) {
        return null;
    }

    const rows = draft
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(',').map((column) => column.trim()));
    const [header, ...body] = rows;

    if (!header || header.join(',') !== 'symbol,name,market,assetClass,currency') {
        return {
            error: 'CSV 头必须是 symbol,name,market,assetClass,currency',
            isValid: false,
            rows: [],
            totalRows: 0,
        };
    }

    return {
        error: null,
        isValid: true,
        rows: body.map(([symbol, name, market, assetClass, currency]) => ({
            symbol,
            name,
            market,
            assetClass,
            currency,
        })),
        totalRows: body.length,
    };
};

const normalizeError = (error: unknown) =>
    error instanceof Error ? error.message : '发生未知错误。';

const sortAssets = (assets: StoredAsset[], sortBy: AssetSortBy) => {
    const nextAssets = [...assets];

    if (sortBy === 'name') {
        return nextAssets.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    }

    return nextAssets.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

export const deriveVisibleAssets = (assets: StoredAsset[], filters: AssetFilters) => {
    const normalizedQuery = filters.query.trim().toLowerCase();
    const normalizedTag = filters.tag.trim().toLowerCase();

    const filteredAssets = assets.filter((asset) => {
        let matchesQuery = !normalizedQuery
            || asset.symbol.toLowerCase().includes(normalizedQuery)
            || asset.name.toLowerCase().includes(normalizedQuery);
        const matchesMarket = filters.market === 'ALL' || asset.market === filters.market;
        const matchesAssetClass = filters.assetClass === 'ALL' || asset.assetClass === filters.assetClass;
        let matchesTag = !normalizedTag;

        if (!matchesQuery || !matchesTag) {
            for (const tag of asset.tags) {
                const normalizedAssetTag = tag.toLowerCase();

                matchesQuery ||= Boolean(normalizedQuery && normalizedAssetTag.includes(normalizedQuery));
                matchesTag ||= normalizedAssetTag === normalizedTag;

                if (matchesQuery && matchesTag) {
                    break;
                }
            }
        }

        return matchesQuery && matchesMarket && matchesAssetClass && matchesTag;
    });

    return sortAssets(filteredAssets, filters.sortBy);
};

export const deriveActiveAsset = (assets: StoredAsset[], activeAssetId: string | null) =>
    assets.find((asset) => asset.id === activeAssetId) ?? null;

export const deriveAvailableTags = (assets: StoredAsset[]) => {
    const tags = new Set<string>();

    for (const asset of assets) {
        for (const tag of asset.tags) {
            tags.add(tag);
        }
    }

    return [...tags].sort((left, right) => left.localeCompare(right, 'zh-CN'));
};

export const useAssetStore = create<AssetStore>((set, get) => ({
    ...createInitialState(),
    async loadAssets() {
        set({ errorMessage: null, isLoading: true });

        try {
            const assets = await apiClient.data.getAssets();
            const previousActiveAssetId = get().activeAssetId;
            const assetIds = new Set(assets.map((asset) => asset.id));
            const activeAssetId = previousActiveAssetId && assetIds.has(previousActiveAssetId)
                ? previousActiveAssetId
                : null;

            set({
                activeAssetId,
                assets,
                isLoading: false,
                selectedAssetIds: get().selectedAssetIds.filter((id) => assetIds.has(id)),
            });
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isLoading: false,
            });
        }
    },
    setFilters(patch) {
        set({ filters: { ...get().filters, ...patch } });
    },
    setLookupMarket(market) {
        set({ lookupMarket: market });
    },
    setLookupQuery(query) {
        set({ lookupQuery: query });
    },
    async lookupAssets() {
        const { lookupMarket, lookupQuery } = get();

        if (!lookupQuery.trim()) {
            set({ lookupResults: [] });
            return;
        }

        set({ errorMessage: null, isLookupLoading: true });

        try {
            const results = await apiClient.data.lookupAssets(
                lookupQuery.trim(),
                lookupMarket === 'ALL' ? undefined : lookupMarket,
            );

            set({ isLookupLoading: false, lookupResults: results });
        } catch (error) {
            set({
                errorMessage: normalizeError(error),
                isLookupLoading: false,
                lookupResults: [],
            });
        }
    },
    async addAssetFromLookup(candidate) {
        const duplicate = get().assets.some(
            (asset) => asset.symbol === candidate.symbol && asset.market === candidate.market,
        );

        if (duplicate) {
            set({ noticeMessage: `${candidate.symbol} 已经在资产池中。` });
            return false;
        }

        const asset: AssetInput = {
            id: crypto.randomUUID(),
            symbol: candidate.symbol,
            name: candidate.name,
            market: candidate.market,
            assetClass: candidate.assetClass,
            currency: candidate.currency,
            metadata: candidate.metadata,
            tags: [],
        };

        try {
            const created = await apiClient.data.addAsset(asset);
            set({
                activeAssetId: created.id,
                assets: [created, ...get().assets],
                noticeMessage: `${created.symbol} 已加入资产池。`,
            });
            return true;
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
            return false;
        }
    },
    setActiveAssetId(activeAssetId) {
        set({ activeAssetId });
    },
    toggleSelectedAsset(assetId) {
        const selected = new Set(get().selectedAssetIds);

        if (selected.has(assetId)) {
            selected.delete(assetId);
        } else {
            selected.add(assetId);
        }

        set({ selectedAssetIds: [...selected] });
    },
    async deleteAsset(id) {
        try {
            const deleted = await apiClient.data.deleteAsset(id);

            if (!deleted) {
                return false;
            }

            const nextAssets = get().assets.filter((asset) => asset.id !== id);

            set({
                activeAssetId: get().activeAssetId === id ? null : get().activeAssetId,
                assets: nextAssets,
                noticeMessage: '标的已删除。',
                selectedAssetIds: get().selectedAssetIds.filter((assetId) => assetId !== id),
            });
            return true;
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
            return false;
        }
    },
    async deleteSelectedAssets() {
        const ids = [...get().selectedAssetIds];
        let deletedCount = 0;

        for (const id of ids) {
            if (await get().deleteAsset(id)) {
                deletedCount += 1;
            }
        }

        if (deletedCount > 0) {
            set({ noticeMessage: `已批量删除 ${deletedCount} 个标的。`, selectedAssetIds: [] });
        }

        return deletedCount;
    },
    async saveAssetTags(assetId, tags) {
        const asset = get().assets.find((entry) => entry.id === assetId);

        if (!asset) {
            return;
        }

        try {
            const updated = await apiClient.data.updateAsset({
                ...asset,
                tags,
            });

            set({
                assets: get().assets.map((entry) => (entry.id === assetId ? updated : entry)),
                noticeMessage: `${updated.symbol} 的标签已更新。`,
            });
        } catch (error) {
            set({ errorMessage: normalizeError(error) });
        }
    },
    setCsvDraft(csvDraft) {
        set({
            csvDraft,
            csvImportResult: null,
            csvPreview: parseCsvDraft(csvDraft),
        });
    },
    async importCsvDraft() {
        const { csvDraft, csvPreview } = get();

        if (!csvPreview?.isValid) {
            set({ errorMessage: csvPreview?.error ?? '请先填写有效的 CSV。' });
            return null;
        }

        set({ errorMessage: null, isImporting: true });

        try {
            const result = await apiClient.data.importAssetsCsv(csvDraft);
            const assets = await apiClient.data.getAssets();
            const previousActiveAssetId = get().activeAssetId;
            const assetIds = new Set(assets.map((asset) => asset.id));
            const activeAssetId = previousActiveAssetId && assetIds.has(previousActiveAssetId)
                ? previousActiveAssetId
                : null;

            set({
                activeAssetId,
                assets,
                csvDraft: result.errorCount === 0 ? '' : csvDraft,
                csvImportResult: result,
                csvPreview: result.errorCount === 0 ? null : csvPreview,
                isImporting: false,
                noticeMessage: `导入完成：成功 ${result.successCount}，跳过 ${result.skippedCount}。`,
            });
            return result;
        } catch (error) {
            set({ errorMessage: normalizeError(error), isImporting: false });
            return null;
        }
    },
    clearNotice() {
        set({ errorMessage: null, noticeMessage: null });
    },
}));

export const resetAssetStore = () => {
    useAssetStore.setState(createInitialState());
};

export const selectVisibleAssets = (state: AssetStore) => deriveVisibleAssets(state.assets, state.filters);

export const selectActiveAsset = (state: AssetStore) =>
    deriveActiveAsset(state.assets, state.activeAssetId);

export const selectAvailableTags = (state: AssetStore) => deriveAvailableTags(state.assets);
