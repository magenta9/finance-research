import type { ActiveDualMomentumDiagnostics, ActiveDualMomentumStrategyConfig } from '@quantdesk/shared';

import { buildActiveDualMomentumCandidateScores } from './active-dual-momentum-candidate-scoring';
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
    correlatedSameDirectionClusterRepresentative?: boolean;
    correlatedSameDirectionBudgetDedup?: boolean;
    crossSignOffsetCash?: boolean;
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
    riskTrimRedeploymentCooldown?: boolean;
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

export const signedActiveDualMomentumWeight = (
    position: Pick<ActiveDualMomentumPosition, 'direction' | 'weight'>,
) => position.direction === 'short' ? -position.weight : position.weight;

const highestPrice = (prices: number[], startIndex: number, endIndex: number) => {
    let high = 0;

    for (let index = startIndex; index <= endIndex; index += 1) {
        high = Math.max(high, prices[index] ?? 0);
    }

    return high;
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
    const candidates = buildActiveDualMomentumCandidateScores({
        lookbackDays,
        prepared,
        profile,
        rebalanceIndex,
        topK: config.topK,
    });

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
