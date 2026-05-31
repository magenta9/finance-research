import type { Currency, MaxDiversificationStrategyConfig } from '../../desktop/quantdesk/packages/shared/src/types/domain';
import type { StoredAsset } from '../../desktop/quantdesk/packages/shared/src/types/persistence';
import type { PreparedAllocationData } from '../../desktop/quantdesk/packages/main/src/portfolio/preprocessor';
import { buildAllocationAnalysisInput } from '../../desktop/quantdesk/packages/main/src/portfolio/allocation-analysis-input';
import type { AllocationAnalysisInput } from '../../desktop/quantdesk/packages/main/src/portfolio/allocation-analysis-input';

import type { EvalAssetInput, EvalPriceCacheEntry, QuantDataPriceRow } from './eval_runner_contract';

const fixtureTimestamp = '2026-05-28T00:00:00.000Z';

export const toEvalStoredAsset = (input: EvalAssetInput): StoredAsset => ({
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

export const prepareEvalData = ({
    assetBySymbol,
    pricesBySymbol,
    symbols,
}: {
    assetBySymbol: Map<string, StoredAsset>;
    pricesBySymbol: Record<string, EvalPriceCacheEntry>;
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

export interface PreparedEvalBundle {
    analysisInput: AllocationAnalysisInput;
    prepared: PreparedAllocationData;
}

export const prepareEvalBundle = ({
    assetBySymbol,
    baseCurrency,
    maxDiversificationConfig,
    pricesBySymbol,
    symbols,
}: {
    assetBySymbol: Map<string, StoredAsset>;
    baseCurrency: Currency;
    maxDiversificationConfig?: MaxDiversificationStrategyConfig;
    pricesBySymbol: Record<string, EvalPriceCacheEntry>;
    symbols: string[];
}): PreparedEvalBundle => {
    const prepared = prepareEvalData({ assetBySymbol, pricesBySymbol, symbols });
    const analysisResult = buildAllocationAnalysisInput(prepared, maxDiversificationConfig);

    if (!analysisResult.ok) {
        throw new Error(analysisResult.error.message);
    }

    return {
        analysisInput: analysisResult.analysisInput,
        prepared: {
            ...prepared,
            series: prepared.series.map((entry, index) => ({
                ...entry,
                annualizedReturn: analysisResult.analysisInput.annualizedMeanReturns[index] ?? 0,
                annualizedVolatility: analysisResult.analysisInput.annualizedAssetVolatility[index] ?? 0,
            })),
        },
    };
};

export const buildAssetMap = (
    assets: EvalAssetInput[],
    baseCurrency: Currency,
): Map<string, StoredAsset> => new Map(
    assets.map((asset) => [asset.symbol, toEvalStoredAsset({
        ...asset,
        currency: asset.currency ?? baseCurrency,
    })]),
);
