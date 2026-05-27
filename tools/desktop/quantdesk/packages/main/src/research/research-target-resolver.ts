import crypto from 'node:crypto';

import type { AssetInput, AssetLookupResult, Market, ResearchRequestInput } from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import { resolveResearchAssetsFromQuery } from './context-snapshot';
import { normalizeResearchRequest } from './task-normalizer';

export interface ResearchTargetMarketDataResolver {
    ensure: (request: {
        assetId: string;
        horizon?: '10y' | '30y' | 'full-known-history';
        intent: 'asset-history';
        priority: 'background' | 'interactive';
    }) => Promise<unknown>;
    lookup: (request: { market?: string; query: string }) => Promise<AssetLookupResult[]>;
}

export interface ResolveResearchTargetInput {
    input: ResearchRequestInput;
    marketDataResolver?: ResearchTargetMarketDataResolver;
    repositories: Pick<Repositories, 'assetRepository'>;
    signal: AbortSignal;
}

const shouldResolveExternalTarget = (input: ResearchRequestInput, hasMarketDataResolver: boolean) => {
    if (!hasMarketDataResolver || (input.assetIds?.length ?? 0) > 0) {
        return false;
    }

    const normalizedRequest = normalizeResearchRequest(input);
    const hasTargetIntent = normalizedRequest.assetScope === 'single_asset'
        || normalizedRequest.taskType === 'short_term_trade'
        || normalizedRequest.assetType !== 'unknown'
        || normalizedRequest.assetClassHint !== null;

    return normalizedRequest.taskType !== 'allocation'
        && normalizedRequest.taskType !== 'macro'
        && normalizedRequest.taskType !== 'portfolio_review'
        && normalizedRequest.assetScope !== 'portfolio'
        && hasTargetIntent;
};

const createResolvedAssetInput = (candidate: AssetLookupResult): AssetInput => ({
    assetClass: candidate.assetClass,
    currency: candidate.currency,
    id: crypto.randomUUID(),
    market: candidate.market,
    metadata: {
        ...candidate.metadata,
        exchange: candidate.exchange ?? null,
        lookupSource: candidate.source,
    },
    name: candidate.name,
    symbol: candidate.symbol,
    tags: [],
});

export const resolveResearchTarget = async ({ input, marketDataResolver, repositories, signal }: ResolveResearchTargetInput): Promise<ResearchRequestInput> => {
    if (!shouldResolveExternalTarget(input, Boolean(marketDataResolver))) {
        return input;
    }

    const localAssets = repositories.assetRepository.list();
    const localMatches = resolveResearchAssetsFromQuery(input.query, localAssets);

    if (localMatches.length > 0) {
        await Promise.all(localMatches.map((asset) => marketDataResolver?.ensure({
            assetId: asset.id,
            horizon: '30y',
            intent: 'asset-history',
            priority: 'interactive',
        })));
        signal.throwIfAborted();

        return {
            ...input,
            assetIds: localMatches.map((asset) => asset.id),
        };
    }

    const normalizedRequest = normalizeResearchRequest(input);
    const market = normalizedRequest.assetType === 'A' || normalizedRequest.assetType === 'HK' || normalizedRequest.assetType === 'US'
        ? normalizedRequest.assetType as Market
        : undefined;
    const marketCandidates = await marketDataResolver?.lookup({ market, query: input.query }) ?? [];
    const candidates = marketCandidates.length > 0 || !market
        ? marketCandidates
        : await marketDataResolver?.lookup({ query: input.query }) ?? [];
    const candidate = candidates[0];

    signal.throwIfAborted();

    if (!candidate) {
        return {
            ...input,
            assetIds: [],
            unresolvedTarget: input.query,
        };
    }

    const existingAsset = repositories.assetRepository.list()
        .find((asset) => asset.symbol === candidate.symbol && asset.market === candidate.market);
    const asset = existingAsset ?? repositories.assetRepository.create(createResolvedAssetInput(candidate));
    const createdAssetId = existingAsset ? null : asset.id;

    try {
        await marketDataResolver?.ensure({
            assetId: asset.id,
            horizon: '30y',
            intent: 'asset-history',
            priority: 'interactive',
        });
        signal.throwIfAborted();
    } catch (error) {
        if (createdAssetId) {
            repositories.assetRepository.delete(createdAssetId);
        }

        throw error;
    }

    return {
        ...input,
        assetIds: [asset.id],
    };
};