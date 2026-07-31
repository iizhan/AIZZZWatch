CREATE TABLE IF NOT EXISTS watch_price_changes (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    group_external_id VARCHAR(128) NOT NULL,
    platform VARCHAR(64) NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL DEFAULT '',
    component VARCHAR(32) NOT NULL,
    previous_value NUMERIC(20, 8) NOT NULL,
    next_value NUMERIC(20, 8) NOT NULL,
    change_kind VARCHAR(16) NOT NULL CHECK (change_kind IN ('increase', 'decrease')),
    observed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_price_changes_source_observed
    ON watch_price_changes (source_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_watch_price_changes_observed
    ON watch_price_changes (observed_at DESC, id DESC);
