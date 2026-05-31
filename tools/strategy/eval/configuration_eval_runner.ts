/** @deprecated Use generic_eval_runner.ts with QuantDesk defaultAllocationStrategyRegistry. */
import type {
    AllocationConstraints,
    AllocationType,
    Currency,
    RebalanceCadence,
} from '../../desktop/quantdesk/packages/shared/src/types/domain';
import type { StoredAsset } from '../../desktop/quantdesk/packages/shared/src/types/persistence';
import type { PreparedAllocationData } from '../../desktop/quantdesk/packages/main/src/portfolio/preprocessor';
import { assembleAllocationResult } from '../../desktop/quantdesk/packages/main/src/portfolio/allocation-result-assembler';
import { optimizeWeights } from '../../desktop/quantdesk/packages/main/src/portfolio/optimizer';
import {
    annualizedReturns,
    annualizedVolatility,
    computeLogReturns,
    covarianceMatrix,
    shrinkCovarianceMatrix,
} from '../../desktop/quantdesk/packages/main/src/portfolio/statistics';

interface EvalAssetInput {
    assetClass: StoredAsset['assetClass'];
    currency: StoredAsset['currency'];
    id: string;
    market: StoredAsset['market'];
    metadata?: Record<string, unknown>;
    name: string;
    symbol: string;
    tags?: string[];
}

interface QuantDataPriceRow {
    adjustedClose?: number | null;
    calculationClose?: number | null;
    close?: number | null;
    date: string;
}

interface PriceCacheEntry {
    prices: QuantDataPriceRow[];
    providerSymbol?: string;
    warnings?: string[];
}

type EvalStrategyId = AllocationType;

interface MaxDiversificationResearchConfig {  // kept for eval config compatibility; fields unused without research strategy
    _placeholder?: never;
    absoluteMomentumLookbackDays?: number;
    absoluteMomentumLookbackDaysList?: number[];
    absoluteMomentumMinPositiveCount?: number;
    absoluteMomentumThreshold?: number;
    cashReserve?: number;
    covarianceShrinkage?: number;
    diagonalLoad?: number;
    commodityClassWeightCap?: number;
    equityClassWeightCap?: number;
    fixedIncomeClassWeightCap?: number;
    marchenkoPasturDenoise?: boolean;
    maxSingleWeight?: number;
    maxTrackingErrorVolatility?: number;
    momentumReturnTiltStrength?: number;
    portfolioVolatilityCapAnnualized?: number;
    portfolioVolatilityCapMinRiskyScale?: number;
    equalWeightShrinkageIntensity?: number;
    semiCovarianceForOptimization?: boolean;
    mdErcBlendWeight?: number;
    faaMomentumTopN?: number;
    mdHrpBlendWeight?: number;
    momentumPriorBlendWeight?: number;
    correlationClusterWeightCap?: boolean;
    mdInverseVolBlendWeight?: number;
    correlationRegimeCashScale?: number;
    useErcWhenEligibleAtLeast?: number;
    downsideBetaFilter?: boolean;
    herfindahlWeightCap?: boolean;
    diversificationRatioNudgeBlendWeight?: number;
    covarianceShrinkageBoost?: boolean;
    optimizationMinCorrelationBoost?: boolean;
    minCorrelation?: number;
    momentumBreadthCashScale?: number;
    volatilityPower?: number;
}

interface EvalCaseInput {
    basketSize: number;
    caseId: string;
    endDate: string;
    rebalanceCadence: RebalanceCadence;
    sampleIndex: number;
    startDate: string;
    symbols: string[];
    windowYears: number;
}

interface RunnerPayload {
    assets: EvalAssetInput[];
    baseCurrency: Currency;
    cases: EvalCaseInput[];
    constraints: AllocationConstraints;
    pricesBySymbol: Record<string, PriceCacheEntry>;
    strategies: EvalStrategyId[];
    strategyConfigs?: Record<string, MaxDiversificationResearchConfig>;
}

const fixtureTimestamp = '2026-05-28T00:00:00.000Z';
const cashReserveAssetId = 'eval-cash-reserve';
const cashReserveSymbol = 'CASH_RESERVE';

const toStoredAsset = (input: EvalAssetInput): StoredAsset => ({
    assetClass: input.assetClass,
    createdAt: fixtureTimestamp,
    currency: input.currency,
    id: input.id,
    market: input.market,
    metadata: input.metadata ?? {},
    name: input.name,
    symbol: input.symbol,
    tags: input.tags ?? [],
    updatedAt: fixtureTimestamp,
});

const priceValue = (row: QuantDataPriceRow) => row.calculationClose ?? row.adjustedClose ?? row.close ?? null;

const subsetArray = <T>(values: T[], indices: number[]) => indices.map((index) => values[index]);

const subsetMatrix = (matrix: number[][], indices: number[]) => indices.map((rowIndex) => (
    indices.map((columnIndex) => matrix[rowIndex]?.[columnIndex] ?? 0)
));

const mapSubsetWeights = (weights: number[], indices: number[], assetCount: number) => {
    const mappedWeights = Array.from({ length: assetCount }, () => 0);

    indices.forEach((assetIndex, weightIndex) => {
        mappedWeights[assetIndex] = weights[weightIndex] ?? 0;
    });

    return mappedWeights;
};

const ensureFeasibleConstraints = (constraints: AllocationConstraints, assetCount: number) => {
    if (constraints.allowLeverage || assetCount <= 0 || constraints.maxSingleWeight * assetCount >= 1) {
        return constraints;
    }

    return {
        ...constraints,
        maxSingleWeight: 1 / assetCount,
    };
};

const appendCashReserve = ({
    baseCurrency,
    cashReserve,
    covariance,
    meanReturns,
    prepared,
    volatility,
    weights,
}: {
    baseCurrency: Currency;
    cashReserve: number;
    covariance: number[][];
    meanReturns: number[];
    prepared: PreparedAllocationData;
    volatility: number[];
    weights: number[];
}) => {
    if (cashReserve <= 0) {
        return {
            covariance,
            meanReturns,
            prepared,
            volatility,
            weights,
        };
    }

    const riskyScale = 1 - cashReserve;
    const cashAsset: StoredAsset = {
        assetClass: 'cash',
        createdAt: fixtureTimestamp,
        currency: baseCurrency,
        id: cashReserveAssetId,
        market: 'A',
        metadata: { synthetic: true },
        name: 'Cash Reserve',
        symbol: cashReserveSymbol,
        tags: ['eval', 'cash-reserve'],
        updatedAt: fixtureTimestamp,
    };

    return {
        covariance: [
            ...covariance.map((row) => [...row, 0]),
            Array.from({ length: covariance.length + 1 }, () => 0),
        ],
        meanReturns: [...meanReturns, 0],
        prepared: {
            ...prepared,
            assetDateCoverage: [
                ...prepared.assetDateCoverage,
                {
                    actualEndDate: prepared.alignedDates.at(-1) ?? '',
                    actualStartDate: prepared.alignedDates[0] ?? '',
                    assetId: cashReserveAssetId,
                    isFallback: false,
                    requestedEndDate: prepared.alignedDates.at(-1) ?? '',
                    requestedStartDate: prepared.alignedDates[0] ?? '',
                    symbol: cashReserveSymbol,
                    tradingDays: prepared.alignedDates.length,
                },
            ],
            series: [
                ...prepared.series,
                {
                    annualizedReturn: 0,
                    annualizedVolatility: 0,
                    asset: cashAsset,
                    prices: prepared.alignedDates.map(() => 1),
                },
            ],
        },
        volatility: [...volatility, 0],
        weights: [...weights.map((weight) => weight * riskyScale), cashReserve],
    };
};

const resolveOptimizationInput = ({
    baseConstraints,
    baseCovariance,
    baseVolatilities,
    strategy,
}: {
    baseConstraints: AllocationConstraints;
    baseCovariance: number[][];
    baseVolatilities: number[];
    strategy: EvalStrategyId;
}) => ({
    cashReserve: 0,
    constraints: baseConstraints,
    covariance: baseCovariance,
    mode: strategy,
    volatilities: baseVolatilities,
});

const prepareEvalData = ({
    assetBySymbol,
    pricesBySymbol,
    symbols,
}: {
    assetBySymbol: Map<string, StoredAsset>;
    pricesBySymbol: Record<string, PriceCacheEntry>;
    symbols: string[];
}): PreparedAllocationData => {
    const priceMaps = symbols.map((symbol) => {
        const rows = pricesBySymbol[symbol]?.prices ?? [];
        return new Map(rows.flatMap((row) => {
            const value = priceValue(row);
            return value && value > 0 ? [[row.date, value] as const] : [];
        }));
    });
    const dateCounts = new Map<string, number>();

    for (const priceMap of priceMaps) {
        for (const date of priceMap.keys()) {
            dateCounts.set(date, (dateCounts.get(date) ?? 0) + 1);
        }
    }

    const alignedDates = [...dateCounts.entries()]
        .filter(([, count]) => count === symbols.length)
        .map(([date]) => date)
        .sort();

    if (alignedDates.length < 61) {
        throw new Error(`Insufficient aligned price coverage: ${alignedDates.length} rows.`);
    }

    const warnings = symbols.flatMap((symbol) => pricesBySymbol[symbol]?.warnings ?? []);

    return {
        alignedDates,
        assetDateCoverage: symbols.map((symbol, index) => ({
            actualEndDate: alignedDates.at(-1) ?? '',
            actualStartDate: alignedDates[0] ?? '',
            assetId: assetBySymbol.get(symbol)?.id ?? symbol,
            isFallback: false,
            requestedEndDate: alignedDates.at(-1) ?? '',
            requestedStartDate: alignedDates[0] ?? '',
            symbol,
            tradingDays: priceMaps[index].size,
        })),
        excludedAssets: [],
        series: symbols.map((symbol, index) => {
            const asset = assetBySymbol.get(symbol);

            if (!asset) {
                throw new Error(`Missing asset metadata for symbol: ${symbol}`);
            }

            return {
                annualizedReturn: 0,
                annualizedVolatility: 0,
                asset,
                prices: alignedDates.map((date) => priceMaps[index].get(date) ?? 0),
            };
        }),
        warnings: [...new Set(warnings)],
    };
};

const prepareEvalCase = ({
    assetBySymbol,
    pricesBySymbol,
    symbols,
}: {
    assetBySymbol: Map<string, StoredAsset>;
    pricesBySymbol: Record<string, PriceCacheEntry>;
    symbols: string[];
}) => {
    const prepared = prepareEvalData({ assetBySymbol, pricesBySymbol, symbols });
    const logReturns = computeLogReturns(prepared.series.map((entry) => entry.prices));
    const sampleCovariance = covarianceMatrix(logReturns);
    const covariance = shrinkCovarianceMatrix(sampleCovariance);

    const meanReturns = annualizedReturns(logReturns);
    const volatility = annualizedVolatility(covariance);

    return {
        covariance,
        meanReturns,
        prepared: {
            ...prepared,
            series: prepared.series.map((entry, index) => ({
                ...entry,
                annualizedReturn: meanReturns[index] ?? 0,
                annualizedVolatility: volatility[index] ?? 0,
            })),
        },
        volatility,
    };
};

const runCaseStrategy = async ({
    baseCurrency,
    constraints,
    evalCase,
    preparedCase,
    strategy,
}: {
    baseCurrency: Currency;
    constraints: AllocationConstraints;
    evalCase: EvalCaseInput;
    preparedCase: ReturnType<typeof prepareEvalCase>;
    strategy: EvalStrategyId;
}) => {
    const assetClasses = preparedCase.prepared.series.map((entry) => entry.asset.assetClass);
    const eligibleIndices = assetClasses.map((_, index) => index);

    const fullOptimizationInput = resolveOptimizationInput({
        baseConstraints: constraints,
        baseCovariance: preparedCase.covariance,
        baseVolatilities: preparedCase.volatility,
        strategy,
    });
    const optimizationInput = resolveOptimizationInput({
        baseConstraints: constraints,
        baseCovariance: subsetMatrix(preparedCase.covariance, eligibleIndices),
        baseVolatilities: subsetArray(preparedCase.volatility, eligibleIndices),
        strategy,
    });
    const optimizationAssetClasses = subsetArray(assetClasses, eligibleIndices);
    const optimizationConstraints = ensureFeasibleConstraints(
        optimizationInput.constraints,
        optimizationAssetClasses.length,
    );
    const optimization = optimizeWeights({
        assetClasses: optimizationAssetClasses,
        constraints: optimizationConstraints,
        covariance: optimizationInput.covariance,
        mode: optimizationInput.mode,
        volatilities: optimizationInput.volatilities,
    });

    const assemblyInput = appendCashReserve({
        baseCurrency,
        cashReserve: fullOptimizationInput.cashReserve,
        covariance: fullOptimizationInput.covariance,
        meanReturns: preparedCase.meanReturns,
        prepared: preparedCase.prepared,
        volatility: preparedCase.volatility,
        weights: mapSubsetWeights(optimization.weights, eligibleIndices, preparedCase.prepared.series.length),
    });
    const result = await assembleAllocationResult({
        annualizedAssetVolatility: assemblyInput.volatility,
        annualizedMeanReturns: assemblyInput.meanReturns,
        baseCurrency,
        calculationDateRange: {
            endDate: evalCase.endDate,
            startDate: evalCase.startDate,
        },
        covariance: assemblyInput.covariance,
        diversificationRatio: optimization.diversificationRatio,
        mode: optimizationInput.mode,
        optimizer: "js",
        optimizerDiagnostics: optimization.diagnostics,
        prepared: assemblyInput.prepared,
        rebalanceCadence: evalCase.rebalanceCadence,
        strategy: optimizationInput.mode,
        trendFollowing: null,
        weights: assemblyInput.weights,
    });
    const diagnostics = result.diagnostics;

    return {
        basketSize: evalCase.basketSize,
        caseId: evalCase.caseId,
        endDate: evalCase.endDate,
        metrics: result.portfolioMetrics,
        rebalanceCadence: evalCase.rebalanceCadence,
        rebalanceEventCount: diagnostics.rebalanceEventCount ?? null,
        sampleIndex: evalCase.sampleIndex,
        startDate: evalCase.startDate,
        status: 'ok',
        strategyId: strategy,
        symbols: evalCase.symbols,
        windowYears: evalCase.windowYears,
    };
};

const main = async () => {
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RunnerPayload;
    const assetBySymbol = new Map(payload.assets.map((asset) => [asset.symbol, toStoredAsset(asset)]));
    const rows: Array<Record<string, unknown>> = [];

    for (const evalCase of payload.cases) {
        try {
            const preparedCase = prepareEvalCase({
                assetBySymbol,
                pricesBySymbol: payload.pricesBySymbol,
                symbols: evalCase.symbols,
            });

            for (const strategy of payload.strategies) {
                try {
                    rows.push(
                        await runCaseStrategy({
                            baseCurrency: payload.baseCurrency,
                            constraints: payload.constraints,
                            evalCase,
                            preparedCase,
                            strategy,
                        }),
                    );
                } catch (error) {
                    rows.push({
                        basketSize: evalCase.basketSize,
                        caseId: evalCase.caseId,
                        endDate: evalCase.endDate,
                        error: error instanceof Error ? error.message : String(error),
                        rebalanceCadence: evalCase.rebalanceCadence,
                        sampleIndex: evalCase.sampleIndex,
                        startDate: evalCase.startDate,
                        status: 'error',
                        strategyId: strategy,
                        symbols: evalCase.symbols,
                        windowYears: evalCase.windowYears,
                    });
                }
            }
        } catch (error) {
            for (const strategy of payload.strategies) {
                rows.push({
                    basketSize: evalCase.basketSize,
                    caseId: evalCase.caseId,
                    endDate: evalCase.endDate,
                    error: error instanceof Error ? error.message : String(error),
                    rebalanceCadence: evalCase.rebalanceCadence,
                    sampleIndex: evalCase.sampleIndex,
                    startDate: evalCase.startDate,
                    status: 'error',
                    strategyId: strategy,
                    symbols: evalCase.symbols,
                    windowYears: evalCase.windowYears,
                });
            }
        }
    }

    process.stdout.write(`${JSON.stringify({ rows }, null, 2)}\n`);
};

void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
});