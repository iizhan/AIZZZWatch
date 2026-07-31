package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

const watchPriceAuditColumns = `id,target_type,target_id,COALESCE(target_group_id,0),mode,COALESCE(component,''),previous_value,next_value,
candidate_source_id,COALESCE(candidate_group_external_id,''),action,COALESCE(reason,''),actor_user_id,
COALESCE(idempotency_key,''),COALESCE(platform,''),COALESCE(model,''),rollback_of_id,created_at,updated_at`

func (r *watchSourceRepository) ReservePriceAudit(ctx context.Context, audit service.WatchPriceAudit) (*service.WatchPriceAudit, bool, error) {
	result, err := r.db.ExecContext(ctx, `
INSERT INTO watch_price_audits
(target_type,target_id,target_group_id,mode,component,previous_value,next_value,candidate_source_id,candidate_group_external_id,
 action,reason,actor_user_id,idempotency_key,platform,model,rollback_of_id,updated_at)
VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,NULLIF($9,''),$10,NULLIF($11,''),$12,$13,$14,$15,$16,NOW())
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
		audit.TargetType, audit.TargetID, audit.TargetGroupID, audit.Mode, audit.Component, audit.PreviousValue, audit.NextValue,
		audit.CandidateSourceID, audit.CandidateGroupExternalID, audit.Action, audit.Reason, audit.ActorUserID,
		audit.IdempotencyKey, audit.Platform, audit.Model, audit.RollbackOfID)
	if err != nil {
		return nil, false, fmt.Errorf("reserve watch price audit: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, false, fmt.Errorf("read watch price audit reserve result: %w", err)
	}
	reserved, err := r.GetPriceAuditByIdempotencyKey(ctx, audit.IdempotencyKey)
	if err != nil {
		return nil, false, err
	}
	return reserved, rows == 1, nil
}

func (r *watchSourceRepository) GetPriceAudit(ctx context.Context, id int64) (*service.WatchPriceAudit, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+watchPriceAuditColumns+` FROM watch_price_audits WHERE id=$1`, id)
	return scanWatchPriceAudit(row)
}

func (r *watchSourceRepository) GetPriceAuditByIdempotencyKey(ctx context.Context, key string) (*service.WatchPriceAudit, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+watchPriceAuditColumns+` FROM watch_price_audits WHERE idempotency_key=$1`, key)
	return scanWatchPriceAudit(row)
}

func (r *watchSourceRepository) CompletePriceAudit(ctx context.Context, id int64, action, reason string) (*service.WatchPriceAudit, error) {
	result, err := r.db.ExecContext(ctx, `
UPDATE watch_price_audits SET action=$2,reason=NULLIF($3,''),updated_at=NOW()
WHERE id=$1 AND action='applying'`, id, action, reason)
	if err != nil {
		return nil, fmt.Errorf("complete watch price audit: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("read watch price audit completion result: %w", err)
	}
	if rows == 0 {
		return r.GetPriceAudit(ctx, id)
	}
	return r.GetPriceAudit(ctx, id)
}

func (r *watchSourceRepository) ListPriceAudits(ctx context.Context, limit int) ([]service.WatchPriceAudit, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx, `SELECT `+watchPriceAuditColumns+` FROM watch_price_audits ORDER BY created_at DESC,id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list watch price audits: %w", err)
	}
	defer rows.Close()
	out := make([]service.WatchPriceAudit, 0)
	for rows.Next() {
		item, scanErr := scanWatchPriceAudit(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		if item != nil {
			out = append(out, *item)
		}
	}
	return out, rows.Err()
}

type watchPriceAuditScanner interface {
	Scan(dest ...any) error
}

func scanWatchPriceAudit(scanner watchPriceAuditScanner) (*service.WatchPriceAudit, error) {
	var item service.WatchPriceAudit
	err := scanner.Scan(&item.ID, &item.TargetType, &item.TargetID, &item.TargetGroupID, &item.Mode, &item.Component,
		&item.PreviousValue, &item.NextValue, &item.CandidateSourceID, &item.CandidateGroupExternalID,
		&item.Action, &item.Reason, &item.ActorUserID, &item.IdempotencyKey, &item.Platform, &item.Model,
		&item.RollbackOfID, &item.CreatedAt, &item.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("scan watch price audit: %w", err)
	}
	return &item, nil
}
