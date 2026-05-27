import type {
  AssetInput,
  AssetSeriesAnalyticsRequest,
  DailyPriceRecord,
  AssetMetricsRequest,
  PricePatternAnalogSearchRequest,
  PositionImportRow,
  PositionInput,
  PriceRangeQuery,
  PriceSyncRequest,
} from '@quantdesk/shared';

import type { Repositories } from '../db/repositories';
import type { LoggerLike } from '../logger';
import type { CacheService } from '../sidecar/cache-service';
import type { CsvImportService } from '../sidecar/csv-import-service';
import type { PriceSyncService } from '../sidecar/price-sync-service';
import type { MarketDataPublicApi } from '../sidecar/market-data-orchestrator';
import type { E2eProbeStrategy } from './e2e-probe';
import type { ContractBinder } from './contract-binder';
import { computeSingleAssetMetrics } from '../portfolio/statistics';
import { computeAssetSeriesAnalytics } from '../portfolio/series-analytics';
import { searchPricePatternAnalogs } from '../portfolio/price-analog/search';

export interface CreateDataHandlersOptions {
  assetLookupService?: Pick<MarketDataPublicApi, 'lookup'>;
  assetRepository: Pick<Repositories['assetRepository'], 'create' | 'delete' | 'list' | 'search' | 'update'>;
  cacheService?: Pick<CacheService, 'clearCache' | 'getCacheSummary'>;
  csvImportService?: Pick<CsvImportService, 'importAssetsCsv' | 'importPositionsCsv' | 'importPricesCsv'>;
  e2eProbe?: E2eProbeStrategy | null;
  fxRateRepository: Pick<Repositories['fxRateRepository'], 'clearAll' | 'count'>;
  logger?: LoggerLike;
  marketDataOrchestrator?: Pick<MarketDataPublicApi, 'ensure'>;
  positionRepository: Pick<Repositories['positionRepository'], 'delete' | 'listByPortfolio' | 'save'>;
  priceReadService?: {
    getRange: (query: PriceRangeQuery) => Promise<DailyPriceRecord[]> | DailyPriceRecord[];
    listByAsset: (assetId: string) => Promise<DailyPriceRecord[]> | DailyPriceRecord[];
  };
  priceRepository: Pick<Repositories['priceRepository'], 'clearAll' | 'count' | 'getLatestFetchedAt' | 'getRange' | 'listByAsset'>;
  priceSyncService?: Pick<PriceSyncService, 'getSyncStatus' | 'syncFxRates' | 'syncPrices'>;
}

export const createDataHandlers = ({
  assetLookupService,
  assetRepository,
  cacheService,
  csvImportService,
  e2eProbe,
  fxRateRepository,
  logger,
  marketDataOrchestrator,
  positionRepository,
  priceReadService,
  priceRepository,
  priceSyncService,
}: CreateDataHandlersOptions) => {
  const getPriceRange = async (query: PriceRangeQuery) => await (priceReadService?.getRange(query) ?? priceRepository.getRange(query));
  const listPricesByAsset = async (assetId: string) => await (priceReadService?.listByAsset(assetId) ?? priceRepository.listByAsset(assetId));

  return {
    getAssets: () => assetRepository.list(),
    addAsset: (asset: AssetInput) => {
      if (!marketDataOrchestrator) {
        throw new Error('Market data public API is required before assets can be added.');
      }

      const created = assetRepository.create(asset);
      void marketDataOrchestrator.ensure({
        assetId: created.id,
        horizon: '30y',
        intent: 'asset-history',
        priority: 'background',
      });
      return created;
    },
    updateAsset: (asset: AssetInput) => assetRepository.update(asset),
    deleteAsset: (id: string) => assetRepository.delete(id),
    searchAssets: (query: string) => assetRepository.search(query),
    lookupAssets: (query: string, market?: string) => {
      if (e2eProbe?.isEnabled) {
        return e2eProbe.lookupAssets(query, market);
      }

      if (!assetLookupService) {
        throw new Error('Market data service is not available.');
      }

      return assetLookupService.lookup({ market, query });
    },
    importAssetsCsv: (csvText: string) => {
      if (e2eProbe?.isEnabled) {
        return e2eProbe.importAssetsCsv(csvText);
      }

      if (!csvImportService) {
        throw new Error('Market data service is not available.');
      }

      return csvImportService.importAssetsCsv(csvText);
    },
    syncPrices: (request: PriceSyncRequest) => {
      if (!priceSyncService) {
        throw new Error('Market data service is not available.');
      }

      return priceSyncService.syncPrices(request);
    },
    importPricesCsv: (assetId: string, csvText: string) => {
      if (!csvImportService) {
        throw new Error('Market data service is not available.');
      }

      return csvImportService.importPricesCsv(assetId, csvText);
    },
    getPrices: (assetId: string) => listPricesByAsset(assetId),
    getPriceRange: (query: PriceRangeQuery) =>
      getPriceRange(query),
    getAssetMetrics: async (request: AssetMetricsRequest) => {
      const asset = assetRepository.list().find((entry) => entry.id === request.assetId);

      if (!asset) {
        throw new Error(`Asset not found: ${request.assetId}`);
      }

      const prices = await getPriceRange({
        assetId: request.assetId,
        endDate: request.endDate,
        startDate: request.startDate,
      });

      return computeSingleAssetMetrics({
        currency: asset.currency,
        prices: prices.map((price) => ({
          adjustedClose: price.adjustedClose,
          close: price.close,
          date: price.date,
          source: price.source,
        })),
      });
    },
    getAssetSeriesAnalytics: async (request: AssetSeriesAnalyticsRequest) => {
      const asset = assetRepository.list().find((entry) => entry.id === request.assetId);

      if (!asset) {
        throw new Error(`Asset not found: ${request.assetId}`);
      }

      const prices = await listPricesByAsset(request.assetId);
      const analytics = computeAssetSeriesAnalytics({
        channelWidthSigma: request.channelWidthSigma,
        displayEndDate: request.displayEndDate,
        displaySeriesMode: request.displaySeriesMode,
        displayStartDate: request.displayStartDate,
        includeRegression: request.includeRegression,
        prices: prices.map((price) => ({
          adjustedClose: price.adjustedClose,
          close: price.close,
          date: price.date,
          source: price.source,
        })),
        regressionWindow: request.regressionWindow,
        volWindow: request.volWindow,
      });

      if (analytics.regression.regressionSkippedNonPositiveCount > 0) {
        logger?.warn('main', 'Asset series regression skipped non-positive samples.', {
          assetId: request.assetId,
          regressionWindow: request.regressionWindow,
          skippedCount: analytics.regression.regressionSkippedNonPositiveCount,
        });
      }

      return analytics;
    },
    searchPricePatternAnalogs: (request: PricePatternAnalogSearchRequest) => searchPricePatternAnalogs({
      dependencies: {
        assetRepository,
        priceRepository,
      },
      request,
    }),
    syncFxRates: (pairs: string[], startDate: string, endDate?: string) => {
      if (!priceSyncService) {
        return {
          insertedRows: 0,
          pairs,
          warnings: [],
        };
      }

      return priceSyncService.syncFxRates(pairs, startDate, endDate);
    },
    getSyncStatus: () => {
      if (!priceSyncService) {
        return {
          activeTask: null,
          completedTasks: 0,
          failedTasks: 0,
          lastWarning: null,
          queuedTasks: 0,
          recentEvents: [],
          running: false,
        };
      }

      return priceSyncService.getSyncStatus();
    },
    getPositions: (portfolioName?: string) =>
      positionRepository.listByPortfolio(portfolioName),
    getCacheSummary: () => {
      if (!cacheService) {
        return {
          assetCount: assetRepository.list().length,
          fxRateRowCount: fxRateRepository.count(),
          latestPriceFetchAt: priceRepository.getLatestFetchedAt(),
          priceRowCount: priceRepository.count(),
        };
      }

      return cacheService.getCacheSummary();
    },
    clearCache: () => {
      if (!cacheService) {
        priceRepository.clearAll();
        fxRateRepository.clearAll();
        return {
          cacheSummary: {
            assetCount: assetRepository.list().length,
            fxRateRowCount: 0,
            latestPriceFetchAt: null,
            priceRowCount: 0,
          },
          syncStatus: {
            activeTask: null,
            completedTasks: 0,
            failedTasks: 0,
            lastWarning: null,
            queuedTasks: 0,
            recentEvents: [],
            running: false,
          },
        };
      }

      return cacheService.clearCache();
    },
    updatePosition: (position: PositionInput) =>
      positionRepository.save(position),
    deletePosition: (id: string) => positionRepository.delete(id),
    importPositionsCsv: (rows: PositionImportRow[]) => {
      if (!csvImportService) {
        throw new Error('Market data service is not available.');
      }

      return csvImportService.importPositionsCsv(rows);
    },
  };
};

export const registerDataIpc = (
  binder: ContractBinder,
  options: CreateDataHandlersOptions,
) => {
  binder.registerInvokeNamespace('data', createDataHandlers(options));
};
