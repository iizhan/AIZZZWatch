-- Stage historical failover overcharge candidates without changing balances.
-- Actual refunds require a separate, explicitly authorized application path.
CREATE TABLE IF NOT EXISTS gateway_failover_refund_candidates (
    id BIGSERIAL PRIMARY KEY,
    attempt_id BIGINT NOT NULL REFERENCES gateway_failover_attempts(id) ON DELETE RESTRICT,
    refund_key VARCHAR(160) NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    request_id VARCHAR(128) NOT NULL,
    attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
    original_settled_cost NUMERIC(20,10) NOT NULL CHECK (original_settled_cost > 0),
    candidate_cost NUMERIC(20,10) NOT NULL CHECK (candidate_cost > 0),
    status VARCHAR(24) NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'refunded', 'canceled')),
    refunded_cost NUMERIC(20,10) NOT NULL DEFAULT 0
        CHECK (refunded_cost >= 0 AND refunded_cost <= candidate_cost),
    refunded_at TIMESTAMPTZ,
    refunded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    refund_reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (attempt_id),
    UNIQUE (refund_key),
    CHECK (
        (status = 'refunded' AND refunded_cost > 0 AND refunded_at IS NOT NULL)
        OR status <> 'refunded'
    )
);

CREATE INDEX IF NOT EXISTS idx_gateway_failover_refund_candidates_user_created
    ON gateway_failover_refund_candidates (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gateway_failover_refund_candidates_status
    ON gateway_failover_refund_candidates (status, created_at);

COMMENT ON TABLE gateway_failover_refund_candidates IS
    'Idempotent staging ledger for historical failover overcharge review; creation never changes balances or quotas.';
