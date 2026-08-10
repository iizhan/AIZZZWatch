-- Track principal and bonus amounts for administrator balance recharges.
-- Existing redeem-code rows remain valid and are treated as legacy adjustments.

ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS admin_principal_amount NUMERIC(20, 8) NULL;
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS admin_bonus_amount NUMERIC(20, 8) NULL;
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS admin_balance_before NUMERIC(20, 8) NULL;
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS admin_balance_after NUMERIC(20, 8) NULL;
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS admin_actor_id BIGINT NULL;
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS admin_operation_key_hash VARCHAR(64) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'redeem_codes_admin_principal_nonnegative'
    ) THEN
        ALTER TABLE redeem_codes
            ADD CONSTRAINT redeem_codes_admin_principal_nonnegative
            CHECK (admin_principal_amount IS NULL OR admin_principal_amount > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'redeem_codes_admin_bonus_nonnegative'
    ) THEN
        ALTER TABLE redeem_codes
            ADD CONSTRAINT redeem_codes_admin_bonus_nonnegative
            CHECK (admin_bonus_amount IS NULL OR admin_bonus_amount >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'redeem_codes_admin_balance_order'
    ) THEN
        ALTER TABLE redeem_codes
            ADD CONSTRAINT redeem_codes_admin_balance_order
            CHECK (
                admin_balance_before IS NULL
                OR admin_balance_after IS NULL
                OR admin_balance_after >= admin_balance_before
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_redeem_codes_admin_operation
    ON redeem_codes (admin_actor_id, admin_operation_key_hash)
    WHERE type = 'admin_balance' AND admin_operation_key_hash IS NOT NULL;

COMMENT ON COLUMN redeem_codes.admin_principal_amount IS 'Principal portion of an administrator recharge';
COMMENT ON COLUMN redeem_codes.admin_bonus_amount IS 'Non-refundable bonus portion of an administrator recharge';
COMMENT ON COLUMN redeem_codes.admin_actor_id IS 'Administrator user id that performed the recharge';
COMMENT ON COLUMN redeem_codes.admin_operation_key_hash IS 'SHA-256 digest of the request idempotency key';
