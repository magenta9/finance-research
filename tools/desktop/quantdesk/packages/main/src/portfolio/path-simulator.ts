import type { AllocationTrade, PortfolioMetrics, PortfolioPathPoint, RebalanceCadence } from '@quantdesk/shared';

import { isMaterialAllocationTradeChange } from './allocation-trade-orchestrator';
import { computePortfolioMetricsFromDailyReturns } from './portfolio-performance';
import { isPortfolioCadenceRebalanceDay } from './rebalance-calendar';

export interface PathSimulationInput {
    assetMetadata?: Array<{
        assetId: string;
        name: string;
        symbol: string;
    }>;
    targetWeights: number[];
    priceSeries: number[][];
    alignedDates: string[];
    rebalanceCadence: RebalanceCadence;
}

export interface PathSimulationResult {
    portfolioEquity: number[];
    portfolioPath: PortfolioPathPoint[];
    metrics: PortfolioMetrics;
    rebalanceEventCount: number;
    trades: AllocationTrade[];
}

const resolveAllocationTradeAction = (fromWeight: number, toWeight: number): AllocationTrade['action'] => {
    if (toWeight > fromWeight) {
        return toWeight > 0 ? 'open_long' : 'close_short';
    }

    return toWeight < 0 ? 'open_short' : 'close_long';
};

export const simulatePortfolioPath = ({
    assetMetadata,
    targetWeights,
    priceSeries,
    alignedDates,
    rebalanceCadence,
}: PathSimulationInput): PathSimulationResult => {
    if (targetWeights.length === 0 || alignedDates.length === 0) {
        return {
            portfolioEquity: [1],
            portfolioPath: [],
            metrics: {
                expectedReturn: 0,
                maxDrawdown: 0,
                sharpeRatio: 0,
                volatility: 0,
            },
            rebalanceEventCount: 0,
            trades: [],
        };
    }

    let currentWeights = [...targetWeights];
    let currentEquity = 1;
    let rebalanceEventCount = 0;
    const portfolioEquity = [1];
    const portfolioPath: PortfolioPathPoint[] = [{ date: alignedDates[0] ?? '', equity: 1 }];
    const trades: AllocationTrade[] = targetWeights.flatMap((weight, assetIndex) => {
        if (!isMaterialAllocationTradeChange(weight)) {
            return [];
        }

        const asset = assetMetadata?.[assetIndex];
        if (!asset) {
            return [];
        }

        return [{
            action: 'open_long' as const,
            assetId: asset.assetId,
            date: alignedDates[0] ?? '',
            fromWeight: 0,
            name: asset.name,
            reason: '配置建仓',
            source: 'allocation' as const,
            symbol: asset.symbol,
            toWeight: weight,
            weightChange: weight,
        }];
    });

    for (let dayIndex = 1; dayIndex < alignedDates.length; dayIndex += 1) {
        const nextValues = currentWeights.map((weight, assetIndex) => {
            const previousPrice = priceSeries[assetIndex]?.[dayIndex - 1] ?? 0;
            const currentPrice = priceSeries[assetIndex]?.[dayIndex] ?? previousPrice;
            const priceRelative = previousPrice > 0 ? currentPrice / previousPrice : 1;
            return weight * priceRelative;
        });
        const totalValue = nextValues.reduce((sum, value) => sum + value, 0);

        currentEquity *= totalValue;
        portfolioEquity.push(currentEquity);
        portfolioPath.push({
            date: alignedDates[dayIndex] ?? alignedDates[alignedDates.length - 1] ?? '',
            equity: currentEquity,
        });
        currentWeights = totalValue === 0
            ? [...targetWeights]
            : nextValues.map((value) => value / totalValue);

        if (isPortfolioCadenceRebalanceDay(alignedDates, dayIndex, rebalanceCadence)) {
            targetWeights.forEach((targetWeight, assetIndex) => {
                const fromWeight = currentWeights[assetIndex] ?? 0;
                const weightChange = targetWeight - fromWeight;

                if (!isMaterialAllocationTradeChange(weightChange)) {
                    return;
                }

                const asset = assetMetadata?.[assetIndex];
                if (!asset) {
                    return;
                }

                trades.push({
                    action: resolveAllocationTradeAction(fromWeight, targetWeight),
                    assetId: asset.assetId,
                    date: alignedDates[dayIndex] ?? '',
                    fromWeight,
                    name: asset.name,
                    reason: '配置调仓',
                    source: 'allocation',
                    symbol: asset.symbol,
                    toWeight: targetWeight,
                    weightChange,
                });
            });
            currentWeights = [...targetWeights];
            rebalanceEventCount += 1;
        }
    }

    const dailyReturns = portfolioEquity.slice(1).map((equity, index) => equity / portfolioEquity[index] - 1);
    return {
        portfolioEquity,
        portfolioPath,
        metrics: computePortfolioMetricsFromDailyReturns(dailyReturns, portfolioEquity),
        rebalanceEventCount,
        trades,
    };
};