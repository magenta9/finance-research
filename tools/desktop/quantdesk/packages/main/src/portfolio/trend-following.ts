import type {
    AllocationDiagnostics,
    AllocationStrategyMix,
    AllocationTrade,
    PortfolioMetrics,
    PortfolioPathPoint,
} from '@quantdesk/shared';

import { annualizationFactor } from './analytics-constants';
import {
    computeEwmacFamily,
    defaultEwmacRules,
    normalizeEwmacRules,
    type EwmacFamilyForecast,
    type NormalizedEwmacRule,
} from './ewmac';

export interface NormalizedTrendFollowingConfig {
    assetIds?: string[];
    cap: number;
    forecastDiversificationMultiplier?: number;
    rules: NormalizedEwmacRule[];
    sleeveWeight: number;
    volatilitySpan: number;
}

export interface TrendFollowingSimulationInput {
    alignedDates: string[];
    assetIds: string[];
    assetNames: string[];
    priceSeries: number[][];
    strategyMix?: AllocationStrategyMix;
    symbols: string[];
}

export interface TrendFollowingSimulationResult {
    assetIds: string[];
    assetDiagnostics: NonNullable<AllocationDiagnostics['trendFollowing']>['assets'];
    dailyReturns: number[];
    forecastCap: number;
    forecastDiversificationMultiplier: number;
    latestWeights: number[];
    path: PortfolioPathPoint[];
    ruleSlotCount: number;
    rules: Array<{
        fast: number;
        scalar: number;
        slow: number;
        weight: number;
    }>;
    sleeveWeight: number;
    trades: AllocationTrade[];
}

export interface CombinedSleeveSimulationResult {
    allocationSleeveWeight: number;
    combinedDailyReturns: number[];
    metrics: PortfolioMetrics;
    path: PortfolioPathPoint[];
}

const defaultForecastCap = 20;
const defaultVolatilitySpan = 32;
const minimumTradeWeight = 0.0001;

const normalizeAssetIds = (assetIds?: string[]) => {
    if (!assetIds) {
        return undefined;
    }

    const seen = new Set<string>();
    return assetIds.filter((assetId) => {
        const trimmed = assetId.trim();
        if (trimmed.length === 0 || seen.has(trimmed)) {
            return false;
        }

        seen.add(trimmed);
        return true;
    });
};

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

const computeMaxDrawdownFromEquity = (equityCurve: number[]) => {
    let peak = equityCurve[0] ?? 1;
    let maxDrawdown = 0;

    for (const equity of equityCurve) {
        peak = Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    }

    return Math.abs(maxDrawdown);
};

const metricsFromDailyReturns = (dailyReturns: number[], equityCurve: number[]): PortfolioMetrics => {
    const expectedReturn = mean(dailyReturns) * annualizationFactor;
    const volatility = standardDeviation(dailyReturns) * Math.sqrt(annualizationFactor);

    return {
        expectedReturn,
        maxDrawdown: computeMaxDrawdownFromEquity(equityCurve),
        sharpeRatio: volatility === 0 ? 0 : expectedReturn / volatility,
        volatility,
    };
};

const buildPathFromDailyReturns = (
    alignedDates: string[],
    dailyReturns: number[],
    extraPointFields?: (index: number, equity: number) => Partial<PortfolioPathPoint>,
) => {
    const equityCurve = [1];
    const path: PortfolioPathPoint[] = alignedDates.length === 0
        ? []
        : [{ date: alignedDates[0], equity: 1, ...extraPointFields?.(0, 1) }];

    for (let index = 0; index < dailyReturns.length; index += 1) {
        const nextEquity = equityCurve[index] * (1 + dailyReturns[index]);
        equityCurve.push(nextEquity);
        path.push({
            date: alignedDates[index + 1] ?? alignedDates[alignedDates.length - 1] ?? '',
            equity: nextEquity,
            ...extraPointFields?.(index + 1, nextEquity),
        });
    }

    return { equityCurve, path };
};

export const normalizeTrendFollowingConfig = (
    strategyMix?: AllocationStrategyMix,
): NormalizedTrendFollowingConfig | null => {
    const config = strategyMix?.trendFollowing;

    if (!config?.enabled || config.sleeveWeight <= 0) {
        return null;
    }

    return {
        assetIds: normalizeAssetIds(config.assetIds),
        cap: config.forecastCap ?? defaultForecastCap,
        forecastDiversificationMultiplier: config.forecastDiversificationMultiplier,
        rules: config.rules ? config.rules.map((rule) => {
            const defaultRule = defaultEwmacRules.find((candidate) => candidate.fast === rule.fast);

            return {
                enabled: rule.enabled ?? defaultRule?.enabled ?? true,
                fast: rule.fast,
                scalar: rule.scalar ?? defaultRule?.scalar ?? 1,
                slow: rule.slow ?? defaultRule?.slow ?? rule.fast * 4,
                weight: rule.weight ?? defaultRule?.weight ?? 1,
            };
        }) : defaultEwmacRules,
        sleeveWeight: config.sleeveWeight,
        volatilitySpan: config.volatilitySpan ?? defaultVolatilitySpan,
    };
};

const countActiveRules = (family: EwmacFamilyForecast, forecastIndex: number) =>
    family.ruleForecasts.reduce(
        (count, ruleForecast) => count + ((ruleForecast.forecast[forecastIndex] ?? 0) > 0 ? 1 : 0),
        0,
    );

const buildSlotWeights = (
    familyForecasts: Array<EwmacFamilyForecast | null>,
    ruleSlotCount: number,
    pointCount: number,
) => familyForecasts.map((family) => family
    ? family.forecast.map((_value, index) => (
        ruleSlotCount === 0 ? 0 : countActiveRules(family, index) / ruleSlotCount
    ))
    : Array.from({ length: pointCount }, () => 0));

const buildTrendTrades = ({
    alignedDates,
    assetIds,
    assetNames,
    familyForecasts,
    positionWeights,
    sleeveWeight,
    symbols,
}: {
    alignedDates: string[];
    assetIds: string[];
    assetNames: string[];
    familyForecasts: Array<EwmacFamilyForecast | null>;
    positionWeights: number[][];
    sleeveWeight: number;
    symbols: string[];
}): AllocationTrade[] => {
    const trades: AllocationTrade[] = [];

    positionWeights.forEach((weights, assetIndex) => {
        if (!familyForecasts[assetIndex]) {
            return;
        }

        weights.forEach((weight, dateIndex) => {
            const fromWeight = (dateIndex === 0 ? 0 : weights[dateIndex - 1] ?? 0) * sleeveWeight;
            const toWeight = weight * sleeveWeight;
            const weightChange = toWeight - fromWeight;

            if (Math.abs(weightChange) < minimumTradeWeight) {
                return;
            }

            trades.push({
                action: weightChange > 0 ? 'buy' : 'sell',
                assetId: assetIds[assetIndex],
                date: alignedDates[dateIndex] ?? alignedDates[alignedDates.length - 1] ?? '',
                fromWeight,
                name: assetNames[assetIndex] ?? symbols[assetIndex] ?? assetIds[assetIndex],
                reason: weightChange > 0 ? '趋势规则转多' : '趋势规则转弱',
                source: 'trend_following',
                symbol: symbols[assetIndex] ?? assetIds[assetIndex],
                toWeight,
                weightChange,
            });
        });
    });

    return trades;
};

const summarizeAssetDiagnostics = ({
    assetIds,
    familyForecasts,
    positionWeights,
    sleeveWeight,
    symbols,
}: {
    assetIds: string[];
    familyForecasts: Array<EwmacFamilyForecast | null>;
    positionWeights: number[][];
    sleeveWeight: number;
    symbols: string[];
}): TrendFollowingSimulationResult['assetDiagnostics'] => familyForecasts.flatMap((family, index) => family
    ? [{
        activeRuleCount: countActiveRules(family, family.forecast.length - 1),
        assetId: assetIds[index],
        averageAbsForecast: mean(family.forecast.map((value) => Math.abs(value))),
        latestForecast: family.forecast.at(-1) ?? 0,
        latestPositionWeight: sleeveWeight * (positionWeights[index]?.at(-1) ?? 0),
        symbol: symbols[index],
    }]
    : []);

export const simulateTrendFollowingSleeve = ({
    alignedDates,
    assetIds,
    assetNames,
    priceSeries,
    strategyMix,
    symbols,
}: TrendFollowingSimulationInput): TrendFollowingSimulationResult | null => {
    const config = normalizeTrendFollowingConfig(strategyMix);

    if (!config || alignedDates.length === 0 || priceSeries.length === 0) {
        return null;
    }

    const configuredAssetIdSet = config.assetIds ? new Set(config.assetIds) : null;
    const trendAssetIndexes = assetIds
        .map((assetId, index) => (configuredAssetIdSet === null || configuredAssetIdSet.has(assetId) ? index : -1))
        .filter((index) => index >= 0);
    const familyForecasts = priceSeries.map((prices, index) => trendAssetIndexes.includes(index)
        ? computeEwmacFamily({
            cap: config.cap,
            forecastDiversificationMultiplier: config.forecastDiversificationMultiplier,
            prices,
            rules: config.rules,
            volatilitySpan: config.volatilitySpan,
        })
        : null);
    const firstFamily = familyForecasts.find((family): family is EwmacFamilyForecast => family !== null);
    const enabledRules = firstFamily?.rules ?? normalizeEwmacRules(config.rules);
    const ruleSlotCount = trendAssetIndexes.length * enabledRules.length;

    const positionWeights = buildSlotWeights(familyForecasts, ruleSlotCount, alignedDates.length);
    const trades = buildTrendTrades({
        alignedDates,
        assetIds,
        assetNames,
        familyForecasts,
        positionWeights,
        sleeveWeight: config.sleeveWeight,
        symbols,
    });
    const dailyReturns: number[] = [];

    for (let dayIndex = 1; dayIndex < alignedDates.length; dayIndex += 1) {
        dailyReturns.push(priceSeries.reduce((sum, prices, assetIndex) => {
            const previousPrice = prices[dayIndex - 1] ?? 0;
            const currentPrice = prices[dayIndex] ?? previousPrice;
            const assetReturn = previousPrice > 0 ? currentPrice / previousPrice - 1 : 0;
            const exposure = positionWeights[assetIndex]?.[dayIndex - 1] ?? 0;

            return sum + exposure * assetReturn;
        }, 0));
    }

    const { path } = buildPathFromDailyReturns(alignedDates, dailyReturns);

    return {
        assetIds: trendAssetIndexes.map((index) => assetIds[index]),
        assetDiagnostics: summarizeAssetDiagnostics({
            assetIds,
            familyForecasts,
            positionWeights,
            sleeveWeight: config.sleeveWeight,
            symbols,
        }),
        dailyReturns,
        forecastCap: config.cap,
        forecastDiversificationMultiplier: firstFamily?.forecastDiversificationMultiplier ?? 1,
        latestWeights: positionWeights.map((weights) => weights.at(-1) ?? 0),
        path,
        ruleSlotCount,
        rules: enabledRules.map((rule) => ({
            fast: rule.fast,
            scalar: rule.scalar,
            slow: rule.slow,
            weight: rule.weight,
        })),
        sleeveWeight: config.sleeveWeight,
        trades,
    };
};

export const combineSleeveReturns = ({
    alignedDates,
    allocationEquity,
    trendFollowing,
}: {
    alignedDates: string[];
    allocationEquity: number[];
    trendFollowing: TrendFollowingSimulationResult;
}): CombinedSleeveSimulationResult => {
    const allocationSleeveWeight = Math.max(0, 1 - trendFollowing.sleeveWeight);
    const allocationDailyReturns = allocationEquity.slice(1).map((equity, index) => {
        const previousEquity = allocationEquity[index] ?? 1;
        return previousEquity === 0 ? 0 : equity / previousEquity - 1;
    });
    const combinedDailyReturns = allocationDailyReturns.map((allocationReturn, index) =>
        allocationSleeveWeight * allocationReturn
        + trendFollowing.sleeveWeight * (trendFollowing.dailyReturns[index] ?? 0));
    const allocationSleeveEquity = buildPathFromDailyReturns(alignedDates, allocationDailyReturns).equityCurve;
    const trendSleeveEquity = trendFollowing.path.map((point) => point.equity);
    const { equityCurve, path } = buildPathFromDailyReturns(
        alignedDates,
        combinedDailyReturns,
        (index) => ({
            allocationEquity: allocationSleeveEquity[index] ?? 1,
            trendFollowingEquity: trendSleeveEquity[index] ?? 1,
        }),
    );

    return {
        allocationSleeveWeight,
        combinedDailyReturns,
        metrics: metricsFromDailyReturns(combinedDailyReturns, equityCurve),
        path,
    };
};