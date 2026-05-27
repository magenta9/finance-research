export interface PingResponse {
  message: 'pong';
  appVersion: string;
  timestamp: string;
}

export interface NativeCheckResponse {
  driver: 'better-sqlite3';
  sqliteVersion: string;
  memoryDbReady: boolean;
}

export interface DummyPythonResponse {
  command: string;
  exitCode: number;
  scriptPath: string;
  stderr: string;
  stdout: string;
}

export interface MetadataBackfillStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  scannedAssets: number;
  updatedAssets: number;
  failedAssets: number;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface RuntimeStatusResponse {
  sidecarReady: boolean;
  sidecarPid: number | null;
  sidecarPort: number | null;
  lastError: string | null;
  logDir: string | null;
  metadataBackfill?: MetadataBackfillStatus;
  quantData?: QuantDataRuntimeStatus;
}

export interface QuantDataProviderConfigurationStatus {
  ready: boolean;
  code: string | null;
  message: string | null;
}

export interface QuantDataRuntimeStatus {
  ready: boolean;
  lastError: string | null;
  providerConfiguration: QuantDataProviderConfigurationStatus;
  stats?: {
    priceRowCount?: number;
    fxRateRowCount?: number;
    latestPriceFetchAt?: string | null;
  };
  storePath?: string;
  storeVersion?: number;
}

export type RuntimeMode = 'electron' | 'browser-live';

export interface RuntimeConfig {
  sidecarUrl: string;
  lastConnectedAt: string | null;
  lastConnectionError: string | null;
  lastInitializationError: string | null;
}

export interface RuntimeCapabilities {
  hasNativeFileDialog: boolean;
  hasKeytarSecrets: boolean;
  hasNativeNotifications: boolean;
  hasSidecarAutoStart: boolean;
}

export interface SidecarValidationResult {
  ok: boolean;
  error?: string;
}

export interface ProviderValidationResult {
  ok: boolean;
  error?: string;
  availableModels?: string[];
}
