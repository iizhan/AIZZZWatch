-- Watch upstream source response field mapping.
-- This keeps custom/fork parsing rules in Watch-owned tables only and never
-- stores raw upstream responses or credentials.

ALTER TABLE watch_sources
    ADD COLUMN IF NOT EXISTS read_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;
