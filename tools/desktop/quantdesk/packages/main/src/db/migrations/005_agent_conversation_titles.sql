ALTER TABLE agent_conversations ADD COLUMN title_source TEXT NOT NULL DEFAULT 'placeholder';
ALTER TABLE agent_conversations ADD COLUMN title_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE agent_conversations ADD COLUMN title_updated_at TEXT;