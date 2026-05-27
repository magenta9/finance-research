import type Database from 'better-sqlite3';

import type { PreferenceMap } from '@quantdesk/shared';

interface PreferenceRow {
  key: string;
  value: string;
}

export const createPreferencesRepository = (
  database: Database.Database,
) => ({
  get(key: string) {
    const row = database
      .prepare(
        `
          SELECT value
          FROM user_preferences
          WHERE key = ?
        `,
      )
      .get(key) as { value: string } | undefined;

    return row?.value ?? null;
  },
  set(key: string, value: string) {
    database
      .prepare(
        `
          INSERT INTO user_preferences (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value
        `,
      )
      .run(key, value);

    return value;
  },
  getAll() {
    const rows = database
      .prepare(
        `
          SELECT key, value
          FROM user_preferences
        `,
      )
      .all() as PreferenceRow[];

    return rows.reduce<PreferenceMap>((accumulator, row) => {
      accumulator[row.key] = row.value;
      return accumulator;
    }, {});
  },
  delete(key: string) {
    const result = database
      .prepare(
        `
          DELETE FROM user_preferences
          WHERE key = ?
        `,
      )
      .run(key);

    return result.changes > 0;
  },
});