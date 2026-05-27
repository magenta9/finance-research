import path from 'node:path';

import { app, BrowserWindow } from 'electron';

import type { LogLevel } from '@quantdesk/shared';
import { APP_NAME } from '@quantdesk/shared/constants';

import { createAppServices, type DataServices } from './db/services';
import { registerIpcHandlers } from './ipc/register';
import { runEnabledE2eProbes } from './e2e-probe-registry';
import { Logger } from './logger';
import { createRuntimeServices, type RuntimeServices } from './runtime-services';
import { createSecretStore } from './secrets/store';
import { WsBridgeServer } from './ipc/ws-bridge-server';
import { ensureElectronNativeModulesReady } from './native/electron-preflight';

let mainWindow: BrowserWindow | null = null;
let dataServices: DataServices | null = null;
let runtimeServices: RuntimeServices | null = null;
let logger: Logger | null = null;
let wsBridgeServer: WsBridgeServer | null = null;
let isQuitting = false;
let globalErrorHandlersRegistered = false;

const isSidecarE2eProbeEnabled = process.env.QUANTDESK_E2E_SIDECAR_PROBE === '1';
const isAssetsPoolE2eProbeEnabled = process.env.QUANTDESK_E2E_ASSETS_PROBE === '1';
const isAllocationE2eProbeEnabled = process.env.QUANTDESK_E2E_ALLOCATION_PROBE === '1';
const isPiAgentE2eProbeEnabled = process.env.QUANTDESK_E2E_PI_AGENT_PROBE === '1';
const isResearchE2eProbeEnabled = process.env.QUANTDESK_E2E_RESEARCH_PROBE === '1';
const shouldAutoStartSidecar = !isAllocationE2eProbeEnabled
  && !isAssetsPoolE2eProbeEnabled
  && !isPiAgentE2eProbeEnabled
  && !isResearchE2eProbeEnabled;
const shouldPrewarmKnownAssets = shouldAutoStartSidecar && !isSidecarE2eProbeEnabled;
const shouldScheduleHistorySync = shouldAutoStartSidecar && !isSidecarE2eProbeEnabled;
const shouldBackfillAssetMetadataAtStartup = shouldAutoStartSidecar && !isSidecarE2eProbeEnabled;

// Set the app name before Electron resolves userData during startup.
app.setName(APP_NAME);

const isLogLevel = (value: string | undefined): value is LogLevel => (
  value === 'debug'
  || value === 'info'
  || value === 'warn'
  || value === 'error'
  || value === 'fatal'
);

const resolveLogDir = () => {
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch (error) {
    console.warn('[main] Failed to resolve log directory.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const isNavigationAbortError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('ERR_ABORTED');
};

const exitFatal = () => {
  if (app.isReady()) {
    app.exit(1);
    return;
  }

  process.exit(1);
};

const registerGlobalErrorHandlers = () => {
  if (globalErrorHandlersRegistered) {
    return;
  }

  globalErrorHandlersRegistered = true;

  process.on('uncaughtException', (error) => {
    logger?.fatal('main', 'Uncaught exception', error);
    void (logger?.close() ?? Promise.resolve()).finally(exitFatal);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));

    if (isNavigationAbortError(error)) {
      logger?.info('main', 'Ignored aborted navigation rejection during dev reload', {
        error: error.message,
      });
      return;
    }

    logger?.error('main', 'Unhandled rejection', error);
  });
};

const createMainWindow = async () => {
  const preloadPath = path.resolve(__dirname, '../../preload/dist/index.js');

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1320,
    minHeight: 840,
    title: APP_NAME,
    backgroundColor: '#f4efe6',
    show: false,
    ...(process.platform === 'darwin'
      ? {
        simpleFullscreen: true,
        titleBarStyle: 'hidden' as const,
        trafficLightPosition: { x: 18, y: 12 },
      }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    try {
      await mainWindow.loadURL(devServerUrl);
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));

      if (!isNavigationAbortError(resolvedError)) {
        throw resolvedError;
      }

      logger?.info('main', 'Ignored aborted navigation during dev reload', {
        error: resolvedError.message,
      });
      return;
    }

    if (!isSidecarE2eProbeEnabled) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    return;
  }

  const rendererEntry = path.resolve(__dirname, '../../renderer/dist/index.html');
  await mainWindow.loadFile(rendererEntry);
};

const bootstrap = async () => {
  if (process.env.QUANTDESK_E2E_USER_DATA_PATH) {
    app.setPath('userData', process.env.QUANTDESK_E2E_USER_DATA_PATH);
  }

  logger = new Logger({
    logDir: resolveLogDir(),
    minLevel: isLogLevel(process.env.QUANTDESK_LOG_LEVEL)
      ? process.env.QUANTDESK_LOG_LEVEL
      : 'info',
  });
  registerGlobalErrorHandlers();
  ensureElectronNativeModulesReady({ isPackaged: app.isPackaged });

  dataServices = createAppServices({
    secretStore: createSecretStore(),
    userDataPath: app.getPath('userData'),
  });
  runtimeServices = createRuntimeServices({
    dataServices,
    isPackaged: app.isPackaged,
    logger,
    shouldSkipInteractiveSync: isAllocationE2eProbeEnabled ? () => true : undefined,
    userDataPath: app.getPath('userData'),
  });
  wsBridgeServer = new WsBridgeServer({ logger });
  const handlerMap = registerIpcHandlers({
    dataServices,
    eventBroadcast: (channel, payload) => wsBridgeServer?.broadcastEvent(channel, payload),
    logger,
    runtime: runtimeServices,
    isAssetsPoolE2eProbeEnabled,
  });

  if (!app.isPackaged) {
    wsBridgeServer.useHandlers(handlerMap);
    const bridgePort = await wsBridgeServer.start(
      Number.parseInt(
        process.env.QUANTDESK_WS_BRIDGE_PORT ?? process.env.VITE_WS_BRIDGE_PORT ?? '9876',
        10,
      ),
    );
    logger?.info('main', 'WS bridge listening', { bridgePort });
  }

  if (shouldAutoStartSidecar) {
    void runtimeServices.marketData.sidecarRuntime.ensureReady().catch((error) => {
      runtimeServices?.marketData.sidecarManager.recordError(error);
    });
  }

  if (shouldPrewarmKnownAssets) {
    void runtimeServices.marketData.orchestrator.ensure({ intent: 'maintenance', priority: 'background', scope: 'startup-prewarm' }).catch((error) => {
      logger?.warn('main', 'Background prewarm failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  if (shouldScheduleHistorySync) {
    runtimeServices.marketData.historySyncScheduler.start();
  }

  if (shouldBackfillAssetMetadataAtStartup) {
    void runtimeServices.marketData.orchestrator.backfillMetadataForKnownAssets().catch((error) => {
      logger?.warn('main', 'Startup asset metadata backfill failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  await createMainWindow();

  if (mainWindow) {
    runEnabledE2eProbes({
      app,
      logger,
      services: dataServices ?? undefined,
      window: mainWindow,
    });
  }
};

app.whenReady().then(bootstrap);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;

  void (async () => {
    try {
      await wsBridgeServer?.stop();
      runtimeServices?.marketData.historySyncScheduler.stop();
      await runtimeServices?.pi.manager.stop();
      await runtimeServices?.marketData.orchestrator.shutdown();
      await runtimeServices?.marketData.sidecarRuntime.stop();
      await runtimeServices?.agent.docsRagService.close();
      await logger?.close();
    } finally {
      wsBridgeServer = null;
      runtimeServices = null;
      dataServices?.close();
      dataServices = null;
      app.exit(0);
    }
  })();
});
