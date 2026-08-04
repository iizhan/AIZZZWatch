CREATE TABLE IF NOT EXISTS watch_rate_anomalies (
    id BIGSERIAL PRIMARY KEY,
    pricing_rule_id BIGINT REFERENCES watch_pricing_rules(id) ON DELETE SET NULL,
    target_group_id BIGINT NOT NULL,
    group_name_snapshot VARCHAR(255) NOT NULL DEFAULT '',
    kind VARCHAR(32) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    current_value NUMERIC(20, 8) NOT NULL,
    target_value NUMERIC(20, 8) NOT NULL,
    highest_upstream_cost NUMERIC(20, 8) NOT NULL,
    pricing_source VARCHAR(32) NOT NULL DEFAULT '',
    official_probe_count INTEGER NOT NULL DEFAULT 0,
    watch_fallback_count INTEGER NOT NULL DEFAULT 0,
    evidence_mismatch_count INTEGER NOT NULL DEFAULT 0,
    detected_at TIMESTAMPTZ NOT NULL,
    last_observed_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT watch_rate_anomalies_kind_check CHECK (kind IN ('underpriced', 'overpriced')),
    CONSTRAINT watch_rate_anomalies_status_check CHECK (status IN ('open', 'resolved')),
    CONSTRAINT watch_rate_anomalies_values_check CHECK (
        current_value >= 0 AND target_value >= 0 AND highest_upstream_cost >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_rate_anomalies_open_rule
    ON watch_rate_anomalies (pricing_rule_id)
    WHERE status = 'open' AND pricing_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_watch_rate_anomalies_status_observed
    ON watch_rate_anomalies (status, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_watch_rate_anomalies_group_detected
    ON watch_rate_anomalies (target_group_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS watch_rate_anomaly_samples (
    id BIGSERIAL PRIMARY KEY,
    anomaly_id BIGINT NOT NULL REFERENCES watch_rate_anomalies(id) ON DELETE CASCADE,
    observed_at TIMESTAMPTZ NOT NULL,
    current_value NUMERIC(20, 8) NOT NULL,
    target_value NUMERIC(20, 8) NOT NULL,
    highest_upstream_cost NUMERIC(20, 8) NOT NULL,
    pricing_source VARCHAR(32) NOT NULL DEFAULT '',
    official_probe_count INTEGER NOT NULL DEFAULT 0,
    watch_fallback_count INTEGER NOT NULL DEFAULT 0,
    evidence_mismatch_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT watch_rate_anomaly_samples_values_check CHECK (
        current_value >= 0 AND target_value >= 0 AND highest_upstream_cost >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_rate_anomaly_samples_identity
    ON watch_rate_anomaly_samples (anomaly_id, observed_at);

CREATE INDEX IF NOT EXISTS idx_watch_rate_anomaly_samples_timeline
    ON watch_rate_anomaly_samples (anomaly_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS watch_rate_compensations (
    id BIGSERIAL PRIMARY KEY,
    anomaly_id BIGINT REFERENCES watch_rate_anomalies(id) ON DELETE RESTRICT,
    target_group_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(24) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    request_count BIGINT NOT NULL DEFAULT 0,
    unresolved_request_count BIGINT NOT NULL DEFAULT 0,
    actual_cost NUMERIC(20, 10) NOT NULL DEFAULT 0,
    expected_cost NUMERIC(20, 10) NOT NULL DEFAULT 0,
    candidate_amount NUMERIC(20, 10) NOT NULL DEFAULT 0,
    compensated_amount NUMERIC(20, 10) NOT NULL DEFAULT 0,
    balance_before NUMERIC(20, 10),
    balance_after NUMERIC(20, 10),
    operator_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT watch_rate_compensations_status_check CHECK (status IN ('applied', 'external')),
    CONSTRAINT watch_rate_compensations_window_check CHECK (window_start < window_end),
    CONSTRAINT watch_rate_compensations_amount_check CHECK (
        actual_cost >= 0 AND expected_cost >= 0 AND candidate_amount >= 0 AND compensated_amount >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_rate_compensations_anomaly_user
    ON watch_rate_compensations (anomaly_id, user_id)
    WHERE anomaly_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_watch_rate_compensations_user_created
    ON watch_rate_compensations (user_id, created_at DESC);

COMMENT ON TABLE watch_rate_anomalies IS
    'Open/resolved downstream group-rate deviations detected from verified Watch pricing rules.';
COMMENT ON TABLE watch_rate_anomaly_samples IS
    'Time-ordered, sanitized pricing evidence used for anomaly audit and compensation reconstruction.';
COMMENT ON TABLE watch_rate_compensations IS
    'Idempotent user balance compensations or externally-applied compensation registrations.';
