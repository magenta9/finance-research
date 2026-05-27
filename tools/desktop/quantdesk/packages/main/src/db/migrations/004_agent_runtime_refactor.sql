ALTER TABLE agent_conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE agent_conversations ADD COLUMN degraded_mode TEXT;

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  tool_call_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE,
  UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_seq
ON conversation_messages (conversation_id, seq);

CREATE TABLE IF NOT EXISTS compaction_snapshots (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  covered_message_ids TEXT NOT NULL,
  token_estimate INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_compaction_snapshots_conversation_created
ON compaction_snapshots (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  error_json TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  token_count INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_conversation_created
ON tool_executions (conversation_id, created_at DESC);