ALTER TABLE allocation_plans ADD COLUMN start_date TEXT;
ALTER TABLE allocation_plans ADD COLUMN end_date TEXT;
ALTER TABLE allocation_plans ADD COLUMN rebalance_cadence TEXT NOT NULL DEFAULT 'none';

UPDATE allocation_plans
SET result = NULL
WHERE result IS NOT NULL;