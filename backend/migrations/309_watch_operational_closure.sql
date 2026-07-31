-- Watch Web operational closure.
-- Add source/group historical ledgers, mapping validity history and snapshot
-- names for price changes. Keep this additive and isolated from official
-- Sub2API tables so upstream upgrades can still be merged cleanly.

ALTER TABLE watch_price_changes
    ADD COLUMN IF NOT EXISTS source_name_snapshot TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS group_name_snapshot TEXT NOT NULL DEFAULT '';

UPDATE watch_price_changes c
SET
    source_name_snapshot = COALESCE(NULLIF(c.source_name_snapshot, ''), s.name),
    group_name_snapshot = COALESCE(
        NULLIF(c.group_name_snapshot, ''),
        (
            SELECT g.name
            FROM watch_source_groups g
            WHERE g.source_id = c.source_id
              AND g.external_id = c.group_external_id
            LIMIT 1
        ),
        c.group_external_id
    )
FROM watch_sources s
WHERE s.id = c.source_id
  AND (c.source_name_snapshot = '' OR c.group_name_snapshot = '');

-- Legacy migration 195 created an optional persisted key digest. The Web Watch
-- scanner now compares SHA-256 fingerprints only in backend memory; retained
-- column stays NULL for rollback/schema compatibility and is no longer indexed.
DROP INDEX IF EXISTS idx_watch_source_keys_digest;
UPDATE watch_source_keys SET key_digest = NULL WHERE key_digest IS NOT NULL;

CREATE TABLE IF NOT EXISTS watch_source_group_history (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    source_name_snapshot TEXT NOT NULL DEFAULT '',
    group_external_id VARCHAR(128) NOT NULL,
    group_name_snapshot TEXT NOT NULL DEFAULT '',
    platform VARCHAR(64) NOT NULL DEFAULT '',
    rate_multiplier NUMERIC(20, 8) NOT NULL,
    user_rate_multiplier NUMERIC(20, 8) NULL,
    recharge_ratio NUMERIC(20, 8) NOT NULL,
    effective_rate_multiplier NUMERIC(20, 8) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_source_group_history_lookup
    ON watch_source_group_history (source_id, group_external_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_watch_source_group_history_observed
    ON watch_source_group_history (observed_at DESC, id DESC);

INSERT INTO watch_source_group_history
    (source_id, source_name_snapshot, group_external_id, group_name_snapshot, platform,
     rate_multiplier, user_rate_multiplier, recharge_ratio, effective_rate_multiplier, observed_at)
SELECT
    g.source_id, s.name, g.external_id, g.name, g.platform,
    g.rate_multiplier, g.user_rate_multiplier, s.recharge_ratio,
    (COALESCE(g.user_rate_multiplier, g.rate_multiplier) / s.recharge_ratio)::NUMERIC(20, 8),
    g.observed_at
FROM watch_source_groups g
JOIN watch_sources s ON s.id = g.source_id
WHERE NOT EXISTS (
    SELECT 1 FROM watch_source_group_history h
    WHERE h.source_id = g.source_id
      AND h.group_external_id = g.external_id
      AND h.observed_at = g.observed_at
);

CREATE TABLE IF NOT EXISTS watch_source_price_history (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    source_name_snapshot TEXT NOT NULL DEFAULT '',
    group_external_id VARCHAR(128) NOT NULL,
    group_name_snapshot TEXT NOT NULL DEFAULT '',
    platform VARCHAR(64) NOT NULL DEFAULT '',
    model VARCHAR(255) NOT NULL,
    component VARCHAR(32) NOT NULL CHECK (component IN ('input', 'output', 'per_request')),
    value NUMERIC(20, 8) NOT NULL CHECK (value >= 0),
    recharge_ratio NUMERIC(20, 8) NOT NULL,
    effective_value NUMERIC(20, 8) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_source_price_history_lookup
    ON watch_source_price_history (source_id, group_external_id, platform, model, component, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_watch_source_price_history_observed
    ON watch_source_price_history (observed_at DESC, id DESC);

INSERT INTO watch_source_price_history
    (source_id, source_name_snapshot, group_external_id, group_name_snapshot, platform,
     model, component, value, recharge_ratio, effective_value, observed_at)
SELECT
    p.source_id, s.name, p.group_external_id, COALESCE(g.name, p.group_external_id), p.platform,
    p.model, p.component, p.value, s.recharge_ratio,
    (p.value / s.recharge_ratio)::NUMERIC(20, 8),
    p.observed_at
FROM watch_source_prices p
JOIN watch_sources s ON s.id = p.source_id
LEFT JOIN watch_source_groups g ON g.source_id = p.source_id AND g.external_id = p.group_external_id
WHERE NOT EXISTS (
    SELECT 1 FROM watch_source_price_history h
    WHERE h.source_id = p.source_id
      AND h.group_external_id = p.group_external_id
      AND h.platform = p.platform
      AND h.model = p.model
      AND h.component = p.component
      AND h.observed_at = p.observed_at
);

CREATE TABLE IF NOT EXISTS watch_account_upstream_mapping_history (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source_id BIGINT NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
    source_name_snapshot TEXT NOT NULL DEFAULT '',
    source_key_external_id VARCHAR(128) NOT NULL,
    source_key_label_snapshot TEXT NOT NULL DEFAULT '',
    source_group_external_id VARCHAR(128) NOT NULL,
    source_group_name_snapshot TEXT NOT NULL DEFAULT '',
    mapping_method VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (mapping_method IN ('manual','auto')),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to TIMESTAMPTZ NULL,
    updated_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_mapping_history_account_time
    ON watch_account_upstream_mapping_history (account_id, valid_from DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_watch_mapping_history_source_group
    ON watch_account_upstream_mapping_history (source_id, source_group_external_id, valid_from DESC);

INSERT INTO watch_account_upstream_mapping_history
    (account_id, source_id, source_name_snapshot, source_key_external_id, source_key_label_snapshot,
     source_group_external_id, source_group_name_snapshot, mapping_method, valid_from, valid_to, updated_by)
SELECT
    m.account_id, m.source_id, COALESCE(s.name, ''), m.source_key_external_id, COALESCE(k.label, ''),
    COALESCE(NULLIF(m.source_group_external_id, ''), ''),
    COALESCE(g.name, NULLIF(m.source_group_external_id, ''), ''),
    m.mapping_method, m.created_at, NULL, m.updated_by
FROM watch_account_upstream_mappings m
LEFT JOIN watch_sources s ON s.id = m.source_id
LEFT JOIN watch_source_keys k ON k.source_id = m.source_id AND k.external_id = m.source_key_external_id
LEFT JOIN watch_source_groups g ON g.source_id = m.source_id AND g.external_id = m.source_group_external_id
WHERE NULLIF(m.source_group_external_id, '') IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM watch_account_upstream_mapping_history h
      WHERE h.account_id = m.account_id
        AND h.valid_to IS NULL
  );
