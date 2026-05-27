import type Database from 'better-sqlite3';

import type { PositionInput, PositionRecord } from '@quantdesk/shared';

interface PositionRow {
  id: string;
  portfolio_name: string;
  asset_id: string;
  shares: number;
  cost_basis: number | null;
  currency: PositionRecord['currency'];
  updated_at: string;
}

const mapPositionRow = (row: PositionRow): PositionRecord => ({
  id: row.id,
  portfolioName: row.portfolio_name,
  assetId: row.asset_id,
  shares: row.shares,
  costBasis: row.cost_basis,
  currency: row.currency,
  updatedAt: row.updated_at,
});

export const createPositionRepository = (
  database: Database.Database,
) => ({
  save(input: PositionInput) {
    database
      .prepare(
        `
          INSERT INTO positions (id, portfolio_name, asset_id, shares, cost_basis, currency)
          VALUES (@id, @portfolioName, @assetId, @shares, @costBasis, @currency)
          ON CONFLICT(id) DO UPDATE SET
            portfolio_name = excluded.portfolio_name,
            asset_id = excluded.asset_id,
            shares = excluded.shares,
            cost_basis = excluded.cost_basis,
            currency = excluded.currency,
            updated_at = CURRENT_TIMESTAMP
        `,
      )
      .run({
        id: input.id,
        portfolioName: input.portfolioName ?? 'default',
        assetId: input.assetId,
        shares: input.shares,
        costBasis: input.costBasis,
        currency: input.currency,
      });

    const row = database
      .prepare(
        `
          SELECT *
          FROM positions
          WHERE id = ?
        `,
      )
      .get(input.id) as PositionRow | undefined;

    if (!row) {
      throw new Error(`Position ${input.id} was not found.`);
    }

    return mapPositionRow(row);
  },
  listByPortfolio(portfolioName: string = 'default') {
    const rows = database
      .prepare(
        `
          SELECT *
          FROM positions
          WHERE portfolio_name = ?
          ORDER BY updated_at DESC, id ASC
        `,
      )
      .all(portfolioName) as PositionRow[];

    return rows.map(mapPositionRow);
  },
  delete(id: string) {
    const result = database
      .prepare(
        `
          DELETE FROM positions
          WHERE id = ?
        `,
      )
      .run(id);

    return result.changes > 0;
  },
});