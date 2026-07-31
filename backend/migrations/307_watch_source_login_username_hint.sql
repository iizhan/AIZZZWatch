-- Watch upstream source login username display hint.
-- Keep the applied 196 migration immutable; this additive migration only stores
-- a masked username hint so the frontend can show that login credentials exist
-- without returning the saved username/password.

ALTER TABLE watch_sources
    ADD COLUMN IF NOT EXISTS login_username_hint TEXT NOT NULL DEFAULT '';
