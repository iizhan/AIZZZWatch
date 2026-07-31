package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

const watchPricingRuleColumns = `id,name,target_group_id,mode,COALESCE(platform,''),COALESCE(model,''),component,enabled,
interval_seconds,adjustment_step,run_sequence,last_run_at,next_run_at,COALESCE(last_status,''),COALESCE(last_error_code,''),
created_by,updated_by,created_at,updated_at`

const watchPricingRuleColumnsFromRuleAlias = `r.id,r.name,r.target_group_id,r.mode,COALESCE(r.platform,''),COALESCE(r.model,''),r.component,r.enabled,
r.interval_seconds,r.adjustment_step,r.run_sequence,r.last_run_at,r.next_run_at,COALESCE(r.last_status,''),COALESCE(r.last_error_code,''),
r.created_by,r.updated_by,r.created_at,r.updated_at`

func (r *watchSourceRepository) CreatePricingRule(ctx context.Context, rule service.WatchPricingRule) (*service.WatchPricingRule, error) {
	row := r.db.QueryRowContext(ctx, `
INSERT INTO watch_pricing_rules
(name,target_group_id,mode,platform,model,component,enabled,interval_seconds,adjustment_step,next_run_at,created_by,updated_by,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $7 THEN NOW() ELSE NULL END,$10,$10,NOW())
RETURNING `+watchPricingRuleColumns,
		rule.Name, rule.TargetGroupID, rule.Mode, rule.Platform, rule.Model, rule.Component,
		rule.Enabled, rule.IntervalSeconds, rule.AdjustmentStep, rule.CreatedBy)
	return scanWatchPricingRule(row)
}

func (r *watchSourceRepository) UpdatePricingRule(ctx context.Context, rule service.WatchPricingRule) (*service.WatchPricingRule, error) {
	row := r.db.QueryRowContext(ctx, `
UPDATE watch_pricing_rules SET
	name=$2,target_group_id=$3,mode=$4,platform=$5,model=$6,component=$7,enabled=$8,
	interval_seconds=$9,adjustment_step=$10,updated_by=$11,updated_at=NOW(),
	next_run_at=CASE
		WHEN $8=FALSE THEN NULL
		WHEN enabled=FALSE THEN NOW()
		ELSE COALESCE(next_run_at,NOW())
	END
WHERE id=$1
RETURNING `+watchPricingRuleColumns,
		rule.ID, rule.Name, rule.TargetGroupID, rule.Mode, rule.Platform, rule.Model, rule.Component,
		rule.Enabled, rule.IntervalSeconds, rule.AdjustmentStep, rule.UpdatedBy)
	out, err := scanWatchPricingRule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrWatchPricingRuleNotFound
	}
	return out, err
}

func (r *watchSourceRepository) GetPricingRule(ctx context.Context, id int64) (*service.WatchPricingRule, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+watchPricingRuleColumns+` FROM watch_pricing_rules WHERE id=$1`, id)
	out, err := scanWatchPricingRule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrWatchPricingRuleNotFound
	}
	return out, err
}

func (r *watchSourceRepository) ListPricingRules(ctx context.Context) ([]service.WatchPricingRule, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+watchPricingRuleColumns+` FROM watch_pricing_rules ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list watch pricing rules: %w", err)
	}
	defer rows.Close()
	return collectWatchPricingRules(rows)
}

func (r *watchSourceRepository) DeletePricingRule(ctx context.Context, id int64) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM watch_pricing_rules WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("delete watch pricing rule: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return service.ErrWatchPricingRuleNotFound
	}
	return nil
}

func (r *watchSourceRepository) ClaimDuePricingRules(ctx context.Context, nowTime time.Time, limit int) ([]service.WatchPricingRule, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx, `
WITH due AS (
	SELECT id FROM watch_pricing_rules
	WHERE enabled=TRUE
	  AND (
		next_run_at IS NULL
		OR next_run_at <= $1::timestamptz
		OR (last_status='running' AND last_run_at IS NOT NULL AND last_run_at < $1::timestamptz - INTERVAL '5 minutes')
	  )
	ORDER BY next_run_at NULLS FIRST,id
	FOR UPDATE SKIP LOCKED
	LIMIT $2
)
UPDATE watch_pricing_rules r SET
	run_sequence=r.run_sequence+1,
	last_run_at=$1::timestamptz,
	next_run_at=$1::timestamptz + make_interval(secs => r.interval_seconds),
	last_status='running',
	last_error_code=NULL,
	updated_at=NOW()
FROM due WHERE r.id=due.id
RETURNING `+watchPricingRuleColumnsFromRuleAlias, nowTime, limit)
	if err != nil {
		return nil, fmt.Errorf("claim due watch pricing rules: %w", err)
	}
	defer rows.Close()
	return collectWatchPricingRules(rows)
}

func (r *watchSourceRepository) ClaimPricingRuleRun(ctx context.Context, id int64, now time.Time) (*service.WatchPricingRule, error) {
	row := r.db.QueryRowContext(ctx, `
UPDATE watch_pricing_rules SET
	run_sequence=run_sequence+1,
	last_run_at=$2::timestamptz,
	next_run_at=CASE WHEN enabled THEN $2::timestamptz + make_interval(secs => interval_seconds) ELSE next_run_at END,
	last_status='running',
	last_error_code=NULL,
	updated_at=NOW()
WHERE id=$1
RETURNING `+watchPricingRuleColumns, id, now)
	out, err := scanWatchPricingRule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrWatchPricingRuleNotFound
	}
	return out, err
}

func (r *watchSourceRepository) FinishPricingRuleRun(ctx context.Context, id, sequence int64, status, errorCode string) (*service.WatchPricingRule, error) {
	row := r.db.QueryRowContext(ctx, `
UPDATE watch_pricing_rules SET last_status=$3,last_error_code=NULLIF($4,''),updated_at=NOW()
WHERE id=$1 AND run_sequence=$2
RETURNING `+watchPricingRuleColumns, id, sequence, status, errorCode)
	out, err := scanWatchPricingRule(row)
	if errors.Is(err, sql.ErrNoRows) {
		return r.GetPricingRule(ctx, id)
	}
	return out, err
}

type watchPricingRuleScanner interface {
	Scan(dest ...any) error
}

func scanWatchPricingRule(scanner watchPricingRuleScanner) (*service.WatchPricingRule, error) {
	var rule service.WatchPricingRule
	if err := scanner.Scan(&rule.ID, &rule.Name, &rule.TargetGroupID, &rule.Mode, &rule.Platform, &rule.Model,
		&rule.Component, &rule.Enabled, &rule.IntervalSeconds, &rule.AdjustmentStep, &rule.RunSequence, &rule.LastRunAt, &rule.NextRunAt,
		&rule.LastStatus, &rule.LastErrorCode, &rule.CreatedBy, &rule.UpdatedBy, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
		return nil, err
	}
	return &rule, nil
}

func collectWatchPricingRules(rows *sql.Rows) ([]service.WatchPricingRule, error) {
	out := make([]service.WatchPricingRule, 0)
	for rows.Next() {
		item, err := scanWatchPricingRule(rows)
		if err != nil {
			return nil, fmt.Errorf("scan watch pricing rule: %w", err)
		}
		out = append(out, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate watch pricing rules: %w", err)
	}
	return out, nil
}
