import type { PreparedAllocationData } from './preprocessor';
import type { ActiveDualMomentumResearchProfile } from './active-dual-momentum-rules';

export interface ActiveDualMomentumCandidateScore {
    assetIndex: number;
    currentPrice: number;
    downsideRisk: number;
    drawdown: number;
    futures: boolean;
    momentum: number;
    rankScore: number;
    recent: number;
    riskScore: number;
    volatility: number;
}

export const isActiveDualMomentumFuturesAsset = (asset: PreparedAllocationData['series'][number]['asset']) => {
    const metadataInstrumentType = typeof asset.metadata.instrumentType === 'string'
        ? asset.metadata.instrumentType.toLowerCase()
        : '';
    return metadataInstrumentType.includes('future')
        || asset.tags.some((tag) => tag.toLowerCase().includes('future') || tag.includes('期货'))
        || /9999$/u.test(asset.symbol);
};

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

export const buildActiveDualMomentumCandidateScores = ({
    lookbackDays,
    prepared,
    profile,
    rebalanceIndex,
    topK,
}: {
    lookbackDays: number;
    prepared: PreparedAllocationData;
    profile?: ActiveDualMomentumResearchProfile;
    rebalanceIndex: number;
    topK: number;
}): ActiveDualMomentumCandidateScore[] => prepared.series.flatMap((entry, assetIndex) => {
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
        rankScore: resolveRankScore({ downsideRisk, drawdown, futures, momentum, profile, recent, volatility }),
        recent,
        riskScore: resolveRiskScore({ downsideRisk, profile, volatility }),
        volatility,
    }];
}).sort((left, right) => right.rankScore - left.rankScore).slice(0, topK);
