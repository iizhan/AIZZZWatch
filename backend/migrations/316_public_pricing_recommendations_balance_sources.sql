-- Public Watch pricing, user recommendations and balance source snapshots.
-- Additive and idempotent: old orders and balances remain readable.

ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS recharge_base_amount NUMERIC(20, 8) NULL;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS recharge_bonus_amount NUMERIC(20, 8) NULL;
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(20, 8) NULL;

CREATE TABLE IF NOT EXISTS balance_source_lots (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(32) NOT NULL,
    source_id BIGINT NULL,
    principal_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
    bonus_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
    unknown_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (unknown_amount >= 0),
    remaining_principal NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (remaining_principal >= 0),
    remaining_bonus NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (remaining_bonus >= 0),
    remaining_unknown NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (remaining_unknown >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (remaining_principal <= principal_amount),
    CHECK (remaining_bonus <= bonus_amount),
    CHECK (remaining_unknown <= unknown_amount)
);
CREATE INDEX IF NOT EXISTS idx_balance_source_lots_fifo
    ON balance_source_lots (user_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_source_lots_source
    ON balance_source_lots (source_type, source_id) WHERE source_id IS NOT NULL;

-- Existing balances predate source snapshots and must never be presented as
-- verified recharge principal. The user id is a stable idempotency key when a
-- migration runner or an operator safely replays this additive migration.
INSERT INTO balance_source_lots (
    user_id,
    source_type,
    source_id,
    principal_amount,
    bonus_amount,
    unknown_amount,
    remaining_principal,
    remaining_bonus,
    remaining_unknown
)
SELECT
    u.id,
    'historical_opening',
    u.id,
    0,
    0,
    u.balance + COALESCE(u.frozen_balance, 0),
    0,
    0,
    u.balance + COALESCE(u.frozen_balance, 0)
FROM users u
WHERE u.deleted_at IS NULL AND u.balance + COALESCE(u.frozen_balance, 0) > 0
ON CONFLICT DO NOTHING;

-- Batch image holds move money from balance to frozen_balance before usage is
-- known. Preserve the exact funding components so later recharges and regular
-- requests cannot change the source attributed to the batch settlement.
CREATE TABLE IF NOT EXISTS balance_source_holds (
    id BIGSERIAL PRIMARY KEY,
    lot_id BIGINT NOT NULL REFERENCES balance_source_lots(id) ON DELETE RESTRICT,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id VARCHAR(64) NOT NULL REFERENCES batch_image_jobs(batch_id) ON DELETE RESTRICT,
    principal_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
    bonus_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
    unknown_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (unknown_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, lot_id),
    CHECK (principal_amount + bonus_amount + unknown_amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_balance_source_holds_user_batch
    ON balance_source_holds (user_id, batch_id);

CREATE TABLE IF NOT EXISTS balance_source_allocations (
    id BIGSERIAL PRIMARY KEY,
    lot_id BIGINT NOT NULL REFERENCES balance_source_lots(id) ON DELETE RESTRICT,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_log_id BIGINT NULL,
    request_id VARCHAR(128) NOT NULL,
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    principal_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
    bonus_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
    unknown_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (unknown_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_balance_source_allocations_user_created
    ON balance_source_allocations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_source_allocations_request
    ON balance_source_allocations (request_id);

CREATE TABLE IF NOT EXISTS watch_public_pricing (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    group_external_id VARCHAR(128) NOT NULL,
    public_name VARCHAR(255) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, group_external_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_public_pricing_enabled
    ON watch_public_pricing (enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_model_options (
    id BIGSERIAL PRIMARY KEY,
    model_key VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO recommendation_model_options (model_key, display_name, sort_order)
VALUES ('claude', 'Claude', 10), ('gpt', 'GPT', 20), ('gptpro', 'GPT Pro', 30)
ON CONFLICT (model_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_recommendations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_url TEXT NOT NULL,
    model_key VARCHAR(64) NOT NULL,
    submitted_multiplier NUMERIC(20, 8) NOT NULL CHECK (submitted_multiplier > 0),
    requested_reward_type VARCHAR(32) NOT NULL CHECK (requested_reward_type IN ('profit_share', 'one_time_credit')),
    note TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'adopted', 'rejected')),
    decision_reason TEXT NULL,
    adopted_source_id BIGINT NULL REFERENCES watch_sources(id) ON DELETE SET NULL,
    adopted_at TIMESTAMPTZ NULL,
    decided_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_recommendations_user_created
    ON user_recommendations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_recommendations_status_created
    ON user_recommendations (status, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_rewards (
    id BIGSERIAL PRIMARY KEY,
    recommendation_id BIGINT NOT NULL REFERENCES user_recommendations(id) ON DELETE RESTRICT,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reward_type VARCHAR(32) NOT NULL CHECK (reward_type IN ('profit_share', 'one_time_credit')),
    amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    share_percent NUMERIC(10, 6) NOT NULL DEFAULT 1 CHECK (share_percent >= 0 AND share_percent <= 100),
    cap_amount NUMERIC(20, 8) NOT NULL DEFAULT 100 CHECK (cap_amount >= 0),
    expires_at TIMESTAMPTZ NULL,
    transferred_amount NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (transferred_amount >= 0),
    admin_note TEXT NULL,
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    created_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recommendation_rewards_user_created
    ON recommendation_rewards (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_reward_accruals (
    id BIGSERIAL PRIMARY KEY,
    reward_id BIGINT NOT NULL REFERENCES recommendation_rewards(id) ON DELETE CASCADE,
    usage_log_id BIGINT NOT NULL,
    positive_margin NUMERIC(20, 8) NOT NULL CHECK (positive_margin >= 0),
    reward_amount NUMERIC(20, 8) NOT NULL CHECK (reward_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (reward_id, usage_log_id)
);
CREATE INDEX IF NOT EXISTS idx_recommendation_reward_accruals_reward
    ON recommendation_reward_accruals (reward_id, created_at DESC);
