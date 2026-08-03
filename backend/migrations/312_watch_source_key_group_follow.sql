-- Keep a confirmed account mapping aligned with the same upstream Key when
-- that Key moves to one unambiguous upstream group. The observed group set is
-- not credential material; it is retained only to detect later assignment
-- changes without repeatedly invalidating an unchanged manual confirmation.

ALTER TABLE watch_sources
    ADD COLUMN IF NOT EXISTS auto_follow_key_group BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE watch_account_upstream_mappings
    ADD COLUMN IF NOT EXISTS group_binding_state VARCHAR(24) NOT NULL DEFAULT 'confirmed',
    ADD COLUMN IF NOT EXISTS confirmed_group_external_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_key_observed_at TIMESTAMPTZ NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'watch_account_upstream_mappings_group_binding_state_check'
    ) THEN
        ALTER TABLE watch_account_upstream_mappings
            ADD CONSTRAINT watch_account_upstream_mappings_group_binding_state_check
            CHECK (group_binding_state IN ('confirmed', 'needs_confirmation'));
    END IF;
END $$;

UPDATE watch_account_upstream_mappings m
SET
    confirmed_group_external_ids = CASE
        WHEN jsonb_typeof(k.group_external_ids) = 'array'
             AND jsonb_array_length(k.group_external_ids) > 0
            THEN k.group_external_ids
        WHEN NULLIF(m.source_group_external_id, '') IS NOT NULL
            THEN jsonb_build_array(m.source_group_external_id)
        ELSE '[]'::jsonb
    END,
    source_key_observed_at = k.observed_at
FROM watch_source_keys k
WHERE k.source_id = m.source_id
  AND k.external_id = m.source_key_external_id
  AND m.confirmed_group_external_ids = '[]'::jsonb;

UPDATE watch_account_upstream_mappings
SET confirmed_group_external_ids = jsonb_build_array(source_group_external_id)
WHERE confirmed_group_external_ids = '[]'::jsonb
  AND NULLIF(source_group_external_id, '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_watch_account_upstream_mappings_binding_state
    ON watch_account_upstream_mappings (source_id, group_binding_state)
    WHERE group_binding_state = 'needs_confirmation';
