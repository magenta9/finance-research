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

type EvalStrategyId = AllocationType | 'max_diversification_research_v1';

interface MaxDiversificationResearchConfig {
    covarianceShrinkage?: number;
    diagonalLoad?: number;
    maxSingleWeight?: number;
    minCorrelation?: number;
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

const cloneMatrix = (matrix: number[][]) => matrix.map((row) => [...row]);

const applyCovarianceShrinkage = (covariance: number[][], shrinkage: number) => {
    const bounded = Math.min(1, Math.max(0, shrinkage));

    return covariance.map((row, rowIndex) => row.map((value, columnIndex) => (
        rowIndex === columnIndex ? value : value * (1 - bounded)
    )));
};

const applyDiagonalLoad = (covariance: number[][], load: number) => covariance.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (rowIndex !== columnIndex) {
        return value;
    }

    return value + Math.max(value, 1e-12) * Math.max(0, load);
}));

const applyMinCorrelation = (covariance: number[][], minCorrelation: number) => {
    const bounded = Math.min(0.95, Math.max(-0.95, minCorrelation));
    const standardDeviations = covariance.map((row, index) => Math.sqrt(Math.max(row[index] ?? 0, 0)));

    return covariance.map((row, rowIndex) => row.map((value, columnIndex) => {
        if (rowIndex === columnIndex) {
            return value;
        }

        const denominator = standardDeviations[rowIndex] * standardDeviations[columnIndex];

        if (denominator <= 0) {
            return value;
        }

        return Math.max(value / denominator, bounded) * denominator;
    }));
};

const applyVolatilityPower = (volatilities: number[], power: number) => volatilities.map((volatility) => (
    Math.pow(Math.max(volatility, 1e-8), power)
));

const resolveOptimizationInput = ({
    baseConstraints,
    baseCovariance,
    baseVolatilities,
    strategy,
    strategyConfigs,
}: {
    baseConstraints: AllocationConstraints;
    baseCovariance: number[][];
    baseVolatilities: number[];
    strategy: EvalStrategyId;
    strategyConfigs?: Record<string, MaxDiversificationResearchConfig>;
}) => {
    if (strategy !== 'max_diversification_research_v1') {
        return {
            constraints: baseConstraints,
            covariance: baseCovariance,
            mode: strategy,
            volatilities: baseVolatilities,
        };
    }

    const config = strategyConfigs?.[strategy] ?? {};
    let covariance = cloneMatrix(baseCovariance);
    let volatilities = [...baseVolatilities];
    let constraints = { ...baseConstraints };

    if (typeof config.covarianceShrinkage === 'number') {
        covariance = applyCovarianceShrinkage(covariance, config.covarianceShrinkage);
    }

    if (typeof config.diagonalLoad === 'number') {
        covariance = applyDiagonalLoad(covariance, config.diagonalLoad);
    }

    if (typeof config.minCorrelation === 'number') {
        covariance = applyMinCorrelation(covariance, config.minCorrelation);
    }

    if (typeof config.volatilityPower === 'number') {
        volatilities = applyVolatilityPower(volatilities, config.volatilityPower);
    }

    if (typeof config.maxSingleWeight === 'number') {
        constraints = { ...constraints, maxSingleWeight: config.maxSingleWeight };
    }

    return {
        constraints,
        covariance,
        mode: 'max_diversification' as const,
        volatilities,
    };
};

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
    const covariance = shrinkCovarianceMatrix(covarianceMatrix(logReturns));
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

const runCaseStrategy = ({
    baseCurrency,
    constraints,
    evalCase,
    preparedCase,
    strategy,
    strategyConfigs,
}: {
    baseCurrency: Currency;
    constraints: AllocationConstraints;
    evalCase: EvalCaseInput;
    preparedCase: ReturnType<typeof prepareEvalCase>;
    strategy: EvalStrategyId;
    strategyConfigs?: Record<string, MaxDiversificationResearchConfig>;
}) => {
    const assetClasses = preparedCase.prepared.series.map((entry) => entry.asset.assetClass);
    const optimizationInput = resolveOptimizationInput({
        baseConstraints: constraints,
        baseCovariance: preparedCase.covariance,
        baseVolatilities: preparedCase.volatility,
        strategy,
        strategyConfigs,
    });
    const optimization = optimizeWeights({
        assetClasses,
        constraints: optimizationInput.constraints,
        covariance: optimizationInput.covariance,
        mode: optimizationInput.mode,
        volatilities: optimizationInput.volatilities,
    });
    const result = assembleAllocationResult({
        annualizedAssetVolatility: preparedCase.volatility,
        annualizedMeanReturns: preparedCase.meanReturns,
        baseCurrency,
        calculationDateRange: {
            endDate: evalCase.endDate,
            startDate: evalCase.startDate,
        },
        covariance: optimizationInput.covariance,
        diversificationRatio: optimization.diversificationRatio,
        mode: optimizationInput.mode,
        optimizer: 'js',
        optimizerDiagnostics: optimization.diagnostics,
        prepared: preparedCase.prepared,
        rebalanceCadence: evalCase.rebalanceCadence,
        strategy: optimizationInput.mode,
        trendFollowing: null,
        weights: optimization.weights,
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
    const rows = payload.cases.flatMap((evalCase) => {
        try {
            const preparedCase = prepareEvalCase({
                assetBySymbol,
                pricesBySymbol: payload.pricesBySymbol,
                symbols: evalCase.symbols,
            });

            return payload.strategies.map((strategy) => {
                try {
                    return runCaseStrategy({
                        baseCurrency: payload.baseCurrency,
                        constraints: payload.constraints,
                        evalCase,
                        preparedCase,
                        strategy,
                        strategyConfigs: payload.strategyConfigs,
                    });
                } catch (error) {
                    return {
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
                    };
                }
            });
        } catch (error) {
            return payload.strategies.map((strategy) => ({
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
            }));
        }
    });

    process.stdout.write(`${JSON.stringify({ rows }, null, 2)}\n`);
};

void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
});