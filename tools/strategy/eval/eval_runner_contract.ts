import type {
    AllocationConstraints,
    AllocationStrategy,
    AllocationStrategyMix,
    Currency,
    PortfolioMetrics,
    RebalanceCadence,
} from '@quantdesk/shared';
import type { StoredAsset } from '@quantdesk/shared';
import {
    CANONICAL_STRATEGY_IDS,
    resolveAllocationMode,
    resolveDefaultRebalanceCadence,
} from '@finance-research/allocation-engine';

export { CANONICAL_STRATEGY_IDS, resolveAllocationMode };

export interface EvalAssetInput {
    assetClass: StoredAsset['assetClass'];
    currency: StoredAsset['currency'];
    id: string;
    market: StoredAsset['market'];
    metadata?: Record<string, unknown>;
    name: string;
    symbol: string;
    tags?: string[];
}

export interface QuantDataPriceRow {
    adjustedClose?: number | null;
    calculationClose?: number | null;
    close?: number | null;
    date: string;
}

export interface EvalPriceCacheEntry {
    prices: QuantDataPriceRow[];
    providerSymbol?: string;
    requestMarket?: string;
    warnings?: string[];
}

export interface EvalCaseInput {
    assetIds?: string[];
    basketSize: number;
    caseId: string;
    endDate: string;
    rebalanceCadence?: RebalanceCadence;
    sampleIndex: number;
    skipReason?: string;
    startDate: string;
    symbols: string[];
    windowYears: number;
}

export interface StrategyRunInput {
    constraints?: AllocationConstraints;
    extraResultFields?: string[];
    strategyId: AllocationStrategy;
    strategyMix?: AllocationStrategyMix;
}

export interface EvalRunRequest {
    assets: EvalAssetInput[];
    baseCurrency: Currency;
    cases: EvalCaseInput[];
    defaultConstraints: AllocationConstraints;
    pricesBySymbol: Record<string, EvalPriceCacheEntry>;
    strategyRuns: StrategyRunInput[];
}

export type EvalResultStatus = 'error' | 'ok' | 'skipped';

export interface EvalResultRow {
    basketSize: number;
    caseId: string;
    endDate: string;
    error?: string | null;
    metadata?: Record<string, unknown>;
    metrics?: PortfolioMetrics;
    rebalanceCadence?: RebalanceCadence;
    rebalanceEventCount?: number | null;
    sampleIndex: number;
    startDate: string;
    status: EvalResultStatus;
    strategyId: AllocationStrategy;
    symbols: string[];
    windowYears: number;
}

export interface EvalRunnerOutput {
    rows: EvalResultRow[];
}

export const resolveRebalanceCadence = (
    evalCase: EvalCaseInput,
    strategyId: AllocationStrategy,
): RebalanceCadence => resolveDefaultRebalanceCadence(strategyId, evalCase.rebalanceCadence);
