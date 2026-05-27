import type Database from 'better-sqlite3';

import type { AllocationPlanInput, AllocationPlanRecord, RebalanceCadence } from '@quantdesk/shared';
import { parseJson, stringifyJson } from '../json';

interface AllocationPlanRow {
  id: string;
  name: string;
  strategy: AllocationPlanRecord['strategy'] | null;
  mode: AllocationPlanRecord['mode'];
  assets: string;
  constraints: string;
  result: string | null;
  base_currency: AllocationPlanRecord['baseCurrency'];
  start_date: string | null;
  end_date: string | null;
  rebalance_cadence: string;
  created_at: string;
  updated_at: string;
}

const normalizeRebalanceCadence = (value: string | null | undefined): RebalanceCadence => {
  if (value === 'monthly' || value === 'quarterly') {
    return value;
  }

  return 'none';
};

const mapAllocationPlanRow = (row: AllocationPlanRow): AllocationPlanRecord => ({
  id: row.id,
  name: row.name,
  strategy: row.strategy ?? row.mode,
  mode: row.mode,
  assets: parseJson<string[]>(row.assets),
  constraints: parseJson<AllocationPlanRecord['constraints']>(row.constraints),
  result: row.result ? parseJson<AllocationPlanRecord['result']>(row.result) : null,
  baseCurrency: row.base_currency,
  startDate: row.start_date ?? undefined,
  endDate: row.end_date ?? undefined,
  rebalanceCadence: normalizeRebalanceCadence(row.rebalance_cadence),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const createAllocationPlanRepository = (
  database: Database.Database,
) => {
  const getById = (id: string) => {
    const row = database
      .prepare(
        `
          SELECT *
          FROM allocation_plans
          WHERE id = ?
        `,
      )
      .get(id) as AllocationPlanRow | undefined;

    return row ? mapAllocationPlanRow(row) : null;
  };

  return {
    save(input: AllocationPlanInput) {
      database
        .prepare(
          `
            INSERT INTO allocation_plans (
              id, name, strategy, mode, assets, constraints, result, base_currency, start_date, end_date, rebalance_cadence
            )
            VALUES (
              @id, @name, @strategy, @mode, @assets, @constraints, @result, @baseCurrency, @startDate, @endDate, @rebalanceCadence
            )
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              strategy = excluded.strategy,
              mode = excluded.mode,
              assets = excluded.assets,
              constraints = excluded.constraints,
              result = excluded.result,
              base_currency = excluded.base_currency,
              start_date = excluded.start_date,
              end_date = excluded.end_date,
              rebalance_cadence = excluded.rebalance_cadence,
              updated_at = CURRENT_TIMESTAMP
          `,
        )
        .run({
          id: input.id,
          name: input.name,
          strategy: input.strategy ?? input.mode,
          mode: input.mode,
          assets: stringifyJson(input.assets),
          constraints: stringifyJson(input.constraints),
          result: input.result ? stringifyJson(input.result) : null,
          baseCurrency: input.baseCurrency,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          rebalanceCadence: input.rebalanceCadence ?? 'none',
        });

      return getById(input.id) as AllocationPlanRecord;
    },
    list() {
      const rows = database
        .prepare(
          `
            SELECT *
            FROM allocation_plans
            ORDER BY updated_at DESC, created_at DESC
          `,
        )
        .all() as AllocationPlanRow[];

      return rows.map(mapAllocationPlanRow);
    },
    getById,
    delete(id: string) {
      const result = database
        .prepare(
          `
            DELETE FROM allocation_plans
            WHERE id = ?
          `,
        )
        .run(id);

      return result.changes > 0;
    },
  };
};