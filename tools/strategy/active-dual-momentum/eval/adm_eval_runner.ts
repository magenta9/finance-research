import fs from 'node:fs';

import type { AllocationStrategyMix, Currency } from '../../../desktop/quantdesk/packages/shared/src/types/domain';
import type { StoredAsset } from '../../../desktop/quantdesk/packages/shared/src/types/persistence';
import { runActiveDualMomentumBacktest } from '../../../desktop/quantdesk/packages/main/src/portfolio/active-dual-momentum';
import type { PreparedAllocationData } from '../../../desktop/quantdesk/packages/main/src/portfolio/preprocessor';
import {
    annualizedReturns,
    annualizedVolatility,
    computeLogReturns,
    covarianceMatrix,
    shrinkCovarianceMatrix,
} from '../../../desktop/quantdesk/packages/main/src/portfolio/statistics';

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

interface EvalCase {
    assetIds: string[];
    basketSize: number;
    caseId: string;
    endDate: string;
    sampleIndex: number;
    skipReason?: string;
    startDate: string;
    symbols: string[];
    windowYears: number;
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

interface EvalPayload {
    assets: EvalAssetInput[];
    baseCurrency: Currency;
    cases: EvalCase[];
    pricesBySymbol: Record<string, PriceCacheEntry>;
    strategyConfig: NonNullable<AllocationStrategyMix['activeDualMomentum']>;
}

const fixtureTimestamp = '2026-05-28T00:00:00.000Z';

const readStdin = () => fs.readFileSync(0, 'utf8');

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

const fallbackAsset = (symbol: string): StoredAsset => toStoredAsset({
    assetClass: 'equity',
    currency: 'CNY',
    id: symbol,
    market: 'A',
    name: symbol,
    symbol,
});

const priceValue = (row: QuantDataPriceRow) => row.calculationClose ?? row.adjustedClose ?? row.close ?? null;

const prepareCase = ({
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
        series: symbols.map((symbol, index) => ({
            annualizedReturn: 0,
            annualizedVolatility: 0,
            asset: assetBySymbol.get(symbol) ?? fallbackAsset(symbol),
            prices: alignedDates.map((date) => priceMaps[index].get(date) ?? 0),
        })),
        warnings: [...new Set(warnings)],
    };
};

const run = () => {
    const payload = JSON.parse(readStdin()) as EvalPayload;
    const assetBySymbol = new Map(payload.assets.map((asset) => [asset.symbol, toStoredAsset(asset)]));
    const rows = [];

    for (const testCase of payload.cases) {
        try {
            if (testCase.skipReason) {
                rows.push({
                    ...testCase,
                    error: testCase.skipReason,
                    status: 'skipped',
                });
                continue;
            }
            let prepared = prepareCase({
                assetBySymbol,
                pricesBySymbol: payload.pricesBySymbol,
                symbols: testCase.symbols,
            });
            const logReturns = computeLogReturns(prepared.series.map((entry) => entry.prices));
            const covariance = shrinkCovarianceMatrix(covarianceMatrix(logReturns));
            const meanReturns = annualizedReturns(logReturns);
            const volatility = annualizedVolatility(covariance);
            prepared = {
                ...prepared,
                series: prepared.series.map((entry, index) => ({
                    ...entry,
                    annualizedReturn: meanReturns[index] ?? 0,
                    annualizedVolatility: volatility[index] ?? 0,
                })),
            };
            const result = runActiveDualMomentumBacktest({
                annualizedMeanReturns: meanReturns,
                annualizedVolatility: volatility,
                baseCurrency: payload.baseCurrency,
                calculationDateRange: { endDate: testCase.endDate, startDate: testCase.startDate },
                covariance,
                config: payload.strategyConfig,
                prepared,
            });
            const diagnostics = result.diagnostics.activeDualMomentum;
            rows.push({
                ...testCase,
                calmarRatio: diagnostics?.calmarRatio ?? null,
                error: result.error?.message ?? null,
                metrics: result.portfolioMetrics,
                status: result.error ? 'error' : 'ok',
                warnings: result.diagnostics.warnings,
                winRate: diagnostics?.winRate ?? null,
            });
        } catch (error) {
            rows.push({
                ...testCase,
                error: error instanceof Error ? error.message : String(error),
                status: 'error',
            });
        }
    }

    process.stdout.write(`${JSON.stringify({ rows })}\n`);
};

try {
    run();
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
}
