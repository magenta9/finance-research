import type { DataServices } from '../db/services';
import type { LoggerLike } from '../logger';
import { CacheService } from './cache-service';
import { CsvImportService } from './csv-import-service';
import { HistoryBackfillService } from './history-backfill-service';
import { MetadataBackfillService } from './metadata-backfill-service';
import type { MarketSourceService, ResearchProviderService } from '../agent/capabilities/finance';
import type { MarketDataPort } from './market-data-port';
import { createNewsCatalystServices } from './news-catalyst-services';
import { PriceSyncService } from './price-sync-service';
import { createResearchProviderServices } from './research-provider-services';
import type { SidecarRpc } from './runtime-types';
import { SidecarMarketDataAdapter } from './sidecar-market-data-adapter';
import { getEnabledSearchSources } from './provider-config';
import { SyncQueue } from './sync-queue';

export interface MarketDataServices {
    cacheService: CacheService;
    csvImportService: CsvImportService;
    historyBackfillService: HistoryBackfillService;
    marketDataPort: MarketDataPort;
    marketSourceService: MarketSourceService;
    metadataBackfillService: MetadataBackfillService;
    priceSyncService: PriceSyncService;
    researchProviderService: Pick<ResearchProviderService, 'getFlowSentimentSnapshot' | 'getFundamentalSnapshot' | 'getMacroSeriesSnapshot' | 'searchNewsCatalysts'>;
}

export const createMarketDataServices = ({
    dataServices,
    logger,
    sidecarRuntime,
    syncQueue = new SyncQueue(),
}: {
    dataServices: DataServices;
    logger?: LoggerLike;
    sidecarRuntime: SidecarRpc;
    syncQueue?: SyncQueue;
}): MarketDataServices => {
    const { assetRepository, fxRateRepository, positionRepository, preferencesRepository, priceRepository } = dataServices.repositories;
    const marketDataPort = new SidecarMarketDataAdapter(sidecarRuntime);
    const newsCatalystServices = createNewsCatalystServices({ dataServices, marketDataPort });
    const researchProviderServices = createResearchProviderServices({ dataServices, marketDataPort });
    const priceSyncService = new PriceSyncService(
        {
            assets: assetRepository,
            fxRates: fxRateRepository,
            preferences: preferencesRepository,
            prices: priceRepository,
        },
        marketDataPort,
        syncQueue,
        logger,
    );
    const csvImportService = new CsvImportService({
        assets: assetRepository,
        positions: positionRepository,
        prices: priceRepository,
    });
    const cacheService = new CacheService(
        { assets: assetRepository, fxRates: fxRateRepository, prices: priceRepository },
        () => priceSyncService.getSyncStatus(),
        logger,
    );
    const metadataBackfillService = new MetadataBackfillService(
        { assets: assetRepository },
        {
            lookupAssets: async (query, market) => await marketDataPort.searchAssets({
                enabledSources: getEnabledSearchSources(dataServices.repositories.preferencesRepository, market),
                market,
                query,
            }),
        },
        logger,
    );
    const historyBackfillService = new HistoryBackfillService(
        { assets: assetRepository, prices: priceRepository },
        {
            metadataBackfill: metadataBackfillService,
            priceSync: priceSyncService,
        },
        logger,
    );

    return {
        cacheService,
        csvImportService,
        historyBackfillService,
        marketDataPort,
        marketSourceService: newsCatalystServices.marketSourceService,
        metadataBackfillService,
        priceSyncService,
        researchProviderService: {
            ...newsCatalystServices.researchProviderService,
            ...researchProviderServices,
        },
    };
};