ALTER TABLE watch_price_audits ADD COLUMN IF NOT EXISTS candidate_source_id BIGINT NULL;
ALTER TABLE watch_price_audits ADD COLUMN IF NOT EXISTS candidate_group_external_id VARCHAR(128) NULL;
ALTER TABLE watch_price_audits ADD COLUMN IF NOT EXISTS target_group_id BIGINT NULL;
ALTER TABLE watch_price_audits ADD COLUMN IF NOT EXISTS platform VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE watch_price_audits ADD COLUMN IF NOT EXISTS model VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE watch_price_audits ADD COLUMN IF NOT EXISTS rollback_of_id BIGINT NULL REFERENCES watch_price_audits(id);
ALTER TABLE watch_price_audits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_watch_price_audits_created
    ON watch_price_audits (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_watch_price_audits_rollback
    ON watch_price_audits (rollback_of_id) WHERE rollback_of_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS watch_pricing_rules (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    target_group_id BIGINT NOT NULL,
    mode VARCHAR(32) NOT NULL CHECK (mode IN ('group_multiplier', 'model_price')),
    platform VARCHAR(64) NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL DEFAULT '',
    component VARCHAR(32) NOT NULL DEFAULT 'input' CHECK (component IN ('input', 'output', 'per_request')),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK (interval_seconds BETWEEN 60 AND 86400),
    run_sequence BIGINT NOT NULL DEFAULT 0,
    last_run_at TIMESTAMPTZ NULL,
    next_run_at TIMESTAMPTZ NULL,
    last_status VARCHAR(32) NULL,
    last_error_code VARCHAR(64) NULL,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (mode <> 'model_price' OR model <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_pricing_rules_name_ci ON watch_pricing_rules (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_watch_pricing_rules_due ON watch_pricing_rules (enabled, next_run_at, id);
