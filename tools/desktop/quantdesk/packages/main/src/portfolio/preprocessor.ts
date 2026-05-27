import type { AssetDateCoverage, Currency, StoredAsset } from '@quantdesk/shared';

import type { AllocationPreparationReader } from './preparation-repository-adapter';

export interface PreparedAssetSeries {
    asset: StoredAsset;
    prices: number[];
    annualizedReturn: number;
    annualizedVolatility: number;
}

export interface PreparedAllocationData {
    alignedDates: string[];
    assetDateCoverage: AssetDateCoverage[];
    excludedAssets: string[];
    series: PreparedAssetSeries[];
    warnings: string[];
}

const MIN_REQUIRED_TRADING_DAYS = 61;

const resolveFxRate = (
    reader: AllocationPreparationReader,
    assetCurrency: Currency,
    baseCurrency: Currency,
    date: string,
) => {
    if (assetCurrency === baseCurrency) {
        return 1;
    }

    const fxRate = reader.readFxRates({
        assetCurrency,
        baseCurrency,
        onOrBeforeDate: date,
    });

    if (fxRate) {
        return fxRate.rate;
    }

    throw new Error(`Missing FX rate for ${assetCurrency}/${baseCurrency} on or before ${date}.`);
};

export const prepareAllocationData = ({
    assets,
    baseCurrency,
    reader,
    endDate,
    startDate,
}: {
    assets: StoredAsset[];
    baseCurrency: Currency;
    reader: AllocationPreparationReader;
    startDate?: string;
    endDate?: string;
}): PreparedAllocationData => {
    const insufficientCoverageMessage = `已选标的在当前窗口内的共同覆盖不足 ${MIN_REQUIRED_TRADING_DAYS} 个交易日。`;
    const warnings: string[] = [];
    const excludedAssets: string[] = [];
    const assetPriceMaps = assets.map((asset) => {
        const rows = reader.readPriceHistory({
            assetId: asset.id,
            endDate,
            startDate,
        });

        if (rows.length < MIN_REQUIRED_TRADING_DAYS) {
            excludedAssets.push(asset.id);
            warnings.push(`${asset.symbol} 历史数据不足 60 个交易日。`);
            return null;
        }

        const priceMap = new Map<string, number>();

        for (const row of rows) {
            const rawPrice = row.adjustedClose ?? row.close;

            if (rawPrice == null || Number.isNaN(rawPrice)) {
                continue;
            }

            const fxRate = resolveFxRate(reader, asset.currency, baseCurrency, row.date);
            priceMap.set(row.date, rawPrice * fxRate);
        }

        if (priceMap.size < MIN_REQUIRED_TRADING_DAYS) {
            excludedAssets.push(asset.id);
            warnings.push(`${asset.symbol} 历史数据不足 60 个交易日。`);
            return null;
        }

        const coverageDates = [...priceMap.keys()];

        return {
            asset,
            coverage: {
                actualEndDate: coverageDates.at(-1) ?? coverageDates[0],
                actualStartDate: coverageDates[0],
                assetId: asset.id,
                isFallback: false,
                requestedStartDate: startDate ?? coverageDates[0],
                symbol: asset.symbol,
                tradingDays: coverageDates.length,
            },
            priceMap,
        };
    });

    const validAssetMaps = assetPriceMaps.filter(
        (entry): entry is {
            asset: StoredAsset;
            coverage: AssetDateCoverage;
            priceMap: Map<string, number>;
        } => Boolean(entry),
    );

    if (validAssetMaps.length < 2) {
        throw new Error(startDate && endDate
            ? insufficientCoverageMessage
            : 'At least two assets with sufficient history are required to run allocation.');
    }

    const sortedDates = [...new Set(validAssetMaps.flatMap((entry) => [...entry.priceMap.keys()]))].sort();
    const alignedDates: string[] = [];
    const alignedPriceSeries = validAssetMaps.map(() => [] as number[]);
    const lastSeen = validAssetMaps.map(() => Number.NaN);

    for (const date of sortedDates) {
        let allReady = true;

        validAssetMaps.forEach((entry, index) => {
            const nextPrice = entry.priceMap.get(date);

            if (nextPrice != null) {
                lastSeen[index] = nextPrice;
            }

            if (Number.isNaN(lastSeen[index])) {
                allReady = false;
            }
        });

        if (!allReady) {
            continue;
        }

        alignedDates.push(date);
        lastSeen.forEach((price, index) => {
            alignedPriceSeries[index].push(price);
        });
    }

    if (alignedDates.length < MIN_REQUIRED_TRADING_DAYS) {
        throw new Error(insufficientCoverageMessage);
    }

    const series = validAssetMaps.map((entry, index) => ({
        annualizedReturn: 0,
        annualizedVolatility: 0,
        asset: entry.asset,
        prices: alignedPriceSeries[index],
    }));

    return {
        alignedDates,
        assetDateCoverage: validAssetMaps.map((entry) => entry.coverage),
        excludedAssets,
        series,
        warnings,
    };
};
