import type { AllocationStrategy, AllocationType, RebalanceCadence } from '@quantdesk/shared';

export const CANONICAL_STRATEGY_IDS = [
    'active_dual_momentum_gtaa',
    'erc',
    'ewmac_trend_following',
    'inverse_volatility',
    'max_diversification',
] as const satisfies readonly AllocationStrategy[];

export const resolveAllocationMode = (strategyId: AllocationStrategy): AllocationType => {
    if (strategyId === 'erc') {
        return 'erc';
    }

    if (strategyId === 'inverse_volatility') {
        return 'inverse_volatility';
    }

    if (strategyId === 'max_diversification') {
        return 'max_diversification';
    }

    return 'inverse_volatility';
};

export const resolveDefaultRebalanceCadence = (
    strategyId: AllocationStrategy,
    override?: RebalanceCadence,
): RebalanceCadence => {
    if (override) {
        return override;
    }

    if (strategyId === 'active_dual_momentum_gtaa') {
        return 'weekly';
    }

    return 'monthly';
};
