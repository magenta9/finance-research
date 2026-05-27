import type Database from 'better-sqlite3';

import type { AssetInput, StoredAsset } from '@quantdesk/shared';

import { parseJson, stringifyJson } from '../json';

interface AssetRow {
  id: string;
  symbol: string;
  name: string;
  market: StoredAsset['market'];
  asset_class: StoredAsset['assetClass'];
  currency: StoredAsset['currency'];
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

const mapAssetRow = (row: AssetRow): StoredAsset => ({
  id: row.id,
  symbol: row.symbol,
  name: row.name,
  market: row.market,
  assetClass: row.asset_class,
  currency: row.currency,
  tags: parseJson<string[]>(row.tags),
  metadata: parseJson<Record<string, unknown>>(row.metadata),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const createAssetRepository = (
  database: Database.Database,
) => {
  const searchById = (id: string): StoredAsset => {
    const row = database
      .prepare(
        `
          SELECT *
          FROM assets
          WHERE id = ?
        `,
      )
      .get(id) as AssetRow | undefined;

    if (!row) {
      throw new Error(`Asset ${id} was not found.`);
    }

    return mapAssetRow(row);
  };

  const create = (input: AssetInput) => {
    database
      .prepare(
        `
          INSERT INTO assets (id, symbol, name, market, asset_class, currency, tags, metadata)
          VALUES (@id, @symbol, @name, @market, @assetClass, @currency, @tags, @metadata)
        `,
      )
      .run({
        id: input.id,
        symbol: input.symbol,
        name: input.name,
        market: input.market,
        assetClass: input.assetClass,
        currency: input.currency,
        tags: stringifyJson(input.tags),
        metadata: stringifyJson(input.metadata),
      });

    return searchById(input.id);
  };

  return {
    create,
    createMany(inputs: AssetInput[]) {
      const transaction = database.transaction((rows: AssetInput[]) =>
        rows.map((row) => create(row)),
      );

      return transaction(inputs);
    },
    list() {
      const rows = database
        .prepare(
          `
            SELECT *
            FROM assets
            ORDER BY created_at DESC, name ASC
          `,
        )
        .all() as AssetRow[];

      return rows.map(mapAssetRow);
    },
    search(query: string) {
      const likeQuery = `%${query}%`;
      const rows = database
        .prepare(
          `
            SELECT *
            FROM assets
            WHERE symbol LIKE @query
               OR name LIKE @query
               OR tags LIKE @query
            ORDER BY created_at DESC, name ASC
          `,
        )
        .all({ query: likeQuery }) as AssetRow[];

      return rows.map(mapAssetRow);
    },
    update(input: AssetInput) {
      database
        .prepare(
          `
            UPDATE assets
            SET symbol = @symbol,
                name = @name,
                market = @market,
                asset_class = @assetClass,
                currency = @currency,
                tags = @tags,
                metadata = @metadata,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = @id
          `,
        )
        .run({
          id: input.id,
          symbol: input.symbol,
          name: input.name,
          market: input.market,
          assetClass: input.assetClass,
          currency: input.currency,
          tags: stringifyJson(input.tags),
          metadata: stringifyJson(input.metadata),
        });

      return searchById(input.id);
    },
    delete(id: string) {
      const result = database
        .prepare(
          `
            DELETE FROM assets
            WHERE id = ?
          `,
        )
        .run(id);

      return result.changes > 0;
    },
  };
};