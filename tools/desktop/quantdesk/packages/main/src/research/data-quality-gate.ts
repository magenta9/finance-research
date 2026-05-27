import type { ResearchGateReasonCode, ReviewGateResult } from '@quantdesk/shared';

import type { ResearchContextSnapshot } from './context-snapshot';
import { createGateExplanation } from './gate-explanation';

export const runDataQualityGate = (context: ResearchContextSnapshot): ReviewGateResult => {
    const reasons = [
        ...(context.assets.length === 0 ? ['No assets are available in the local QuantDesk asset pool for this request.'] : []),
        ...context.missingAssetIds.map((assetId) => `Requested asset was not found: ${assetId}`),
        ...context.priceCoverage
            .filter((coverage) => coverage.status === 'block')
            .map((coverage) => `${coverage.symbol} has no local price history.`),
        ...context.priceCoverage
            .filter((coverage) => coverage.status === 'warn')
            .map((coverage) => `${coverage.symbol} price history is stale or lacks fetched_at.`),
        ...(context.riskProfile ? [] : ['Risk profile is missing; precise position sizing must stay unavailable.']),
        ...context.dataSources
            .filter((source) => source.kind === 'provider' && source.status === 'unavailable')
            .map((source) => `${source.label} provider is unavailable.`),
        ...context.dataSources
            .filter((source) => source.kind === 'provider' && source.status === 'degraded')
            .map((source) => `${source.label} provider is degraded: ${source.warnings.join(' ') || 'coverage requires verification.'}`),
    ];
    const reasonCodes: ResearchGateReasonCode[] = [
        ...(context.assets.length === 0 ? ['local_asset_pool_empty' as const] : []),
        ...context.missingAssetIds.map(() => 'requested_asset_missing' as const),
        ...context.priceCoverage
            .filter((coverage) => coverage.status === 'block')
            .map(() => 'price_history_missing' as const),
        ...context.priceCoverage
            .filter((coverage) => coverage.status === 'warn')
            .map(() => 'price_history_stale' as const),
        ...(context.riskProfile ? [] : ['risk_profile_missing' as const]),
        ...context.dataSources
            .filter((source) => source.kind === 'provider' && source.status === 'unavailable')
            .map(() => 'provider_source_unavailable' as const),
        ...context.dataSources
            .filter((source) => source.kind === 'provider' && source.status === 'degraded')
            .map(() => 'provider_degraded' as const),
    ];
    const hasBlock = context.assets.length === 0
        || context.missingAssetIds.length > 0
        || context.priceCoverage.some((coverage) => coverage.status === 'block')
        || context.dataSources.some((source) => source.kind === 'provider' && source.status === 'unavailable');
    const hasWarn = reasons.length > 0;

    const status = hasBlock ? 'block' : hasWarn ? 'warn' : 'pass';
    const requiredDowngrades = [
        ...(hasBlock ? ['Block high confidence and aggressive action.'] : []),
        ...(context.riskProfile ? [] : ['Set position level to precise_unavailable or none.']),
        ...(context.dataSources.some((source) => source.kind === 'provider' && source.status !== 'available')
            ? ['Keep action conservative until degraded or unavailable provider coverage is resolved or documented.']
            : []),
    ];

    return {
        dataProvenance: context.provenance,
        explanation: createGateExplanation({
            reasons,
            requiredDowngrades,
            reviewerRole: 'data_quality',
            status,
        }),
        reasons,
        reasonCodes,
        requiredDowngrades,
        reviewerRole: 'data_quality',
        status,
        verdict: hasBlock
            ? 'Critical local data is missing.'
            : hasWarn
                ? 'Research can continue with explicit limitations.'
                : 'Local data quality is sufficient for first-pass research.',
    };
};