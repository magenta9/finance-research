CREATE TABLE IF NOT EXISTS daily_prices (
  asset_id TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume REAL,
  adjusted_close REAL,
  source TEXT NOT NULL DEFAULT 'unknown',
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id, date),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fx_rates (
  pair TEXT NOT NULL,
  date TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (pair, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_prices_fetched_at ON daily_prices(asset_id, fetched_at);