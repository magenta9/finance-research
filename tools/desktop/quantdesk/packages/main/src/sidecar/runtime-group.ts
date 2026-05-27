import type { DataServices } from '../db/services';
import type { LoggerLike } from '../logger';
import { HistorySyncScheduler } from './history-sync-scheduler';
import { MarketDataOrchestrator } from './market-data-orchestrator';
import { createMarketDataServices, type MarketDataServices } from './market-data-service';
import type { SidecarManager } from './manager';
import { SidecarRuntime } from './runtime';
import { SyncQueue } from './sync-queue';

export interface MarketDataRuntimeGroup {
    historySyncScheduler: HistorySyncScheduler;
    orchestrator: MarketDataOrchestrator;
    services: MarketDataServices;
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
    const services = createMarketDataServices({
        dataServices,
        logger,
        sidecarRuntime,
        syncQueue,
    });
    const orchestrator = new MarketDataOrchestrator(dataServices, services);

    return {
        historySyncScheduler: new HistorySyncScheduler(orchestrator, logger),
        orchestrator,
        services,
        sidecarManager,
        sidecarRuntime,
    };
};