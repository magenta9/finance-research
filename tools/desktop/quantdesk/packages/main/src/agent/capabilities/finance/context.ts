import type { Currency } from '@quantdesk/shared';

import type { DataServices } from '../../../db/services';
import type { PortfolioEngine } from '../../../portfolio/engine';
import { createPreferencesService } from '../../../preferences/preferences-service';
import type { DocsRagService } from '../../rag/docs-rag-service';
import type { FinanceCapabilityContext } from './types';

const resolveBaseCurrency = (dataServices: DataServices): Currency => {
  return createPreferencesService(dataServices.repositories.preferencesRepository).getBaseCurrency();
};

const getLatestPlan = (dataServices: DataServices, activePlanId?: string) => {
  if (activePlanId) {
    return dataServices.repositories.allocationPlanRepository.getById(activePlanId);
  }

  return dataServices.repositories.allocationPlanRepository.list()[0] ?? null;
};

export const createFinanceCapabilityContext = ({
  dataServices,
  docsRagService,
  marketDataPort,
  marketSourceService,
  portfolioEngine,
  priceSyncService,
  researchProviderService,
  strategyCliService,
}: {
  dataServices: DataServices;
  docsRagService: DocsRagService;
  marketDataPort?: FinanceCapabilityContext['marketDataPort'];
  marketSourceService?: FinanceCapabilityContext['marketSourceService'];
  portfolioEngine: PortfolioEngine;
  priceSyncService?: FinanceCapabilityContext['priceSyncService'];
  researchProviderService?: FinanceCapabilityContext['researchProviderService'];
  strategyCliService?: FinanceCapabilityContext['strategyCliService'];
}): FinanceCapabilityContext => ({
  dataServices,
  docsRagService,
  getSkillContext(message, activePlanId) {
    const latestPlan = getLatestPlan(dataServices, activePlanId);

    return {
      assets: dataServices.repositories.assetRepository.list(),
      baseCurrency: resolveBaseCurrency(dataServices),
      latestAllocation: latestPlan?.result ?? null,
      latestPlanId: latestPlan?.id,
      message,
    };
  },
  marketDataPort,
  marketSourceService,
  portfolioEngine,
  priceSyncService,
  researchProviderService,
  strategyCliService,
});