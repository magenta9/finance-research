import type Database from 'better-sqlite3';

import type {
  DailyPriceInput,
  DailyPriceRecord,
  PriceFreshnessQuery,
  PriceRangeQuery,
} from '@quantdesk/shared';

interface DailyPriceRow {
  asset_id: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjusted_close: number | null;
  source: string;
  fetched_at: string;
}

interface DailyPriceCoverageSummaryRow {
  count: number;
  earliest_date: string | null;
  fetched_at: string | null;
  latest_date: string | null;
  latest_source: string | null;
  sources: string | null;
}

const mapDailyPriceRow = (row: DailyPriceRow): DailyPriceRecord => ({
  assetId: row.asset_id,
  date: row.date,
  open: row.open,
  high: row.high,
  low: row.low,
  close: row.close,
  volume: row.volume,
  adjustedClose: row.adjusted_close,
  source: row.source,
  fetchedAt: row.fetched_at,
});

export const createPriceRepository = (
  database: Database.Database,
) => ({
  insertMany(inputs: DailyPriceInput[]) {
    const insert = database.prepare(
      `
        INSERT INTO daily_prices (
          asset_id, date, open, high, low, close, volume, adjusted_close, source, fetched_at
        )
        VALUES (
          @assetId, @date, @open, @high, @low, @close, @volume, @adjustedClose, @source, @fetchedAt
        )
        ON CONFLICT(asset_id, date) DO UPDATE SET
          open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          close = excluded.close,
          volume = excluded.volume,
          adjusted_close = excluded.adjusted_close,
          source = excluded.source,
          fetched_at = excluded.fetched_at
      `,
    );

    const transaction = database.transaction((rows: DailyPriceInput[]) => {
      for (const row of rows) {
        insert.run({
          ...row,
          fetchedAt: row.fetchedAt ?? new Date().toISOString(),
        });
      }
    });

    transaction(inputs);
  },
  listByAsset(assetId: string) {
    const rows = database
      .prepare(
        `
          SELECT *
          FROM daily_prices
          WHERE asset_id = ?
          ORDER BY date ASC
        `,
      )
      .all(assetId) as DailyPriceRow[];

    return rows.map(mapDailyPriceRow);
  },
  getRange({ assetId, endDate, startDate }: PriceRangeQuery) {
    const rows = database
      .prepare(
        `
          SELECT *
          FROM daily_prices
          WHERE asset_id = @assetId
            AND date BETWEEN @startDate AND @endDate
          ORDER BY date ASC
        `,
      )
      .all({ assetId, startDate, endDate }) as DailyPriceRow[];

    return rows.map(mapDailyPriceRow);
  },
  getDateBounds(assetId: string) {
    const row = database
      .prepare(
        `
          SELECT MIN(date) AS earliest_date, MAX(date) AS latest_date
          FROM daily_prices
          WHERE asset_id = ?
        `,
      )
      .get(assetId) as { earliest_date: string | null; latest_date: string | null };

    return {
      earliestDate: row.earliest_date,
      latestDate: row.latest_date,
    };
  },
  getCoverageSummaryByAssetId(assetId: string) {
    const row = database
      .prepare(
        `
          SELECT
            COUNT(*) AS count,
            MIN(date) AS earliest_date,
            MAX(date) AS latest_date,
            MAX(fetched_at) AS fetched_at,
            GROUP_CONCAT(DISTINCT source) AS sources,
            (
              SELECT source
              FROM daily_prices latest
              WHERE latest.asset_id = daily_prices.asset_id
              ORDER BY date DESC
              LIMIT 1
            ) AS latest_source
          FROM daily_prices
          WHERE asset_id = ?
        `,
      )
      .get(assetId) as DailyPriceCoverageSummaryRow;

    return {
      earliestDate: row.earliest_date,
      fetchedAt: row.fetched_at,
      latestDate: row.latest_date,
      latestSource: row.latest_source,
      providerIds: row.sources
        ? Array.from(new Set(row.sources.split(',').filter((source) => source.length > 0)))
        : [],
      rowCount: row.count,
    };
  },
  isFresh({ assetId, maxAgeHours, now }: PriceFreshnessQuery) {
    const row = database
      .prepare(
        `
          SELECT MAX(fetched_at) AS fetched_at
          FROM daily_prices
          WHERE asset_id = ?
        `,
      )
      .get(assetId) as { fetched_at: string | null };

    if (!row.fetched_at) {
      return false;
    }

    const referenceTime = now ? new Date(now) : new Date();
    const fetchedAt = new Date(row.fetched_at);
    const ageInHours =
      (referenceTime.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60);

    return ageInHours <= maxAgeHours;
  },
  count() {
    const row = database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM daily_prices
        `,
      )
      .get() as { count: number };

    return row.count;
  },
  countByAssetId(assetId: string) {
    const row = database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM daily_prices
          WHERE asset_id = ?
        `,
      )
      .get(assetId) as { count: number };

    return row.count;
  },
  getLatestFetchedAt() {
    const row = database
      .prepare(
        `
          SELECT MAX(fetched_at) AS fetched_at
          FROM daily_prices
        `,
      )
      .get() as { fetched_at: string | null };

    return row.fetched_at;
  },
  getLatestFetchedAtByAssetId(assetId: string) {
    const row = database
      .prepare(
        `
          SELECT MAX(fetched_at) AS fetched_at
          FROM daily_prices
          WHERE asset_id = ?
        `,
      )
      .get(assetId) as { fetched_at: string | null };

    return row.fetched_at;
  },
  clearAll() {
    database.prepare('DELETE FROM daily_prices').run();
  },
});