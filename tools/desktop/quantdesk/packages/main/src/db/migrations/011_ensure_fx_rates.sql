CREATE TABLE IF NOT EXISTS fx_rates (
  pair TEXT NOT NULL,
  date TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (pair, date)
);