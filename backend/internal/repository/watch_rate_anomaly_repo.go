package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

type watchRateAnomalyRowScanner interface {
	Scan(...any) error
}

func scanWatchRateAnomaly(row watchRateAnomalyRowScanner) (*service.WatchRateAnomaly, error) {
	var anomaly service.WatchRateAnomaly
	var ruleID sql.NullInt64
	var resolvedAt sql.NullTime
	if err := row.Scan(
		&anomaly.ID, &ruleID, &anomaly.TargetGroupID, &anomaly.GroupName, &anomaly.Kind, &anomaly.Status,
		&anomaly.CurrentValue, &anomaly.TargetValue, &anomaly.HighestUpstreamCost, &anomaly.PricingSource,
		&anomaly.OfficialProbeCount, &anomaly.WatchFallbackCount, &anomaly.EvidenceMismatchCount,
		&anomaly.DetectedAt, &anomaly.LastObservedAt, &resolvedAt, &anomaly.CreatedAt, &anomaly.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if ruleID.Valid {
		value := ruleID.Int64
		anomaly.PricingRuleID = &value
	}
	if resolvedAt.Valid {
		value := resolvedAt.Time.UTC()
		anomaly.ResolvedAt = &value
	}
	return &anomaly, nil
}

const watchRateAnomalyColumns = `
	id, pricing_rule_id, target_group_id, group_name_snapshot, kind, status,
	current_value, target_value, highest_upstream_cost, pricing_source,
	official_probe_count, watch_fallback_count, evidence_mismatch_count,
	detected_at, last_observed_at, resolved_at, created_at, updated_at`

func (r *watchSourceRepository) ReconcileWatchRateAnomaly(ctx context.Context, input service.WatchRateAnomalyReconcileInput) (*service.WatchRateAnomaly, error) {
	if r == nil || r.db == nil || input.PricingRuleID <= 0 || input.TargetGroupID <= 0 || input.ObservedAt.IsZero() ||
		input.CurrentValue < 0 || input.TargetValue < 0 || input.HighestUpstreamCost < 0 ||
		math.IsNaN(input.CurrentValue) || math.IsNaN(input.TargetValue) || math.IsNaN(input.HighestUpstreamCost) ||
		math.IsInf(input.CurrentValue, 0) || math.IsInf(input.TargetValue, 0) || math.IsInf(input.HighestUpstreamCost, 0) {
		return nil, fmt.Errorf("invalid watch rate anomaly input")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var lockedRuleID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM watch_pricing_rules WHERE id=$1 FOR UPDATE`, input.PricingRuleID).Scan(&lockedRuleID); err != nil {
		return nil, err
	}

	open, err := scanWatchRateAnomaly(tx.QueryRowContext(ctx, `SELECT `+watchRateAnomalyColumns+`
		FROM watch_rate_anomalies WHERE pricing_rule_id=$1 AND status='open' FOR UPDATE`, input.PricingRuleID))
	if errors.Is(err, sql.ErrNoRows) {
		open = nil
	} else if err != nil {
		return nil, err
	}

	equal := watchRepositoryValuesEqual(input.CurrentValue, input.TargetValue)
	if equal {
		if open == nil {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return nil, nil
		}
		resolved, err := scanWatchRateAnomaly(tx.QueryRowContext(ctx, `UPDATE watch_rate_anomalies
			SET status='resolved', current_value=$2, target_value=$3, highest_upstream_cost=$4,
				pricing_source=$5, official_probe_count=$6, watch_fallback_count=$7,
				evidence_mismatch_count=$8, last_observed_at=$9, resolved_at=$9, updated_at=NOW()
			WHERE id=$1 RETURNING `+watchRateAnomalyColumns,
			open.ID, input.CurrentValue, input.TargetValue, input.HighestUpstreamCost,
			input.Evidence.PricingSource, input.Evidence.OfficialProbeCount, input.Evidence.WatchFallbackCount,
			input.Evidence.EvidenceMismatchCount, input.ObservedAt))
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return resolved, nil
	}

	kind := service.WatchRateAnomalyOverpriced
	if input.CurrentValue < input.TargetValue {
		kind = service.WatchRateAnomalyUnderpriced
	}
	if open != nil && open.Kind != kind {
		if _, err := tx.ExecContext(ctx, `UPDATE watch_rate_anomalies SET status='resolved', resolved_at=$2, last_observed_at=$2, updated_at=NOW() WHERE id=$1`, open.ID, input.ObservedAt); err != nil {
			return nil, err
		}
		open = nil
	}

	var anomaly *service.WatchRateAnomaly
	if open == nil {
		anomaly, err = scanWatchRateAnomaly(tx.QueryRowContext(ctx, `INSERT INTO watch_rate_anomalies (
			pricing_rule_id, target_group_id, group_name_snapshot, kind, status,
			current_value, target_value, highest_upstream_cost, pricing_source,
			official_probe_count, watch_fallback_count, evidence_mismatch_count,
			detected_at, last_observed_at
		) VALUES ($1,$2,COALESCE((SELECT name FROM groups WHERE id=$2),''),$3,'open',$4,$5,$6,$7,$8,$9,$10,$11,$11)
		RETURNING `+watchRateAnomalyColumns,
			input.PricingRuleID, input.TargetGroupID, kind, input.CurrentValue, input.TargetValue,
			input.HighestUpstreamCost, input.Evidence.PricingSource, input.Evidence.OfficialProbeCount,
			input.Evidence.WatchFallbackCount, input.Evidence.EvidenceMismatchCount, input.ObservedAt))
	} else {
		anomaly, err = scanWatchRateAnomaly(tx.QueryRowContext(ctx, `UPDATE watch_rate_anomalies
			SET current_value=$2, target_value=$3, highest_upstream_cost=$4, pricing_source=$5,
				official_probe_count=$6, watch_fallback_count=$7, evidence_mismatch_count=$8,
				last_observed_at=$9, updated_at=NOW()
			WHERE id=$1 RETURNING `+watchRateAnomalyColumns,
			open.ID, input.CurrentValue, input.TargetValue, input.HighestUpstreamCost,
			input.Evidence.PricingSource, input.Evidence.OfficialProbeCount, input.Evidence.WatchFallbackCount,
			input.Evidence.EvidenceMismatchCount, input.ObservedAt))
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO watch_rate_anomaly_samples (
		anomaly_id, observed_at, current_value, target_value, highest_upstream_cost, pricing_source,
		official_probe_count, watch_fallback_count, evidence_mismatch_count
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (anomaly_id, observed_at) DO NOTHING`,
		anomaly.ID, input.ObservedAt, input.CurrentValue, input.TargetValue, input.HighestUpstreamCost,
		input.Evidence.PricingSource, input.Evidence.OfficialProbeCount, input.Evidence.WatchFallbackCount,
		input.Evidence.EvidenceMismatchCount); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return anomaly, nil
}

func (r *watchSourceRepository) ListWatchRateAnomalies(ctx context.Context, filter service.WatchRateAnomalyFilter) ([]service.WatchRateAnomaly, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.QueryContext(ctx, `SELECT `+watchRateAnomalyColumns+`
		FROM watch_rate_anomalies
		WHERE ($1='' OR $1='all' OR status=$1)
		ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, last_observed_at DESC, id DESC
		LIMIT $2`, filter.Status, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]service.WatchRateAnomaly, 0)
	for rows.Next() {
		item, scanErr := scanWatchRateAnomaly(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, *item)
	}
	return result, rows.Err()
}

type watchRateCompensationQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func previewWatchRateCompensation(ctx context.Context, q watchRateCompensationQueryer, anomalyID int64, now time.Time) (*service.WatchRateCompensationPreview, error) {
	anomaly, err := scanWatchRateAnomaly(q.QueryRowContext(ctx, `SELECT `+watchRateAnomalyColumns+` FROM watch_rate_anomalies WHERE id=$1`, anomalyID))
	if err != nil {
		return nil, err
	}
	windowEnd := now.UTC()
	if anomaly.ResolvedAt != nil {
		windowEnd = anomaly.ResolvedAt.UTC()
	}
	preview := &service.WatchRateCompensationPreview{
		Anomaly: *anomaly, WindowStart: anomaly.DetectedAt.UTC(), WindowEnd: windowEnd,
		Rows: []service.WatchRateCompensationRow{}, GeneratedAt: now.UTC(),
	}
	rows, err := q.QueryContext(ctx, `
		WITH evidence AS (
			SELECT u.user_id, u.actual_cost, u.total_cost, u.rate_multiplier,
			       u.billing_type, COALESCE(u.billing_mode, 'token') AS billing_mode,
			       COALESCE(u.image_count,0) AS image_count, COALESCE(u.video_count,0) AS video_count,
			       sample.current_value AS anomaly_current_value, sample.target_value,
			       EXISTS (
				   SELECT 1 FROM user_group_rate_multipliers ugr
				   WHERE ugr.user_id=u.user_id AND ugr.group_id=$2 AND ugr.rate_multiplier IS NOT NULL
			       ) AS has_user_override
			FROM usage_logs u
			LEFT JOIN LATERAL (
				SELECT s.current_value, s.target_value
				FROM watch_rate_anomaly_samples s
				WHERE s.anomaly_id=$1 AND s.observed_at <= u.created_at
				ORDER BY s.observed_at DESC, s.id DESC LIMIT 1
			) sample ON TRUE
			WHERE u.group_id=$2 AND u.created_at >= $3 AND u.created_at < $4
		), classified AS (
			SELECT *, (
				billing_type=0 AND billing_mode='token' AND image_count=0 AND video_count=0
				AND anomaly_current_value IS NOT NULL AND target_value IS NOT NULL AND NOT has_user_override
				AND total_cost >= 0 AND actual_cost >= 0
				AND ABS(rate_multiplier-anomaly_current_value) <= GREATEST(0.00000001, ABS(rate_multiplier)*0.000001)
				AND ABS(actual_cost - total_cost*rate_multiplier) <= GREATEST(0.00000001, ABS(actual_cost)*0.000001)
			) AS resolved
			FROM evidence
		), aggregated AS (
			SELECT user_id,
			       COUNT(*)::BIGINT AS request_count,
			       COUNT(*) FILTER (WHERE NOT resolved)::BIGINT AS unresolved_count,
			       COALESCE(SUM(actual_cost),0)::DOUBLE PRECISION AS actual_cost,
			       COALESCE(SUM(CASE WHEN resolved THEN total_cost*target_value ELSE 0 END),0)::DOUBLE PRECISION AS expected_cost,
			       COALESCE(SUM(CASE WHEN resolved THEN GREATEST(actual_cost-total_cost*target_value,0) ELSE 0 END),0)::DOUBLE PRECISION AS candidate_amount
			FROM classified GROUP BY user_id
		)
		SELECT a.user_id, COALESCE(u.username,''), COALESCE(u.email,''), a.request_count, a.unresolved_count,
		       a.actual_cost, a.expected_cost, a.candidate_amount,
		       EXISTS (
			SELECT 1 FROM watch_rate_compensations c
			WHERE c.user_id=a.user_id AND c.target_group_id=$2
			  AND c.window_start < $4 AND c.window_end > $3
		       ) AS already_compensated
		FROM aggregated a JOIN users u ON u.id=a.user_id
		ORDER BY a.candidate_amount DESC, a.user_id
	`, anomalyID, anomaly.TargetGroupID, preview.WindowStart, preview.WindowEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row service.WatchRateCompensationRow
		if err := rows.Scan(&row.UserID, &row.Username, &row.Email, &row.RequestCount, &row.UnresolvedRequestCount,
			&row.ActualCost, &row.ExpectedCost, &row.CandidateAmount, &row.AlreadyCompensated); err != nil {
			return nil, err
		}
		row.EligibleRequestCount = row.RequestCount - row.UnresolvedRequestCount
		row.Eligible = anomaly.Kind == service.WatchRateAnomalyOverpriced && anomaly.Status == service.WatchRateAnomalyResolved &&
			row.EligibleRequestCount > 0 && row.CandidateAmount > 0 && !row.AlreadyCompensated
		switch {
		case anomaly.Kind != service.WatchRateAnomalyOverpriced:
			row.Reason = "underpriced incidents do not create user compensation"
		case anomaly.Status != service.WatchRateAnomalyResolved:
			row.Reason = "rate anomaly is still open"
		case row.AlreadyCompensated:
			row.Reason = "compensation has already been recorded"
		case row.CandidateAmount <= 0:
			row.Reason = "no overcharge was found"
		case row.UnresolvedRequestCount > 0:
			row.Reason = "unsupported or ambiguous usage is excluded and requires review"
		}
		preview.Rows = append(preview.Rows, row)
		preview.UserCount++
		preview.RequestCount += row.RequestCount
		preview.ActualCost += row.ActualCost
		preview.ExpectedCost += row.ExpectedCost
		preview.UnresolvedCount += row.UnresolvedRequestCount
		if row.Eligible {
			preview.EligibleCount++
			preview.CandidateAmount += row.CandidateAmount
		}
	}
	return preview, rows.Err()
}

func (r *watchSourceRepository) PreviewWatchRateCompensation(ctx context.Context, anomalyID int64, now time.Time) (*service.WatchRateCompensationPreview, error) {
	if r == nil || r.db == nil || anomalyID <= 0 {
		return nil, sql.ErrNoRows
	}
	preview, err := previewWatchRateCompensation(ctx, r.db, anomalyID, now)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrWatchRateAnomalyNotFound
	}
	return preview, err
}

func watchRateCompensationItemKey(operationKey string, userID int64) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", strings.TrimSpace(operationKey), userID)))
	return fmt.Sprintf("watch-rate:%x", digest[:16])
}

func (r *watchSourceRepository) ApplyWatchRateCompensation(ctx context.Context, anomalyID int64, input service.WatchRateCompensationApplyInput, operatorUserID int64, now time.Time) (*service.WatchRateCompensationApplyResult, error) {
	// The anomaly row is the compensation mutex. READ COMMITTED lets a waiter
	// observe the first transaction's committed idempotency record after the row
	// lock is released, so concurrent retries return the same result instead of
	// surfacing a serialization error.
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var lockedAnomalyID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM watch_rate_anomalies WHERE id=$1 FOR UPDATE`, anomalyID).Scan(&lockedAnomalyID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, service.ErrWatchRateAnomalyNotFound
		}
		return nil, err
	}
	preview, err := previewWatchRateCompensation(ctx, tx, anomalyID, now)
	if err != nil {
		return nil, err
	}
	selected := make(map[int64]struct{}, len(input.UserIDs))
	for _, userID := range input.UserIDs {
		if userID > 0 {
			selected[userID] = struct{}{}
		}
	}
	result := &service.WatchRateCompensationApplyResult{AnomalyID: anomalyID, AppliedUserIDs: []int64{}, SkippedUserIDs: []int64{}, AppliedAt: now.UTC()}
	for _, row := range preview.Rows {
		if len(selected) > 0 {
			if _, ok := selected[row.UserID]; !ok {
				continue
			}
		}
		itemKey := watchRateCompensationItemKey(input.IdempotencyKey, row.UserID)
		var existingKey string
		var existingAmount float64
		existingErr := tx.QueryRowContext(ctx, `SELECT idempotency_key, compensated_amount
			FROM watch_rate_compensations WHERE anomaly_id=$1 AND user_id=$2`, anomalyID, row.UserID).Scan(&existingKey, &existingAmount)
		if existingErr == nil {
			if existingKey != itemKey {
				result.SkippedUserIDs = append(result.SkippedUserIDs, row.UserID)
				continue
			}
			result.AppliedUserIDs = append(result.AppliedUserIDs, row.UserID)
			result.AppliedCount++
			result.CompensatedAmount += existingAmount
			result.Replayed = true
			continue
		}
		if !errors.Is(existingErr, sql.ErrNoRows) {
			return nil, existingErr
		}
		if !row.Eligible {
			result.SkippedUserIDs = append(result.SkippedUserIDs, row.UserID)
			continue
		}
		var balanceBefore float64
		if err := tx.QueryRowContext(ctx, `SELECT balance FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, row.UserID).Scan(&balanceBefore); err != nil {
			return nil, err
		}
		var compensationID int64
		err := tx.QueryRowContext(ctx, `INSERT INTO watch_rate_compensations (
			anomaly_id, target_group_id, user_id, idempotency_key, status, window_start, window_end,
			request_count, unresolved_request_count, actual_cost, expected_cost, candidate_amount,
			compensated_amount, balance_before, balance_after, operator_user_id, reason, applied_at
		) VALUES ($1,$2,$3,$4,'applied',$5,$6,$7,$8,$9,$10,$11,$11,$12,$12::NUMERIC+$11::NUMERIC,$13,$14,$15)
		ON CONFLICT (anomaly_id, user_id) WHERE anomaly_id IS NOT NULL DO NOTHING RETURNING id`,
			anomalyID, preview.Anomaly.TargetGroupID, row.UserID, itemKey, preview.WindowStart, preview.WindowEnd,
			row.RequestCount, row.UnresolvedRequestCount, row.ActualCost, row.ExpectedCost, row.CandidateAmount,
			balanceBefore, operatorUserID, input.Reason, now).Scan(&compensationID)
		if errors.Is(err, sql.ErrNoRows) {
			result.SkippedUserIDs = append(result.SkippedUserIDs, row.UserID)
			continue
		}
		if err != nil {
			if strings.Contains(err.Error(), "watch_rate_compensations_idempotency_key_key") {
				return nil, service.ErrWatchRateCompensationIdempotencyMismatch
			}
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET balance=balance+$1, updated_at=NOW() WHERE id=$2`, row.CandidateAmount, row.UserID); err != nil {
			return nil, err
		}
		code := fmt.Sprintf("WRCOMP-%d", compensationID)
		notes := fmt.Sprintf("Watch rate compensation #%d: %s", anomalyID, input.Reason)
		if _, err := tx.ExecContext(ctx, `INSERT INTO redeem_codes (code,type,value,status,used_by,used_at,notes,created_at,validity_days)
			VALUES ($1,'admin_balance',$2,'used',$3,$4,$5,$4,0)`, code, row.CandidateAmount, row.UserID, now, notes); err != nil {
			return nil, err
		}
		result.AppliedUserIDs = append(result.AppliedUserIDs, row.UserID)
		result.AppliedCount++
		result.CompensatedAmount += row.CandidateAmount
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *watchSourceRepository) RecordExternalWatchRateCompensation(ctx context.Context, input service.WatchRateExternalCompensationInput, operatorUserID int64, now time.Time) error {
	result, err := r.db.ExecContext(ctx, `INSERT INTO watch_rate_compensations (
		anomaly_id, target_group_id, user_id, idempotency_key, status, window_start, window_end,
		candidate_amount, compensated_amount, operator_user_id, reason, applied_at
	) VALUES (NULL,$1,$2,$3,'external',$4,$5,$6,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING`,
		input.TargetGroupID, input.UserID, strings.TrimSpace(input.IdempotencyKey), input.WindowStart.UTC(), input.WindowEnd.UTC(),
		input.Amount, operatorUserID, input.Reason, now.UTC())
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected > 0 {
		return err
	}
	var groupID, userID int64
	var amount float64
	var status, reason string
	var windowStart, windowEnd time.Time
	if err := r.db.QueryRowContext(ctx, `SELECT target_group_id,user_id,compensated_amount,status,window_start,window_end,reason
		FROM watch_rate_compensations WHERE idempotency_key=$1`, strings.TrimSpace(input.IdempotencyKey)).Scan(
		&groupID, &userID, &amount, &status, &windowStart, &windowEnd, &reason,
	); err != nil {
		return err
	}
	if status != "external" || groupID != input.TargetGroupID || userID != input.UserID ||
		!watchRepositoryValuesEqual(amount, input.Amount) || !windowStart.Equal(input.WindowStart.UTC()) ||
		!windowEnd.Equal(input.WindowEnd.UTC()) || reason != input.Reason {
		return service.ErrWatchRateCompensationIdempotencyMismatch
	}
	return nil
}

func watchRepositoryValuesEqual(left, right float64) bool {
	delta := left - right
	if delta < 0 {
		delta = -delta
	}
	return delta < 0.000000005
}

var _ service.WatchRateAnomalyRepository = (*watchSourceRepository)(nil)
