import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { createAppDatabase, runMigrations } from './database';
import {
  DEFAULT_LOCAL_ASSETS,
  defaultLocalAssetSeedVersion,
} from './default-local-assets';
import { createRepositories } from './repositories';
import { createAppServices } from './services';
import { preferenceKeys } from '../preferences/preference-keys';
import { createNullSecretStore } from '../secrets/null-store';

const migrationsDir = path.resolve(__dirname, 'migrations');

const getLatestMigrationVersion = () =>
  Math.max(
    ...fs
      .readdirSync(migrationsDir)
      .map((name) => name.match(/^(\d+)_.*\.sql$/)?.[1])
      .filter((version): version is string => Boolean(version))
      .map((version) => Number.parseInt(version, 10)),
  );

const createMigratedDatabase = () => {
  const database = new Database(':memory:');
  runMigrations(database);
  return database;
};

describe('database layer', () => {
  test('applies the initial migration and creates every core table', () => {
    const database = createMigratedDatabase();

    try {
      const tables = database
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name
          `,
        )
        .all() as Array<{ name: string }>;

      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'agent_conversations',
          'allocation_plans',
          'assets',
          'compaction_snapshots',
          'conversation_messages',
          'daily_prices',
          'fx_rates',
          'positions',
          'research_artifacts',
          'research_requests',
          'tool_executions',
          'user_preferences',
        ]),
      );

      const pragma = database.prepare('PRAGMA user_version').get() as {
        user_version: number;
      };

      expect(pragma.user_version).toBe(getLatestMigrationVersion());
    } finally {
      database.close();
    }
  });

  test('does not reapply completed migrations when the app starts again', () => {
    const database = createMigratedDatabase();

    try {
      database
        .prepare(
          `
            INSERT INTO user_preferences (key, value)
            VALUES ('baseCurrency', 'USD')
          `,
        )
        .run();

      runMigrations(database);

      const row = database
        .prepare(
          `
            SELECT key, value
            FROM user_preferences
            WHERE key = 'baseCurrency'
          `,
        )
        .get() as { key: string; value: string };

      const pragma = database.prepare('PRAGMA user_version').get() as {
        user_version: number;
      };

      expect(row).toEqual({ key: 'baseCurrency', value: 'USD' });
      expect(pragma.user_version).toBe(getLatestMigrationVersion());
    } finally {
      database.close();
    }
  });

  test('repairs upgraded databases that are missing the fx_rates table', () => {
    const database = new Database(':memory:');

    try {
      database.exec(`
        CREATE TABLE assets (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          name TEXT NOT NULL,
          market TEXT NOT NULL,
          asset_class TEXT NOT NULL,
          currency TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(symbol, market)
        );

        CREATE TABLE daily_prices (
          asset_id TEXT NOT NULL,
          date TEXT NOT NULL,
          close REAL,
          source TEXT NOT NULL DEFAULT 'unknown',
          fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (asset_id, date)
        );

        PRAGMA user_version = 10;
      `);

      runMigrations(database);

      const table = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fx_rates'")
        .get() as { name: string } | undefined;
      const version = database.prepare('PRAGMA user_version').get() as { user_version: number };

      expect(table?.name).toBe('fx_rates');
      expect(version.user_version).toBe(getLatestMigrationVersion());
    } finally {
      database.close();
    }
  });

  test('repairs upgraded databases that are missing market cache tables', () => {
    const database = new Database(':memory:');

    try {
      database.exec(`
        CREATE TABLE assets (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          name TEXT NOT NULL,
          market TEXT NOT NULL,
          asset_class TEXT NOT NULL,
          currency TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(symbol, market)
        );

        CREATE TABLE fx_rates (
          pair TEXT NOT NULL,
          date TEXT NOT NULL,
          rate REAL NOT NULL,
          source TEXT NOT NULL DEFAULT 'unknown',
          PRIMARY KEY (pair, date)
        );

        PRAGMA user_version = 11;
      `);

      runMigrations(database);

      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('daily_prices', 'fx_rates') ORDER BY name")
        .all() as Array<{ name: string }>;
      const version = database.prepare('PRAGMA user_version').get() as { user_version: number };

      expect(tables.map((table) => table.name)).toEqual(['daily_prices', 'fx_rates']);
      expect(version.user_version).toBe(getLatestMigrationVersion());
    } finally {
      database.close();
    }
  });

  test('migration 003 clears stale allocation results and backfills cadence columns', () => {
    const database = new Database(':memory:');
    try {
      database.exec(
        fs.readFileSync(
          path.join(migrationsDir, '001_initial_schema.sql'),
          'utf8',
        ),
      );
      database.exec(
        fs.readFileSync(
          path.join(migrationsDir, '002_allocation_mode_refactor.sql'),
          'utf8',
        ),
      );
      database.exec('PRAGMA user_version = 2');
      database
        .prepare(
          `
            INSERT INTO allocation_plans (id, name, mode, assets, constraints, result, base_currency)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'plan-legacy',
          'Legacy Plan',
          'inverse_volatility',
          '[]',
          '{}',
          JSON.stringify({
            generatedAt: '2026-04-11T00:00:00.000Z',
            legacy: true,
          }),
          'CNY',
        );

      runMigrations(database, { migrationsDir });

      const row = database
        .prepare(
          `
            SELECT result, start_date, end_date, rebalance_cadence
            FROM allocation_plans
            WHERE id = 'plan-legacy'
          `,
        )
        .get() as {
          result: string | null;
          start_date: string | null;
          end_date: string | null;
          rebalance_cadence: string;
        };

      expect(row).toEqual({
        end_date: null,
        rebalance_cadence: 'none',
        result: null,
        start_date: null,
      });
    } finally {
      database.close();
    }
  });

  test('rolls back the full pending migration batch when a later migration fails', () => {
    const database = new Database(':memory:');
    const migrationsDir = fs.mkdtempSync(
      path.join(tmpdir(), 'quantdesk-migrations-'),
    );

    try {
      fs.writeFileSync(
        path.join(migrationsDir, '001_create_probe_table.sql'),
        'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(migrationsDir, '002_broken_followup.sql'),
        'CREATE TABLE broken_followup (\n',
        'utf8',
      );

      expect(() => runMigrations(database, { migrationsDir })).toThrow();

      const tables = database
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name = 'migration_probe'
          `,
        )
        .all() as Array<{ name: string }>;

      const pragma = database.prepare('PRAGMA user_version').get() as {
        user_version: number;
      };

      expect(tables).toEqual([]);
      expect(pragma.user_version).toBe(0);
    } finally {
      database.close();
      fs.rmSync(migrationsDir, { force: true, recursive: true });
    }
  });

  test('does not open a write transaction when there are no pending migrations', () => {
    const migrationsDir = fs.mkdtempSync(
      path.join(tmpdir(), 'quantdesk-noop-migrations-'),
    );

    try {
      fs.writeFileSync(
        path.join(migrationsDir, '001_initial.sql'),
        'CREATE TABLE noop_probe (id INTEGER PRIMARY KEY);\n',
        'utf8',
      );
      const execCalls: string[] = [];
      const database = {
        exec: (sql: string) => {
          execCalls.push(sql);
        },
        prepare: (sql: string) => {
          expect(sql).toBe('PRAGMA user_version');
          return {
            get: () => ({ user_version: 1 }),
          };
        },
      } as unknown as Database.Database;
      runMigrations(database, { migrationsDir });

      expect(execCalls).toEqual([]);
    } finally {
      fs.rmSync(migrationsDir, { force: true, recursive: true });
    }
  });

  test('supports asset create, update, search, and delete flows', () => {
    const database = createMigratedDatabase();
    const repositories = createRepositories(database);

    try {
      const created = repositories.assetRepository.create({
        id: 'asset-spy',
        symbol: 'SPY',
        name: 'SPDR S&P 500 ETF Trust',
        market: 'US',
        assetClass: 'equity',
        currency: 'USD',
        tags: ['core', 'index'],
        metadata: {
          issuer: 'State Street',
        },
      });

      expect(created.symbol).toBe('SPY');
      expect(repositories.assetRepository.list()).toHaveLength(1);

      repositories.assetRepository.update({
        ...created,
        name: 'SPY Core ETF',
        tags: ['core', 'large-cap'],
      });

      expect(repositories.assetRepository.search('large-cap')).toEqual([
        expect.objectContaining({
          id: 'asset-spy',
          name: 'SPY Core ETF',
          tags: ['core', 'large-cap'],
        }),
      ]);

      expect(() =>
        repositories.assetRepository.create({
          id: 'asset-spy-duplicate',
          symbol: 'SPY',
          name: 'Duplicate SPY',
          market: 'US',
          assetClass: 'equity',
          currency: 'USD',
          tags: [],
          metadata: {},
        }),
      ).toThrow();

      expect(repositories.assetRepository.delete('asset-spy')).toBe(true);
      expect(repositories.assetRepository.list()).toEqual([]);
    } finally {
      database.close();
    }
  });

  test('seeds the default A-share index ETF universe on first app launch', () => {
    const userDataPath = fs.mkdtempSync(
      path.join(tmpdir(), 'quantdesk-app-services-'),
    );

    try {
      const services = createAppServices({
        secretStore: createNullSecretStore(),
        userDataPath,
      });

      try {
        const assets = services.repositories.assetRepository.list();
        const symbols = assets.map((asset) => asset.symbol).sort();

        expect(symbols).toEqual(
          DEFAULT_LOCAL_ASSETS.map((asset) => asset.symbol).sort(),
        );
        expect(
          services.repositories.preferencesRepository.get(
            preferenceKeys.assetUniverse.defaultLocalAssetSeedVersion,
          ),
        ).toBe(defaultLocalAssetSeedVersion);
      } finally {
        services.close();
      }
    } finally {
      fs.rmSync(userDataPath, { force: true, recursive: true });
    }
  });

  test('seeds mainstream Hang Seng theme ETFs for local asset search', () => {
    const userDataPath = fs.mkdtempSync(
      path.join(tmpdir(), 'quantdesk-hang-seng-etfs-'),
    );

    try {
      const services = createAppServices({
        secretStore: createNullSecretStore(),
        userDataPath,
      });

      try {
        const repository = services.repositories.assetRepository;

        expect(repository.search('恒生消费')[0]).toEqual(
          expect.objectContaining({
            metadata: expect.objectContaining({ underlyingMarket: 'HK' }),
            name: '恒生消费ETF',
            symbol: '513970',
          }),
        );
        expect(repository.search('恒生医疗')[0]).toEqual(
          expect.objectContaining({
            metadata: expect.objectContaining({ underlyingMarket: 'HK' }),
            name: '恒生医疗ETF',
            symbol: '513060',
          }),
        );
        expect(repository.search('恒生互联网')[0]).toEqual(
          expect.objectContaining({
            metadata: expect.objectContaining({ underlyingMarket: 'HK' }),
            name: '恒生互联网ETF',
            symbol: '513330',
          }),
        );
      } finally {
        services.close();
      }
    } finally {
      fs.rmSync(userDataPath, { force: true, recursive: true });
    }
  });

  test('backfills the default ETF pack once for legacy databases without re-adding it later', () => {
    const userDataPath = fs.mkdtempSync(
      path.join(tmpdir(), 'quantdesk-legacy-assets-'),
    );

    try {
      const { database } = createAppDatabase({ userDataPath });
      const repositories = createRepositories(database);

      repositories.assetRepository.create({
        id: 'asset-spy',
        symbol: 'SPY',
        name: 'SPDR S&P 500 ETF Trust',
        market: 'US',
        assetClass: 'equity',
        currency: 'USD',
        tags: ['core'],
        metadata: {},
      });
      database.close();

      const firstOpen = createAppServices({
        secretStore: createNullSecretStore(),
        userDataPath,
      });

      try {
        expect(firstOpen.repositories.assetRepository.list()).toHaveLength(
          DEFAULT_LOCAL_ASSETS.length + 1,
        );
        expect(
          firstOpen.repositories.preferencesRepository.get(
            preferenceKeys.assetUniverse.defaultLocalAssetSeedVersion,
          ),
        ).toBe(defaultLocalAssetSeedVersion);
      } finally {
        firstOpen.close();
      }

      const secondOpen = createAppServices({
        secretStore: createNullSecretStore(),
        userDataPath,
      });

      try {
        expect(secondOpen.repositories.assetRepository.list()).toHaveLength(
          DEFAULT_LOCAL_ASSETS.length + 1,
        );
      } finally {
        secondOpen.close();
      }
    } finally {
      fs.rmSync(userDataPath, { force: true, recursive: true });
    }
  });

  test('supports asset batch inserts and delete flows across persisted aggregates', () => {
    const database = createMigratedDatabase();
    const repositories = createRepositories(database);

    try {
      const assets = repositories.assetRepository.createMany([
        {
          id: 'asset-spy',
          symbol: 'SPY',
          name: 'SPDR S&P 500 ETF Trust',
          market: 'US',
          assetClass: 'equity',
          currency: 'USD',
          tags: ['core'],
          metadata: {},
        },
        {
          id: 'asset-agg',
          symbol: 'AGG',
          name: 'iShares Core U.S. Aggregate Bond ETF',
          market: 'US',
          assetClass: 'fixed_income',
          currency: 'USD',
          tags: ['bond'],
          metadata: {},
        },
      ]);

      repositories.positionRepository.save({
        id: 'position-1',
        portfolioName: 'default',
        assetId: 'asset-spy',
        shares: 4,
        costBasis: 580,
        currency: 'USD',
      });

      repositories.allocationPlanRepository.save({
        id: 'plan-1',
        name: 'Balanced Core',
        mode: 'inverse_volatility',
        assets: assets.map((asset) => asset.id),
        constraints: {
          allowLeverage: false,
          allowShort: false,
          maxClassWeight: {},
          maxSingleWeight: 1,
        },
        result: null,
        baseCurrency: 'CNY',
        endDate: '2026-04-11',
        rebalanceCadence: 'monthly',
        startDate: '2025-04-11',
      });

      repositories.conversationRepository.create({
        id: 'conversation-1',
        title: 'Balanced Core discussion',
        messages: [],
        context: {},
      });

      expect(assets).toHaveLength(2);
      expect(repositories.positionRepository.delete('position-1')).toBe(true);
      expect(repositories.allocationPlanRepository.delete('plan-1')).toBe(true);
      expect(repositories.conversationRepository.delete('conversation-1')).toBe(
        true,
      );
    } finally {
      database.close();
    }
  });

  test('stores price history and FX rates with range and fallback queries', () => {
    const database = createMigratedDatabase();
    const repositories = createRepositories(database);

    try {
      repositories.assetRepository.create({
        id: 'asset-spy',
        symbol: 'SPY',
        name: 'SPDR S&P 500 ETF Trust',
        market: 'US',
        assetClass: 'equity',
        currency: 'USD',
        tags: ['core'],
        metadata: {},
      });

      repositories.priceRepository.insertMany([
        {
          assetId: 'asset-spy',
          date: '2026-01-02',
          open: 580,
          high: 585,
          low: 579,
          close: 584,
          volume: 120_000_000,
          adjustedClose: 584,
          source: 'yfinance',
          fetchedAt: '2026-01-03T08:00:00.000Z',
        },
        {
          assetId: 'asset-spy',
          date: '2026-01-03',
          open: 584,
          high: 589,
          low: 583,
          close: 588,
          volume: 118_000_000,
          adjustedClose: 588,
          source: 'yfinance',
          fetchedAt: '2026-01-03T08:00:00.000Z',
        },
      ]);

      repositories.fxRateRepository.insertMany([
        {
          pair: 'USD/CNY',
          date: '2026-01-02',
          rate: 7.12,
          source: 'yfinance',
        },
      ]);

      expect(
        repositories.priceRepository.getRange({
          assetId: 'asset-spy',
          startDate: '2026-01-02',
          endDate: '2026-01-02',
        }),
      ).toEqual([
        expect.objectContaining({
          assetId: 'asset-spy',
          date: '2026-01-02',
          close: 584,
        }),
      ]);

      expect(
        repositories.priceRepository.isFresh({
          assetId: 'asset-spy',
          maxAgeHours: 24,
          now: '2026-01-03T20:00:00.000Z',
        }),
      ).toBe(true);

      expect(
        repositories.fxRateRepository.getLatestRate('USD/CNY', '2026-01-03'),
      ).toEqual(
        expect.objectContaining({
          pair: 'USD/CNY',
          date: '2026-01-02',
          rate: 7.12,
        }),
      );
    } finally {
      database.close();
    }
  });

  test('persists positions, plans, conversations, and preferences', () => {
    const database = createMigratedDatabase();
    const repositories = createRepositories(database);

    try {
      repositories.assetRepository.create({
        id: 'asset-spy',
        symbol: 'SPY',
        name: 'SPDR S&P 500 ETF Trust',
        market: 'US',
        assetClass: 'equity',
        currency: 'USD',
        tags: [],
        metadata: {},
      });

      repositories.positionRepository.save({
        id: 'position-1',
        portfolioName: 'default',
        assetId: 'asset-spy',
        shares: 10,
        costBasis: 580,
        currency: 'USD',
      });

      repositories.allocationPlanRepository.save({
        id: 'plan-1',
        name: 'All Weather Baseline',
        mode: 'inverse_volatility',
        assets: ['asset-spy'],
        constraints: {
          allowLeverage: false,
          allowShort: false,
          maxClassWeight: {},
          maxSingleWeight: 0.5,
        },
        result: null,
        baseCurrency: 'CNY',
        endDate: '2026-04-11',
        rebalanceCadence: 'monthly',
        startDate: '2025-04-11',
      });

      repositories.conversationRepository.create({
        id: 'conversation-1',
        title: 'Initial allocation review',
        messages: [
          {
            role: 'user',
            content: 'Review the baseline plan.',
          },
        ],
        context: {
          allocationPlanId: 'plan-1',
        },
      });

      repositories.conversationRepository.appendMessage('conversation-1', {
        role: 'assistant',
        content: 'The plan is diversified across one test asset.',
      });

      repositories.preferencesRepository.set('baseCurrency', 'USD');

      expect(
        repositories.positionRepository.listByPortfolio('default'),
      ).toEqual([
        expect.objectContaining({
          id: 'position-1',
          assetId: 'asset-spy',
          shares: 10,
        }),
      ]);

      expect(repositories.allocationPlanRepository.list()).toEqual([
        expect.objectContaining({
          endDate: '2026-04-11',
          id: 'plan-1',
          name: 'All Weather Baseline',
          rebalanceCadence: 'monthly',
          startDate: '2025-04-11',
        }),
      ]);

      expect(
        repositories.conversationRepository.getById('conversation-1'),
      ).toEqual(
        expect.objectContaining({
          id: 'conversation-1',
          messages: [
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({ role: 'assistant' }),
          ],
        }),
      );

      expect(repositories.preferencesRepository.get('baseCurrency')).toBe(
        'USD',
      );
      expect(repositories.preferencesRepository.getAll()).toEqual({
        baseCurrency: 'USD',
      });
    } finally {
      database.close();
    }
  });
});
