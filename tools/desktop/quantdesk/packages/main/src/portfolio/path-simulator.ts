import type { AllocationTrade, PortfolioMetrics, PortfolioPathPoint, RebalanceCadence } from '@quantdesk/shared';

import { annualizationFactor } from './analytics-constants';
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

const minimumTradeWeight = 0.0001;

const resolveAllocationTradeAction = (fromWeight: number, toWeight: number): AllocationTrade['action'] => {
    if (toWeight > fromWeight) {
        return toWeight > 0 ? 'open_long' : 'close_short';
    }

    return toWeight < 0 ? 'open_short' : 'close_long';
};

const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

const standardDeviation = (values: number[]) => {
    if (values.length <= 1) {
        return 0;
    }

    const average = mean(values);
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
    return Math.sqrt(Math.max(variance, 0));
};

const computeMaxDrawdownFromEquity = (equityCurve: number[]) => {
    let peak = equityCurve[0] ?? 1;
    let maxDrawdown = 0;

    for (const equity of equityCurve) {
        peak = Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    }

    return Math.abs(maxDrawdown);
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
        if (Math.abs(weight) < minimumTradeWeight) {
            return [];
        }

        const asset = assetMetadata?.[assetIndex];
        return [{
            action: 'open_long' as const,
            assetId: asset?.assetId ?? `asset-${assetIndex}`,
            date: alignedDates[0] ?? '',
            fromWeight: 0,
            name: asset?.name ?? asset?.symbol ?? `Asset ${assetIndex + 1}`,
            reason: '配置建仓',
            source: 'allocation' as const,
            symbol: asset?.symbol ?? `Asset ${assetIndex + 1}`,
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

                if (Math.abs(weightChange) < minimumTradeWeight) {
                    return;
                }

                const asset = assetMetadata?.[assetIndex];
                trades.push({
                    action: resolveAllocationTradeAction(fromWeight, targetWeight),
                    assetId: asset?.assetId ?? `asset-${assetIndex}`,
                    date: alignedDates[dayIndex] ?? '',
                    fromWeight,
                    name: asset?.name ?? asset?.symbol ?? `Asset ${assetIndex + 1}`,
                    reason: '配置调仓',
                    source: 'allocation',
                    symbol: asset?.symbol ?? `Asset ${assetIndex + 1}`,
                    toWeight: targetWeight,
                    weightChange,
                });
            });
            currentWeights = [...targetWeights];
            rebalanceEventCount += 1;
        }
    }

    const dailyReturns = portfolioEquity.slice(1).map((equity, index) => equity / portfolioEquity[index] - 1);
    const expectedReturn = dailyReturns.length === 0 ? 0 : mean(dailyReturns) * annualizationFactor;
    const volatility = dailyReturns.length <= 1 ? 0 : standardDeviation(dailyReturns) * Math.sqrt(annualizationFactor);

    return {
        portfolioEquity,
        portfolioPath,
        metrics: {
            expectedReturn,
            maxDrawdown: computeMaxDrawdownFromEquity(portfolioEquity),
            sharpeRatio: volatility === 0 ? 0 : expectedReturn / volatility,
            volatility,
        },
        rebalanceEventCount,
        trades,
    };
};