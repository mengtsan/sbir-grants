-- Cache company lookup responses so frontend and verification do not repeatedly hit g0v.
CREATE TABLE company_search_cache (
    normalized_query TEXT PRIMARY KEY,
    response_json TEXT NOT NULL,
    found_count INTEGER DEFAULT 0,
    official_name TEXT,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX idx_company_search_cache_expires_at ON company_search_cache(expires_at);

-- Persist company lookup intent for future business development analysis.
CREATE TABLE company_search_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT,
    query TEXT NOT NULL,
    normalized_query TEXT NOT NULL,
    source TEXT NOT NULL,
    found_count INTEGER DEFAULT 0,
    official_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX idx_company_search_events_user_created ON company_search_events(user_id, created_at DESC);
CREATE INDEX idx_company_search_events_normalized_query ON company_search_events(normalized_query);
