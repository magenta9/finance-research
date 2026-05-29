import type { Currency } from '../../../desktop/quantdesk/packages/shared/src/types/domain';
import type { StoredAsset } from '../../../desktop/quantdesk/packages/shared/src/types/persistence';
import type { PreparedAllocationData } from '../../../desktop/quantdesk/packages/main/src/portfolio/preprocessor';
import {
    annualizedReturns,
    annualizedVolatility,
    computeLogReturns,
    covarianceMatrix,
    shrinkCovarianceMatrix,
} from '../../../desktop/quantdesk/packages/main/src/portfolio/statistics';

export interface ActiveDualMomentumEvalAssetInput {
    assetClass: StoredAsset['assetClass'];
    currency: StoredAsset['currency'];
    id: string;
    market: StoredAsset['market'];
    metadata?: Record<string, unknown>;
    name: string;
    symbol: string;
    tags?: string[];
}

export interface QuantDataPriceRow {
    adjustedClose?: number | null;
    calculationClose?: number | null;
    close?: number | null;
    date: string;
}

export interface ActiveDualMomentumEvalPriceCacheEntry {
    prices: QuantDataPriceRow[];
    providerSymbol?: string;
    warnings?: string[];
}

export interface ActiveDualMomentumPreparedEvalCase {
    covariance: number[][];
    meanReturns: number[];
    prepared: PreparedAllocationData;
    volatility: number[];
}

const fixtureTimestamp = '2026-05-28T00:00:00.000Z';

export const toActiveDualMomentumEvalStoredAsset = (input: ActiveDualMomentumEvalAssetInput): StoredAsset => ({
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

const fallbackAsset = (symbol: string, baseCurrency: Currency): StoredAsset => toActiveDualMomentumEvalStoredAsset({
    assetClass: 'equity',
    currency: baseCurrency,
    id: symbol,
    market: 'A',
    name: symbol,
    symbol,
});

const priceValue = (row: QuantDataPriceRow) => row.calculationClose ?? row.adjustedClose ?? row.close ?? null;

export const prepareActiveDualMomentumEvalData = ({
    assetBySymbol,
    baseCurrency,
    pricesBySymbol,
    symbols,
}: {
    assetBySymbol: Map<string, StoredAsset>;
    baseCurrency: Currency;
    pricesBySymbol: Record<string, ActiveDualMomentumEvalPriceCacheEntry>;
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
        series: symbols.map((symbol, index) => ({
            annualizedReturn: 0,
            annualizedVolatility: 0,
            asset: assetBySymbol.get(symbol) ?? fallbackAsset(symbol, baseCurrency),
            prices: alignedDates.map((date) => priceMaps[index].get(date) ?? 0),
        })),
        warnings: [...new Set(warnings)],
    };
};

export const prepareActiveDualMomentumEvalCase = ({
    assetBySymbol,
    baseCurrency,
    pricesBySymbol,
    symbols,
}: {
    assetBySymbol: Map<string, StoredAsset>;
    baseCurrency: Currency;
    pricesBySymbol: Record<string, ActiveDualMomentumEvalPriceCacheEntry>;
    symbols: string[];
}): ActiveDualMomentumPreparedEvalCase => {
    const prepared = prepareActiveDualMomentumEvalData({
        assetBySymbol,
        baseCurrency,
        pricesBySymbol,
        symbols,
    });
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
