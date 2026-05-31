import type { PreparedAllocationData } from './preprocessor';
import {
    signedActiveDualMomentumWeight,
    type ActiveDualMomentumPosition,
    type NormalizedActiveDualMomentumConfig,
} from './active-dual-momentum-rules';

export const activeDualMomentumPortfolioDownsideVolatility = ({
    endIndex,
    positions,
    prepared,
    startIndex,
}: {
    endIndex: number;
    positions: ActiveDualMomentumPosition[];
    prepared: PreparedAllocationData;
    startIndex: number;
}) => {
    const downsideReturns: number[] = [];

    for (let dayIndex = Math.max(1, startIndex + 1); dayIndex <= endIndex; dayIndex += 1) {
        const portfolioReturn = positions.reduce((sum, position) => {
            const prices = prepared.series[position.assetIndex].prices;
            const previousPrice = prices[dayIndex - 1] ?? 0;
            const currentPrice = prices[dayIndex] ?? previousPrice;
            const assetReturn = previousPrice > 0 ? currentPrice / previousPrice - 1 : 0;

            return sum + signedActiveDualMomentumWeight(position) * assetReturn;
        }, 0);

        if (portfolioReturn < 0) {
            downsideReturns.push(portfolioReturn);
        }
    }

    if (downsideReturns.length < 2) {
        return 0;
    }

    const mean = downsideReturns.reduce((sum, value) => sum + value, 0) / downsideReturns.length;
    const variance = downsideReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (downsideReturns.length - 1);

    return Math.sqrt(Math.max(0, variance));
};

export const resolveActiveDualMomentumCashBufferMultiplier = ({
    baseMultiplier,
    config,
    grossPositions,
    maxLookbackDays,
    prepared,
    rebalanceIndex,
}: {
    baseMultiplier: number;
    config: NormalizedActiveDualMomentumConfig;
    grossPositions: ActiveDualMomentumPosition[];
    maxLookbackDays: number;
    prepared: PreparedAllocationData;
    rebalanceIndex: number;
}) => {
    if (config.researchProfile?.portfolioDownsideVolTarget === false) {
        return baseMultiplier;
    }

    const downsideVolatility = activeDualMomentumPortfolioDownsideVolatility({
        endIndex: rebalanceIndex,
        positions: grossPositions,
        prepared,
        startIndex: Math.max(0, rebalanceIndex - maxLookbackDays),
    });
    const targetDailyDownsideVolatility = 0.01;
    const riskMultiplier = downsideVolatility > 0
        ? Math.min(1, targetDailyDownsideVolatility / downsideVolatility)
        : 1;

    return baseMultiplier * riskMultiplier;
};
