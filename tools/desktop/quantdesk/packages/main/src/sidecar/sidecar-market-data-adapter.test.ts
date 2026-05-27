import { describe, expect, test, vi } from 'vitest';

import { loadMarketDataFixture } from './market-data-contracts';
import { SidecarMarketDataAdapter } from './sidecar-market-data-adapter';

describe('sidecar market data adapter', () => {
    test('maps typed requests onto the shared sidecar wire shapes', async () => {
        const fixture = loadMarketDataFixture<{
            fetchFxRates: { method: string; params: Record<string, unknown>; result: Record<string, unknown> };
            fetchPrices: { method: string; params: Record<string, unknown>; result: Record<string, unknown> };
            searchAssets: { method: string; params: Record<string, unknown>; result: Array<Record<string, unknown>> };
        }>('wire-shape.json');
        const newsFixture = loadMarketDataFixture<{
            fetchMarketSource: { method: string; params: Record<string, unknown>; result: Record<string, unknown> };
            searchAnnouncements: { method: string; params: Record<string, unknown>; result: Array<Record<string, unknown>> };
            searchNewsCatalysts: { method: string; params: Record<string, unknown>; result: Record<string, unknown> };
        }>('news-catalyst-wire-shape.json');
        const researchProviderFixture = loadMarketDataFixture<{
            fetchFlowSentiment: { method: string; params: Record<string, unknown>; result: Record<string, unknown> };
            fetchFundamentals: { method: string; params: Record<string, unknown>; result: Record<string, unknown> };
        }>('research-provider-wire-shape.json');
        const sidecarManager = {
            call: vi.fn(async (method: string) => {
                if (method === fixture.searchAssets.method) {
                    return fixture.searchAssets.result;
                }

                if (method === fixture.fetchPrices.method) {
                    return fixture.fetchPrices.result;
                }

                if (method === fixture.fetchFxRates.method) {
                    return fixture.fetchFxRates.result;
                }

                if (method === newsFixture.searchNewsCatalysts.method) {
                    return newsFixture.searchNewsCatalysts.result;
                }

                if (method === newsFixture.searchAnnouncements.method) {
                    return newsFixture.searchAnnouncements.result;
                }

                if (method === newsFixture.fetchMarketSource.method) {
                    return newsFixture.fetchMarketSource.result;
                }

                if (method === researchProviderFixture.fetchFundamentals.method) {
                    return researchProviderFixture.fetchFundamentals.result;
                }

                if (method === researchProviderFixture.fetchFlowSentiment.method) {
                    return researchProviderFixture.fetchFlowSentiment.result;
                }

                throw new Error(`Unexpected method ${method}`);
            }),
        };
        const adapter = new SidecarMarketDataAdapter(sidecarManager as never);

        await expect(adapter.searchAssets({
            enabledSources: fixture.searchAssets.params.enabledSources as Array<'akshare' | 'yfinance'>,
            market: fixture.searchAssets.params.market as string,
            query: fixture.searchAssets.params.query as string,
        })).resolves.toEqual(fixture.searchAssets.result);
        await expect(adapter.fetchPrices({
            enabledSources: fixture.fetchPrices.params.enabledSources as Array<'akshare' | 'yfinance'>,
            end: fixture.fetchPrices.params.end as string,
            market: fixture.fetchPrices.params.market as string,
            start: fixture.fetchPrices.params.start as string,
            symbol: fixture.fetchPrices.params.symbol as string,
        })).resolves.toEqual(fixture.fetchPrices.result);
        await expect(adapter.fetchFxRates({
            enabledSources: fixture.fetchFxRates.params.enabledSources as Array<'akshare' | 'frankfurter' | 'yfinance'>,
            end: fixture.fetchFxRates.params.end as string,
            pair: fixture.fetchFxRates.params.pair as string,
            start: fixture.fetchFxRates.params.start as string,
        })).resolves.toEqual(fixture.fetchFxRates.result);
        await expect(adapter.searchNewsCatalysts({
            enabledProviders: newsFixture.searchNewsCatalysts.params.enabledProviders as Array<'sec_edgar'>,
            lookaheadDays: newsFixture.searchNewsCatalysts.params.lookaheadDays as number,
            lookbackDays: newsFixture.searchNewsCatalysts.params.lookbackDays as number,
            market: newsFixture.searchNewsCatalysts.params.market as string,
            query: newsFixture.searchNewsCatalysts.params.query as string,
            symbol: newsFixture.searchNewsCatalysts.params.symbol as string,
        })).resolves.toEqual(newsFixture.searchNewsCatalysts.result);
        await expect(adapter.searchAnnouncements({
            enabledProviders: newsFixture.searchAnnouncements.params.enabledProviders as Array<'cninfo' | 'eastmoney_notice'>,
            market: newsFixture.searchAnnouncements.params.market as string,
            query: newsFixture.searchAnnouncements.params.query as string,
            symbol: newsFixture.searchAnnouncements.params.symbol as string,
        })).resolves.toEqual(newsFixture.searchAnnouncements.result);
        await expect(adapter.fetchMarketSource({
            sourceId: newsFixture.fetchMarketSource.params.sourceId as string,
            url: newsFixture.fetchMarketSource.params.url as string,
        })).resolves.toEqual(newsFixture.fetchMarketSource.result);
        await expect(adapter.fetchFundamentals({
            assetMetadata: researchProviderFixture.fetchFundamentals.params.assetMetadata as Record<string, unknown>,
            enabledProviders: researchProviderFixture.fetchFundamentals.params.enabledProviders as Array<'akshare' | 'tushare'>,
            market: researchProviderFixture.fetchFundamentals.params.market as string,
            symbol: researchProviderFixture.fetchFundamentals.params.symbol as string,
        })).resolves.toEqual(researchProviderFixture.fetchFundamentals.result);
        await expect(adapter.fetchFlowSentiment({
            assetMetadata: researchProviderFixture.fetchFlowSentiment.params.assetMetadata as Record<string, unknown>,
            enabledProviders: researchProviderFixture.fetchFlowSentiment.params.enabledProviders as Array<'akshare' | 'tushare'>,
            market: researchProviderFixture.fetchFlowSentiment.params.market as string,
            symbol: researchProviderFixture.fetchFlowSentiment.params.symbol as string,
        })).resolves.toEqual(researchProviderFixture.fetchFlowSentiment.result);

        expect(sidecarManager.call).toHaveBeenNthCalledWith(1, fixture.searchAssets.method, fixture.searchAssets.params);
        expect(sidecarManager.call).toHaveBeenNthCalledWith(2, fixture.fetchPrices.method, fixture.fetchPrices.params);
        expect(sidecarManager.call).toHaveBeenNthCalledWith(3, fixture.fetchFxRates.method, fixture.fetchFxRates.params);
        expect(sidecarManager.call).toHaveBeenNthCalledWith(4, newsFixture.searchNewsCatalysts.method, newsFixture.searchNewsCatalysts.params);
        expect(sidecarManager.call).toHaveBeenNthCalledWith(5, newsFixture.searchAnnouncements.method, newsFixture.searchAnnouncements.params);
        expect(sidecarManager.call).toHaveBeenNthCalledWith(6, newsFixture.fetchMarketSource.method, newsFixture.fetchMarketSource.params);
        expect(sidecarManager.call).toHaveBeenNthCalledWith(7, researchProviderFixture.fetchFundamentals.method, researchProviderFixture.fetchFundamentals.params);
        expect(sidecarManager.call).toHaveBeenNthCalledWith(8, researchProviderFixture.fetchFlowSentiment.method, researchProviderFixture.fetchFlowSentiment.params);
    });
});