-- Watch upstream source keepalive and password-auth state.
-- This migration is additive so official Sub2API upgrades can continue to merge
-- without coupling Watch data to core account/group tables.

ALTER TABLE watch_sources
    ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(32) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS profile_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS groups_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS rates_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS pricing_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS keys_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS login_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS heartbeat_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS keepalive_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS keepalive_interval_seconds INTEGER NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS last_keepalive_status VARCHAR(32) NULL,
    ADD COLUMN IF NOT EXISTS last_keepalive_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_keepalive_success_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_keepalive_error_code VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS last_keepalive_latency_ms INTEGER NULL,
    ADD COLUMN IF NOT EXISTS last_token_refreshed_at TIMESTAMPTZ NULL;

ALTER TABLE watch_source_credentials
    ADD COLUMN IF NOT EXISTS encrypted_login_value TEXT NULL,
    ADD COLUMN IF NOT EXISTS token_updated_at TIMESTAMPTZ NULL;

UPDATE watch_sources
SET
    profile_path = CASE WHEN profile_path = '' THEN
        CASE WHEN adapter_type = 'newapi' THEN '/api/user/self' ELSE '/user/profile' END
        ELSE profile_path END,
    groups_path = CASE WHEN groups_path = '' THEN
        CASE WHEN adapter_type = 'newapi' THEN '/api/user/self/groups' ELSE '/groups/available' END
        ELSE groups_path END,
    rates_path = CASE WHEN rates_path = '' THEN
        CASE WHEN adapter_type = 'newapi' THEN '' ELSE '/groups/rates' END
        ELSE rates_path END,
    pricing_path = CASE WHEN pricing_path = '' THEN
        CASE WHEN adapter_type = 'newapi' THEN '/api/pricing' ELSE '/channels/available' END
        ELSE pricing_path END,
    keys_path = CASE WHEN keys_path = '' THEN
        CASE
            WHEN adapter_type = 'newapi' THEN '/api/token/?p=0&size=100'
            WHEN adapter_type = 'custom' THEN ''
            ELSE '/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai'
        END
        ELSE keys_path END,
    login_path = CASE WHEN login_path = '' THEN
        CASE WHEN adapter_type = 'newapi' THEN '/api/user/login' ELSE '/auth/login' END
        ELSE login_path END,
    heartbeat_path = CASE WHEN heartbeat_path = '' THEN
        CASE WHEN adapter_type = 'newapi' THEN '/api/user/self' ELSE '/user/profile' END
        ELSE heartbeat_path END,
    keepalive_interval_seconds = CASE
        WHEN keepalive_interval_seconds <= 0 THEN 300
        ELSE keepalive_interval_seconds
    END;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'watch_sources_auth_mode_check'
    ) THEN
        ALTER TABLE watch_sources
            ADD CONSTRAINT watch_sources_auth_mode_check
            CHECK (auth_mode IN ('manual', 'password'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'watch_sources_keepalive_interval_check'
    ) THEN
        ALTER TABLE watch_sources
            ADD CONSTRAINT watch_sources_keepalive_interval_check
            CHECK (keepalive_interval_seconds BETWEEN 30 AND 86400);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_watch_sources_keepalive_due
    ON watch_sources (enabled, keepalive_enabled, last_keepalive_at);
