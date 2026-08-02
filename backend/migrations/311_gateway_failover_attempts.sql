-- Track each upstream account attempt made for one client request.
-- This table intentionally stores no request body, token, cookie, or credential.
CREATE TABLE IF NOT EXISTS gateway_failover_attempts (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    group_id BIGINT REFERENCES groups(id) ON DELETE SET NULL,
    account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
    failure_kind VARCHAR(32) NOT NULL DEFAULT 'none'
        CHECK (failure_kind IN ('none', 'http_status', 'transport', 'stream_started', 'client_canceled')),
    upstream_status_code INTEGER,
    state VARCHAR(24) NOT NULL DEFAULT 'started'
        CHECK (state IN ('started', 'failed', 'succeeded', 'canceled')),
    billing_status VARCHAR(24) NOT NULL DEFAULT 'not_billable'
        CHECK (billing_status IN ('not_billable', 'standard_usage', 'pending_reconciliation', 'reserved', 'settled', 'released')),
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    actual_cost NUMERIC(20,10),
    reserved_cost NUMERIC(20,10) NOT NULL DEFAULT 0,
    settled_cost NUMERIC(20,10) NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    response_started BOOLEAN NOT NULL DEFAULT FALSE,
    upstream_request_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_gateway_failover_attempts_user_created
    ON gateway_failover_attempts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gateway_failover_attempts_request
    ON gateway_failover_attempts (request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gateway_failover_attempts_billing_status
    ON gateway_failover_attempts (billing_status, created_at);

COMMENT ON TABLE gateway_failover_attempts IS 'Per-upstream-attempt audit and billing reconciliation records; never stores request bodies or credentials.';
