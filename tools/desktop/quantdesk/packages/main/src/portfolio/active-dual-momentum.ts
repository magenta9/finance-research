import type {
    ActiveDualMomentumDiagnostics,
    ActiveDualMomentumStrategyConfig,
    AllocationAssetWeight,
    AllocationResult,
    AllocationTrade,
    Currency,
    PortfolioMetrics,
} from '@quantdesk/shared';

import { isMaterialAllocationTradeChange } from './allocation-trade-orchestrator';
import type { PreparedAllocationData } from './preprocessor';
import { buildScenarioAnalysis } from './scenarios';
import { correlationMatrix } from './statistics';
import {
    activeDualMomentumTradingDaysPerWeek,
    isActiveDualMomentumFuturesAsset,
    mergeActiveDualMomentumSleeves,
    normalizeActiveDualMomentumConfig,
    selectActiveDualMomentumSleeve,
    signedActiveDualMomentumWeight,
    type ActiveDualMomentumPosition,
} from './active-dual-momentum-rules';
import {
    buildPortfolioPathFromDailyReturns,
    computePortfolioCalmarRatio,
    computePortfolioMetricsFromDailyReturns,
    computePortfolioWinRate,
    meanPortfolioValues,
} from './portfolio-performance';
import { buildWeeklyRebalanceIndexesOnOrBeforeWeekday } from './rebalance-calendar';

const metricsFromReturns = (dailyReturns: number[], equityCurve: number[]): PortfolioMetrics & { calmarRatio: number; winRate: number } => {
    const metrics = computePortfolioMetricsFromDailyReturns(dailyReturns, equityCurve);

    return {
        ...metrics,
        calmarRatio: computePortfolioCalmarRatio(metrics.expectedReturn, metrics.maxDrawdown),
        winRate: computePortfolioWinRate(dailyReturns),
    };
};

const actionForTransition = (fromSigned: number, toSigned: number): AllocationTrade['action'] => {
    if (toSigned > fromSigned) {
        return toSigned > 0 ? 'open_long' : 'close_short';
    }

    return toSigned < 0 ? 'open_short' : 'close_long';
};

const buildTrades = ({
    date,
    nextPositions,
    previousPositions,
    prepared,
}: {
    date: string;
    nextPositions: ActiveDualMomentumPosition[];
    previousPositions: ActiveDualMomentumPosition[];
    prepared: PreparedAllocationData;
}) => prepared.series.flatMap((entry, assetIndex): AllocationTrade[] => {
    const previous = previousPositions.find((position) => position.assetIndex === assetIndex);
    const next = nextPositions.find((position) => position.assetIndex === assetIndex);
    const fromSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
    const toSigned = next ? signedActiveDualMomentumWeight(next) : 0;
    const weightChange = toSigned - fromSigned;

    if (!isMaterialAllocationTradeChange(weightChange)) {
        return [];
    }

    return [{
        action: actionForTransition(fromSigned, toSigned),
        assetId: entry.asset.id,
        date,
        fromWeight: Math.abs(fromSigned),
        name: entry.asset.name,
        reason: 'Active Dual Momentum GTAA 调仓',
        source: 'allocation',
        symbol: entry.asset.symbol,
        toWeight: Math.abs(toSigned),
        weightChange: Math.abs(weightChange),
    }];
});

const turnoverBetween = (previousPositions: ActiveDualMomentumPosition[], nextPositions: ActiveDualMomentumPosition[], assetCount: number) => {
    let turnover = 0;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousPositions.find((position) => position.assetIndex === assetIndex);
        const next = nextPositions.find((position) => position.assetIndex === assetIndex);
        const fromSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const toSigned = next ? signedActiveDualMomentumWeight(next) : 0;

        turnover += Math.sign(fromSigned) !== Math.sign(toSigned) && fromSigned !== 0 && toSigned !== 0
            ? Math.abs(fromSigned) + Math.abs(toSigned)
            : Math.abs(toSigned - fromSigned);
    }

    return turnover;
};

const positiveNonFuturesMomentumBreadth = (prepared: PreparedAllocationData, rebalanceIndex: number, lookbackDays: number) => {
    let eligibleCount = 0;
    let positiveCount = 0;

    prepared.series.forEach((entry) => {
        if (isActiveDualMomentumFuturesAsset(entry.asset)) {
            return;
        }

        const previousPrice = entry.prices[rebalanceIndex - lookbackDays] ?? 0;
        const currentPrice = entry.prices[rebalanceIndex] ?? 0;

        if (previousPrice <= 0 || currentPrice <= 0) {
            return;
        }

        eligibleCount += 1;
        if (currentPrice / previousPrice - 1 > 0) {
            positiveCount += 1;
        }
    });

    return eligibleCount > 0 ? positiveCount / eligibleCount : 1;
};

const latestAllocations = (prepared: PreparedAllocationData, positions: ActiveDualMomentumPosition[], annualizedReturns: number[], annualizedVolatility: number[]): AllocationAssetWeight[] =>
    positions.map((position) => {
        const entry = prepared.series[position.assetIndex];

        return {
            annualizedReturn: annualizedReturns[position.assetIndex] ?? 0,
            annualizedVolatility: annualizedVolatility[position.assetIndex] ?? 0,
            assetClass: entry.asset.assetClass,
            assetId: entry.asset.id,
            currency: entry.asset.currency,
            direction: position.direction,
            market: entry.asset.market,
            name: entry.asset.name,
            riskContribution: 0,
            symbol: entry.asset.symbol,
            weight: position.weight,
        };
    }).sort((left, right) => right.weight - left.weight);

const resolveCalculationSlice = (
    alignedDates: string[],
    calculationDateRange: { startDate: string; endDate: string },
) => {
    const startIndex = alignedDates.findIndex((date) => date >= calculationDateRange.startDate);
    let endIndex = alignedDates.length - 1;

    while (endIndex >= 0 && (alignedDates[endIndex] ?? '') > calculationDateRange.endDate) {
        endIndex -= 1;
    }

    if (startIndex < 0 || endIndex < startIndex) {
        return {
            dates: alignedDates,
            endIndex: alignedDates.length - 1,
            startIndex: 0,
        };
    }

    return {
        dates: alignedDates.slice(startIndex, endIndex + 1),
        endIndex,
        startIndex,
    };
};

export const runActiveDualMomentumBacktest = ({
    annualizedMeanReturns,
    annualizedVolatility,
    baseCurrency,
    calculationDateRange,
    covariance,
    config: rawConfig,
    prepared,
}: {
    annualizedMeanReturns: number[];
    annualizedVolatility: number[];
    baseCurrency: Currency;
    calculationDateRange: { startDate: string; endDate: string };
    covariance: number[][];
    config?: ActiveDualMomentumStrategyConfig;
    prepared: PreparedAllocationData;
}): AllocationResult => {
    const config = normalizeActiveDualMomentumConfig(rawConfig);
    const maxLookbackDays = Math.max(config.shortLookbackWeeks, config.longLookbackWeeks) * activeDualMomentumTradingDaysPerWeek;
    const rebalanceIndexes = buildWeeklyRebalanceIndexesOnOrBeforeWeekday({
        dates: prepared.alignedDates,
        latestWeekday: 3,
        minimumIndex: maxLookbackDays,
    });
    const calculationSlice = resolveCalculationSlice(prepared.alignedDates, calculationDateRange);
    const calculationRebalanceIndexes = rebalanceIndexes.filter((index) =>
        index >= calculationSlice.startIndex && index <= calculationSlice.endIndex,
    );
    const warnings = [...prepared.warnings];

    if (prepared.series.length < 3) {
        return {
            allocations: [],
            baseCurrency,
            correlationMatrix: { labels: [], matrix: [] },
            diagnostics: {
                activeDualMomentum: {
                    averageNetExposure: 0,
                    averageNominalExposure: 0,
                    cashWeight: 0,
                    maxNetExposure: 0,
                    maxNominalExposure: 0,
                    rebalanceRecords: [],
                    status: 'unavailable',
                    turnover: 0,
                },
                alignedDates: prepared.alignedDates.length,
                excludedAssets: prepared.excludedAssets,
                optimizer: 'js',
                strategy: 'active_dual_momentum_gtaa',
                warnings: [...warnings, 'Active Dual Momentum GTAA 至少需要 3 个合格标的。'],
            },
            error: {
                code: 'INSUFFICIENT_ASSETS',
                message: 'Active Dual Momentum GTAA 至少需要 3 个合格标的。',
                suggestions: ['增加 ETF 或期货标的后重新运行。'],
            },
            generatedAt: new Date().toISOString(),
            mode: 'inverse_volatility',
            portfolioMetrics: { expectedReturn: 0, maxDrawdown: 0, sharpeRatio: 0, volatility: 0 },
            rebalanceCadence: 'weekly',
            riskContributions: {},
            scenarioAnalysis: [],
            strategy: 'active_dual_momentum_gtaa',
            weights: {},
        };
    }

    if (calculationRebalanceIndexes.length < 26) {
        warnings.push('最大 lookback 后可回测周数不足 26 周，结果标记为 degraded。');
    }

    let currentPositions: ActiveDualMomentumPosition[] = [];
    let latestPositions: ActiveDualMomentumPosition[] = [];
    let totalTurnover = 0;
    let totalCost = 0;
    const trades: AllocationTrade[] = [];
    const dailyReturns: number[] = [];
    const nominalExposures: number[] = [];
    const netExposures: number[] = [];
    const rebalanceRecords: ActiveDualMomentumDiagnostics['rebalanceRecords'] = [];
    const rebalanceIndexSet = new Set(rebalanceIndexes);

    for (let dayIndex = 1; dayIndex < prepared.alignedDates.length; dayIndex += 1) {
        const grossReturn = currentPositions.reduce((sum, position) => {
            const prices = prepared.series[position.assetIndex].prices;
            const previousPrice = prices[dayIndex - 1] ?? 0;
            const currentPrice = prices[dayIndex] ?? previousPrice;
            const assetReturn = previousPrice > 0 ? currentPrice / previousPrice - 1 : 0;
            return sum + signedActiveDualMomentumWeight(position) * assetReturn;
        }, 0);

        let rebalanceCost = 0;

        if (rebalanceIndexSet.has(dayIndex)) {
            const isCalculationRebalance = dayIndex >= calculationSlice.startIndex && dayIndex <= calculationSlice.endIndex;
            const shortSleeve = selectActiveDualMomentumSleeve({
                config,
                lookbackWeeks: config.shortLookbackWeeks,
                prepared,
                rebalanceIndex: dayIndex,
                sleeve: 'short',
            });
            const longSleeve = selectActiveDualMomentumSleeve({
                config,
                lookbackWeeks: config.longLookbackWeeks,
                prepared,
                rebalanceIndex: dayIndex,
                sleeve: 'long',
            });
            const breadth = positiveNonFuturesMomentumBreadth(
                prepared,
                dayIndex,
                config.shortLookbackWeeks * activeDualMomentumTradingDaysPerWeek,
            );
            const breadthExposureScale = breadth < 0.4 ? 0.5 : 1;
            const unscaledPositions = mergeActiveDualMomentumSleeves(shortSleeve, longSleeve);
            const scaledOutWeight = unscaledPositions.reduce((sum, position) => sum + position.weight * (1 - breadthExposureScale), 0);
            const nextPositions = unscaledPositions
                .map((position) => ({ ...position, weight: position.weight * breadthExposureScale }));
            const turnover = turnoverBetween(currentPositions, nextPositions, prepared.series.length);
            const cost = turnover * (config.transactionCostBps + config.slippageBps) / 10_000;

            if (isCalculationRebalance) {
                totalTurnover += turnover;
                totalCost += cost;
            }
            rebalanceCost = cost;
            if (isCalculationRebalance) {
                trades.push(...buildTrades({
                    date: prepared.alignedDates[dayIndex],
                    nextPositions,
                    prepared,
                    previousPositions: currentPositions,
                }));
            }

            const cashWeight = shortSleeve.cashWeight + longSleeve.cashWeight + scaledOutWeight;
            if (isCalculationRebalance) {
                rebalanceRecords.push({
                    cashWeight,
                    date: prepared.alignedDates[dayIndex],
                    holdings: nextPositions.map((position) => {
                        const entry = prepared.series[position.assetIndex];
                        return {
                            assetId: entry.asset.id,
                            direction: position.direction,
                            longMomentum: position.longMomentum,
                            shortMomentum: position.shortMomentum,
                            source: position.source,
                            symbol: entry.asset.symbol,
                            weight: position.weight,
                        };
                    }),
                    selectedButFiltered: [...shortSleeve.filtered, ...longSleeve.filtered],
                });
            }

            currentPositions = nextPositions;
            latestPositions = nextPositions;
        }

        const netReturn = grossReturn - rebalanceCost;
        dailyReturns.push(netReturn);
        nominalExposures.push(currentPositions.reduce((sum, position) => sum + position.weight, 0));
        netExposures.push(currentPositions.reduce((sum, position) => sum + signedActiveDualMomentumWeight(position), 0));
    }

    const calculationDailyReturns = dailyReturns.slice(calculationSlice.startIndex, calculationSlice.endIndex);
    const calculationNominalExposures = nominalExposures.slice(calculationSlice.startIndex, calculationSlice.endIndex);
    const calculationNetExposures = netExposures.slice(calculationSlice.startIndex, calculationSlice.endIndex);
    const { equityCurve, path } = buildPortfolioPathFromDailyReturns(calculationSlice.dates, calculationDailyReturns);
    const metrics = metricsFromReturns(calculationDailyReturns, equityCurve);
    const allocations = latestAllocations(prepared, latestPositions, annualizedMeanReturns, annualizedVolatility);
    const status = warnings.length > prepared.warnings.length ? 'degraded' : 'ok';
    const maxNominalExposure = Math.max(0, ...calculationNominalExposures);
    const maxNetExposure = Math.max(0, ...calculationNetExposures.map((value) => Math.abs(value)));

    return {
        allocations,
        baseCurrency,
        correlationMatrix: { labels: prepared.series.map((entry) => entry.asset.symbol), matrix: correlationMatrix(covariance) },
        diagnostics: {
            activeDualMomentum: {
                averageNetExposure: meanPortfolioValues(calculationNetExposures.map((value) => Math.abs(value))),
                averageNominalExposure: meanPortfolioValues(calculationNominalExposures),
                calmarRatio: metrics.calmarRatio,
                cashWeight: rebalanceRecords.at(-1)?.cashWeight ?? 0,
                maxNetExposure,
                maxNominalExposure,
                rebalanceRecords,
                status,
                totalCost,
                turnover: totalTurnover,
                winRate: metrics.winRate,
            },
            alignedDates: calculationSlice.dates.length,
            assetDateCoverage: prepared.assetDateCoverage,
            dateRange: calculationDateRange,
            excludedAssets: prepared.excludedAssets,
            metricComputation: 'portfolio_path_simulation',
            optimizer: 'js',
            rebalanceEventCount: rebalanceRecords.length,
            strategy: 'active_dual_momentum_gtaa',
            trades,
            warnings,
        },
        generatedAt: new Date().toISOString(),
        mode: 'inverse_volatility',
        portfolioMetrics: metrics,
        portfolioPath: path,
        rebalanceCadence: 'weekly',
        riskContributions: Object.fromEntries(prepared.series.map((entry) => [entry.asset.id, 0])),
        scenarioAnalysis: buildScenarioAnalysis(allocations),
        strategy: 'active_dual_momentum_gtaa',
        weights: Object.fromEntries(allocations.map((allocation) => [allocation.assetId, allocation.weight])),
    };
};
