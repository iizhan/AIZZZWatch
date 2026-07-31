-- External Watch sources and their latest normalized observations.
-- Secrets are encrypted by the existing server-side SecretEncryptor and kept
-- in a separate table so normal source reads can never return ciphertext.
CREATE TABLE IF NOT EXISTS watch_sources (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    adapter_type VARCHAR(32) NOT NULL CHECK (adapter_type IN ('sub2api', 'newapi', 'custom')),
    base_url TEXT NOT NULL,
    api_base_url TEXT NOT NULL,
    recharge_ratio NUMERIC(20, 8) NOT NULL DEFAULT 1 CHECK (recharge_ratio > 0),
    low_balance_threshold NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (low_balance_threshold >= 0),
    polling_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (polling_interval_seconds BETWEEN 30 AND 3600),
    request_timeout_seconds INTEGER NOT NULL DEFAULT 15 CHECK (request_timeout_seconds BETWEEN 3 AND 60),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_check_status VARCHAR(32) NULL,
    last_check_at TIMESTAMPTZ NULL,
    last_success_at TIMESTAMPTZ NULL,
    last_error_code VARCHAR(64) NULL,
    last_latency_ms INTEGER NULL,
    last_balance NUMERIC(20, 8) NULL,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_sources_name_ci ON watch_sources (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_watch_sources_due ON watch_sources (enabled, last_check_at);

CREATE TABLE IF NOT EXISTS watch_source_credentials (
    source_id BIGINT PRIMARY KEY REFERENCES watch_sources(id) ON DELETE CASCADE,
    credential_type VARCHAR(32) NOT NULL CHECK (credential_type IN ('bearer', 'api_key', 'cookie')),
    encrypted_value TEXT NOT NULL,
    updated_by BIGINT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watch_source_groups (
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    external_id VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(64) NOT NULL DEFAULT '',
    rate_multiplier NUMERIC(20, 8) NOT NULL,
    user_rate_multiplier NUMERIC(20, 8) NULL,
    pricing_available BOOLEAN NOT NULL DEFAULT FALSE,
    observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_source_groups_rank
    ON watch_source_groups (platform, rate_multiplier, observed_at DESC);

CREATE TABLE IF NOT EXISTS watch_source_prices (
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    group_external_id VARCHAR(128) NOT NULL,
    platform VARCHAR(64) NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL,
    component VARCHAR(32) NOT NULL CHECK (component IN ('input', 'output', 'per_request')),
    value NUMERIC(20, 8) NOT NULL CHECK (value >= 0),
    observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (source_id, group_external_id, platform, model, component)
);
CREATE INDEX IF NOT EXISTS idx_watch_source_prices_rank
    ON watch_source_prices (platform, model, component, value, observed_at DESC);
