import { describe, expect, test, vi } from 'vitest';

import { preferenceKeys } from '../preferences/preference-keys';
import {
  buildMarketDataPriceRows,
  createInMemoryDataServices,
  createTestMarketDataOrchestrator,
} from './market-data-test-support';

describe('MarketDataOrchestrator smoke', () => {
  test('delegates asset lookup through the adapter with enabled sources', async () => {
    const { services } = createInMemoryDataServices();
    services.repositories.preferencesRepository.set(preferenceKeys.dataSource.akshareEnabled, 'false');
    const call = vi.fn(async () => ([{
      assetClass: 'equity',
      currency: 'USD',
      market: 'US',
      metadata: {},
      name: 'SPDR S&P 500 ETF Trust',
      source: 'yfinance',
      symbol: 'SPY',
    }]));
    const service = createTestMarketDataOrchestrator({ call, services });

    await expect(service.lookup({ market: 'US', query: 'SPY' })).resolves.toEqual([
      expect.objectContaining({ symbol: 'SPY', source: 'yfinance' }),
    ]);
    expect(call).toHaveBeenCalledWith('search_assets', {
      enabledSources: ['yfinance'],
      market: 'US',
      query: 'SPY',
    });
  });

  test('exposes sync status and cache helpers through composed subservices', () => {
    const { services } = createInMemoryDataServices();
    const service = createTestMarketDataOrchestrator({ services });

    services.repositories.assetRepository.create({
      assetClass: 'equity',
      currency: 'USD',
      id: 'asset-spy',
      market: 'US',
      metadata: {},
      name: 'SPDR S&P 500 ETF Trust',
      symbol: 'SPY',
      tags: [],
    });
    services.repositories.priceRepository.insertMany(
      buildMarketDataPriceRows({
        assetId: 'asset-spy',
        dates: ['2026-01-02', '2026-01-03'],
        source: 'yfinance',
      }),
    );
    services.repositories.fxRateRepository.insertMany([
      {
        date: '2026-01-02',
        pair: 'USD/CNY',
        rate: 7.11,
        source: 'fx-test',
      },
    ]);

    const seenStatuses: Array<{ queuedTasks: number; running: boolean }> = [];
    const unsubscribe = service.subscribeSyncStatus((status) => {
      seenStatuses.push({ queuedTasks: status.queuedTasks, running: status.running });
    });
    unsubscribe();

    expect(seenStatuses[0]).toEqual({ queuedTasks: 0, running: false });
    expect(service.getCacheSummary()).toMatchObject({
      assetCount: 1,
      fxRateRowCount: 1,
      latestPriceFetchAt: '2026-01-12T00:00:00.000Z',
      priceRowCount: 2,
    });
    expect(service.clearCache()).toEqual({
      cacheSummary: {
        assetCount: 1,
        fxRateRowCount: 0,
        latestPriceFetchAt: null,
        priceRowCount: 0,
      },
      syncStatus: expect.objectContaining({
        activeTask: null,
        queuedTasks: 0,
        running: false,
      }),
    });
  });
});
