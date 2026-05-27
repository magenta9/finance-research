import type {
    ActiveDualMomentumDiagnostics,
    ActiveDualMomentumStrategyConfig,
    AllocationAssetWeight,
    AllocationResult,
    AllocationTrade,
    Currency,
    PortfolioMetrics,
    PortfolioPathPoint,
} from '@quantdesk/shared';

import type { PreparedAllocationData } from './preprocessor';
import { annualizationFactor } from './analytics-constants';
import { buildScenarioAnalysis } from './scenarios';

interface NormalizedActiveDualMomentumConfig {
    absoluteMomentumFilter: boolean;
    longLookbackWeeks: number;
    shortLookbackWeeks: number;
    slippageBps: number;
    sleeveWeights: { long: number; short: number };
    topK: number;
    transactionCostBps: number;
}

interface Position {
    assetIndex: number;
    direction: 'long' | 'short';
    longMomentum?: number;
    shortMomentum?: number;
    source: 'short' | 'long' | 'both';
    weight: number;
}

interface SleeveSelection {
    cashWeight: number;
    filtered: ActiveDualMomentumDiagnostics['rebalanceRecords'][number]['selectedButFiltered'];
    positions: Position[];
}

const tradingDaysPerWeek = 5;
const minimumTradeWeight = 0.0001;

const mean = (values: number[]) => values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const standardDeviation = (values: number[]) => {
    if (values.length <= 1) {
        return 0;
    }

    const average = mean(values);
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
    return Math.sqrt(Math.max(variance, 0));
};

const normalizeConfig = (config?: ActiveDualMomentumStrategyConfig): NormalizedActiveDualMomentumConfig => ({
    absoluteMomentumFilter: config?.absoluteMomentumFilter ?? true,
    longLookbackWeeks: config?.longLookbackWeeks ?? 25,
    shortLookbackWeeks: config?.shortLookbackWeeks ?? 10,
    slippageBps: config?.slippageBps ?? 0,
    sleeveWeights: config?.sleeveWeights ?? { long: 0.5, short: 0.5 },
    topK: Math.min(5, Math.max(3, Math.round(config?.topK ?? 3))),
    transactionCostBps: config?.transactionCostBps ?? 0,
});

const isFuturesAsset = (asset: PreparedAllocationData['series'][number]['asset']) => {
    const metadataInstrumentType = typeof asset.metadata.instrumentType === 'string'
        ? asset.metadata.instrumentType.toLowerCase()
        : '';
    return metadataInstrumentType.includes('future')
        || asset.tags.some((tag) => tag.toLowerCase().includes('future') || tag.includes('期货'))
        || /9999$/u.test(asset.symbol);
};

const signedWeight = (position: Pick<Position, 'direction' | 'weight'>) =>
    position.direction === 'short' ? -position.weight : position.weight;

const buildWeekKey = (date: string) => {
    const cursor = new Date(`${date}T00:00:00Z`);
    const day = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return `${cursor.getUTCFullYear()}W${week}`;
};

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

const buildWednesdayRebalanceIndexes = (dates: string[], minimumIndex: number) => {
    const indexes: number[] = [];
    let currentWeek = '';
    let candidate: number | null = null;

    dates.forEach((date, index) => {
        const weekKey = buildWeekKey(date);

        if (currentWeek && weekKey !== currentWeek && candidate != null && candidate >= minimumIndex) {
            indexes.push(candidate);
        }

        if (weekKey !== currentWeek) {
            currentWeek = weekKey;
            candidate = null;
        }

        if (weekday(date) <= 3) {
            candidate = index;
        }
    });

    if (candidate != null && candidate >= minimumIndex) {
        indexes.push(candidate);
    }

    return indexes;
};

const buildPath = (dates: string[], dailyReturns: number[]) => {
    let equity = 1;
    const equityCurve = [equity];
    const path: PortfolioPathPoint[] = dates.length === 0 ? [] : [{ date: dates[0], equity }];

    dailyReturns.forEach((dailyReturn, index) => {
        equity *= 1 + dailyReturn;
        equityCurve.push(equity);
        path.push({ date: dates[index + 1] ?? dates.at(-1) ?? '', equity });
    });

    return { equityCurve, path };
};

const maxDrawdown = (equityCurve: number[]) => {
    let peak = equityCurve[0] ?? 1;
    let drawdown = 0;

    equityCurve.forEach((equity) => {
        peak = Math.max(peak, equity);
        drawdown = Math.min(drawdown, equity / peak - 1);
    });

    return Math.abs(drawdown);
};

const metricsFromReturns = (dailyReturns: number[], equityCurve: number[]): PortfolioMetrics & { calmarRatio: number; winRate: number } => {
    const expectedReturn = mean(dailyReturns) * annualizationFactor;
    const volatility = standardDeviation(dailyReturns) * Math.sqrt(annualizationFactor);
    const drawdown = maxDrawdown(equityCurve);

    return {
        calmarRatio: drawdown === 0 ? 0 : expectedReturn / drawdown,
        expectedReturn,
        maxDrawdown: drawdown,
        sharpeRatio: volatility === 0 ? 0 : expectedReturn / volatility,
        volatility,
        winRate: dailyReturns.length === 0 ? 0 : dailyReturns.filter((value) => value > 0).length / dailyReturns.length,
    };
};

const selectSleeve = ({
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
}): SleeveSelection => {
    const lookbackDays = lookbackWeeks * tradingDaysPerWeek;
    const candidates = prepared.series.flatMap((entry, assetIndex) => {
        const previousPrice = entry.prices[rebalanceIndex - lookbackDays];
        const currentPrice = entry.prices[rebalanceIndex];

        if (!previousPrice || !currentPrice || previousPrice <= 0) {
            return [];
        }

        const momentum = currentPrice / previousPrice - 1;
        const futures = isFuturesAsset(entry.asset);
        return [{
            assetIndex,
            futures,
            momentum,
            rankScore: futures ? Math.abs(momentum) : momentum,
        }];
    }).sort((left, right) => right.rankScore - left.rankScore).slice(0, config.topK);

    if (candidates.length === 0) {
        return { cashWeight: 0, filtered: [], positions: [] };
    }

    const sleeveWeight = config.sleeveWeights[sleeve];
    const slotWeight = sleeveWeight / candidates.length;
    const filtered: SleeveSelection['filtered'] = [];
    const positions: Position[] = [];
    let cashWeight = 0;

    candidates.forEach((candidate) => {
        const asset = prepared.series[candidate.assetIndex].asset;

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

const mergeSleeves = (shortSleeve: SleeveSelection, longSleeve: SleeveSelection) => {
    const merged = new Map<number, Position>();

    [...shortSleeve.positions, ...longSleeve.positions].forEach((position) => {
        const existing = merged.get(position.assetIndex);

        if (!existing) {
            merged.set(position.assetIndex, { ...position });
            return;
        }

        const netWeight = signedWeight(existing) + signedWeight(position);
        existing.direction = netWeight < 0 ? 'short' : 'long';
        existing.weight = Math.abs(netWeight);
        existing.source = 'both';
        existing.shortMomentum = existing.shortMomentum ?? position.shortMomentum;
        existing.longMomentum = existing.longMomentum ?? position.longMomentum;
    });

    return [...merged.values()].filter((position) => position.weight >= minimumTradeWeight);
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
    nextPositions: Position[];
    previousPositions: Position[];
    prepared: PreparedAllocationData;
}) => prepared.series.flatMap((entry, assetIndex): AllocationTrade[] => {
    const previous = previousPositions.find((position) => position.assetIndex === assetIndex);
    const next = nextPositions.find((position) => position.assetIndex === assetIndex);
    const fromSigned = previous ? signedWeight(previous) : 0;
    const toSigned = next ? signedWeight(next) : 0;
    const weightChange = toSigned - fromSigned;

    if (Math.abs(weightChange) < minimumTradeWeight) {
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

const turnoverBetween = (previousPositions: Position[], nextPositions: Position[], assetCount: number) => {
    let turnover = 0;

    for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
        const previous = previousPositions.find((position) => position.assetIndex === assetIndex);
        const next = nextPositions.find((position) => position.assetIndex === assetIndex);
        const fromSigned = previous ? signedWeight(previous) : 0;
        const toSigned = next ? signedWeight(next) : 0;

        turnover += Math.sign(fromSigned) !== Math.sign(toSigned) && fromSigned !== 0 && toSigned !== 0
            ? Math.abs(fromSigned) + Math.abs(toSigned)
            : Math.abs(toSigned - fromSigned);
    }

    return turnover;
};

const latestAllocations = (prepared: PreparedAllocationData, positions: Position[], annualizedReturns: number[], annualizedVolatility: number[]): AllocationAssetWeight[] =>
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

export const runActiveDualMomentumBacktest = ({
    annualizedMeanReturns,
    annualizedVolatility,
    baseCurrency,
    calculationDateRange,
    config: rawConfig,
    prepared,
}: {
    annualizedMeanReturns: number[];
    annualizedVolatility: number[];
    baseCurrency: Currency;
    calculationDateRange: { startDate: string; endDate: string };
    config?: ActiveDualMomentumStrategyConfig;
    prepared: PreparedAllocationData;
}): AllocationResult => {
    const config = normalizeConfig(rawConfig);
    const maxLookbackDays = Math.max(config.shortLookbackWeeks, config.longLookbackWeeks) * tradingDaysPerWeek;
    const rebalanceIndexes = buildWednesdayRebalanceIndexes(prepared.alignedDates, maxLookbackDays);
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

    if (rebalanceIndexes.length < 26) {
        warnings.push('最大 lookback 后可回测周数不足 26 周，结果标记为 degraded。');
    }

    let currentPositions: Position[] = [];
    let latestPositions: Position[] = [];
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
            return sum + signedWeight(position) * assetReturn;
        }, 0);

        let rebalanceCost = 0;

        if (rebalanceIndexSet.has(dayIndex)) {
            const shortSleeve = selectSleeve({
                config,
                lookbackWeeks: config.shortLookbackWeeks,
                prepared,
                rebalanceIndex: dayIndex,
                sleeve: 'short',
            });
            const longSleeve = selectSleeve({
                config,
                lookbackWeeks: config.longLookbackWeeks,
                prepared,
                rebalanceIndex: dayIndex,
                sleeve: 'long',
            });
            const nextPositions = mergeSleeves(shortSleeve, longSleeve);
            const turnover = turnoverBetween(currentPositions, nextPositions, prepared.series.length);
            const cost = turnover * (config.transactionCostBps + config.slippageBps) / 10_000;

            totalTurnover += turnover;
            totalCost += cost;
            rebalanceCost = cost;
            trades.push(...buildTrades({
                date: prepared.alignedDates[dayIndex],
                nextPositions,
                prepared,
                previousPositions: currentPositions,
            }));

            const cashWeight = shortSleeve.cashWeight + longSleeve.cashWeight;
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

            currentPositions = nextPositions;
            latestPositions = nextPositions;
        }

        const netReturn = grossReturn - rebalanceCost;
        dailyReturns.push(netReturn);
        nominalExposures.push(currentPositions.reduce((sum, position) => sum + position.weight, 0));
        netExposures.push(currentPositions.reduce((sum, position) => sum + signedWeight(position), 0));
    }

    const { equityCurve, path } = buildPath(prepared.alignedDates, dailyReturns);
    const metrics = metricsFromReturns(dailyReturns, equityCurve);
    const allocations = latestAllocations(prepared, latestPositions, annualizedMeanReturns, annualizedVolatility);
    const status = warnings.length > prepared.warnings.length ? 'degraded' : 'ok';
    const maxNominalExposure = Math.max(0, ...nominalExposures);
    const maxNetExposure = Math.max(0, ...netExposures.map((value) => Math.abs(value)));

    return {
        allocations,
        baseCurrency,
        correlationMatrix: { labels: prepared.series.map((entry) => entry.asset.symbol), matrix: [] },
        diagnostics: {
            activeDualMomentum: {
                averageNetExposure: mean(netExposures.map((value) => Math.abs(value))),
                averageNominalExposure: mean(nominalExposures),
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
            alignedDates: prepared.alignedDates.length,
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
