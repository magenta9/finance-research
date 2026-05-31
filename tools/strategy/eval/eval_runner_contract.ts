import type {
    AllocationConstraints,
    AllocationStrategy,
    AllocationStrategyMix,
    AllocationType,
    Currency,
    PortfolioMetrics,
    RebalanceCadence,
} from '../../desktop/quantdesk/packages/shared/src/types/domain';
import type { StoredAsset } from '../../desktop/quantdesk/packages/shared/src/types/persistence';

export const CANONICAL_STRATEGY_IDS = [
    'active_dual_momentum_gtaa',
    'erc',
    'ewmac_trend_following',
    'inverse_volatility',
    'max_diversification',
    'max_diversification_research_v1',
] as const satisfies readonly AllocationStrategy[];

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

export const resolveAllocationMode = (strategyId: AllocationStrategy): AllocationType => {
    if (strategyId === 'erc') {
        return 'erc';
    }

    if (strategyId === 'inverse_volatility') {
        return 'inverse_volatility';
    }

    if (strategyId === 'max_diversification' || strategyId === 'max_diversification_research_v1') {
        return 'max_diversification';
    }

    return 'inverse_volatility';
};

export const resolveRebalanceCadence = (
    evalCase: EvalCaseInput,
    strategyId: AllocationStrategy,
): RebalanceCadence => {
    if (evalCase.rebalanceCadence) {
        return evalCase.rebalanceCadence;
    }

    if (strategyId === 'active_dual_momentum_gtaa') {
        return 'weekly';
    }

    return 'monthly';
};
