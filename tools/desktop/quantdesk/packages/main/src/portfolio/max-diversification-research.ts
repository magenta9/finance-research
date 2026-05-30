import type {
    AllocationConstraints,
    Currency,
    MaxDiversificationStrategyConfig,
    StoredAsset,
} from '@quantdesk/shared';

import type { AllocationAnalysisInput } from './allocation-analysis-input';
import type { PreparedAllocationData } from './preprocessor';

const fixtureTimestamp = '2026-05-28T00:00:00.000Z';
const cashReserveAssetId = 'max-diversification-v3-cash-reserve';
const cashReserveSymbol = 'CASH_RESERVE';

export const DEFAULT_MAX_DIVERSIFICATION_RESEARCH_CONFIG: Required<MaxDiversificationStrategyConfig> = {
    absoluteMomentumLookbackDaysList: [50, 125, 252],
    absoluteMomentumMinPositiveCount: 2,
    absoluteMomentumThreshold: 0,
    cashReserve: 0.25,
    diagonalLoad: 0.15,
    maxSingleWeight: 0.6,
    minCorrelation: 0.08,
    momentumBreadthCashScale: 1.25,
    volatilityPower: 0,
};

export type MaxDiversificationResearchConfigResolved = Required<MaxDiversificationStrategyConfig>;

export interface MaxDiversificationResearchInput {
    allocationAssetIndexes: number[];
    analysisInput: AllocationAnalysisInput;
    config?: MaxDiversificationStrategyConfig;
    constraints: AllocationConstraints;
    prepared: PreparedAllocationData;
}

export interface MaxDiversificationOptimizationInput {
    annualizedAssetVolatility: number[];
    assetIndexes: number[];
    assemblyCovariance: number[][];
    assemblyVolatility: number[];
    cashReserve: number;
    constraints: AllocationConstraints;
    covariance: number[][];
}

export interface MaxDiversificationCashReserveInput {
    baseCurrency: Currency;
    cashReserve: number;
    covariance: number[][];
    meanReturns: number[];
    prepared: PreparedAllocationData;
    volatility: number[];
    weights: number[];
}

export interface MaxDiversificationCashReserveOutput {
    covariance: number[][];
    meanReturns: number[];
    prepared: PreparedAllocationData;
    volatility: number[];
    weights: number[];
}

const cloneMatrix = (matrix: number[][]) => matrix.map((row) => [...row]);

const subsetArray = <T>(values: T[], indices: number[]) => indices.map((index) => values[index]);

const subsetMatrix = (matrix: number[][], indices: number[]) => indices.map((rowIndex) => (
    indices.map((columnIndex) => matrix[rowIndex]?.[columnIndex] ?? 0)
));

export const mapSubsetWeights = (weights: number[], indices: number[], assetCount: number) => {
    const mappedWeights = Array.from({ length: assetCount }, () => 0);

    indices.forEach((assetIndex, weightIndex) => {
        mappedWeights[assetIndex] = weights[weightIndex] ?? 0;
    });

    return mappedWeights;
};

export const resolveMaxDiversificationResearchConfig = (
    config?: MaxDiversificationStrategyConfig,
): MaxDiversificationResearchConfigResolved => {
    const defaults = DEFAULT_MAX_DIVERSIFICATION_RESEARCH_CONFIG;

    return {
        absoluteMomentumLookbackDaysList: config?.absoluteMomentumLookbackDaysList
            ?? defaults.absoluteMomentumLookbackDaysList,
        absoluteMomentumMinPositiveCount: config?.absoluteMomentumMinPositiveCount
            ?? defaults.absoluteMomentumMinPositiveCount,
        absoluteMomentumThreshold: config?.absoluteMomentumThreshold
            ?? defaults.absoluteMomentumThreshold,
        cashReserve: config?.cashReserve ?? defaults.cashReserve,
        diagonalLoad: config?.diagonalLoad ?? defaults.diagonalLoad,
        maxSingleWeight: config?.maxSingleWeight ?? defaults.maxSingleWeight,
        minCorrelation: config?.minCorrelation ?? defaults.minCorrelation,
        momentumBreadthCashScale: config?.momentumBreadthCashScale
            ?? defaults.momentumBreadthCashScale,
        volatilityPower: config?.volatilityPower ?? defaults.volatilityPower,
    };
};

export const applyDiagonalLoad = (covariance: number[][], load: number) => covariance.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (rowIndex !== columnIndex) {
        return value;
    }

    return value + Math.max(value, 1e-12) * Math.max(0, load);
}));

export const applyMinCorrelation = (covariance: number[][], minCorrelation: number) => {
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

export const applyVolatilityPower = (volatilities: number[], power: number) => volatilities.map((volatility) => (
    Math.pow(Math.max(volatility, 1e-8), power)
));

export const boundedCashReserve = (value: number) => Math.min(0.95, Math.max(0, value));

export const applyMomentumBreadthCashScale = ({
    assetCount,
    baseCashReserve,
    eligibleCount,
    scale,
}: {
    assetCount: number;
    baseCashReserve: number;
    eligibleCount: number;
    scale: number;
}) => {
    if (assetCount <= 0) {
        return baseCashReserve;
    }

    const breadth = eligibleCount / assetCount;
    return boundedCashReserve(baseCashReserve + (1 - breadth) * Math.max(0, scale));
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

const transformCovariance = (
    covariance: number[][],
    config: MaxDiversificationResearchConfigResolved,
) => applyMinCorrelation(applyDiagonalLoad(cloneMatrix(covariance), config.diagonalLoad), config.minCorrelation);

export const withResearchClassWeightCaps = (
    constraints: AllocationConstraints,
    config?: MaxDiversificationStrategyConfig,
): AllocationConstraints => {
    const classCaps = { ...constraints.maxClassWeight };

    if (typeof config?.equityClassWeightCap === 'number') {
        classCaps.equity = Math.min(1, Math.max(0, config.equityClassWeightCap));
    }

    if (typeof config?.fixedIncomeClassWeightCap === 'number') {
        classCaps.fixed_income = Math.min(1, Math.max(0, config.fixedIncomeClassWeightCap));
    }

    if (typeof config?.commodityClassWeightCap === 'number') {
        classCaps.commodity = Math.min(1, Math.max(0, config.commodityClassWeightCap));
    }

    if (Object.keys(classCaps).length === Object.keys(constraints.maxClassWeight).length
        && !config?.equityClassWeightCap
        && !config?.fixedIncomeClassWeightCap
        && !config?.commodityClassWeightCap) {
        return constraints;
    }

    return {
        ...constraints,
        maxClassWeight: classCaps,
    };
};

export const resolveAverageMomentumScores = (
    prepared: PreparedAllocationData,
    config?: MaxDiversificationStrategyConfig,
) => {
    const resolvedConfig = resolveMaxDiversificationResearchConfig(config);
    const lookbacks = resolvedConfig.absoluteMomentumLookbackDaysList
        .map((value) => Math.max(1, Math.floor(value)));

    return prepared.series.map((entry) => {
        const current = entry.prices.at(-1) ?? 0;
        const momentums = lookbacks.map((lookbackDays) => {
            const referenceIndex = Math.max(0, entry.prices.length - 1 - lookbackDays);
            const reference = entry.prices[referenceIndex] ?? 0;

            return current > 0 && reference > 0 ? current / reference - 1 : 0;
        });

        return momentums.reduce((sum, value) => sum + value, 0) / momentums.length;
    });
};

export const resolveAbsoluteMomentumEligibleIndices = (
    prepared: PreparedAllocationData,
    config: MaxDiversificationStrategyConfig,
    candidateIndexes: number[] = prepared.series.map((_entry, index) => index),
) => {
    const resolvedConfig = resolveMaxDiversificationResearchConfig(config);
    const lookbacks = resolvedConfig.absoluteMomentumLookbackDaysList
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.max(1, Math.floor(value)));

    if (lookbacks.length === 0) {
        return candidateIndexes;
    }

    const momentumScores = candidateIndexes.map((index) => {
        const entry = prepared.series[index];
        const current = entry?.prices.at(-1) ?? 0;
        const momentums = lookbacks.map((lookbackDays) => {
            const referenceIndex = Math.max(0, (entry?.prices.length ?? 0) - 1 - lookbackDays);
            const reference = entry?.prices[referenceIndex] ?? 0;

            return current > 0 && reference > 0 ? current / reference - 1 : -Infinity;
        });
        const positiveCount = momentums.filter((momentum) => momentum > resolvedConfig.absoluteMomentumThreshold).length;
        const momentum = momentums.reduce((sum, value) => sum + value, 0) / momentums.length;

        return { index, momentum, positiveCount };
    });
    const eligible = momentumScores
        .filter((entry) => entry.positiveCount >= resolvedConfig.absoluteMomentumMinPositiveCount)
        .map((entry) => entry.index);

    if (eligible.length > 0) {
        return eligible;
    }

    return [momentumScores.reduce((best, entry) => (
        entry.momentum > best.momentum ? entry : best
    ), momentumScores[0]).index];
};

export const resolveMaxDiversificationOptimizationInput = ({
    allocationAssetIndexes,
    analysisInput,
    config,
    constraints,
    prepared,
}: MaxDiversificationResearchInput): MaxDiversificationOptimizationInput => {
    const resolvedConfig = resolveMaxDiversificationResearchConfig(config);
    const eligibleAssetIndexes = resolveAbsoluteMomentumEligibleIndices(
        prepared,
        resolvedConfig,
        allocationAssetIndexes,
    );
    const assemblyCovariance = transformCovariance(analysisInput.shrunkCovariance, resolvedConfig);
    const assemblyVolatility = [...analysisInput.annualizedAssetVolatility];
    const optimizationCovariance = transformCovariance(
        subsetMatrix(analysisInput.shrunkCovariance, eligibleAssetIndexes),
        resolvedConfig,
    );
    const optimizationVolatility = applyVolatilityPower(
        subsetArray(analysisInput.annualizedAssetVolatility, eligibleAssetIndexes),
        resolvedConfig.volatilityPower,
    );
    const optimizationConstraints = ensureFeasibleConstraints(
        withResearchClassWeightCaps({
            ...constraints,
            maxSingleWeight: resolvedConfig.maxSingleWeight,
        }, config),
        eligibleAssetIndexes.length,
    );
    const cashReserve = applyMomentumBreadthCashScale({
        assetCount: allocationAssetIndexes.length,
        baseCashReserve: boundedCashReserve(resolvedConfig.cashReserve),
        eligibleCount: eligibleAssetIndexes.length,
        scale: resolvedConfig.momentumBreadthCashScale,
    });

    return {
        annualizedAssetVolatility: optimizationVolatility,
        assetIndexes: eligibleAssetIndexes,
        assemblyCovariance,
        assemblyVolatility,
        cashReserve,
        constraints: optimizationConstraints,
        covariance: optimizationCovariance,
    };
};

export const appendMaxDiversificationCashReserve = ({
    baseCurrency,
    cashReserve,
    covariance,
    meanReturns,
    prepared,
    volatility,
    weights,
}: MaxDiversificationCashReserveInput): MaxDiversificationCashReserveOutput => {
    if (cashReserve <= 0) {
        return {
            covariance,
            meanReturns,
            prepared,
            volatility,
            weights,
        };
    }

    const boundedReserve = boundedCashReserve(cashReserve);
    const riskyScale = 1 - boundedReserve;
    const cashAsset: StoredAsset = {
        assetClass: 'cash',
        createdAt: fixtureTimestamp,
        currency: baseCurrency,
        id: cashReserveAssetId,
        market: 'A',
        metadata: { synthetic: true, source: 'max_diversification_research_v1' },
        name: 'Cash Reserve',
        symbol: cashReserveSymbol,
        tags: ['synthetic', 'cash-reserve'],
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
        weights: [...weights.map((weight) => weight * riskyScale), boundedReserve],
    };
};
