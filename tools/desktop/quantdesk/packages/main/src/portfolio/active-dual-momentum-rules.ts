import type { ActiveDualMomentumDiagnostics, ActiveDualMomentumStrategyConfig } from '@quantdesk/shared';

import { minimumPortfolioTradeWeight } from './portfolio-constants';
import type { PreparedAllocationData } from './preprocessor';

export interface NormalizedActiveDualMomentumConfig {
    absoluteMomentumFilter: boolean;
    longLookbackWeeks: number;
    researchProfile?: ActiveDualMomentumResearchProfile;
    shortLookbackWeeks: number;
    slippageBps: number;
    sleeveWeights: { long: number; short: number };
    topK: number;
    transactionCostBps: number;
}

export interface ActiveDualMomentumResearchProfile {
    cashBufferMultiplier?: number;
    cashReturnMode?: 'zero' | 'riskFreeRate';
    closeScoreCashFactor?: number;
    closeScoreThreshold?: number;
    confirmFuturesShort?: boolean;
    decayPenaltyFactor?: number;
    deduplicateSameAssetSleeveBudget?: boolean;
    etfHighWaterFilter?: boolean;
    futuresShortWeightMultiplier?: number;
    maxPositionWeight?: number;
    nettedResidualCashReturn?: boolean;
    portfolioDownsideVolTarget?: boolean;
    rankMode?: 'default' | 'riskAdjusted' | 'downsideRiskAdjusted' | 'drawdownPenalty' | 'momentumSlope' | 'positiveFuturesBias';
    rebalanceStep?: number;
    rebalanceWeightHoldBand?: number;
    riskExitRedeploymentCooldown?: boolean;
    riskMode?: 'inverseVolatility' | 'inverseDownsideVolatility' | 'sqrtInverseVolatility' | 'equalWeight';
    shockToCash?: boolean;
}

export interface ActiveDualMomentumPosition {
    assetIndex: number;
    direction: 'long' | 'short';
    longMomentum?: number;
    shortMomentum?: number;
    source: 'short' | 'long' | 'both';
    weight: number;
}

export interface ActiveDualMomentumSleeveSelection {
    cashWeight: number;
    filtered: ActiveDualMomentumDiagnostics['rebalanceRecords'][number]['selectedButFiltered'];
    positions: ActiveDualMomentumPosition[];
}

export const activeDualMomentumTradingDaysPerWeek = 5;
export const activeDualMomentumWarmupBufferWeeks = 4;

export const resolveActiveDualMomentumWarmupCalendarDays = (
    config?: ActiveDualMomentumStrategyConfig,
) => {
    const normalized = normalizeActiveDualMomentumConfig(config);
    const maxLookbackWeeks = Math.max(normalized.shortLookbackWeeks, normalized.longLookbackWeeks);

    return (maxLookbackWeeks + activeDualMomentumWarmupBufferWeeks) * 7;
};

const researchProfileFromConfig = (config?: ActiveDualMomentumStrategyConfig) => {
    const profile = (config as ActiveDualMomentumStrategyConfig & { researchProfile?: ActiveDualMomentumResearchProfile } | undefined)
        ?.researchProfile;

    return profile && typeof profile === 'object' ? profile : undefined;
};

export const normalizeActiveDualMomentumConfig = (
    config?: ActiveDualMomentumStrategyConfig,
): NormalizedActiveDualMomentumConfig => ({
    absoluteMomentumFilter: config?.absoluteMomentumFilter ?? true,
    longLookbackWeeks: config?.longLookbackWeeks ?? 25,
    researchProfile: researchProfileFromConfig(config),
    shortLookbackWeeks: config?.shortLookbackWeeks ?? 10,
    slippageBps: config?.slippageBps ?? 0,
    sleeveWeights: config?.sleeveWeights ?? { long: 0.5, short: 0.5 },
    topK: Math.min(5, Math.max(3, Math.round(config?.topK ?? 3))),
    transactionCostBps: config?.transactionCostBps ?? 0,
});

export const isActiveDualMomentumFuturesAsset = (asset: PreparedAllocationData['series'][number]['asset']) => {
    const metadataInstrumentType = typeof asset.metadata.instrumentType === 'string'
        ? asset.metadata.instrumentType.toLowerCase()
        : '';
    return metadataInstrumentType.includes('future')
        || asset.tags.some((tag) => tag.toLowerCase().includes('future') || tag.includes('期货'))
        || /9999$/u.test(asset.symbol);
};

export const signedActiveDualMomentumWeight = (
    position: Pick<ActiveDualMomentumPosition, 'direction' | 'weight'>,
) => position.direction === 'short' ? -position.weight : position.weight;

const dailyReturnsInRange = (prices: number[], startIndex: number, endIndex: number) => {
    const returns: number[] = [];

    for (let index = startIndex + 1; index <= endIndex; index += 1) {
        const previousPrice = prices[index - 1] ?? 0;
        const currentPrice = prices[index] ?? 0;

        if (previousPrice > 0 && currentPrice > 0) {
            returns.push(currentPrice / previousPrice - 1);
        }
    }

    return returns;
};

const volatilityFromReturns = (returns: number[]) => {
    if (returns.length < 2) {
        return 0;
    }

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);

    return Math.sqrt(Math.max(0, variance));
};

const realizedVolatility = (prices: number[], startIndex: number, endIndex: number) => {
    const returns = dailyReturnsInRange(prices, startIndex, endIndex);

    return volatilityFromReturns(returns);
};

const downsideVolatility = (prices: number[], startIndex: number, endIndex: number) => {
    const downsideReturns = dailyReturnsInRange(prices, startIndex, endIndex).filter((value) => value < 0);

    return volatilityFromReturns(downsideReturns);
};

const maxLookbackDrawdown = (prices: number[], startIndex: number, endIndex: number) => {
    let peak = prices[startIndex] ?? 0;
    let maxDrawdown = 0;

    for (let index = startIndex + 1; index <= endIndex; index += 1) {
        const price = prices[index] ?? 0;

        if (price <= 0) {
            continue;
        }
        peak = Math.max(peak, price);
        if (peak > 0) {
            maxDrawdown = Math.max(maxDrawdown, 1 - price / peak);
        }
    }

    return maxDrawdown;
};

const recentMomentum = (prices: number[], endIndex: number, days: number) => {
    const startIndex = Math.max(0, endIndex - days);
    const previousPrice = prices[startIndex] ?? 0;
    const currentPrice = prices[endIndex] ?? 0;

    return previousPrice > 0 && currentPrice > 0 ? currentPrice / previousPrice - 1 : 0;
};

const highestPrice = (prices: number[], startIndex: number, endIndex: number) => {
    let high = 0;

    for (let index = startIndex; index <= endIndex; index += 1) {
        high = Math.max(high, prices[index] ?? 0);
    }

    return high;
};

const resolveRankScore = ({
    downsideRisk,
    drawdown,
    futures,
    momentum,
    profile,
    recent,
    volatility,
}: {
    downsideRisk: number;
    drawdown: number;
    futures: boolean;
    momentum: number;
    profile?: ActiveDualMomentumResearchProfile;
    recent: number;
    volatility: number;
}) => {
    const baseScore = futures ? Math.abs(momentum) : momentum;
    const rankMode = profile?.rankMode ?? 'downsideRiskAdjusted';

    switch (rankMode) {
        case 'riskAdjusted':
            return baseScore / Math.max(volatility, 0.0001);
        case 'downsideRiskAdjusted':
            return baseScore / Math.max(downsideRisk, 0.0001);
        case 'drawdownPenalty':
            return baseScore * Math.max(0, 1 - drawdown);
        case 'momentumSlope':
            return baseScore + recent;
        case 'positiveFuturesBias':
            return futures && momentum < 0 ? baseScore * 0.85 : baseScore;
        default:
            return baseScore;
    }
};

const resolveRiskScore = ({
    downsideRisk,
    profile,
    volatility,
}: {
    downsideRisk: number;
    profile?: ActiveDualMomentumResearchProfile;
    volatility: number;
}) => {
    switch (profile?.riskMode) {
        case 'equalWeight':
            return 1;
        case 'inverseDownsideVolatility':
            return 1 / Math.max(downsideRisk || volatility, 0.0001);
        case 'sqrtInverseVolatility':
            return Math.sqrt(1 / Math.max(volatility, 0.0001));
        default:
            if (!profile?.riskMode) {
                return 1 / Math.max(downsideRisk || volatility, 0.0001);
            }
            return 1 / Math.max(volatility, 0.0001);
    }
};

export const selectActiveDualMomentumSleeve = ({
    config,
    lookbackWeeks,
    prepared,
    rebalanceIndex,
    sleeve,
}: {
    config: NormalizedActiveDualMomentumConfig;
    lookbackWeeks: number;
    prepared: PreparedAllocationData;
    rebalanceIndex: number;
    sleeve: 'short' | 'long';
}): ActiveDualMomentumSleeveSelection => {
    const lookbackDays = lookbackWeeks * activeDualMomentumTradingDaysPerWeek;
    const profile = config.researchProfile;
    const candidates = prepared.series.flatMap((entry, assetIndex) => {
        const previousPrice = entry.prices[rebalanceIndex - lookbackDays];
        const currentPrice = entry.prices[rebalanceIndex];

        if (!previousPrice || !currentPrice || previousPrice <= 0) {
            return [];
        }

        const momentum = currentPrice / previousPrice - 1;
        const futures = isActiveDualMomentumFuturesAsset(entry.asset);
        const volatility = realizedVolatility(entry.prices, rebalanceIndex - lookbackDays, rebalanceIndex);
        const downsideRisk = downsideVolatility(entry.prices, rebalanceIndex - lookbackDays, rebalanceIndex);
        const drawdown = maxLookbackDrawdown(entry.prices, rebalanceIndex - lookbackDays, rebalanceIndex);
        const recent = recentMomentum(entry.prices, rebalanceIndex, Math.min(10, Math.max(1, Math.floor(lookbackDays / 3))));
        return [{
            assetIndex,
            currentPrice,
            downsideRisk,
            drawdown,
            futures,
            momentum,
            recent,
            rankScore: resolveRankScore({ downsideRisk, drawdown, futures, momentum, profile, recent, volatility }),
            riskScore: resolveRiskScore({ downsideRisk, profile, volatility }),
            volatility,
        }];
    }).sort((left, right) => right.rankScore - left.rankScore).slice(0, config.topK);

    if (candidates.length === 0) {
        return { cashWeight: 0, filtered: [], positions: [] };
    }

    const sleeveWeight = config.sleeveWeights[sleeve];
    const totalRiskScore = candidates.reduce((sum, candidate) => sum + candidate.riskScore, 0);
    const rankSpread = (candidates[0]?.rankScore ?? 0) - (candidates.at(-1)?.rankScore ?? 0);
    const filtered: ActiveDualMomentumSleeveSelection['filtered'] = [];
    const positions: ActiveDualMomentumPosition[] = [];
    let cashWeight = 0;

    candidates.forEach((candidate) => {
        const asset = prepared.series[candidate.assetIndex].asset;
        let slotWeight = totalRiskScore > 0
            ? sleeveWeight * candidate.riskScore / totalRiskScore
            : sleeveWeight / candidates.length;
        const closeScoreThreshold = profile?.closeScoreThreshold ?? 0;

        if (profile?.closeScoreCashFactor && rankSpread > 0 && rankSpread < closeScoreThreshold) {
            const retainedWeight = slotWeight * profile.closeScoreCashFactor;
            cashWeight += slotWeight - retainedWeight;
            slotWeight = retainedWeight;
        }

        if (profile?.decayPenaltyFactor && Math.sign(candidate.momentum) !== Math.sign(candidate.recent) && candidate.recent !== 0) {
            const retainedWeight = slotWeight * profile.decayPenaltyFactor;
            cashWeight += slotWeight - retainedWeight;
            slotWeight = retainedWeight;
        }

        if (profile?.shockToCash && candidate.volatility > 0 && Math.abs(candidate.recent) > candidate.volatility * 5) {
            cashWeight += slotWeight;
            return;
        }

        if (profile?.maxPositionWeight && slotWeight > profile.maxPositionWeight) {
            cashWeight += slotWeight - profile.maxPositionWeight;
            slotWeight = profile.maxPositionWeight;
        }

        if (candidate.futures) {
            if (candidate.momentum === 0) {
                return;
            }

            if (sleeve === 'long' && candidate.momentum < 0) {
                cashWeight += slotWeight;
                filtered.push({
                    assetId: asset.id,
                    momentum: candidate.momentum,
                    reason: 'NEGATIVE_MOMENTUM',
                    symbol: asset.symbol,
                });
                return;
            }

            if (profile?.confirmFuturesShort && candidate.momentum < 0 && candidate.recent >= 0) {
                cashWeight += slotWeight;
                filtered.push({
                    assetId: asset.id,
                    momentum: candidate.momentum,
                    reason: 'NEGATIVE_MOMENTUM',
                    symbol: asset.symbol,
                });
                return;
            }

            if (profile?.futuresShortWeightMultiplier && candidate.momentum < 0) {
                const retainedWeight = slotWeight * profile.futuresShortWeightMultiplier;
                cashWeight += slotWeight - retainedWeight;
                slotWeight = retainedWeight;
            }

            positions.push({
                assetIndex: candidate.assetIndex,
                direction: candidate.momentum > 0 ? 'long' : 'short',
                longMomentum: sleeve === 'long' ? candidate.momentum : undefined,
                shortMomentum: sleeve === 'short' ? candidate.momentum : undefined,
                source: sleeve,
                weight: slotWeight,
            });
            return;
        }

        if (profile?.etfHighWaterFilter) {
            const high = highestPrice(prepared.series[candidate.assetIndex].prices, rebalanceIndex - lookbackDays, rebalanceIndex);

            if (high > 0 && candidate.currentPrice < high * 0.9) {
                cashWeight += slotWeight;
                filtered.push({
                    assetId: asset.id,
                    momentum: candidate.momentum,
                    reason: 'NEGATIVE_MOMENTUM',
                    symbol: asset.symbol,
                });
                return;
            }
        }

        if (config.absoluteMomentumFilter && candidate.momentum <= 0) {
            cashWeight += slotWeight;
            filtered.push({
                assetId: asset.id,
                momentum: candidate.momentum,
                reason: 'NEGATIVE_MOMENTUM',
                symbol: asset.symbol,
            });
            return;
        }

        positions.push({
            assetIndex: candidate.assetIndex,
            direction: 'long',
            longMomentum: sleeve === 'long' ? candidate.momentum : undefined,
            shortMomentum: sleeve === 'short' ? candidate.momentum : undefined,
            source: sleeve,
            weight: slotWeight,
        });
    });

    return { cashWeight, filtered, positions };
};

export const mergeActiveDualMomentumSleevesWithCash = (
    shortSleeve: ActiveDualMomentumSleeveSelection,
    longSleeve: ActiveDualMomentumSleeveSelection,
    options?: { deduplicateSameDirection?: boolean },
) => {
    const merged = new Map<number, ActiveDualMomentumPosition>();
    let cashWeight = 0;

    [...shortSleeve.positions, ...longSleeve.positions].forEach((position) => {
        const existing = merged.get(position.assetIndex);

        if (!existing) {
            merged.set(position.assetIndex, { ...position });
            return;
        }

        if (options?.deduplicateSameDirection && existing.direction === position.direction) {
            cashWeight += Math.min(existing.weight, position.weight);
            existing.weight = Math.max(existing.weight, position.weight);
            existing.source = 'both';
            existing.shortMomentum = existing.shortMomentum ?? position.shortMomentum;
            existing.longMomentum = existing.longMomentum ?? position.longMomentum;
            return;
        }

        const netWeight = signedActiveDualMomentumWeight(existing) + signedActiveDualMomentumWeight(position);
        existing.direction = netWeight < 0 ? 'short' : 'long';
        existing.weight = Math.abs(netWeight);
        existing.source = 'both';
        existing.shortMomentum = existing.shortMomentum ?? position.shortMomentum;
        existing.longMomentum = existing.longMomentum ?? position.longMomentum;
    });

    return {
        cashWeight,
        positions: [...merged.values()].filter((position) => position.weight >= minimumPortfolioTradeWeight),
    };
};

export const mergeActiveDualMomentumSleeves = (
    shortSleeve: ActiveDualMomentumSleeveSelection,
    longSleeve: ActiveDualMomentumSleeveSelection,
) => mergeActiveDualMomentumSleevesWithCash(shortSleeve, longSleeve).positions;
