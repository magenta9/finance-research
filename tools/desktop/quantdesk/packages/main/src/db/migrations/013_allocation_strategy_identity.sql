CREATE TABLE IF NOT EXISTS allocation_plans (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	mode TEXT NOT NULL,
	assets TEXT NOT NULL,
	constraints TEXT NOT NULL DEFAULT '{}',
	result TEXT,
	base_currency TEXT NOT NULL DEFAULT 'CNY',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	start_date TEXT,
	end_date TEXT,
	rebalance_cadence TEXT NOT NULL DEFAULT 'none'
);

ALTER TABLE allocation_plans ADD COLUMN strategy TEXT;

UPDATE allocation_plans
SET strategy = mode
WHERE strategy IS NULL;