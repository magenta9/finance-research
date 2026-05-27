import type {
    AllocationPlanRecord,
    CacheSummary,
    PositionImportRow,
    PositionInput,
    PositionRecord,
    RuntimeStatusResponse,
    StoredAsset,
    SyncStatus,
} from '@quantdesk/shared';

export const chartPalette = ['#9c6237', '#bd8c58', '#d9bc9a', '#5d4638', '#b54b3c', '#6a7b6f'];

export interface DashboardState {
    activePlan: AllocationPlanRecord | null;
    assets: StoredAsset[];
    cacheSummary: CacheSummary | null;
    errorMessage: string | null;
    heartbeat: string | null;
    isImportingPositions: boolean;
    isLoading: boolean;
    isSavingPosition: boolean;
    latestPriceByAssetId: Record<string, number>;
    nativeStatus: string | null;
    noticeMessage: string | null;
    positionCsvDraft: string;
    positionDraft: PositionDraft;
    positions: PositionRecord[];
    pythonProbe: string | null;
    runtimeStatus: RuntimeStatusResponse | null;
    syncStatus: SyncStatus | null;
}

export interface PositionDraft {
    assetId: string;
    costBasis: string;
    currency: PositionInput['currency'];
    id: string | null;
    portfolioName: string;
    shares: string;
}

export interface PositionOverviewRow {
    assetId: string;
    costBasis: number | null;
    currentWeight: number;
    estimatedValue: number;
    latestPrice: number | null;
    market: StoredAsset['market'];
    name: string;
    positionId: string;
    shares: number;
    symbol: string;
    targetWeight: number | null;
    valuationLabel: string;
}

export type PositionOverviewBaseRow = Omit<PositionOverviewRow, 'currentWeight'>;

export const emptyPositionDraft = (): PositionDraft => ({
    assetId: '',
    costBasis: '',
    currency: 'CNY',
    id: null,
    portfolioName: 'default',
    shares: '',
});

export const formatDashboardError = (error: unknown) =>
    error instanceof Error ? error.message : '发生未知错误。';

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const wholeNumberFormatter = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
});

const smallNumberFormatter = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
});

export const formatNumber = (value: number) =>
    (value < 100 ? smallNumberFormatter : wholeNumberFormatter).format(value);

export const parseLatestPrice = (
    values: Array<{ adjustedClose: number | null; close: number | null }>,
) => {
    for (let index = values.length - 1; index >= 0; index -= 1) {
        const row = values[index];
        const value = row.adjustedClose ?? row.close ?? null;

        if (value != null && value > 0) {
            return value;
        }
    }

    return null;
};

export const parsePositionsCsv = (
    draft: string,
    assets: StoredAsset[],
): { error: string | null; rows: PositionImportRow[] } => {
    const lines = draft
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return {
            error: '请先填写持仓 CSV。',
            rows: [],
        };
    }

    const [header, ...body] = lines.map((line) => line.split(',').map((entry) => entry.trim()));
    const normalizedHeader = header.join(',');
    const withPortfolioHeader = 'symbol,market,shares,costBasis,currency,portfolioName';
    const withoutPortfolioHeader = 'symbol,market,shares,costBasis,currency';

    if (normalizedHeader !== withPortfolioHeader && normalizedHeader !== withoutPortfolioHeader) {
        return {
            error: 'CSV 头必须是 symbol,market,shares,costBasis,currency[,portfolioName]。',
            rows: [],
        };
    }

    const assetIndex = new Map(assets.map((asset) => [`${asset.symbol}::${asset.market}`, asset]));
    const rows: PositionImportRow[] = [];

    for (const [symbol, market, sharesRaw, costBasisRaw, currency, portfolioName] of body) {
        const asset = assetIndex.get(`${symbol}::${market}`);

        if (!asset) {
            return {
                error: `找不到资产 ${symbol} / ${market}，请先在资产池中添加。`,
                rows: [],
            };
        }

        const shares = Number(sharesRaw);
        const costBasis = costBasisRaw === '' ? null : Number(costBasisRaw);

        if (!Number.isFinite(shares) || shares <= 0) {
            return {
                error: `持仓份额无效：${symbol}`,
                rows: [],
            };
        }

        if (costBasis != null && (!Number.isFinite(costBasis) || costBasis < 0)) {
            return {
                error: `成本价无效：${symbol}`,
                rows: [],
            };
        }

        rows.push({
            assetId: asset.id,
            costBasis,
            currency: currency as PositionInput['currency'],
            portfolioName: portfolioName || 'default',
            shares,
        });
    }

    return {
        error: null,
        rows,
    };
};

export const derivePositionOverview = ({
    activePlan,
    assets,
    latestPriceByAssetId,
    positions,
}: {
    activePlan: AllocationPlanRecord | null;
    assets: StoredAsset[];
    latestPriceByAssetId: Record<string, number>;
    positions: PositionRecord[];
}) => {
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const rows: PositionOverviewBaseRow[] = [];

    for (const position of positions) {
        const asset = assetsById.get(position.assetId);

        if (!asset) {
            continue;
        }

        const latestPrice = latestPriceByAssetId[position.assetId] ?? null;
        const referencePrice = latestPrice ?? position.costBasis ?? 1;
        const estimatedValue = referencePrice * position.shares;

        rows.push({
            assetId: asset.id,
            costBasis: position.costBasis,
            estimatedValue,
            latestPrice,
            market: asset.market,
            name: asset.name,
            positionId: position.id,
            shares: position.shares,
            symbol: asset.symbol,
            targetWeight: activePlan?.result?.weights[position.assetId] ?? null,
            valuationLabel: latestPrice != null ? '按缓存价格估值' : position.costBasis != null ? '按成本价估值' : '按份额估值',
        });
    }
    const totalEstimatedValue = rows.reduce((sum, row) => sum + row.estimatedValue, 0);

    return rows
        .map((row) => ({
            ...row,
            currentWeight: totalEstimatedValue > 0 ? row.estimatedValue / totalEstimatedValue : 0,
        }))
        .sort((left, right) => right.estimatedValue - left.estimatedValue);
};
