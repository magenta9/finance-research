import type { DataServices } from '../db/services';
import type { LoggerLike } from '../logger';
import { HistorySyncScheduler } from './history-sync-scheduler';
import { MarketDataOrchestrator } from './market-data-orchestrator';
import { createMarketDataServices, type MarketDataServices } from './market-data-service';
import type { SidecarManager } from './manager';
import { SidecarRuntime } from './runtime';
import { SidecarMarketDataAdapter } from './sidecar-market-data-adapter';
import { SyncQueue } from './sync-queue';
import { QuantDataMarketDataAdapter, QuantDataMarketDataPort } from '../quant-data/market-data-adapter';

export interface MarketDataRuntimeGroup {
    historySyncScheduler: HistorySyncScheduler;
    orchestrator: MarketDataOrchestrator;
    services: MarketDataServices;
    quantData: QuantDataMarketDataAdapter;
    sidecarManager: SidecarManager;
    sidecarRuntime: SidecarRuntime;
}

export const createMarketDataRuntimeGroup = ({
    dataServices,
    logger,
    sidecarManager,
    syncQueue = new SyncQueue(),
}: {
    dataServices: DataServices;
    logger?: LoggerLike;
    sidecarManager: SidecarManager;
    syncQueue?: SyncQueue;
}): MarketDataRuntimeGroup => {
    const sidecarRuntime = new SidecarRuntime(sidecarManager);
    const sidecarMarketDataPort = new SidecarMarketDataAdapter(sidecarRuntime);
    const quantData = new QuantDataMarketDataAdapter();
    const marketDataPort = new QuantDataMarketDataPort({ fallback: sidecarMarketDataPort, quantData });
    const services = createMarketDataServices({
        dataServices,
        logger,
        marketDataPort,
        sidecarRuntime,
        syncQueue,
    });
    const orchestrator = new MarketDataOrchestrator(dataServices, services);

    return {
        historySyncScheduler: new HistorySyncScheduler(orchestrator, logger),
        orchestrator,
        quantData,
        services,
        sidecarManager,
        sidecarRuntime,
    };
};