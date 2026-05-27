import path from 'node:path';

import { app, ipcMain, shell, webContents } from 'electron';

import {
  type LogWriteInput,
  type QuantDataRuntimeStatus,
} from '@quantdesk/shared';

import {
  createDefaultSystemDependencies,
  registerSystemIpc,
  type SystemHandlers,
  createSystemHandlers,
} from './system';
import { createRuntimeHandlers, registerRuntimeIpc } from './runtime';
import { registerDataIpc } from './data';
import { createE2eProbe } from './e2e-probe';
import { registerPiAgentIpc } from './pi-agent';
import { registerPiRuntimeIpc } from './pi-runtime';
import { registerPortfolioIpc } from './portfolio';
import { registerResearchIpc } from './research';
import { registerSecretsIpc } from './secrets';
import { registerSettingsIpc } from './settings';
import type { DataServices } from '../db/services';
import type { LoggerLike } from '../logger';
import type { MarketDataPublicApi } from '../sidecar/market-data-orchestrator';
import type { MarketDataServices } from '../sidecar/market-data-service';
import { createContractBinder, type IpcHandlerMap } from './contract-binder';
import { createPiRiskGatePreferences } from '../pi/preferences';
import type { AgentRuntimeGroup, PiRuntimeGroup } from '../runtime-services';
import type { MarketDataRuntimeGroup } from '../sidecar/runtime-group';

export interface IpcRegistrar {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ) => void;
  on?: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ) => void;
}

export interface RegisterIpcRuntime {
  agent?: Pick<AgentRuntimeGroup, 'portfolioEngine'>;
  marketData?: {
    orchestrator: MarketDataPublicApi;
    quantData?: Pick<MarketDataRuntimeGroup['quantData'], 'getStatus'>;
    services: Pick<MarketDataServices, 'cacheService' | 'csvImportService' | 'metadataBackfillService' | 'priceSyncService'>;
    sidecarRuntime: Pick<MarketDataRuntimeGroup['sidecarRuntime'], 'snapshot'>;
  };
  pi?: Pick<PiRuntimeGroup, 'manager'>;
}

export interface RegisterIpcHandlersOptions {
  dataServices: DataServices;
  registrar?: IpcRegistrar;
  systemHandlers?: SystemHandlers;
  runtime?: RegisterIpcRuntime;
  logger?: LoggerLike;
  eventBroadcast?: (channel: string, payload: unknown) => void;
  isAssetsPoolE2eProbeEnabled?: boolean;
}

const resolveDummyScriptPath = () =>
  app.isPackaged
    ? path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'sidecar',
      'scripts',
      'dummy.py',
    )
    : path.resolve(__dirname, '../../../sidecar/scripts/dummy.py');

export const registerIpcHandlers = ({
  registrar = ipcMain,
  dataServices,
  systemHandlers,
  runtime,
  logger,
  eventBroadcast,
  isAssetsPoolE2eProbeEnabled,
}: RegisterIpcHandlersOptions) => {
  const agentRuntime = runtime?.agent;
  const marketDataRuntime = runtime?.marketData;
  const piRuntime = runtime?.pi;
  const metadataBackfillService = marketDataRuntime?.services.metadataBackfillService;
  const priceSyncService = marketDataRuntime?.services.priceSyncService;

  if (runtime && !marketDataRuntime) {
    throw new Error('RegisterIpcRuntime.marketData is required when registering production IPC runtime dependencies.');
  }

  const parseSidecarPort = (endpoint: string | null) => {
    if (!endpoint) {
      return null;
    }

    try {
      return Number.parseInt(new URL(endpoint).port, 10) || null;
    } catch (error) {
      void error;
      return null;
    }
  };

  const resolveQuantDataStatus = async (): Promise<QuantDataRuntimeStatus> => {
    if (!marketDataRuntime?.quantData) {
      return {
        lastError: null,
        providerConfiguration: {
          code: 'RUNTIME_UNAVAILABLE',
          message: 'quant-data runtime is not configured.',
          ready: false,
        },
        ready: false,
      };
    }

    try {
      const status = await marketDataRuntime.quantData.getStatus();
      const providerConfiguration = status.providerConfiguration ?? {
        code: null,
        message: null,
        ready: true,
      };

      return {
        lastError: null,
        providerConfiguration,
        ready: providerConfiguration.ready,
        stats: status.stats,
        storePath: status.storePath,
        storeVersion: status.storeVersion,
      };
    } catch (error) {
      return {
        lastError: error instanceof Error ? error.message : String(error),
        providerConfiguration: {
          code: 'STATUS_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
          ready: false,
        },
        ready: false,
      };
    }
  };

  const resolvedSystemHandlers =
    systemHandlers ??
    createSystemHandlers(
      {
        ...createDefaultSystemDependencies(() => app.getVersion(), resolveDummyScriptPath),
        getRuntimeStatus: async () => ({
          lastError: marketDataRuntime?.sidecarRuntime.snapshot().lastError?.message ?? null,
          sidecarPid: marketDataRuntime?.sidecarRuntime.snapshot().pid ?? null,
          sidecarPort: parseSidecarPort(marketDataRuntime?.sidecarRuntime.snapshot().endpoint ?? null),
          sidecarReady: marketDataRuntime?.sidecarRuntime.snapshot().healthy ?? false,
          logDir: logger?.getLogDirectory() ?? null,
          metadataBackfill: metadataBackfillService?.getMetadataBackfillStatus(),
          quantData: await resolveQuantDataStatus(),
        }),
      },
    );
  const runtimeHandlers = createRuntimeHandlers({
    getSidecarStatus: () => ({
      sidecarPort: parseSidecarPort(marketDataRuntime?.sidecarRuntime.snapshot().endpoint ?? null),
    }),
    preferences: dataServices.repositories.preferencesRepository,
  });

  const broadcastEvent = (channel: string, payload: unknown) => {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() !== 'window') {
        continue;
      }

      contents.send(channel, payload);
    }

    eventBroadcast?.(channel, payload);
  };

  const { binder, getHandlerMap } = createContractBinder({ broadcastEvent });
  const piRiskGatePreferences = createPiRiskGatePreferences(dataServices.repositories.preferencesRepository);

  binder.registerSendNamespace('log', {
    write: (entry: LogWriteInput) => {
      logger?.write(entry);
    },
    writeBatch: (entries: LogWriteInput[]) => {
      for (const entry of entries) {
        logger?.write(entry);
      }
    },
  });
  binder.registerInvokeNamespace('log', {
    openDirectory: async () => {
      const targetPath = logger?.getLogDirectory() ?? app.getPath('userData');
      await shell.openPath(targetPath);
    },
  });
  registerSystemIpc(binder, resolvedSystemHandlers);
  registerRuntimeIpc(binder, runtimeHandlers);
  registerDataIpc(binder, {
    assetLookupService: marketDataRuntime?.orchestrator,
    assetRepository: dataServices.repositories.assetRepository,
    cacheService: marketDataRuntime?.services.cacheService,
    csvImportService: marketDataRuntime?.services.csvImportService,
    e2eProbe: createE2eProbe(
      dataServices.repositories.assetRepository,
      isAssetsPoolE2eProbeEnabled ?? false,
    ),
    fxRateRepository: dataServices.repositories.fxRateRepository,
    logger,
    marketDataOrchestrator: marketDataRuntime?.orchestrator,
    positionRepository: dataServices.repositories.positionRepository,
    priceRepository: dataServices.repositories.priceRepository,
    priceSyncService,
  });
  registerPortfolioIpc(binder, agentRuntime?.portfolioEngine);
  registerPiAgentIpc(binder, piRuntime?.manager, piRiskGatePreferences);
  registerPiRuntimeIpc(binder, piRuntime?.manager, piRiskGatePreferences);
  registerResearchIpc(binder, dataServices, marketDataRuntime?.orchestrator, piRuntime?.manager, piRiskGatePreferences);
  registerSettingsIpc(binder, dataServices);
  registerSecretsIpc(binder, dataServices);

  if (priceSyncService?.subscribeSyncStatus) {
    binder.bindSubscription('data', 'subscribeSyncStatus', (listener) =>
      priceSyncService.subscribeSyncStatus(listener));
  }

  const bindIpcTransport = (
    transport: 'invoke' | 'send',
    bindings: Record<string, (event: unknown, ...args: unknown[]) => unknown>,
  ) => {
    for (const [channel, binding] of Object.entries(bindings)) {
      if (transport === 'invoke') {
        registrar.handle(channel, binding);
        continue;
      }

      registrar.on?.(channel, binding as (event: unknown, ...args: unknown[]) => void);
    }
  };

  const { invoke: invokeHandlers, send: sendHandlers } = getHandlerMap();

  bindIpcTransport('send', sendHandlers);
  bindIpcTransport('invoke', invokeHandlers);

  return {
    invoke: invokeHandlers,
    send: sendHandlers,
  } satisfies IpcHandlerMap;
};
