import type Database from 'better-sqlite3';

import { createAppDatabase } from './database';
import { seedDefaultLocalAssets } from './default-local-assets';
import { createRepositories, type Repositories } from './repositories';
import type { SecretStore } from '../secrets/store';

export interface DataServices {
  repositories: Repositories;
  secretStore: SecretStore;
  databasePath?: string;
  close: () => void;
}

export interface CreateDataServicesOptions {
  repositories: Repositories;
  secretStore: SecretStore;
  database?: Database.Database;
  databasePath?: string;
}

export interface CreateAppServicesOptions {
  userDataPath: string;
  secretStore: SecretStore;
  fileName?: string;
  migrationsDir?: string;
}

export const createDataServices = ({
  database,
  databasePath,
  repositories,
  secretStore,
}: CreateDataServicesOptions): DataServices => ({
  repositories,
  secretStore,
  databasePath,
  close() {
    database?.close();
  },
});

export const createAppServices = ({
  fileName,
  migrationsDir,
  secretStore,
  userDataPath,
}: CreateAppServicesOptions): DataServices => {
  const { database, filePath } = createAppDatabase({
    fileName,
    migrationsDir,
    userDataPath,
  });

  const repositories = createRepositories(database);
  seedDefaultLocalAssets({
    assetRepository: repositories.assetRepository,
    preferencesRepository: repositories.preferencesRepository,
  });
  repositories.researchArtifactRepository.backfillMissingHistoryProjections();

  return createDataServices({
    database,
    databasePath: filePath,
    repositories,
    secretStore,
  });
};
