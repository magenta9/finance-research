CREATE TABLE IF NOT EXISTS assets (
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

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  portfolio_name TEXT NOT NULL DEFAULT 'default',
  asset_id TEXT NOT NULL,
  shares REAL NOT NULL,
  cost_basis REAL,
  currency TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS allocation_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  assets TEXT NOT NULL,
  constraints TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  base_currency TEXT NOT NULL DEFAULT 'CNY',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  messages TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
CREATE INDEX IF NOT EXISTS idx_positions_portfolio_name ON positions(portfolio_name);
CREATE INDEX IF NOT EXISTS idx_daily_prices_fetched_at ON daily_prices(asset_id, fetched_at);
