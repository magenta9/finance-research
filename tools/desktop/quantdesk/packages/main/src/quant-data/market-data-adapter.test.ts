import { describe, expect, test, vi } from 'vitest';

import type { MarketDataPort } from '../sidecar/market-data-port';
import { QuantDataCliClient, type QuantDataProcessRequest } from './client';
import { QuantDataMarketDataAdapter, QuantDataMarketDataPort } from './market-data-adapter';

const createAdapter = () => {
    const calls: QuantDataProcessRequest[] = [];
    const runner = vi.fn(async (request: QuantDataProcessRequest) => {
        calls.push(request);
        const method = request.args.at(-1);

        if (method === 'search-assets') {
            return {
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: JSON.stringify({
                    ok: true,
                    data: [{
                        assetClass: 'equity',
                        currency: 'CNY',
                        market: 'A',
                        metadata: { externalInstrumentId: 'akshare:A:510300' },
                        name: '沪深300ETF',
                        source: 'akshare',
                        symbol: '510300',
                    }],
                }),
            };
        }

        if (method === 'get-price-series') {
            return {
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: JSON.stringify({
                    ok: true,
                    data: {
                        attemptedSources: ['akshare'],
                        prices: [{
                            adjustedClose: 3.9,
                            calculationClose: 3.94,
                            close: 3.95,
                            date: '2026-05-14',
                            high: 3.96,
                            low: 3.9,
                            open: 3.91,
                            source: 'akshare',
                            volume: 1200000,
                        }],
                        symbol: '510300',
                        warnings: ['raw continuous and not back-adjusted'],
                    },
                }),
            };
        }

        if (method === 'get-fx-rates') {
            return {
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: JSON.stringify({
                    ok: true,
                    data: {
                        attemptedSources: ['yfinance'],
                        pair: 'USD/CNY',
                        rates: [{ date: '2026-05-14', rate: 7.1, source: 'yfinance' }],
                        warnings: [],
                    },
                }),
            };
        }

        if (method === 'status') {
            return {
                exitCode: 0,
                signal: null,
                stderr: '',
                stdout: JSON.stringify({
                    ok: true,
                    data: {
                        providerConfiguration: { code: null, message: null, ready: true },
                        stats: { fxRateRowCount: 2, latestPriceFetchAt: '2026-05-17T00:00:00Z', priceRowCount: 12 },
                        storePath: '/tmp/quant-data.sqlite3',
                        storeVersion: 1,
                    },
                }),
            };
        }

        throw new Error(`Unexpected method ${method ?? 'unknown'}`);
    });
    const client = new QuantDataCliClient({ command: 'quant-data', runner });
    return { adapter: new QuantDataMarketDataAdapter(client), calls };
};

describe('QuantDataMarketDataAdapter', () => {
    test('maps search assets onto quant-data search-assets', async () => {
        const { adapter, calls } = createAdapter();

        await expect(adapter.searchAssets({ enabledSources: ['akshare'], market: 'A', query: '510300' })).resolves.toEqual([{
            assetClass: 'equity',
            currency: 'CNY',
            market: 'A',
            metadata: { externalInstrumentId: 'akshare:A:510300' },
            name: '沪深300ETF',
            source: 'akshare',
            symbol: '510300',
        }]);

        expect(calls[0]).toMatchObject({
            args: ['search-assets'],
            input: '{"market":"A","query":"510300"}\n',
        });
    });

    test('maps quant-data price series to the desktop market data port shape', async () => {
        const { adapter, calls } = createAdapter();

        await expect(adapter.fetchPrices({
            enabledSources: ['akshare'],
            end: '2026-05-14',
            market: 'A',
            start: '2026-05-01',
            symbol: '510300',
        })).resolves.toEqual({
            attemptedSources: ['akshare'],
            prices: [{
                adjusted_close: 3.94,
                close: 3.95,
                date: '2026-05-14',
                high: 3.96,
                low: 3.9,
                open: 3.91,
                source: 'akshare',
                volume: 1200000,
            }],
            symbol: '510300',
            warnings: ['raw continuous and not back-adjusted'],
        });

        expect(calls[0]).toMatchObject({
            args: ['get-price-series'],
            input: '{"end":"2026-05-14","market":"A","start":"2026-05-01","symbol":"510300"}\n',
        });
    });

    test('maps quant-data FX rates to the desktop market data port shape', async () => {
        const { adapter, calls } = createAdapter();

        await expect(adapter.fetchFxRates({
            enabledSources: ['yfinance'],
            end: '2026-05-14',
            pair: 'USD/CNY',
            start: '2026-05-01',
        })).resolves.toEqual({
            attemptedSources: ['yfinance'],
            pair: 'USD/CNY',
            rates: [{ date: '2026-05-14', rate: 7.1, source: 'yfinance' }],
            warnings: [],
        });

        expect(calls[0]).toMatchObject({
            args: ['get-fx-rates'],
            input: '{"end":"2026-05-14","pair":"USD/CNY","start":"2026-05-01"}\n',
        });
    });

    test('returns quant-data provider configuration status', async () => {
        const { adapter, calls } = createAdapter();

        await expect(adapter.getStatus()).resolves.toEqual({
            providerConfiguration: { code: null, message: null, ready: true },
            stats: { fxRateRowCount: 2, latestPriceFetchAt: '2026-05-17T00:00:00Z', priceRowCount: 12 },
            storePath: '/tmp/quant-data.sqlite3',
            storeVersion: 1,
        });

        expect(calls[0]).toMatchObject({
            args: ['status'],
            input: undefined,
        });
    });

    test('uses quant-data for market data while delegating research providers to sidecar fallback', async () => {
        const { adapter, calls } = createAdapter();
        const fallback = {
            fetchFlowSentiment: vi.fn(),
            fetchFundamentals: vi.fn(async () => ({
                asOf: null,
                attemptedSources: [],
                dataAgeDays: null,
                dataProvenance: [],
                market: 'A',
                metrics: { period: { fiscalPeriod: null, reportDate: null } },
                providerErrors: [],
                qualityStatus: 'unavailable',
                symbol: '510300',
                warnings: [],
            })),
            fetchFxRates: vi.fn(),
            fetchMarketSource: vi.fn(),
            fetchPrices: vi.fn(),
            searchAnnouncements: vi.fn(),
            searchAssets: vi.fn(),
            searchNewsCatalysts: vi.fn(),
        } as unknown as MarketDataPort;
        const port = new QuantDataMarketDataPort({ fallback, quantData: adapter });

        await expect(port.searchAssets({ enabledSources: ['akshare'], market: 'A', query: '510300' })).resolves.toEqual([
            expect.objectContaining({ source: 'akshare', symbol: '510300' }),
        ]);
        await expect(port.fetchFundamentals({ enabledProviders: ['akshare'], market: 'A', symbol: '510300' })).resolves.toEqual(
            expect.objectContaining({ qualityStatus: 'unavailable', symbol: '510300' }),
        );

        expect(calls[0]).toMatchObject({ args: ['search-assets'] });
        expect(fallback.searchAssets).not.toHaveBeenCalled();
        expect(fallback.fetchFundamentals).toHaveBeenCalledWith({
            enabledProviders: ['akshare'],
            market: 'A',
            symbol: '510300',
        });
    });
});
