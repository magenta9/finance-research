import type Database from 'better-sqlite3';

import { createAllocationPlanRepository } from './repos/allocation-plan-repository';
import { createAssetRepository } from './repos/asset-repository';
import { createConversationRepository } from './repos/conversation-repository';
import { createFxRateRepository } from './repos/fx-rate-repository';
import { createPositionRepository } from './repos/position-repository';
import { createPreferencesRepository } from './repos/preferences-repository';
import { createPriceRepository } from './repos/price-repository';
import { createResearchArtifactRepository } from './repos/research-artifact-repository';

export interface Repositories {
  assetRepository: ReturnType<typeof createAssetRepository>;
  priceRepository: ReturnType<typeof createPriceRepository>;
  fxRateRepository: ReturnType<typeof createFxRateRepository>;
  positionRepository: ReturnType<typeof createPositionRepository>;
  allocationPlanRepository: ReturnType<typeof createAllocationPlanRepository>;
  conversationRepository: ReturnType<typeof createConversationRepository>;
  preferencesRepository: ReturnType<typeof createPreferencesRepository>;
  researchArtifactRepository: ReturnType<typeof createResearchArtifactRepository>;
}

export const createRepositories = (database: Database.Database): Repositories => ({
  assetRepository: createAssetRepository(database),
  priceRepository: createPriceRepository(database),
  fxRateRepository: createFxRateRepository(database),
  positionRepository: createPositionRepository(database),
  allocationPlanRepository: createAllocationPlanRepository(database),
  conversationRepository: createConversationRepository(database),
  preferencesRepository: createPreferencesRepository(database),
  researchArtifactRepository: createResearchArtifactRepository(database),
});
