import type { ActiveDualMomentumDiagnostics, ActiveDualMomentumStrategyConfig } from '@quantdesk/shared';

import { minimumPortfolioTradeWeight } from './portfolio-constants';
import type { PreparedAllocationData } from './preprocessor';

export interface NormalizedActiveDualMomentumConfig {
    absoluteMomentumFilter: boolean;
    longLookbackWeeks: number;
    shortLookbackWeeks: number;
    slippageBps: number;
    sleeveWeights: { long: number; short: number };
    topK: number;
    transactionCostBps: number;
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

export const normalizeActiveDualMomentumConfig = (
    config?: ActiveDualMomentumStrategyConfig,
): NormalizedActiveDualMomentumConfig => ({
    absoluteMomentumFilter: config?.absoluteMomentumFilter ?? true,
    longLookbackWeeks: config?.longLookbackWeeks ?? 25,
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

const realizedVolatility = (prices: number[], startIndex: number, endIndex: number) => {
    const returns: number[] = [];

    for (let index = startIndex + 1; index <= endIndex; index += 1) {
        const previousPrice = prices[index - 1] ?? 0;
        const currentPrice = prices[index] ?? 0;

        if (previousPrice > 0 && currentPrice > 0) {
            returns.push(currentPrice / previousPrice - 1);
        }
    }

    if (returns.length < 2) {
        return 0;
    }

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);

    return Math.sqrt(Math.max(0, variance));
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
    const candidates = prepared.series.flatMap((entry, assetIndex) => {
        const previousPrice = entry.prices[rebalanceIndex - lookbackDays];
        const currentPrice = entry.prices[rebalanceIndex];

        if (!previousPrice || !currentPrice || previousPrice <= 0) {
            return [];
        }

        const momentum = currentPrice / previousPrice - 1;
        const futures = isActiveDualMomentumFuturesAsset(entry.asset);
        return [{
            assetIndex,
            futures,
            momentum,
            rankScore: futures ? Math.abs(momentum) : momentum,
            riskScore: 1 / Math.max(realizedVolatility(entry.prices, rebalanceIndex - lookbackDays, rebalanceIndex), 0.0001),
        }];
    }).sort((left, right) => right.rankScore - left.rankScore).slice(0, config.topK);

    if (candidates.length === 0) {
        return { cashWeight: 0, filtered: [], positions: [] };
    }

    const sleeveWeight = config.sleeveWeights[sleeve];
    const totalRiskScore = candidates.reduce((sum, candidate) => sum + candidate.riskScore, 0);
    const filtered: ActiveDualMomentumSleeveSelection['filtered'] = [];
    const positions: ActiveDualMomentumPosition[] = [];
    let cashWeight = 0;

    candidates.forEach((candidate) => {
        const asset = prepared.series[candidate.assetIndex].asset;
        const equalWeight = sleeveWeight / candidates.length;
        const inverseVolatilityWeight = totalRiskScore > 0
            ? sleeveWeight * candidate.riskScore / totalRiskScore
            : equalWeight;
        const slotWeight = (equalWeight + inverseVolatilityWeight) / 2;

        if (candidate.futures) {
            if (candidate.momentum === 0) {
                return;
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

export const mergeActiveDualMomentumSleeves = (
    shortSleeve: ActiveDualMomentumSleeveSelection,
    longSleeve: ActiveDualMomentumSleeveSelection,
) => {
    const merged = new Map<number, ActiveDualMomentumPosition>();

    [...shortSleeve.positions, ...longSleeve.positions].forEach((position) => {
        const existing = merged.get(position.assetIndex);

        if (!existing) {
            merged.set(position.assetIndex, { ...position });
            return;
        }

        const netWeight = signedActiveDualMomentumWeight(existing) + signedActiveDualMomentumWeight(position);
        existing.direction = netWeight < 0 ? 'short' : 'long';
        existing.weight = Math.abs(netWeight);
        existing.source = 'both';
        existing.shortMomentum = existing.shortMomentum ?? position.shortMomentum;
        existing.longMomentum = existing.longMomentum ?? position.longMomentum;
    });

    return [...merged.values()].filter((position) => position.weight >= minimumPortfolioTradeWeight);
};
