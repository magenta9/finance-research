import { describe, expect, test, vi } from 'vitest';

import type { StoredAsset } from '@quantdesk/shared';

import type { MarketDataPort } from './market-data-port';
import { loadResearchProviderFixture } from './research-provider-contracts';
import { createResearchProviderServices } from './research-provider-services';

const buildAsset = (overrides: Partial<StoredAsset> = {}): StoredAsset => ({
    assetClass: overrides.assetClass ?? 'equity',
    createdAt: overrides.createdAt ?? '2026-04-13T00:00:00.000Z',
    currency: overrides.currency ?? 'CNY',
    id: overrides.id ?? `asset-${overrides.symbol ?? '600519'}`,
    market: overrides.market ?? 'A',
    metadata: overrides.metadata ?? { tsCode: '600519.SH' },
    name: overrides.name ?? '贵州茅台',
    symbol: overrides.symbol ?? '600519',
    tags: overrides.tags ?? [],
    updatedAt: overrides.updatedAt ?? '2026-04-13T00:00:00.000Z',
});

const createDataServices = (assets: StoredAsset[]) => ({
    repositories: {
        assetRepository: {
            list: () => assets,
            search: (query: string) => assets.filter((asset) => `${asset.symbol} ${asset.name}`.includes(query)),
        },
        preferencesRepository: {
            get: () => null,
        },
    },
}) as never;

describe('createResearchProviderServices', () => {
    test('passes resolved market, metadata, and ordered providers to fundamentals RPC', async () => {
        const fixture = loadResearchProviderFixture<{
            fetchFundamentals: { result: Record<string, unknown> };
        }>('research-provider-wire-shape.json');
        const fetchFundamentals = vi.fn(async () => fixture.fetchFundamentals.result);
        const service = createResearchProviderServices({
            dataServices: createDataServices([buildAsset()]),
            marketDataPort: { fetchFundamentals } as unknown as MarketDataPort,
        });

        const snapshot = await service.getFundamentalSnapshot!({ symbol: '600519' });

        expect(fetchFundamentals).toHaveBeenCalledWith(expect.objectContaining({
            assetMetadata: expect.objectContaining({ market: 'A', name: '贵州茅台', symbol: '600519', tsCode: '600519.SH' }),
            enabledProviders: ['tushare', 'akshare'],
            market: 'A',
            symbol: '600519',
        }));
        expect(snapshot.status).toBe('available');
        expect(snapshot.providerIds).toEqual(['tushare']);
        expect(snapshot.summary).toContain('基本面快照');
    });

    test('describes ETF fund facts as not issuer-style fundamentals', async () => {
        const fetchFundamentals = vi.fn(async () => ({
            asOf: '2026-05-07',
            attemptedSources: [],
            dataAgeDays: null,
            dataProvenance: [{
                fetchedAt: '2026-05-07T00:00:00Z',
                providerIds: ['asset_metadata'],
                qualityStatus: 'warn' as const,
                rowsUsed: 0,
                sourceId: 'fundamentals:asset_metadata:159740',
                warnings: [],
            }],
            market: 'A',
            metrics: {
                fundFacts: {
                    assetClass: 'equity',
                    assetName: '恒生科技ETF',
                    issuerStyleFundamentals: 'asset_not_covered' as const,
                    underlyingMarket: 'HK',
                },
                period: { fiscalPeriod: null, reportDate: null },
            },
            providerErrors: [],
            qualityStatus: 'degraded' as const,
            symbol: '159740',
            warnings: ['ETF/fund PE/PB requires an explicit underlying-index valuation source; do not infer it from issuer-style fundamentals.'],
        }));
        const service = createResearchProviderServices({
            dataServices: createDataServices([buildAsset({
                id: 'asset-159740',
                metadata: { underlyingMarket: 'HK' },
                name: '恒生科技ETF',
                symbol: '159740',
            })]),
            marketDataPort: { fetchFundamentals } as unknown as MarketDataPort,
        });

        const snapshot = await service.getFundamentalSnapshot!({ symbol: '159740' });

        expect(snapshot.status).toBe('degraded');
        expect(snapshot.summary).toContain('股票发行人基本面不适用');
        expect(snapshot.summary).toContain('未提供 PE/PB/ROE');
        expect(snapshot.summary).not.toContain('基本面缺失');
    });

    test('describes available ETF underlying valuation without implying PB coverage', async () => {
        const fetchFundamentals = vi.fn(async () => ({
            asOf: '2026-05-07',
            attemptedSources: ['akshare'],
            dataAgeDays: null,
            dataProvenance: [{
                fetchedAt: '2026-05-07T00:00:00Z',
                providerIds: ['akshare'],
                qualityStatus: 'pass' as const,
                rowsUsed: 1,
                sourceId: 'fundamentals:akshare:510300',
                warnings: [],
            }],
            market: 'A',
            metrics: {
                fundFacts: {
                    assetName: '沪深300ETF',
                    issuerStyleFundamentals: 'asset_not_covered' as const,
                    underlyingValuation: {
                        dividendYield: 0.02,
                        indexCode: '000300',
                        peTtm: 12.3,
                        providerId: 'akshare' as const,
                        status: 'available' as const,
                    },
                },
                period: { fiscalPeriod: null, reportDate: null },
            },
            providerErrors: [],
            qualityStatus: 'degraded' as const,
            symbol: '510300',
            warnings: [],
        }));
        const service = createResearchProviderServices({
            dataServices: createDataServices([buildAsset({ name: '沪深300ETF', symbol: '510300' })]),
            marketDataPort: { fetchFundamentals } as unknown as MarketDataPort,
        });

        const snapshot = await service.getFundamentalSnapshot!({ symbol: '510300' });

        expect(snapshot.summary).toContain('AkShare 底层指数 PE/股息率估值');
        expect(snapshot.summary).toContain('PB 未覆盖');
    });

    test('passes northbound caveat snapshots through flow/sentiment RPC', async () => {
        const fixture = loadResearchProviderFixture<{
            fetchFlowSentiment: { result: Record<string, unknown> };
        }>('research-provider-wire-shape.json');
        const fetchFlowSentiment = vi.fn(async () => fixture.fetchFlowSentiment.result);
        const service = createResearchProviderServices({
            dataServices: createDataServices([buildAsset()]),
            marketDataPort: { fetchFlowSentiment } as unknown as MarketDataPort,
        });

        const snapshot = await service.getFlowSentimentSnapshot!({ symbol: '600519' });

        expect(fetchFlowSentiment).toHaveBeenCalledWith(expect.objectContaining({
            assetMetadata: expect.objectContaining({ market: 'A', tsCode: '600519.SH' }),
            enabledProviders: ['tushare', 'akshare'],
            market: 'A',
            symbol: '600519',
        }));
        expect(snapshot.status).toBe('degraded');
        expect(snapshot.warnings).toContain('northboundNetInflow is best-effort after 2024 disclosure changes.');
        expect(snapshot.payload).toEqual(expect.objectContaining({
            signals: expect.objectContaining({
                flow: expect.objectContaining({ northboundAvailabilityCaveat: 'disclosure_policy_change_2024' }),
            }),
        }));
    });

    test('keeps unresolved market explicit instead of guessing in the service layer', async () => {
        const fetchFlowSentiment = vi.fn(async () => ({
            asOf: null,
            attemptedSources: ['akshare'],
            dataProvenance: [],
            market: null,
            providerErrors: [],
            qualityStatus: 'unavailable' as const,
            signals: {},
            symbol: 'UNKNOWN',
            warnings: ['Flow/sentiment request requires a resolved market.'],
        }));
        const service = createResearchProviderServices({
            dataServices: createDataServices([]),
            marketDataPort: { fetchFlowSentiment } as unknown as MarketDataPort,
        });

        const snapshot = await service.getFlowSentimentSnapshot!({ symbol: 'UNKNOWN' });

        expect(fetchFlowSentiment).toHaveBeenCalledWith(expect.objectContaining({
            enabledProviders: ['akshare'],
            market: null,
            symbol: 'UNKNOWN',
        }));
        expect(snapshot.warnings).toContain('Unable to resolve market for UNKNOWN; pass explicit market or add the asset first.');
    });

    test('backs macro snapshots with existing fx and price providers', async () => {
        const fetchFxRates = vi.fn(async () => ({
            attemptedSources: ['frankfurter'],
            pair: 'USD/CNY',
            rates: [{ date: '2026-05-08', rate: 7.1, source: 'frankfurter' }],
            warnings: [],
        }));
        const fetchPrices = vi.fn(async () => ({
            attemptedSources: ['yfinance'],
            prices: [{ adjusted_close: 18.2, close: 18.3, date: '2026-05-08', high: 18.5, low: 18.0, open: 18.1, source: 'yfinance', volume: 1000 }],
            symbol: '^VIX',
            warnings: [],
        }));
        const service = createResearchProviderServices({
            dataServices: createDataServices([]),
            marketDataPort: { fetchFxRates, fetchPrices } as unknown as MarketDataPort,
        });

        const snapshot = await service.getMacroSeriesSnapshot!({ symbols: ['USDCNY', 'VIX'] });

        expect(fetchFxRates).toHaveBeenCalledWith(expect.objectContaining({
            enabledSources: ['akshare', 'yfinance', 'frankfurter'],
            pair: 'USD/CNY',
        }));
        expect(fetchPrices).toHaveBeenCalledWith(expect.objectContaining({
            enabledSources: ['yfinance'],
            market: 'US',
            symbol: '^VIX',
        }));
        expect(snapshot.status).toBe('available');
        expect(snapshot.providerIds).toEqual(['frankfurter', 'yfinance']);
        expect(snapshot.summary).toContain('宏观序列快照可用');
    });
});