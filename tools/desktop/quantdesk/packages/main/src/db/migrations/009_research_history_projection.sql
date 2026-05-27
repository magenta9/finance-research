CREATE TABLE IF NOT EXISTS research_request_history_projection (
  request_id TEXT PRIMARY KEY,
  projection TEXT NOT NULL,
  action_level TEXT,
  task_type TEXT,
  runtime_mode TEXT,
  target_text TEXT NOT NULL DEFAULT '',
  available_count INTEGER NOT NULL DEFAULT 0,
  degraded_count INTEGER NOT NULL DEFAULT 0,
  contract_count INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  provider_failure_count INTEGER NOT NULL DEFAULT 0,
  researcher_failure_count INTEGER NOT NULL DEFAULT 0,
  review_triggered INTEGER NOT NULL DEFAULT 0,
  blocked_gate_count INTEGER NOT NULL DEFAULT 0,
  warned_gate_count INTEGER NOT NULL DEFAULT 0,
  tool_execution_count INTEGER NOT NULL DEFAULT 0,
  data_gap_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES research_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_history_projection_runtime
ON research_request_history_projection (runtime_mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_history_projection_task
ON research_request_history_projection (task_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_history_projection_action
ON research_request_history_projection (action_level, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_history_projection_failures
ON research_request_history_projection (provider_failure_count, researcher_failure_count, review_triggered, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_history_projection_gates
ON research_request_history_projection (blocked_gate_count, warned_gate_count, updated_at DESC);
