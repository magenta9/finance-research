import type {
    AllocationPlanRecord,
    DataProvenance,
    PositionRecord,
    ResearchDataSourceSnapshot,
    ResearchGateStatus,
    RiskProfileSnapshot,
    StoredAsset,
} from '@quantdesk/shared';

import { adapterContractToDataSource, researchDataAdapterContracts } from './data-adapters';

interface AssetPriceCoverageSnapshot {
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

interface BuildResearchDataSourceRegistryInput {
    assets: StoredAsset[];
    latestAllocationPlan: AllocationPlanRecord | null;
    missingAssetIds: string[];
    positions: PositionRecord[];
    priceCoverage: AssetPriceCoverageSnapshot[];
    riskProfile: RiskProfileSnapshot | null;
}

const worstQualityStatus = (statuses: ResearchGateStatus[]): ResearchGateStatus => {
    if (statuses.includes('block')) {
        return 'block';
    }

    if (statuses.includes('warn')) {
        return 'warn';
    }

    return 'pass';
};

const localPriceWarnings = (priceCoverage: AssetPriceCoverageSnapshot[]) => Array.from(new Set(
    priceCoverage.flatMap((coverage) => coverage.warnings.map((warning) => `${coverage.symbol}: ${warning}`)),
));

const createDataProvenanceSource = (coverage: AssetPriceCoverageSnapshot): DataProvenance => ({
    analysisWindow: {
        endDate: coverage.latestDate,
        startDate: coverage.earliestDate,
    },
    cacheStatus: coverage.cacheStatus,
    expectedRows: null,
    fallbackProviderIds: coverage.fallbackProviderIds,
    fetchedAt: coverage.fetchedAt,
    providerIds: coverage.providerIds,
    qualityStatus: coverage.status,
    rowsUsed: coverage.rowCount,
    sourceId: `daily_prices:${coverage.assetId}`,
    sourcePriority: coverage.sourcePriority,
    warnings: coverage.warnings,
});

export const buildResearchDataSourceRegistry = ({
    assets,
    latestAllocationPlan,
    missingAssetIds,
    positions,
    priceCoverage,
    riskProfile,
}: BuildResearchDataSourceRegistryInput): ResearchDataSourceSnapshot[] => {
    const priceQuality = priceCoverage.length > 0
        ? worstQualityStatus(priceCoverage.map((coverage) => coverage.status))
        : 'block';
    const priceRows = priceCoverage.reduce((total, coverage) => total + coverage.rowCount, 0);
    const hasScopedAssets = assets.length > 0;
    const sources: ResearchDataSourceSnapshot[] = [
        {
            id: 'local.asset_universe',
            kind: 'local',
            label: 'Asset universe',
            providerIds: ['sqlite.assets'],
            qualityStatus: missingAssetIds.length > 0 || !hasScopedAssets ? 'warn' : 'pass',
            roleAffinity: ['allocation', 'fundamental', 'risk', 'trend'],
            status: hasScopedAssets ? 'available' : 'degraded',
            toolNames: ['search_assets', 'get_asset_pool_summary'],
            warnings: [
                ...(!hasScopedAssets ? ['No scoped assets resolved for this request.'] : []),
                ...missingAssetIds.map((assetId) => `Requested asset was not found: ${assetId}`),
            ],
        },
        {
            id: 'local.daily_prices',
            kind: 'local',
            label: 'Daily price history',
            providerIds: priceCoverage.flatMap((coverage) => coverage.providerIds),
            qualityStatus: priceQuality,
            roleAffinity: ['factor', 'risk', 'trend'],
            status: priceQuality === 'pass' ? 'available' : priceQuality === 'warn' ? 'degraded' : 'unavailable',
            toolNames: ['get_asset_snapshot', 'analyze_asset'],
            warnings: [
                ...(priceCoverage.length === 0 ? ['No local price coverage exists for scoped assets.'] : []),
                ...localPriceWarnings(priceCoverage),
            ],
        },
        {
            id: 'local.positions',
            kind: 'local',
            label: 'Portfolio positions',
            providerIds: ['sqlite.positions'],
            qualityStatus: positions.length > 0 ? 'pass' : 'warn',
            roleAffinity: ['allocation', 'execution', 'risk'],
            status: positions.length > 0 ? 'available' : 'degraded',
            toolNames: ['get_portfolio_summary', 'explain_risk', 'propose_rebalance'],
            warnings: positions.length > 0 ? [] : ['Portfolio has no local positions for this scope.'],
        },
        {
            id: 'local.allocation_plan',
            kind: 'local',
            label: 'Latest allocation plan',
            providerIds: ['sqlite.allocation_plans'],
            qualityStatus: latestAllocationPlan ? 'pass' : 'warn',
            roleAffinity: ['allocation', 'execution', 'risk'],
            status: latestAllocationPlan ? 'available' : 'degraded',
            toolNames: ['run_allocation', 'propose_rebalance'],
            warnings: latestAllocationPlan ? [] : ['No prior allocation plan is available.'],
        },
        {
            id: 'local.risk_profile',
            kind: 'local',
            label: 'Risk profile',
            providerIds: ['sqlite.risk_profile'],
            qualityStatus: riskProfile ? 'pass' : 'warn',
            roleAffinity: ['allocation', 'execution', 'risk'],
            status: riskProfile ? 'available' : 'degraded',
            toolNames: ['explain_risk'],
            warnings: riskProfile ? [] : ['Risk profile missing; precise sizing is unavailable.'],
        },
        {
            id: 'tool.macro_scan',
            kind: 'tool',
            label: 'Macro scan tool',
            providerIds: ['finance.macro_scan'],
            qualityStatus: 'warn',
            roleAffinity: ['allocation', 'macro', 'risk'],
            status: 'available',
            toolNames: ['macro_scan'],
            warnings: ['Macro scan is tool-backed; cite returned provenance before using it as evidence.'],
        },
        {
            id: 'provider.asset_discovery',
            kind: 'provider',
            label: 'Remote asset discovery',
            providerIds: ['market-data.search_assets'],
            qualityStatus: 'warn',
            roleAffinity: ['trend', 'fundamental', 'flow_sentiment'],
            status: 'degraded',
            toolNames: ['resolve_market_assets', 'ensure_asset_history'],
            warnings: ['Remote discovery is executable only when market-data services are injected; candidates require confirmation before use.'],
        },
        ...researchDataAdapterContracts.map(adapterContractToDataSource),
        {
            id: 'derived.price_signals',
            kind: 'derived',
            label: 'Derived price signals',
            providerIds: ['local.daily_prices'],
            qualityStatus: priceRows > 0 ? priceQuality : 'block',
            roleAffinity: ['factor', 'risk', 'trend'],
            status: priceRows > 0 ? priceQuality === 'pass' ? 'available' : 'degraded' : 'unavailable',
            toolNames: [],
            warnings: priceRows > 0 ? [] : ['Price signal derivation has no input rows.'],
        },
    ];

    return sources.map((source) => ({
        ...source,
        providerIds: Array.from(new Set(source.providerIds)),
    }));
};

export const priceCoverageToProvenance = (priceCoverage: AssetPriceCoverageSnapshot[]): DataProvenance[] => priceCoverage
    .map(createDataProvenanceSource);
