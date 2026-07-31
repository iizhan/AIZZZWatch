ALTER TABLE watch_pricing_rules
    ADD COLUMN IF NOT EXISTS adjustment_step NUMERIC(20,8) NOT NULL DEFAULT 0.003;

ALTER TABLE watch_pricing_rules
    DROP CONSTRAINT IF EXISTS watch_pricing_rules_adjustment_step_positive;

ALTER TABLE watch_pricing_rules
    ADD CONSTRAINT watch_pricing_rules_adjustment_step_positive
        CHECK (adjustment_step > 0);
