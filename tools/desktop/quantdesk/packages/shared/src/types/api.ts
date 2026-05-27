import type {
  AssetLookupResult,
  CacheSummary,
  CacheResetResult,
  CsvImportResult,
  FxSyncSummary,
  PositionImportRow,
  PriceSyncRequest,
  PriceSyncSummary,
  SyncStatus,
} from './market';
import type {
  AllocationConstraints,
  AllocationStrategyMix,
  RebalanceCadence,
  AllocationResult,
  AllocationType,
} from './domain';
import type { LogWriteInput } from './logging';
import type {
  AssetSeriesAnalyticsRequest,
  AssetSeriesAnalyticsResult,
  AssetMetricsRequest,
  AssetMetricsResult,
  AllocationPlanInput,
  AllocationPlanRecord,
  AssetInput,
  DailyPriceRecord,
  PositionInput,
  PositionRecord,
  PreferenceMap,
  PriceRangeQuery,
  StoredAsset,
} from './persistence';
import type {
  PricePatternAnalogSearchRequest,
  PricePatternAnalogSearchResult,
} from './price-analog';
import type {
  DummyPythonResponse,
  NativeCheckResponse,
  PingResponse,
  ProviderValidationResult,
  RuntimeCapabilities,
  RuntimeConfig,
  RuntimeMode,
  RuntimeStatusResponse,
  SidecarValidationResult,
} from './system';
import type {
  PiAgentStreamEvent,
  PiCancelRunRequest,
  PiCancelRunResponse,
  PiDiscardAttachmentsRequest,
  PiSendMessageRequest,
  PiSendMessageResponse,
  PiStageAttachmentsResponse,
  PiSessionRecord,
  PiSessionSummary,
  PiSessionTranscript,
  PiSkillSummary,
} from './pi-agent';
import type {
  PiRiskGateState,
  PiRuntimeDirectoryTarget,
  PiRuntimeStatus,
} from './pi-runtime';
import type {
  ResearchArtifactRecord,
  ResearchCancelResponse,
  ResearchRequestListQuery,
  ResearchRequestListResponse,
  ResearchRequestInput,
  ResearchRequestRecord,
  ResearchStreamEvent,
  RiskProfileSnapshot,
} from './research';

export interface QuantdeskApi {
  log: {
    write: (entry: LogWriteInput) => void;
    writeBatch: (entries: LogWriteInput[]) => void;
    openDirectory: () => Promise<void>;
  };
  system: {
    ping: () => Promise<PingResponse>;
    checkNativeBindings: () => Promise<NativeCheckResponse>;
    runDummyPython: () => Promise<DummyPythonResponse>;
    getRuntimeStatus: () => Promise<RuntimeStatusResponse>;
  };
  runtime: {
    getMode: () => Promise<RuntimeMode>;
    getCapabilities: () => Promise<RuntimeCapabilities>;
    getConfig: () => Promise<RuntimeConfig>;
    updateConfig: (updates: Partial<RuntimeConfig>) => Promise<RuntimeConfig>;
    validateSidecarConnection: (input?: { sidecarUrl?: string }) => Promise<SidecarValidationResult>;
    validateProviderConnection: (provider: {
      baseUrl: string;
      model?: string;
    }) => Promise<ProviderValidationResult>;
  };
  data: {
    getAssets: () => Promise<StoredAsset[]>;
    addAsset: (asset: AssetInput) => Promise<StoredAsset>;
    updateAsset: (asset: AssetInput) => Promise<StoredAsset>;
    deleteAsset: (id: string) => Promise<boolean>;
    searchAssets: (query: string) => Promise<StoredAsset[]>;
    lookupAssets: (query: string, market?: string) => Promise<AssetLookupResult[]>;
    importAssetsCsv: (csvText: string) => Promise<CsvImportResult>;
    syncPrices: (request: PriceSyncRequest) => Promise<PriceSyncSummary>;
    importPricesCsv: (assetId: string, csvText: string) => Promise<CsvImportResult>;
    getPrices: (assetId: string) => Promise<DailyPriceRecord[]>;
    getPriceRange: (query: PriceRangeQuery) => Promise<DailyPriceRecord[]>;
    getAssetMetrics: (request: AssetMetricsRequest) => Promise<AssetMetricsResult>;
    getAssetSeriesAnalytics: (
      request: AssetSeriesAnalyticsRequest,
    ) => Promise<AssetSeriesAnalyticsResult>;
    searchPricePatternAnalogs: (
      request: PricePatternAnalogSearchRequest,
    ) => Promise<PricePatternAnalogSearchResult>;
    syncFxRates: (pairs: string[], startDate: string, endDate?: string) => Promise<FxSyncSummary>;
    getCacheSummary: () => Promise<CacheSummary>;
    getSyncStatus: () => Promise<SyncStatus>;
    subscribeSyncStatus: (listener: (payload: SyncStatus) => void) => () => void;
    clearCache: () => Promise<CacheResetResult>;
    getPositions: (portfolioName?: string) => Promise<PositionRecord[]>;
    updatePosition: (position: PositionInput) => Promise<PositionRecord>;
    deletePosition: (id: string) => Promise<boolean>;
    importPositionsCsv: (rows: PositionImportRow[]) => Promise<CsvImportResult>;
  };
  portfolio: {
    runAllocation: (request: {
      assetIds: string[];
      mode: AllocationType;
      constraints: AllocationConstraints;
      baseCurrency?: string;
      startDate?: string;
      endDate?: string;
      rebalanceCadence?: RebalanceCadence;
      strategyMix?: AllocationStrategyMix;
    }) => Promise<AllocationResult>;
    savePlan: (plan: AllocationPlanInput) => Promise<AllocationPlanRecord>;
    getPlans: () => Promise<AllocationPlanRecord[]>;
    deletePlan: (id: string) => Promise<boolean>;
  };
  piAgent: {
    listSessions: () => Promise<PiSessionSummary[]>;
    listSkills: () => Promise<PiSkillSummary[]>;
    getSession: (sessionId: string) => Promise<PiSessionRecord | null>;
    getSessionTranscript: (sessionId: string) => Promise<PiSessionTranscript>;
    deleteSession: (sessionId: string) => Promise<boolean>;
    stageAttachments: () => Promise<PiStageAttachmentsResponse>;
    discardAttachments: (request: PiDiscardAttachmentsRequest) => Promise<void>;
    sendMessage: (request: PiSendMessageRequest) => Promise<PiSendMessageResponse>;
    cancelRun: (request: PiCancelRunRequest) => Promise<PiCancelRunResponse>;
    onStream: (listener: (payload: PiAgentStreamEvent) => void) => () => void;
  };
  piRuntime: {
    getStatus: () => Promise<PiRuntimeStatus>;
    getRiskGateState: () => Promise<PiRiskGateState>;
    acknowledgeHighPrivilegeRisk: () => Promise<PiRiskGateState>;
    openDirectory: (target: PiRuntimeDirectoryTarget) => Promise<void>;
  };
  research: {
    startResearch: (request: ResearchRequestInput) => Promise<ResearchRequestRecord>;
    getResearchRequest: (requestId: string) => Promise<ResearchRequestRecord | null>;
    listResearchRequests: (query?: ResearchRequestListQuery) => Promise<ResearchRequestListResponse>;
    getResearchArtifacts: (requestId: string) => Promise<ResearchArtifactRecord[]>;
    cancelResearch: (requestId: string) => Promise<ResearchCancelResponse>;
    onResearchStream: (listener: (payload: ResearchStreamEvent) => void) => () => void;
    getRiskProfile: () => Promise<RiskProfileSnapshot | null>;
    saveRiskProfile: (profile: RiskProfileSnapshot) => Promise<RiskProfileSnapshot>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<string>;
    getAll: () => Promise<PreferenceMap>;
    delete: (key: string) => Promise<boolean>;
  };
  secrets: {
    get: (service: string, account: string) => Promise<string | null>;
    set: (service: string, account: string, password: string) => Promise<void>;
    delete: (service: string, account: string) => Promise<void>;
  };
}
