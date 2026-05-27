import type {
    PriceAnalogStatus,
    PriceAnalogWindow,
    PricePatternAnalogSearchResult,
    StoredAsset,
} from '@quantdesk/shared';

import { dedupeAnalogCandidates } from './dedupe';
import { buildForwardPath, evaluateForwardOutcomes, hasRequiredForwardCoverage } from './forward';
import {
    buildAnalogSeries,
    buildRequestedWindow,
    buildWindowSnapshot,
    forwardHorizonPoints,
    minimumWindowPoints,
    windowStartDateFromEnd,
} from './series';
import { passesQualityGate, scoreAnalogWindow } from './scorer';
import type { AnalogSeries, PriceAnalogSearchInput, ScoredAnalogCandidate, WindowSnapshot } from './types';

const defaultLimit = 10;
const maxComparableAssets = 40;
const maxRawWindowCount = 100_000;
const candidateWindowStride = 5;
const maximumWindowPoints: Record<PriceAnalogWindow, number> = {
    '3M': 95,
    '6M': 190,
    '1Y': 380,
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const clampLimit = (value: number | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return defaultLimit;
    }

    return Math.min(20, Math.max(1, Math.trunc(value)));
};

const emptyCandidateSummary = {
    comparableAssetCount: 0,
    dedupedWindowCount: 0,
    eligibleWindowCount: 0,
    localAssetCount: 0,
    rawWindowCount: 0,
};

const hasValidDateInput = (startDate?: string, endDate?: string) => {
    if (startDate && !isoDatePattern.test(startDate)) {
        return false;
    }

    if (endDate && !isoDatePattern.test(endDate)) {
        return false;
    }

    if (startDate && endDate && startDate > endDate) {
        return false;
    }

    return true;
};

const emptyResult = (
    request: PriceAnalogSearchInput['request'],
    status: PriceAnalogStatus,
    warnings: string[],
    asset?: StoredAsset | null,
): PricePatternAnalogSearchResult => ({
    candidateSummary: emptyCandidateSummary,
    query: {
        assetClass: asset?.assetClass ?? null,
        assetId: request.assetId,
        endDate: request.endDate ?? null,
        market: asset?.market ?? null,
        startDate: request.startDate ?? null,
        symbol: asset?.symbol ?? null,
        tradingDays: 0,
        window: request.window,
    },
    results: [],
    status,
    targetPath: [],
    warnings,
});

const resolveTargetWindowDates = (
    window: PriceAnalogWindow,
    snapshot: WindowSnapshot,
) => ({
    endDate: snapshot.path.at(-1)?.date ?? null,
    startDate: snapshot.path[0]?.date ?? null,
    window,
});

const buildComparableSeries = (
    assets: StoredAsset[],
    targetAsset: StoredAsset,
    loadPrices: (assetId: string) => PriceAnalogSearchInput['dependencies']['priceRepository']['listByAsset'] extends (assetId: string) => infer Result ? Result : never,
) => assets
    .filter((asset) => asset.market === targetAsset.market && asset.assetClass === targetAsset.assetClass)
    .map((asset) => buildAnalogSeries(asset, loadPrices(asset.id)))
    .filter((series) => series.points.length > 0);

const overlapsTargetWindow = (
    candidate: WindowSnapshot,
    target: WindowSnapshot,
) => {
    const candidateStart = candidate.path[0]?.date;
    const candidateEnd = candidate.path.at(-1)?.date;
    const targetStart = target.path[0]?.date;

    return Boolean(candidateStart && candidateEnd && targetStart && candidateEnd >= targetStart);
};

const buildCandidate = ({
    analogSnapshot,
    series,
    targetAsset,
    targetSnapshot,
}: {
    analogSnapshot: WindowSnapshot;
    series: AnalogSeries;
    targetAsset: StoredAsset;
    targetSnapshot: WindowSnapshot;
}): ScoredAnalogCandidate | null => {
    const forward = evaluateForwardOutcomes(series, analogSnapshot.endIndex);

    if (!hasRequiredForwardCoverage(forward)) {
        return null;
    }

    const similarity = scoreAnalogWindow(targetSnapshot, analogSnapshot);

    if (!passesQualityGate(similarity)) {
        return null;
    }

    return {
        asset: {
            assetClass: series.asset.assetClass,
            currency: series.asset.currency,
            id: series.asset.id,
            market: series.asset.market,
            name: series.asset.name,
            symbol: series.asset.symbol,
        },
        diagnostics: {
            analogMaxDrawdown: analogSnapshot.maxDrawdown,
            analogTotalReturn: analogSnapshot.totalReturn,
            analogVolatility: analogSnapshot.volatility,
            targetMaxDrawdown: targetSnapshot.maxDrawdown,
            targetTotalReturn: targetSnapshot.totalReturn,
            targetVolatility: targetSnapshot.volatility,
        },
        endIndex: analogSnapshot.endIndex,
        forward,
        forwardPaths: {
            '3M': buildForwardPath(series, analogSnapshot.endIndex, forwardHorizonPoints['3M']),
        },
        id: `${series.asset.id}:${analogSnapshot.path[0].date}:${analogSnapshot.path.at(-1)!.date}`,
        match: {
            endDate: analogSnapshot.path.at(-1)!.date,
            startDate: analogSnapshot.path[0].date,
            tradingDays: analogSnapshot.path.length,
        },
        overlapStartIndex: analogSnapshot.startIndex,
        path: analogSnapshot.path,
        similarity,
        sourceType: series.asset.id === targetAsset.id ? 'self' : 'peer',
        startIndex: analogSnapshot.startIndex,
    };
};

const resolveStatus = (
    results: ScoredAnalogCandidate[],
    warnings: string[],
): PriceAnalogStatus => {
    if (results.length === 0) {
        return 'unavailable';
    }

    const topScore = results[0]?.similarity.score ?? 0;
    const hasPartialSixMonthForward = results.some((result) => result.forward['6M'].status !== 'complete');
    const selfCount = results.filter((result) => result.sourceType === 'self').length;

    if (results.length < 3 || topScore < 65 || hasPartialSixMonthForward || selfCount / results.length > 0.7 || warnings.length > 0) {
        return 'degraded';
    }

    return 'ok';
};

export const searchPricePatternAnalogs = ({
    dependencies,
    request,
}: PriceAnalogSearchInput): PricePatternAnalogSearchResult => {
    const limit = clampLimit(request.limit);
    const assets = dependencies.assetRepository.list();
    const targetAsset = assets.find((asset) => asset.id === request.assetId);

    if (!targetAsset) {
        return emptyResult(request, 'unavailable', ['requested_asset_missing']);
    }

    if (!hasValidDateInput(request.startDate, request.endDate)) {
        return emptyResult(request, 'unavailable', ['invalid_date_range'], targetAsset);
    }

    const targetSeries = buildAnalogSeries(targetAsset, dependencies.priceRepository.listByAsset(targetAsset.id));
    const requestedEndDate = request.endDate ?? targetSeries.points.at(-1)?.date;
    const requestedStartDate = request.startDate ?? (requestedEndDate ? windowStartDateFromEnd(request.window, requestedEndDate) : undefined);
    const targetSnapshot = buildRequestedWindow(targetSeries, request.window, requestedStartDate, requestedEndDate);

    if (!targetSnapshot || targetSnapshot.path.length < minimumWindowPoints[request.window]) {
        return emptyResult(request, 'unavailable', ['target_window_insufficient_samples'], targetAsset);
    }

    if (targetSnapshot.path.length > maximumWindowPoints[request.window]) {
        return emptyResult(request, 'unavailable', ['target_window_exceeds_supported_scale'], targetAsset);
    }

    const allComparableSeries = buildComparableSeries(
        assets,
        targetAsset,
        (assetId) => dependencies.priceRepository.listByAsset(assetId),
    );
    const warnings: string[] = [];
    const comparableSeries = allComparableSeries.slice(0, maxComparableAssets);

    if (allComparableSeries.length > comparableSeries.length) {
        warnings.push('candidate_asset_budget_exhausted');
    }

    let rawWindowCount = 0;
    const scoredCandidates: ScoredAnalogCandidate[] = [];
    const targetLength = targetSnapshot.path.length;

    for (const series of comparableSeries) {
        for (let startIndex = 0; startIndex + targetLength - 1 < series.points.length; startIndex += candidateWindowStride) {
            if (rawWindowCount >= maxRawWindowCount) {
                warnings.push('candidate_window_budget_exhausted');
                break;
            }

            const endIndex = startIndex + targetLength - 1;
            const analogSnapshot = buildWindowSnapshot(series, startIndex, endIndex);
            rawWindowCount += 1;

            if (series.asset.id === targetAsset.id && overlapsTargetWindow(analogSnapshot, targetSnapshot)) {
                continue;
            }

            const candidate = buildCandidate({
                analogSnapshot,
                series,
                targetAsset,
                targetSnapshot,
            });

            if (candidate) {
                scoredCandidates.push(candidate);
            }
        }

        if (rawWindowCount >= maxRawWindowCount) {
            break;
        }
    }

    if (comparableSeries.length <= 1) {
        warnings.push('candidate_pool_too_small');
    }

    const dedupedCandidates = dedupeAnalogCandidates(scoredCandidates);
    const results = dedupedCandidates.slice(0, limit);
    const status = resolveStatus(results, warnings);
    const windowDates = resolveTargetWindowDates(request.window, targetSnapshot);

    return {
        candidateSummary: {
            comparableAssetCount: comparableSeries.length,
            dedupedWindowCount: dedupedCandidates.length,
            eligibleWindowCount: scoredCandidates.length,
            localAssetCount: assets.length,
            rawWindowCount,
        },
        query: {
            assetClass: targetAsset.assetClass,
            assetId: targetAsset.id,
            endDate: windowDates.endDate,
            market: targetAsset.market,
            startDate: windowDates.startDate,
            symbol: targetAsset.symbol,
            tradingDays: targetSnapshot.path.length,
            window: request.window,
        },
        results: results.map(({ endIndex: _endIndex, overlapStartIndex: _overlapStartIndex, startIndex: _startIndex, ...result }) => result),
        status,
        targetPath: targetSnapshot.path,
        warnings: status === 'unavailable' && results.length === 0
            ? [...warnings, 'no_high_quality_analogs']
            : warnings,
    };
};