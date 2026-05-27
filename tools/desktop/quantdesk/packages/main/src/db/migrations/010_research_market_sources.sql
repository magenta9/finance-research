CREATE TABLE IF NOT EXISTS research_market_sources (
    source_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT,
    quality_status TEXT NOT NULL DEFAULT 'warn',
    content_hash TEXT,
    summary TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    content_text TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_research_market_sources_provider
    ON research_market_sources(provider_id, published_at);

CREATE INDEX IF NOT EXISTS idx_research_market_sources_fetched
    ON research_market_sources(fetched_at, quality_status);
