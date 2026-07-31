-- Watch account-to-upstream relationship tracking.
-- This remains isolated from official Sub2API account/group tables so upstream
-- project upgrades can continue to merge without schema coupling.

CREATE TABLE IF NOT EXISTS watch_source_keys (
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    external_id VARCHAR(128) NOT NULL,
    label VARCHAR(255) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT '',
    group_external_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    group_names JSONB NOT NULL DEFAULT '[]'::jsonb,
    key_digest VARCHAR(64) NULL,
    summary TEXT NULL,
    external_created_at TIMESTAMPTZ NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_source_keys_source_observed
    ON watch_source_keys (source_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_source_keys_digest
    ON watch_source_keys (key_digest) WHERE key_digest IS NOT NULL;

CREATE TABLE IF NOT EXISTS watch_account_upstream_mappings (
    account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    source_key_external_id VARCHAR(128) NOT NULL,
    source_group_external_id VARCHAR(128) NULL,
    mapping_method VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (mapping_method IN ('manual','auto')),
    updated_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_account_upstream_mappings_source
    ON watch_account_upstream_mappings (source_id, source_key_external_id);
