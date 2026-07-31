-- Watch 独立数据基础表。只保存检测状态与最小化审计，不保存令牌、密钥或完整响应。
CREATE TABLE IF NOT EXISTS watch_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    price_mode VARCHAR(32) NOT NULL DEFAULT 'group_multiplier',
    freshness_seconds INTEGER NOT NULL DEFAULT 300 CHECK (freshness_seconds BETWEEN 30 AND 3600),
    updated_by BIGINT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO watch_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS watch_checks (
    id BIGSERIAL PRIMARY KEY,
    target_type VARCHAR(32) NOT NULL,
    target_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    error_code VARCHAR(64) NULL,
    latency_ms INTEGER NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_checks_target_observed ON watch_checks (target_type, target_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_checks_expiry ON watch_checks (expires_at);

CREATE TABLE IF NOT EXISTS watch_price_audits (
    id BIGSERIAL PRIMARY KEY,
    target_type VARCHAR(32) NOT NULL,
    target_id BIGINT NOT NULL,
    mode VARCHAR(32) NOT NULL,
    component VARCHAR(32) NULL,
    previous_value NUMERIC(20, 8) NULL,
    next_value NUMERIC(20, 8) NULL,
    candidate_group_id BIGINT NULL,
    action VARCHAR(32) NOT NULL,
    reason VARCHAR(255) NULL,
    actor_user_id BIGINT NULL,
    idempotency_key VARCHAR(128) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_price_audits_target_created ON watch_price_audits (target_type, target_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_price_audits_idempotency ON watch_price_audits (idempotency_key) WHERE idempotency_key IS NOT NULL;
