import type { QuantdeskApi } from './types/api';
import { IpcChannel } from './ipc-channels';

export type IpcTransport = 'invoke' | 'send' | 'subscribe';

export interface IpcContractEntry {
  channel: IpcChannel;
  transport: IpcTransport;
  timeoutMs?: number;
}

type NamespaceKey = keyof QuantdeskApi;

export type IpcContractRegistry = {
  [Namespace in NamespaceKey]: {
    [Method in keyof QuantdeskApi[Namespace]]: IpcContractEntry;
  };
};

export const ipcContract = {
  log: {
    write: { channel: IpcChannel.LogWrite, transport: 'send' },
    writeBatch: { channel: IpcChannel.LogWriteBatch, transport: 'send' },
    openDirectory: { channel: IpcChannel.LogOpenDirectory, transport: 'invoke' },
  },
  system: {
    ping: { channel: IpcChannel.SystemPing, transport: 'invoke' },
    checkNativeBindings: { channel: IpcChannel.SystemCheckNative, transport: 'invoke' },
    runDummyPython: { channel: IpcChannel.SystemRunDummyPython, transport: 'invoke' },
    getRuntimeStatus: { channel: IpcChannel.SystemGetRuntimeStatus, transport: 'invoke' },
  },
  runtime: {
    getMode: { channel: IpcChannel.RuntimeGetMode, transport: 'invoke' },
    getCapabilities: { channel: IpcChannel.RuntimeGetCapabilities, transport: 'invoke' },
    getConfig: { channel: IpcChannel.RuntimeGetConfig, transport: 'invoke' },
    updateConfig: { channel: IpcChannel.RuntimeUpdateConfig, transport: 'invoke' },
    validateSidecarConnection: { channel: IpcChannel.RuntimeValidateSidecar, transport: 'invoke' },
    validateProviderConnection: { channel: IpcChannel.RuntimeValidateProvider, transport: 'invoke' },
  },
  data: {
    getAssets: { channel: IpcChannel.DataGetAssets, transport: 'invoke' },
    addAsset: { channel: IpcChannel.DataAddAsset, transport: 'invoke' },
    updateAsset: { channel: IpcChannel.DataUpdateAsset, transport: 'invoke' },
    deleteAsset: { channel: IpcChannel.DataDeleteAsset, transport: 'invoke' },
    searchAssets: { channel: IpcChannel.DataSearchAssets, transport: 'invoke' },
    lookupAssets: { channel: IpcChannel.DataLookupAssets, transport: 'invoke' },
    importAssetsCsv: { channel: IpcChannel.DataImportAssetsCsv, transport: 'invoke' },
    syncPrices: { channel: IpcChannel.DataSyncPrices, transport: 'invoke' },
    importPricesCsv: { channel: IpcChannel.DataImportPricesCsv, transport: 'invoke' },
    getPrices: { channel: IpcChannel.DataGetPrices, transport: 'invoke' },
    getPriceRange: { channel: IpcChannel.DataGetPriceRange, transport: 'invoke' },
    getAssetMetrics: { channel: IpcChannel.DataGetAssetMetrics, transport: 'invoke' },
    getAssetSeriesAnalytics: { channel: IpcChannel.DataGetAssetSeriesAnalytics, transport: 'invoke' },
    searchPricePatternAnalogs: { channel: IpcChannel.DataSearchPricePatternAnalogs, transport: 'invoke' },
    syncFxRates: { channel: IpcChannel.DataSyncFxRates, transport: 'invoke' },
    getCacheSummary: { channel: IpcChannel.DataGetCacheSummary, transport: 'invoke' },
    getSyncStatus: { channel: IpcChannel.DataGetSyncStatus, transport: 'invoke' },
    subscribeSyncStatus: { channel: IpcChannel.DataSyncStatusUpdated, transport: 'subscribe' },
    clearCache: { channel: IpcChannel.DataClearCache, transport: 'invoke' },
    getPositions: { channel: IpcChannel.DataGetPositions, transport: 'invoke' },
    updatePosition: { channel: IpcChannel.DataUpdatePosition, transport: 'invoke' },
    deletePosition: { channel: IpcChannel.DataDeletePosition, transport: 'invoke' },
    importPositionsCsv: { channel: IpcChannel.DataImportPositionsCsv, transport: 'invoke' },
  },
  portfolio: {
    runAllocation: { channel: IpcChannel.PortfolioRunAllocation, timeoutMs: 60_000, transport: 'invoke' },
    savePlan: { channel: IpcChannel.PortfolioSavePlan, transport: 'invoke' },
    getPlans: { channel: IpcChannel.PortfolioGetPlans, transport: 'invoke' },
    deletePlan: { channel: IpcChannel.PortfolioDeletePlan, transport: 'invoke' },
  },
  piAgent: {
    listSessions: { channel: IpcChannel.PiAgentListSessions, transport: 'invoke' },
    listSkills: { channel: IpcChannel.PiAgentListSkills, transport: 'invoke' },
    getSession: { channel: IpcChannel.PiAgentGetSession, transport: 'invoke' },
    getSessionTranscript: { channel: IpcChannel.PiAgentGetSessionTranscript, transport: 'invoke' },
    deleteSession: { channel: IpcChannel.PiAgentDeleteSession, transport: 'invoke' },
    stageAttachments: { channel: IpcChannel.PiAgentStageAttachments, transport: 'invoke' },
    discardAttachments: { channel: IpcChannel.PiAgentDiscardAttachments, transport: 'invoke' },
    sendMessage: { channel: IpcChannel.PiAgentSendMessage, timeoutMs: 60_000, transport: 'invoke' },
    cancelRun: { channel: IpcChannel.PiAgentCancelRun, transport: 'invoke' },
    onStream: { channel: IpcChannel.PiAgentStreamEvent, transport: 'subscribe' },
  },
  piRuntime: {
    getStatus: { channel: IpcChannel.PiRuntimeGetStatus, transport: 'invoke' },
    getRiskGateState: { channel: IpcChannel.PiRuntimeGetRiskGateState, transport: 'invoke' },
    acknowledgeHighPrivilegeRisk: { channel: IpcChannel.PiRuntimeAcknowledgeHighPrivilegeRisk, transport: 'invoke' },
    openDirectory: { channel: IpcChannel.PiRuntimeOpenDirectory, transport: 'invoke' },
  },
  research: {
    startResearch: { channel: IpcChannel.ResearchStart, timeoutMs: 120_000, transport: 'invoke' },
    getResearchRequest: { channel: IpcChannel.ResearchGetRequest, transport: 'invoke' },
    listResearchRequests: { channel: IpcChannel.ResearchListRequests, transport: 'invoke' },
    getResearchArtifacts: { channel: IpcChannel.ResearchGetArtifacts, transport: 'invoke' },
    cancelResearch: { channel: IpcChannel.ResearchCancel, transport: 'invoke' },
    onResearchStream: { channel: IpcChannel.ResearchStreamEvent, transport: 'subscribe' },
    getRiskProfile: { channel: IpcChannel.ResearchGetRiskProfile, transport: 'invoke' },
    saveRiskProfile: { channel: IpcChannel.ResearchSaveRiskProfile, transport: 'invoke' },
  },
  settings: {
    get: { channel: IpcChannel.SettingsGet, transport: 'invoke' },
    set: { channel: IpcChannel.SettingsSet, transport: 'invoke' },
    getAll: { channel: IpcChannel.SettingsGetAll, transport: 'invoke' },
    delete: { channel: IpcChannel.SettingsDelete, transport: 'invoke' },
  },
  secrets: {
    get: { channel: IpcChannel.SecretsGet, transport: 'invoke' },
    set: { channel: IpcChannel.SecretsSet, transport: 'invoke' },
    delete: { channel: IpcChannel.SecretsDelete, transport: 'invoke' },
  },
} satisfies IpcContractRegistry;

export interface IpcContractRecord extends IpcContractEntry {
  namespace: NamespaceKey;
  method: string;
}

export const listIpcContractEntries = () => {
  return Object.entries(ipcContract).flatMap(([namespace, methods]) =>
    Object.entries(methods).map(([method, entry]) => ({
      ...entry,
      method,
      namespace: namespace as NamespaceKey,
    })),
  ) as IpcContractRecord[];
};
