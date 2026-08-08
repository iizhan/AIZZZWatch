-- Persisted idempotency for official/Watch multiplier evidence alerts.
ALTER TABLE ops_alert_events
    ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_alert_events_dedup_key
    ON ops_alert_events (dedup_key)
    WHERE dedup_key IS NOT NULL AND dedup_key <> '';
