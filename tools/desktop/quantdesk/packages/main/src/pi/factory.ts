import type { DataServices } from '../db/services';
import type { LoggerLike } from '../logger';
import type { PortfolioEngine } from '../portfolio/engine';
import { createFinanceCapabilityContext } from '../agent/capabilities/finance';
import type { DocsRagService } from '../agent/rag/docs-rag-service';
import type { MarketSourceService, ResearchProviderService, ResearchProviderSnapshot } from '../agent/capabilities/finance';
import { PiManager, type PiManagerOptions } from './manager';
import { createPiToolHost, type PiToolHost } from './tool-host';
import type { PiRuntimeDirectories } from './types';

export interface PiRuntimeGroup {
  manager: PiManager;
  toolHost: PiToolHost;
}

const unavailableProviderSnapshot = (providerId: string): ResearchProviderSnapshot => ({
  dataProvenance: [{
    fetchedAt: new Date().toISOString(),
    providerIds: [providerId],
    qualityStatus: 'warn',
    sourceId: providerId,
    warnings: [`${providerId} is not connected in this runtime.`],
  }],
  payload: {
    reasonCode: 'provider_unavailable',
  },
  providerIds: [providerId],
  status: 'unavailable',
  summary: `${providerId} is unavailable; keep research degraded until a provider adapter is connected.`,
  warnings: [`${providerId} is not connected in this runtime.`],
});

const createDefaultResearchProviderService = (): ResearchProviderService => ({
  getFlowSentimentSnapshot: async () => unavailableProviderSnapshot('provider.flow_sentiment'),
  getFundamentalSnapshot: async () => unavailableProviderSnapshot('provider.fundamentals'),
  getMacroSeriesSnapshot: async () => unavailableProviderSnapshot('provider.macro'),
  searchNewsCatalysts: async () => unavailableProviderSnapshot('provider.news_catalysts'),
});

const createDefaultMarketSourceService = (): MarketSourceService => ({
  fetchSource: async () => {
    throw new Error('provider.news_catalysts is unavailable; no market source fetch adapter is connected.');
  },
  searchAnnouncements: async () => [],
  searchSources: async () => [],
});

export const createPiRuntimeGroup = ({
  dataServices,
  directories,
  docsRagService,
  logger,
  portfolioEngine,
  marketDataPort,
  marketSourceService,
  priceSyncService,
  researchProviderService,
  spawnSpec,
}: {
  dataServices: DataServices;
  directories: PiRuntimeDirectories;
  docsRagService: DocsRagService;
  logger?: LoggerLike;
  marketDataPort?: Parameters<typeof createFinanceCapabilityContext>[0]['marketDataPort'];
  marketSourceService?: MarketSourceService;
  portfolioEngine: PortfolioEngine;
  priceSyncService?: Parameters<typeof createFinanceCapabilityContext>[0]['priceSyncService'];
  researchProviderService?: ResearchProviderService;
  spawnSpec: PiManagerOptions['spawnSpec'];
}): PiRuntimeGroup => {
  const defaultResearchProviderService = createDefaultResearchProviderService();
  const toolHost = createPiToolHost(createFinanceCapabilityContext({
    dataServices,
    docsRagService,
    marketDataPort,
    marketSourceService: marketSourceService ?? createDefaultMarketSourceService(),
    portfolioEngine,
    priceSyncService,
    researchProviderService: {
      ...defaultResearchProviderService,
      ...researchProviderService,
    },
  }));

  return {
    manager: new PiManager({
      directories,
      logger,
      spawnSpec,
      toolHost,
    }),
    toolHost,
  };
};
