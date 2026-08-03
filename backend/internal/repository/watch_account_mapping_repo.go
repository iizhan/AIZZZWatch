package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
)

func (r *watchSourceRepository) ListAccountUpstreamMappings(ctx context.Context, accountIDs []int64) ([]service.WatchAccountUpstreamMapping, error) {
	accountIDs = uniqueWatchPositiveInt64s(accountIDs)
	if len(accountIDs) == 0 {
		return []service.WatchAccountUpstreamMapping{}, nil
	}
	rows, err := r.db.QueryContext(ctx, watchAccountMappingSelectSQL+` WHERE m.account_id = ANY($1) ORDER BY a.name,m.account_id`, pq.Array(accountIDs))
	if err != nil {
		return nil, fmt.Errorf("list watch account upstream mappings: %w", err)
	}
	defer rows.Close()
	return scanWatchAccountMappings(rows)
}

func (r *watchSourceRepository) ListAllAccountUpstreamMappings(ctx context.Context) ([]service.WatchAccountUpstreamMapping, error) {
	rows, err := r.db.QueryContext(ctx, watchAccountMappingSelectSQL+` ORDER BY a.name,m.account_id`)
	if err != nil {
		return nil, fmt.Errorf("list all watch account upstream mappings: %w", err)
	}
	defer rows.Close()
	return scanWatchAccountMappings(rows)
}

func (r *watchSourceRepository) SaveAccountUpstreamMapping(ctx context.Context, mapping service.WatchAccountUpstreamMapping) (*service.WatchAccountUpstreamMapping, error) {
	method := mapping.MappingMethod
	if method == "" {
		method = "manual"
	}
	bindingState := mapping.GroupBindingState
	if bindingState == "" {
		bindingState = "confirmed"
	}
	confirmedGroupIDs := mapping.ConfirmedGroupExternalIDs
	if len(confirmedGroupIDs) == 0 && mapping.SourceGroupExternalID != "" {
		confirmedGroupIDs = []string{mapping.SourceGroupExternalID}
	}
	confirmedGroupIDsJSON, err := json.Marshal(confirmedGroupIDs)
	if err != nil {
		return nil, fmt.Errorf("encode confirmed watch source key groups: %w", err)
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin save watch account upstream mapping: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := time.Now().UTC()
	if _, err = tx.ExecContext(ctx, `
UPDATE watch_account_upstream_mapping_history
SET valid_to=$2
WHERE account_id=$1 AND valid_to IS NULL`, mapping.AccountID, now); err != nil {
		return nil, fmt.Errorf("close watch account upstream mapping history: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mappings
	(account_id,source_id,source_key_external_id,source_group_external_id,mapping_method,
	 group_binding_state,confirmed_group_external_ids,source_key_observed_at,updated_by,updated_at)
VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7::jsonb,$8,$9,NOW())
ON CONFLICT (account_id) DO UPDATE SET
	source_id=EXCLUDED.source_id,
	source_key_external_id=EXCLUDED.source_key_external_id,
	source_group_external_id=EXCLUDED.source_group_external_id,
	mapping_method=EXCLUDED.mapping_method,
	group_binding_state=EXCLUDED.group_binding_state,
	confirmed_group_external_ids=EXCLUDED.confirmed_group_external_ids,
	source_key_observed_at=EXCLUDED.source_key_observed_at,
	updated_by=EXCLUDED.updated_by,
	updated_at=NOW()`,
		mapping.AccountID, mapping.SourceID, mapping.SourceKeyExternalID, mapping.SourceGroupExternalID,
		method, bindingState, string(confirmedGroupIDsJSON), mapping.SourceKeyObservedAt, mapping.UpdatedBy)
	if err != nil {
		return nil, fmt.Errorf("save watch account upstream mapping: %w", err)
	}
	if mapping.SourceGroupExternalID != "" {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mapping_history
(account_id,source_id,source_name_snapshot,source_key_external_id,source_key_label_snapshot,
 source_group_external_id,source_group_name_snapshot,mapping_method,valid_from,updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			mapping.AccountID, mapping.SourceID, mapping.SourceName, mapping.SourceKeyExternalID,
			mapping.SourceKeyLabel, mapping.SourceGroupExternalID, mapping.SourceGroupName,
			method, now, mapping.UpdatedBy); err != nil {
			return nil, fmt.Errorf("insert watch account upstream mapping history: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit save watch account upstream mapping: %w", err)
	}
	items, err := r.ListAccountUpstreamMappings(ctx, []int64{mapping.AccountID})
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("watch account upstream mapping was not found after save")
	}
	return &items[0], nil
}

func (r *watchSourceRepository) DeleteAccountUpstreamMapping(ctx context.Context, accountID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete watch account upstream mapping: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `
UPDATE watch_account_upstream_mapping_history
SET valid_to=$2
WHERE account_id=$1 AND valid_to IS NULL`, accountID, time.Now().UTC()); err != nil {
		return fmt.Errorf("close watch account upstream mapping history: %w", err)
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM watch_account_upstream_mappings WHERE account_id=$1`, accountID)
	if err != nil {
		return fmt.Errorf("delete watch account upstream mapping: %w", err)
	}
	return tx.Commit()
}

const watchAccountMappingSelectSQL = `
SELECT
	m.account_id,
	COALESCE(a.name,''),
	COALESCE(a.platform,''),
	m.source_id,
	COALESCE(s.name,''),
	m.source_key_external_id,
	COALESCE(k.label,''),
	COALESCE(m.source_group_external_id,''),
	COALESCE(g.name,''),
	m.mapping_method,
	COALESCE(m.group_binding_state,'confirmed'),
	COALESCE(m.confirmed_group_external_ids::text,'[]'),
	m.source_key_observed_at,
	m.updated_by,
	m.created_at,
	m.updated_at
FROM watch_account_upstream_mappings m
LEFT JOIN accounts a ON a.id=m.account_id AND a.deleted_at IS NULL
LEFT JOIN watch_sources s ON s.id=m.source_id
LEFT JOIN watch_source_keys k ON k.source_id=m.source_id AND k.external_id=m.source_key_external_id
LEFT JOIN watch_source_groups g ON g.source_id=m.source_id AND g.external_id=m.source_group_external_id`

func scanWatchAccountMappings(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]service.WatchAccountUpstreamMapping, error) {
	out := make([]service.WatchAccountUpstreamMapping, 0)
	for rows.Next() {
		var item service.WatchAccountUpstreamMapping
		var confirmedGroupIDsRaw string
		if err := rows.Scan(
			&item.AccountID,
			&item.AccountName,
			&item.Platform,
			&item.SourceID,
			&item.SourceName,
			&item.SourceKeyExternalID,
			&item.SourceKeyLabel,
			&item.SourceGroupExternalID,
			&item.SourceGroupName,
			&item.MappingMethod,
			&item.GroupBindingState,
			&confirmedGroupIDsRaw,
			&item.SourceKeyObservedAt,
			&item.UpdatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan watch account upstream mapping: %w", err)
		}
		item.ConfirmedGroupExternalIDs = decodeWatchStringJSONArray(confirmedGroupIDsRaw)
		out = append(out, item)
	}
	return out, rows.Err()
}

func uniqueWatchPositiveInt64s(values []int64) []int64 {
	if len(values) == 0 {
		return nil
	}
	out := make([]int64, 0, len(values))
	seen := make(map[int64]struct{}, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
