CREATE TABLE IF NOT EXISTS research_requests (
  id TEXT PRIMARY KEY,
  input TEXT NOT NULL,
  status TEXT NOT NULL,
  normalized_request TEXT,
  route TEXT,
  decision_card TEXT,
  report TEXT,
  error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_research_requests_status_updated
ON research_requests (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  role TEXT,
  payload TEXT NOT NULL,
  prompt_version_manifest TEXT NOT NULL DEFAULT '[]',
  data_provenance TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES research_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_artifacts_request_created
ON research_artifacts (request_id, created_at ASC);