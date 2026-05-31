import type {
    AllocationConstraints,
    AllocationResult,
    AllocationStrategyMix,
} from '@quantdesk/shared';

export const defaultAllocationConstraints: AllocationConstraints = {
    allowLeverage: false,
    allowShort: false,
    maxClassWeight: {},
    maxSingleWeight: 0.5,
};

export const mergeAllocationConstraints = (constraints: AllocationConstraints): AllocationConstraints => ({
    ...defaultAllocationConstraints,
    ...constraints,
    maxClassWeight: {
        ...defaultAllocationConstraints.maxClassWeight,
        ...constraints.maxClassWeight,
    },
});

export const validateAllocationConstraints = (
    constraints: AllocationConstraints,
): NonNullable<AllocationResult['error']> | null => {
    if (constraints.allowShort) {
        return {
            code: 'UNSUPPORTED_CONSTRAINTS',
            message: 'Short selling is not supported by the current allocation modes.',
            suggestions: ['Disable allowShort and re-run.'],
        };
    }

    if (constraints.allowLeverage) {
        return {
            code: 'UNSUPPORTED_CONSTRAINTS',
            message: 'Leverage is not supported by the current allocation modes.',
            suggestions: ['Disable allowLeverage and re-run.'],
        };
    }

    return null;
};

export const validateAllocationAssetSelection = (
    assetIndexes: number[],
): NonNullable<AllocationResult['error']> | null => {
    if (assetIndexes.length >= 2) {
        return null;
    }

    return {
        code: 'INVALID_STRATEGY_MIX',
        message: '配置部分至少需要覆盖两个标的。',
        suggestions: ['在配置标的中至少勾选两个资产，或从资产池补充可配置标的。'],
    };
};

export const validateAllocationStrategyMix = (
    strategyMix?: AllocationStrategyMix,
): NonNullable<AllocationResult['error']> | null => {
    const trendFollowing = strategyMix?.trendFollowing;

    if (!trendFollowing?.enabled) {
        return null;
    }

    if (!Number.isFinite(trendFollowing.sleeveWeight) || trendFollowing.sleeveWeight < 0 || trendFollowing.sleeveWeight > 1) {
        return {
            code: 'INVALID_STRATEGY_MIX',
            message: '趋势跟随仓位需要在 0% 到 100% 之间。',
            suggestions: ['将趋势跟随仓位调整到 0 到 1 之间。'],
        };
    }

    if (trendFollowing.forecastCap != null && (!Number.isFinite(trendFollowing.forecastCap) || trendFollowing.forecastCap <= 0)) {
        return {
            code: 'INVALID_STRATEGY_MIX',
            message: '趋势跟随 forecast cap 必须为正数。',
            suggestions: ['使用默认 cap 20，或输入一个正数。'],
        };
    }

    for (const rule of trendFollowing.rules ?? []) {
        if (rule.enabled === false) {
            continue;
        }

        const slow = rule.slow ?? rule.fast * 4;

        if (!Number.isFinite(rule.fast) || rule.fast <= 0 || !Number.isFinite(slow) || slow <= rule.fast) {
            return {
                code: 'INVALID_STRATEGY_MIX',
                message: 'EWMAC 子规则需要满足 slow > fast > 0。',
                suggestions: ['使用 2/8、4/16、8/32、16/64、32/128、64/256 这一组默认规则。'],
            };
        }

        if (rule.scalar != null && (!Number.isFinite(rule.scalar) || rule.scalar <= 0)) {
            return {
                code: 'INVALID_STRATEGY_MIX',
                message: 'EWMAC forecast scalar 必须为正数。',
                suggestions: ['使用默认 scalar 表。'],
            };
        }
    }

    return null;
};
