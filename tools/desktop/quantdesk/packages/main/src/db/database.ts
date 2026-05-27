import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type Database from 'better-sqlite3';

const MIGRATION_FILE_PATTERN = /^(\d+)_.*\.sql$/;
const require = createRequire(__filename);

type BetterSqlite3Constructor = typeof import('better-sqlite3');

const loadDatabaseConstructor = (): BetterSqlite3Constructor => {
  const resolved = require('better-sqlite3') as
    | BetterSqlite3Constructor
    | { default: BetterSqlite3Constructor };

  return ('default' in resolved ? resolved.default : resolved) as BetterSqlite3Constructor;
};

export interface MigrationOptions {
  migrationsDir?: string;
}

export interface AppDatabaseOptions extends MigrationOptions {
  userDataPath: string;
  fileName?: string;
}

export interface AppDatabase {
  database: Database.Database;
  filePath: string;
}

interface SqliteVersionRow {
  sqlite_version: string;
}

const getUserVersion = (database: Database.Database): number => {
  const row = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };

  return row.user_version;
};

const resolveEnvProjectRoot = () => {
  const value = process.env.QUANTDESK_PROJECT_ROOT?.trim();
  return value ? path.resolve(value) : null;
};

const resolveDefaultMigrationsDir = () => {
  const projectRoot = resolveEnvProjectRoot();
  const resourcesPath = (process as typeof process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    path.resolve(__dirname, 'migrations'),
    ...(projectRoot
      ? [
        path.resolve(projectRoot, 'packages/main/src/db/migrations'),
        path.resolve(projectRoot, 'src/db/migrations'),
      ]
      : []),
    path.resolve(process.cwd(), 'packages/main/src/db/migrations'),
    path.resolve(process.cwd(), 'src/db/migrations'),
    ...(resourcesPath
      ? [path.resolve(resourcesPath, 'db/migrations')]
      : []),
  ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));

  if (!match) {
    throw new Error('Unable to locate the SQLite migrations directory.');
  }

  return match;
};

const readMigrationFiles = (migrationsDir: string) =>
  fs
    .readdirSync(migrationsDir)
    .map((name) => {
      const match = name.match(MIGRATION_FILE_PATTERN);

      if (!match) {
        return null;
      }

      return {
        version: Number.parseInt(match[1] ?? '0', 10),
        filePath: path.join(migrationsDir, name),
      };
    })
    .filter((migration): migration is { version: number; filePath: string } =>
      Boolean(migration),
    )
    .sort((left, right) => left.version - right.version);

export const runMigrations = (
  database: Database.Database,
  options: MigrationOptions = {},
) => {
  const migrationsDir = options.migrationsDir ?? resolveDefaultMigrationsDir();
  const migrations = readMigrationFiles(migrationsDir);
  const currentVersion = getUserVersion(database);
  const hasPendingMigrations = migrations.some(
    (migration) => migration.version > currentVersion,
  );

  if (!hasPendingMigrations) {
    return;
  }

  database.exec('BEGIN IMMEDIATE');

  try {
    let nextVersion = currentVersion;

    for (const migration of migrations) {
      if (migration.version <= nextVersion) {
        continue;
      }

      const sql = fs.readFileSync(migration.filePath, 'utf8');

      database.exec(sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      nextVersion = migration.version;
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
};

export const createAppDatabase = ({
  fileName = 'quantdesk.db',
  migrationsDir,
  userDataPath,
}: AppDatabaseOptions): AppDatabase => {
  fs.mkdirSync(userDataPath, { recursive: true });

  const filePath = path.join(userDataPath, fileName);
  const BetterSqlite3Database = loadDatabaseConstructor();
  const database = new BetterSqlite3Database(filePath);

  database.exec('PRAGMA foreign_keys = ON');
  runMigrations(database, { migrationsDir });

  return {
    database,
    filePath,
  };
};

export const createInMemoryDatabase = (): Database.Database => {
  const BetterSqlite3Database = loadDatabaseConstructor();

  return new BetterSqlite3Database(':memory:');
};

export const readInMemorySqliteVersion = (): string => {
  const database = createInMemoryDatabase();

  try {
    const row = database.prepare('select sqlite_version() as sqlite_version').get() as SqliteVersionRow | undefined;

    if (!row) {
      throw new Error('Unable to read sqlite_version() from in-memory database.');
    }

    return row.sqlite_version;
  } finally {
    database.close();
  }
};
