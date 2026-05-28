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
import { annualizationFactor, riskFreeRates } from './analytics-constants';
import type { PreparedAllocationData } from './preprocessor';
import { buildScenarioAnalysis } from './scenarios';
import { correlationMatrix } from './statistics';
import {
    activeDualMomentumTradingDaysPerWeek,
    mergeActiveDualMomentumSleevesWithCash,
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

const positionsByAssetIndex = (positions: ActiveDualMomentumPosition[]) => new Map(positions.map((position) => [position.assetIndex, position]));

const applyRiskExitRedeploymentCooldown = ({
    assetCount,
    previousPositions,
    targetPositions,
}: {
    assetCount: number;
    previousPositions: ActiveDualMomentumPosition[];
    targetPositions: ActiveDualMomentumPosition[];
}) => {
    const previousByAssetIndex = positionsByAssetIndex(previousPositions);
    const targetByAssetIndex = positionsByAssetIndex(targetPositions);
    let exitWeight = 0;
    let increaseWeight = 0;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousByAssetIndex.get(assetIndex);
        const target = targetByAssetIndex.get(assetIndex);
        const previousSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const targetSigned = target ? signedActiveDualMomentumWeight(target) : 0;

        if (previous && (!target || Math.sign(previousSigned) !== Math.sign(targetSigned))) {
            exitWeight += previous.weight;
        }
        if (target) {
            increaseWeight += Math.sign(previousSigned) === Math.sign(targetSigned)
                ? Math.max(0, target.weight - Math.abs(previousSigned))
                : target.weight;
        }
    }

    const cooldownWeight = Math.min(exitWeight, increaseWeight);
    if (cooldownWeight <= 0 || increaseWeight <= 0) {
        return { cashWeight: 0, positions: targetPositions };
    }

    const retainedIncreaseRatio = (increaseWeight - cooldownWeight) / increaseWeight;
    const positions = targetPositions.flatMap((target) => {
        const previous = previousByAssetIndex.get(target.assetIndex);
        const previousSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const targetSigned = signedActiveDualMomentumWeight(target);
        const retainedBaseWeight = Math.sign(previousSigned) === Math.sign(targetSigned)
            ? Math.min(Math.abs(previousSigned), target.weight)
            : 0;
        const increase = target.weight - retainedBaseWeight;
        const weight = retainedBaseWeight + increase * retainedIncreaseRatio;

        return weight >= 0.000001 ? [{ ...target, weight }] : [];
    });

    return { cashWeight: cooldownWeight, positions };
};

const portfolioDownsideVolatility = ({
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

const resolveCashBufferMultiplier = ({
    baseMultiplier,
    config,
    grossPositions,
    maxLookbackDays,
    prepared,
    rebalanceIndex,
}: {
    baseMultiplier: number;
    config: ReturnType<typeof normalizeActiveDualMomentumConfig>;
    grossPositions: ActiveDualMomentumPosition[];
    maxLookbackDays: number;
    prepared: PreparedAllocationData;
    rebalanceIndex: number;
}) => {
    if (config.researchProfile?.portfolioDownsideVolTarget === false) {
        return baseMultiplier;
    }

    const downsideVolatility = portfolioDownsideVolatility({
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

const smoothRebalancePositions = ({
    assetCount,
    previousPositions,
    targetPositions,
    rebalanceStep,
    weightHoldBand,
}: {
    assetCount: number;
    previousPositions: ActiveDualMomentumPosition[];
    rebalanceStep?: number;
    targetPositions: ActiveDualMomentumPosition[];
    weightHoldBand?: number;
}) => {
    if (!rebalanceStep && !weightHoldBand) {
        return targetPositions;
    }

    const previousByAssetIndex = positionsByAssetIndex(previousPositions);
    const targetByAssetIndex = positionsByAssetIndex(targetPositions);
    const nextPositions: ActiveDualMomentumPosition[] = [];
    const step = rebalanceStep && rebalanceStep > 0 && rebalanceStep < 1 ? rebalanceStep : 1;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousByAssetIndex.get(assetIndex);
        const target = targetByAssetIndex.get(assetIndex);

        if (!previous && !target) {
            continue;
        }

        const fromSigned = previous ? signedActiveDualMomentumWeight(previous) : 0;
        const toSigned = target ? signedActiveDualMomentumWeight(target) : 0;
        const diff = toSigned - fromSigned;
        const resolvedSigned = weightHoldBand && Math.abs(diff) < weightHoldBand
            ? fromSigned
            : fromSigned + diff * step;

        if (Math.abs(resolvedSigned) < 0.000001) {
            continue;
        }

        const template = target ?? previous;

        if (template) {
            nextPositions.push({
                ...template,
                direction: resolvedSigned < 0 ? 'short' : 'long',
                weight: Math.abs(resolvedSigned),
            });
        }
    }

    return nextPositions;
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
    let currentCashWeight = 1;
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
            const mergedSleeves = mergeActiveDualMomentumSleevesWithCash(shortSleeve, longSleeve, {
                deduplicateSameDirection: config.researchProfile?.deduplicateSameAssetSleeveBudget !== false,
            });
            const grossPositions = mergedSleeves.positions;
            const cashBufferMultiplier = resolveCashBufferMultiplier({
                baseMultiplier: config.researchProfile?.cashBufferMultiplier ?? 0.75,
                config,
                grossPositions,
                maxLookbackDays,
                prepared,
                rebalanceIndex: dayIndex,
            });
            const cashBufferWeight = grossPositions.reduce((sum, position) => sum + position.weight * (1 - cashBufferMultiplier), 0);
            const baseTargetPositions = grossPositions.map((position) => ({ ...position, weight: position.weight * cashBufferMultiplier }));
            const cooldown = config.researchProfile?.riskExitRedeploymentCooldown !== false
                ? applyRiskExitRedeploymentCooldown({
                    assetCount: prepared.series.length,
                    previousPositions: currentPositions,
                    targetPositions: baseTargetPositions,
                })
                : { cashWeight: 0, positions: baseTargetPositions };
            const targetPositions = cooldown.positions;
            const nextPositions = smoothRebalancePositions({
                assetCount: prepared.series.length,
                previousPositions: currentPositions,
                rebalanceStep: config.researchProfile?.rebalanceStep,
                targetPositions,
                weightHoldBand: config.researchProfile?.rebalanceWeightHoldBand,
            });
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

            const cashWeight = shortSleeve.cashWeight + longSleeve.cashWeight + mergedSleeves.cashWeight + cashBufferWeight + cooldown.cashWeight;
            const residualCashWeight = Math.max(0, 1 - nextPositions.reduce((sum, position) => sum + position.weight, 0));
            const resolvedCashWeight = config.researchProfile?.nettedResidualCashReturn !== false
                ? Math.max(cashWeight, residualCashWeight)
                : cashWeight;
            currentCashWeight = resolvedCashWeight;
            if (isCalculationRebalance) {
                rebalanceRecords.push({
                    cashWeight: resolvedCashWeight,
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

        const cashReturn = config.researchProfile?.cashReturnMode !== 'zero'
            ? currentCashWeight * (riskFreeRates[baseCurrency] / annualizationFactor)
            : 0;
        const netReturn = grossReturn + cashReturn - rebalanceCost;
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
