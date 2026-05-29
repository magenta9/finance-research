import { describe, expect, test } from 'vitest';

import {
    prepareActiveDualMomentumEvalCase,
    prepareActiveDualMomentumEvalData,
    toActiveDualMomentumEvalStoredAsset,
    type ActiveDualMomentumEvalAssetInput,
    type ActiveDualMomentumEvalPriceCacheEntry,
} from './adm_eval_preparation';

const dateAt = (index: number) => {
    const date = new Date(Date.UTC(2025, 0, 1 + index));
    return date.toISOString().slice(0, 10);
};

const rows = (length: number, start: number): ActiveDualMomentumEvalPriceCacheEntry => ({
    prices: Array.from({ length }, (_value, index) => ({
        adjustedClose: start + index * 0.5,
        calculationClose: index === 0 ? start + 10 : null,
        close: start + index,
        date: dateAt(index),
    })),
    warnings: ['provider warning', 'provider warning'],
});

const asset = (symbol: string): ActiveDualMomentumEvalAssetInput => ({
    assetClass: 'equity',
    currency: 'USD',
    id: `asset-${symbol}`,
    market: 'US',
    name: symbol,
    symbol,
});

describe('ADM eval preparation', () => {
    test('aligns quant-data prices and prefers calculation close values', () => {
        const assets = [asset('AAA'), asset('BBB')];
        const assetBySymbol = new Map(assets.map((input) => [input.symbol, toActiveDualMomentumEvalStoredAsset(input)]));
        const prepared = prepareActiveDualMomentumEvalData({
            assetBySymbol,
            baseCurrency: 'USD',
            pricesBySymbol: {
                AAA: rows(62, 100),
                BBB: rows(62, 80),
            },
            symbols: ['AAA', 'BBB'],
        });

        expect(prepared.alignedDates).toHaveLength(62);
        expect(prepared.series[0]?.prices[0]).toBe(110);
        expect(prepared.series[0]?.prices[1]).toBe(100.5);
        expect(prepared.warnings).toEqual(['provider warning']);
        expect(prepared.assetDateCoverage[0]).toEqual(expect.objectContaining({
            assetId: 'asset-AAA',
            symbol: 'AAA',
            tradingDays: 62,
        }));
    });

    test('throws when aligned coverage is below the eval minimum', () => {
        const assets = [asset('AAA'), asset('BBB')];
        const assetBySymbol = new Map(assets.map((input) => [input.symbol, toActiveDualMomentumEvalStoredAsset(input)]));

        expect(() => prepareActiveDualMomentumEvalData({
            assetBySymbol,
            baseCurrency: 'USD',
            pricesBySymbol: {
                AAA: rows(60, 100),
                BBB: rows(60, 80),
            },
            symbols: ['AAA', 'BBB'],
        })).toThrow('Insufficient aligned price coverage: 60 rows.');
    });

    test('adds portfolio statistics required by the TypeScript backtest runner', () => {
        const assets = [asset('AAA'), asset('BBB'), asset('CCC')];
        const assetBySymbol = new Map(assets.map((input) => [input.symbol, toActiveDualMomentumEvalStoredAsset(input)]));
        const preparedCase = prepareActiveDualMomentumEvalCase({
            assetBySymbol,
            baseCurrency: 'USD',
            pricesBySymbol: {
                AAA: rows(62, 100),
                BBB: rows(62, 80),
                CCC: rows(62, 120),
            },
            symbols: ['AAA', 'BBB', 'CCC'],
        });

        expect(preparedCase.covariance).toHaveLength(3);
        expect(preparedCase.meanReturns).toHaveLength(3);
        expect(preparedCase.volatility).toHaveLength(3);
        expect(preparedCase.prepared.series.every((entry) => entry.annualizedVolatility > 0)).toBe(true);
    });
});
