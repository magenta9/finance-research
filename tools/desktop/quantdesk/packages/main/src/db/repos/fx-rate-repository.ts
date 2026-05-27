import type Database from 'better-sqlite3';

import type { FxRateInput, FxRateRecord } from '@quantdesk/shared';

interface FxRateRow {
  pair: string;
  date: string;
  rate: number;
  source: string;
}

const mapFxRateRow = (row: FxRateRow): FxRateRecord => ({
  pair: row.pair,
  date: row.date,
  rate: row.rate,
  source: row.source,
});

export const createFxRateRepository = (
  database: Database.Database,
) => ({
  insertMany(inputs: FxRateInput[]) {
    const insert = database.prepare(
      `
        INSERT INTO fx_rates (pair, date, rate, source)
        VALUES (@pair, @date, @rate, @source)
        ON CONFLICT(pair, date) DO UPDATE SET
          rate = excluded.rate,
          source = excluded.source
      `,
    );

    const transaction = database.transaction((rows: FxRateInput[]) => {
      for (const row of rows) {
        insert.run(row);
      }
    });

    transaction(inputs);
  },
  getLatestRate(pair: string, onOrBeforeDate: string) {
    const row = database
      .prepare(
        `
          SELECT *
          FROM fx_rates
          WHERE pair = @pair
            AND date <= @onOrBeforeDate
          ORDER BY date DESC
          LIMIT 1
        `,
      )
      .get({ pair, onOrBeforeDate }) as FxRateRow | undefined;

    return row ? mapFxRateRow(row) : null;
  },
  getDateBounds(pair: string) {
    const row = database
      .prepare(
        `
          SELECT MIN(date) AS earliest_date, MAX(date) AS latest_date
          FROM fx_rates
          WHERE pair = ?
        `,
      )
      .get(pair) as { earliest_date: string | null; latest_date: string | null };

    return {
      earliestDate: row.earliest_date,
      latestDate: row.latest_date,
    };
  },
  getRange(pair: string, startDate: string, endDate: string) {
    const rows = database
      .prepare(
        `
          SELECT *
          FROM fx_rates
          WHERE pair = @pair
            AND date BETWEEN @startDate AND @endDate
          ORDER BY date ASC
        `,
      )
      .all({ pair, startDate, endDate }) as FxRateRow[];

    return rows.map(mapFxRateRow);
  },
  count() {
    const row = database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM fx_rates
        `,
      )
      .get() as { count: number };

    return row.count;
  },
  clearAll() {
    database.prepare('DELETE FROM fx_rates').run();
  },
});