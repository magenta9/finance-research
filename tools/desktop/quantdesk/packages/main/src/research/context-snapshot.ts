import type {
    AllocationPlanRecord,
    DataProvenance,
    DataSourceId,
    PositionRecord,
    ResearchDataSourceSnapshot,
    ResearchRequestInput,
    RiskProfileSnapshot,
    StoredAsset,
} from '@quantdesk/shared';
import { shiftIsoDateByDays } from '@quantdesk/shared/date-utils';

import type { Repositories } from '../db/repositories';
import { buildResearchDataSourceRegistry, priceCoverageToProvenance } from './data-source-registry';

export interface AssetPriceCoverageSnapshot {
    assetId: string;
    cacheStatus: NonNullable<DataProvenance['cacheStatus']>;
    earliestDate: string | null;
    fallbackProviderIds: string[];
    fetchedAt: string | null;
    latestDate: string | null;
    providerIds: string[];
    rowCount: number;
    source: string;
    sourcePriority: string[];
    status: DataProvenance['qualityStatus'];
    symbol: string;
    warnings: string[];
}

export interface AssetPriceSignalSnapshot {
    assetId: string;
    latestClose: number | null;
    latestDate: string | null;
    returnOneMonth: number | null;
    returnOneYear: number | null;
    returnThreeMonths: number | null;
    source: string | null;
    symbol: string;
}

export interface ResearchContextSnapshot {
    assets: StoredAsset[];
    dataSources: ResearchDataSourceSnapshot[];
    generatedAt: string;
    latestAllocationPlan: AllocationPlanRecord | null;
    missingAssetIds: string[];
    portfolioName: string;
    positions: PositionRecord[];
    priceCoverage: AssetPriceCoverageSnapshot[];
    priceSignals: AssetPriceSignalSnapshot[];
    provenance: DataProvenance[];
    riskProfile: RiskProfileSnapshot | null;
}

export interface CreateResearchContextSnapshotOptions {
    now?: () => Date;
    priceProviderIds?: (asset: Pick<StoredAsset, 'market' | 'symbol'>) => DataSourceId[];
    repositories: Pick<Repositories, 'allocationPlanRepository' | 'assetRepository' | 'positionRepository' | 'priceRepository'>;
}

const staleThresholdMs = 4 * 24 * 60 * 60 * 1000;
const defaultPriceProviderIds: DataSourceId[] = ['tushare', 'yfinance'];

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

const hasMeaningfulOverlap = (queryText: string, candidateText: string) => {
    if (!queryText || !candidateText) {
        return false;
    }

    if (queryText.includes(candidateText) || candidateText.includes(queryText)) {
        return true;
    }

    if (candidateText.length < 4) {
        return false;
    }

    for (let index = 0; index <= candidateText.length - 4; index += 1) {
        if (queryText.includes(candidateText.slice(index, index + 4))) {
            return true;
        }
    }

    return false;
};

export const resolveResearchAssetsFromQuery = (query: string, assets: StoredAsset[]) => {
    const normalizedQuery = normalizeSearchText(query);

    if (!normalizedQuery) {
        return [];
    }

    return assets.filter((asset) => [asset.symbol, asset.name, ...asset.tags]
        .some((value) => hasMeaningfulOverlap(normalizedQuery, normalizeSearchText(value))));
};

const classifyPriceStatus = (fetchedAt: string | null, rowCount: number, now: Date) => {
    if (rowCount === 0) {
        return 'block' as const;
    }

    if (!fetchedAt || now.getTime() - new Date(fetchedAt).getTime() > staleThresholdMs) {
        return 'warn' as const;
    }

    return 'pass' as const;
};

const classifyPriceCacheStatus = (status: DataProvenance['qualityStatus']): NonNullable<DataProvenance['cacheStatus']> => {
    if (status === 'block') {
        return 'miss';
    }

    return status === 'warn' ? 'stale' : 'hit';
};

const sourceRoot = (source: string) => source.split('-', 1)[0] ?? source;

const isMarketDataProviderId = (value: string): value is DataSourceId => value === 'akshare' || value === 'tushare' || value === 'yfinance';

const createPriceSourcePriority = (
    asset: StoredAsset,
    providerIds: string[],
    resolvePriceProviderIds: NonNullable<CreateResearchContextSnapshotOptions['priceProviderIds']>,
) => {
    const providerRoots = Array.from(new Set(providerIds.map(sourceRoot)));
    const policyPriority = resolvePriceProviderIds(asset);
    const observedMarketProviders = providerRoots.filter(isMarketDataProviderId);
    const observedFallbackMarketProviders = observedMarketProviders.filter((providerId) => !policyPriority.includes(providerId)).sort();
    const observedOtherProviders = providerRoots.filter((providerId) => !isMarketDataProviderId(providerId)).sort();

    return observedMarketProviders.length > 0 || observedOtherProviders.length > 0
        ? [...policyPriority, ...observedFallbackMarketProviders, ...observedOtherProviders]
        : policyPriority;
};

const getFallbackProviderIds = (source: string, sourcePriority: string[]) => {
    const selectedRoot = sourceRoot(source);
    const selectedIndex = sourcePriority.indexOf(selectedRoot);

    return selectedIndex > 0 ? sourcePriority.slice(0, selectedIndex) : [];
};

const priceValue = (row: { adjustedClose: number | null; close: number | null }) => row.adjustedClose ?? row.close;

const calculateReturn = (
    rows: Array<{ adjustedClose: number | null; close: number | null; date: string }>,
    latestClose: number | null,
    latestDate: string | null,
    days: number,
) => {
    if (latestClose == null || latestClose <= 0 || latestDate == null) {
        return null;
    }

    const targetDate = shiftIsoDateByDays(latestDate, -days);
    const baseline = [...rows].reverse().find((row) => row.date <= targetDate) ?? rows[0];
    const baselineClose = baseline ? priceValue(baseline) : null;

    if (baselineClose == null || baselineClose <= 0) {
        return null;
    }

    return latestClose / baselineClose - 1;
};

export const createResearchContextSnapshot = ({
    now = () => new Date(),
    priceProviderIds = () => defaultPriceProviderIds,
    repositories,
}: CreateResearchContextSnapshotOptions) => ({
    build(input: ResearchRequestInput, riskProfile: RiskProfileSnapshot | null): ResearchContextSnapshot {
        const generatedAt = now();
        const allAssets = repositories.assetRepository.list();
        const assetIdSet = input.assetIds !== undefined
            ? new Set(input.assetIds)
            : null;
        const queryMatchedAssets = assetIdSet ? [] : resolveResearchAssetsFromQuery(input.query, allAssets);
        const assets = input.unresolvedTarget
            ? []
            : assetIdSet
                ? allAssets.filter((asset) => assetIdSet.has(asset.id))
                : queryMatchedAssets.length > 0
                    ? queryMatchedAssets
                    : allAssets;
        const missingAssetIds = input.unresolvedTarget
            ? [input.unresolvedTarget]
            : assetIdSet
                ? [...assetIdSet].filter((assetId) => !assets.some((asset) => asset.id === assetId))
                : [];
        const signalStartDate = shiftIsoDateByDays(generatedAt.toISOString().slice(0, 10), -400);
        const priceCoverage = assets.map((asset) => {
            const coverage = repositories.priceRepository.getCoverageSummaryByAssetId(asset.id);
            const rowCount = coverage.rowCount;
            const fetchedAt = coverage.fetchedAt;
            const status = classifyPriceStatus(fetchedAt, rowCount, generatedAt);
            const cacheStatus = classifyPriceCacheStatus(status);
            const source = coverage.latestSource ?? coverage.providerIds[0] ?? 'daily_prices';
            const sourcePriority = createPriceSourcePriority(asset, coverage.providerIds, priceProviderIds);
            const fallbackProviderIds = getFallbackProviderIds(source, sourcePriority);
            const warnings = [
                ...(rowCount === 0 ? ['No local price rows found.'] : []),
                ...(status === 'warn' ? ['Latest local price fetch is stale or missing fetched_at.'] : []),
                ...(fallbackProviderIds.length > 0 ? [`Price provider fallback observed before ${source}: ${fallbackProviderIds.join(', ')}.`] : []),
            ];

            return {
                assetId: asset.id,
                cacheStatus,
                earliestDate: coverage.earliestDate,
                fallbackProviderIds,
                fetchedAt,
                latestDate: coverage.latestDate,
                providerIds: coverage.providerIds,
                rowCount,
                source,
                sourcePriority,
                status,
                symbol: asset.symbol,
                warnings,
            };
        });
        const priceSignals = assets.map((asset) => {
            const rows = repositories.priceRepository.getRange({
                assetId: asset.id,
                endDate: generatedAt.toISOString().slice(0, 10),
                startDate: signalStartDate,
            });
            const latestRow = rows.at(-1);
            const latestClose = latestRow ? priceValue(latestRow) : null;
            const latestDate = latestRow?.date ?? null;

            return {
                assetId: asset.id,
                latestClose,
                latestDate,
                returnOneMonth: calculateReturn(rows, latestClose, latestDate, 30),
                returnOneYear: calculateReturn(rows, latestClose, latestDate, 365),
                returnThreeMonths: calculateReturn(rows, latestClose, latestDate, 90),
                source: latestRow?.source ?? null,
                symbol: asset.symbol,
            };
        });
        const latestAllocationPlan = repositories.allocationPlanRepository.list()[0] ?? null;
        const positions = repositories.positionRepository.listByPortfolio(input.portfolioName ?? 'default');
        const dataSources = buildResearchDataSourceRegistry({
            assets,
            latestAllocationPlan,
            missingAssetIds,
            positions,
            priceCoverage,
            riskProfile,
        });
        const provenance = priceCoverageToProvenance(priceCoverage);

        return {
            assets,
            dataSources,
            generatedAt: generatedAt.toISOString(),
            latestAllocationPlan,
            missingAssetIds,
            portfolioName: input.portfolioName ?? 'default',
            positions,
            priceCoverage,
            priceSignals,
            provenance,
            riskProfile,
        };
    },
});