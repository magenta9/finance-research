import type {
  AgentRichBlock,
  AgentSkillContext,
  DataProvenance,
  ToolVisibility,
} from '@quantdesk/shared';

import type { DataServices } from '../../../db/services';
import type { PortfolioEngine } from '../../../portfolio/engine';
import type { DocsRagService } from '../../rag/docs-rag-service';
import type { MarketDataPort } from '../../../sidecar/market-data-port';
import type { PriceSyncService } from '../../../sidecar/price-sync-service';

export interface MarketSourceReference {
  credibilityStatus: 'aggregator' | 'official' | 'provider' | 'unknown';
  evidenceEligible: false;
  providerId: string;
  publishedAt: string | null;
  snippet: string;
  sourceId: string;
  title: string;
  url: string;
}

export interface FetchedMarketSource {
  contentHash: string;
  evidenceEligible: true;
  fetchedAt: string;
  provenance: DataProvenance[];
  sourceId: string;
  summary: string;
  textPreview?: string;
  title: string;
  url: string;
}

export interface MarketSourceService {
  fetchSource: (request: { sourceId: string; url?: string } | { sourceId?: string; url: string }) => Promise<FetchedMarketSource>;
  searchAnnouncements: (request: { market?: string; query: string; symbol?: string }) => Promise<MarketSourceReference[]>;
  searchSources: (request: { market?: string; query: string; symbol?: string }) => Promise<MarketSourceReference[]>;
}

export interface ResearchProviderSnapshot {
  dataProvenance: DataProvenance[];
  payload: unknown;
  providerIds: string[];
  status: 'available' | 'degraded' | 'unavailable';
  summary: string;
  warnings: string[];
}

export interface ResearchProviderService {
  getFlowSentimentSnapshot?: (request: { symbol?: string }) => Promise<ResearchProviderSnapshot>;
  getFundamentalSnapshot?: (request: { symbol: string }) => Promise<ResearchProviderSnapshot>;
  getMacroSeriesSnapshot?: (request: { symbols?: string[] }) => Promise<ResearchProviderSnapshot>;
  searchNewsCatalysts?: (request: { market?: string; query: string; symbol?: string }) => Promise<ResearchProviderSnapshot>;
}

export interface FinanceToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
  visibility: ToolVisibility;
}

export interface FinanceToolPayload {
  audit: {
    generatedAt: string;
    toolName: string;
  };
  citations: string[];
  ok: boolean;
  payload: unknown;
  richBlocks: AgentRichBlock[];
  summary: string;
}

export interface FinanceSkillContext extends AgentSkillContext {
  message: string;
}

export interface FinanceCapabilityContext {
  dataServices: DataServices;
  docsRagService: Pick<DocsRagService, 'search'>;
  getSkillContext: (message: string, activePlanId?: string) => FinanceSkillContext;
  marketDataPort?: Pick<MarketDataPort, 'searchAssets'>;
  marketSourceService?: MarketSourceService;
  portfolioEngine: Pick<PortfolioEngine, 'runAllocation'>;
  priceSyncService?: Pick<PriceSyncService, 'syncPrices'>;
  researchProviderService?: ResearchProviderService;
}

export type FinanceHandler = (args: Record<string, unknown>) => Promise<FinanceToolPayload>;

export type LocalAssetList = ReturnType<
  FinanceCapabilityContext['dataServices']['repositories']['assetRepository']['list']
>;