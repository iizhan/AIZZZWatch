package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

type watchSourceRepository struct {
	db *sql.DB
}

func NewWatchSourceRepository(db *sql.DB) service.WatchSourceRepository {
	return &watchSourceRepository{db: db}
}

func encodeWatchReadMapping(mapping *service.WatchSourceReadMapping) (string, error) {
	if mapping == nil || len(mapping.Capabilities) == 0 {
		return "{}", nil
	}
	payload, err := json.Marshal(mapping)
	if err != nil {
		return "", fmt.Errorf("encode watch source read mapping: %w", err)
	}
	return string(payload), nil
}

func (r *watchSourceRepository) CreateSource(ctx context.Context, mutation service.WatchSourceMutation) (*service.WatchSource, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin create watch source: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	s := mutation.Source
	readMappingJSON, err := encodeWatchReadMapping(s.ReadMapping)
	if err != nil {
		return nil, err
	}
	err = tx.QueryRowContext(ctx, `
INSERT INTO watch_sources
    (name, adapter_type, base_url, api_base_url, recharge_ratio, low_balance_threshold,
     polling_interval_seconds, request_timeout_seconds, auth_mode, profile_path, groups_path,
     rates_path, pricing_path, keys_path, login_path, login_username_hint, heartbeat_path, read_mapping, keepalive_enabled,
     keepalive_interval_seconds, auto_follow_key_group, enabled, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,$23)
RETURNING id, created_at, updated_at`,
		s.Name, s.AdapterType, s.BaseURL, s.APIBaseURL, s.RechargeRatio, s.LowBalanceThreshold,
		s.PollingIntervalSeconds, s.RequestTimeoutSeconds, s.AuthMode, s.ProfilePath, s.GroupsPath,
		s.RatesPath, s.PricingPath, s.KeysPath, s.LoginPath, s.LoginUsernameHint, s.HeartbeatPath, readMappingJSON, s.KeepaliveEnabled,
		s.KeepaliveIntervalSeconds, s.AutoFollowKeyGroup, s.Enabled, s.CreatedBy,
	).Scan(&s.ID, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert watch source: %w", err)
	}
	if mutation.EncryptedSecret != "" || mutation.EncryptedLoginSecret != "" {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_credentials (source_id, credential_type, encrypted_value, encrypted_login_value, token_updated_at, updated_by)
VALUES ($1,$2,$3,$4,CASE WHEN NULLIF($3,'') IS NULL THEN NULL ELSE NOW() END,$5)`,
			s.ID, mutation.CredentialType, mutation.EncryptedSecret, mutation.EncryptedLoginSecret, s.CreatedBy); err != nil {
			return nil, fmt.Errorf("insert watch source credential: %w", err)
		}
		s.HasCredential = mutation.EncryptedSecret != ""
		s.HasLoginCredential = mutation.EncryptedLoginSecret != ""
		s.CredentialType = mutation.CredentialType
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create watch source: %w", err)
	}
	return s, nil
}

func (r *watchSourceRepository) UpdateSource(ctx context.Context, mutation service.WatchSourceMutation) (*service.WatchSource, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin update watch source: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	s := mutation.Source
	readMappingJSON, err := encodeWatchReadMapping(s.ReadMapping)
	if err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
UPDATE watch_sources SET
    name=$2, adapter_type=$3, base_url=$4, api_base_url=$5, recharge_ratio=$6,
    low_balance_threshold=$7, polling_interval_seconds=$8, request_timeout_seconds=$9,
    auth_mode=$10, profile_path=$11, groups_path=$12, rates_path=$13, pricing_path=$14,
    keys_path=$15, login_path=$16, login_username_hint=$17, heartbeat_path=$18, read_mapping=$19::jsonb, keepalive_enabled=$20,
    keepalive_interval_seconds=$21, auto_follow_key_group=$22, enabled=$23, updated_by=$24, updated_at=NOW()
WHERE id=$1`, s.ID, s.Name, s.AdapterType, s.BaseURL, s.APIBaseURL, s.RechargeRatio,
		s.LowBalanceThreshold, s.PollingIntervalSeconds, s.RequestTimeoutSeconds, s.AuthMode,
		s.ProfilePath, s.GroupsPath, s.RatesPath, s.PricingPath, s.KeysPath, s.LoginPath,
		s.LoginUsernameHint, s.HeartbeatPath, readMappingJSON, s.KeepaliveEnabled, s.KeepaliveIntervalSeconds,
		s.AutoFollowKeyGroup, s.Enabled, s.UpdatedBy)
	if err != nil {
		return nil, fmt.Errorf("update watch source: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return nil, service.ErrWatchSourceNotFound
	}
	if mutation.ClearCredential {
		if _, err = tx.ExecContext(ctx, `UPDATE watch_source_credentials SET encrypted_value='', token_updated_at=NULL, updated_by=$2, updated_at=NOW() WHERE source_id=$1`, s.ID, s.UpdatedBy); err != nil {
			return nil, fmt.Errorf("clear watch source credential: %w", err)
		}
	} else if mutation.EncryptedSecret != "" {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_credentials (source_id, credential_type, encrypted_value, token_updated_at, updated_by, updated_at)
VALUES ($1,$2,$3,NOW(),$4,NOW())
ON CONFLICT (source_id) DO UPDATE SET credential_type=EXCLUDED.credential_type,
encrypted_value=EXCLUDED.encrypted_value, token_updated_at=NOW(), updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
			s.ID, mutation.CredentialType, mutation.EncryptedSecret, s.UpdatedBy); err != nil {
			return nil, fmt.Errorf("upsert watch source credential: %w", err)
		}
	}
	if mutation.ClearLoginCredential {
		if _, err = tx.ExecContext(ctx, `UPDATE watch_source_credentials SET encrypted_login_value=NULL, updated_by=$2, updated_at=NOW() WHERE source_id=$1`, s.ID, s.UpdatedBy); err != nil {
			return nil, fmt.Errorf("clear watch source login credential: %w", err)
		}
	} else if mutation.EncryptedLoginSecret != "" {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_credentials (source_id, credential_type, encrypted_value, encrypted_login_value, updated_by, updated_at)
VALUES ($1,$2,'',$3,$4,NOW())
ON CONFLICT (source_id) DO UPDATE SET encrypted_login_value=EXCLUDED.encrypted_login_value,
updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
			s.ID, fallbackWatchCredentialType(mutation.CredentialType), mutation.EncryptedLoginSecret, s.UpdatedBy); err != nil {
			return nil, fmt.Errorf("upsert watch source login credential: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit update watch source: %w", err)
	}
	return r.GetSource(ctx, s.ID)
}

const watchSourceColumns = `
s.id, s.name, s.adapter_type, s.base_url, s.api_base_url, s.recharge_ratio,
s.low_balance_threshold, s.polling_interval_seconds, s.request_timeout_seconds, s.enabled,
EXISTS(SELECT 1 FROM watch_source_credentials c WHERE c.source_id=s.id AND NULLIF(c.encrypted_value,'') IS NOT NULL),
EXISTS(SELECT 1 FROM watch_source_credentials c WHERE c.source_id=s.id AND NULLIF(c.encrypted_login_value,'') IS NOT NULL),
COALESCE((SELECT c.credential_type FROM watch_source_credentials c WHERE c.source_id=s.id), ''),
COALESCE(s.last_check_status, ''), s.last_check_at, s.last_success_at,
COALESCE(s.last_error_code, ''), s.last_latency_ms, s.last_balance,
COALESCE(s.auth_mode, 'manual'), COALESCE(s.profile_path, ''), COALESCE(s.groups_path, ''),
COALESCE(s.rates_path, ''), COALESCE(s.pricing_path, ''), COALESCE(s.keys_path, ''),
COALESCE(s.login_path, ''), COALESCE(s.login_username_hint, ''), COALESCE(s.heartbeat_path, ''), COALESCE(s.read_mapping::text, '{}'), COALESCE(s.keepalive_enabled, TRUE),
COALESCE(s.keepalive_interval_seconds, 300), COALESCE(s.auto_follow_key_group, TRUE), COALESCE(s.last_keepalive_status, ''),
s.last_keepalive_at, s.last_keepalive_success_at, COALESCE(s.last_keepalive_error_code, ''),
s.last_keepalive_latency_ms, s.last_token_refreshed_at, s.created_by, s.updated_by, s.created_at, s.updated_at`

type watchSourceRowScanner interface{ Scan(dest ...any) error }

func scanWatchSource(row watchSourceRowScanner) (*service.WatchSource, error) {
	s := &service.WatchSource{}
	var readMappingRaw string
	if err := row.Scan(
		&s.ID, &s.Name, &s.AdapterType, &s.BaseURL, &s.APIBaseURL, &s.RechargeRatio,
		&s.LowBalanceThreshold, &s.PollingIntervalSeconds, &s.RequestTimeoutSeconds, &s.Enabled,
		&s.HasCredential, &s.HasLoginCredential, &s.CredentialType, &s.LastCheckStatus, &s.LastCheckAt, &s.LastSuccessAt,
		&s.LastErrorCode, &s.LastLatencyMs, &s.LastBalance, &s.AuthMode, &s.ProfilePath, &s.GroupsPath,
		&s.RatesPath, &s.PricingPath, &s.KeysPath, &s.LoginPath, &s.LoginUsernameHint, &s.HeartbeatPath, &readMappingRaw, &s.KeepaliveEnabled,
		&s.KeepaliveIntervalSeconds, &s.AutoFollowKeyGroup, &s.LastKeepaliveStatus, &s.LastKeepaliveAt, &s.LastKeepaliveSuccessAt,
		&s.LastKeepaliveErrorCode, &s.LastKeepaliveLatencyMs, &s.LastTokenRefreshedAt,
		&s.CreatedBy, &s.UpdatedBy, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if readMappingRaw != "" && readMappingRaw != "{}" {
		var readMapping service.WatchSourceReadMapping
		if err := json.Unmarshal([]byte(readMappingRaw), &readMapping); err != nil {
			return nil, fmt.Errorf("decode watch source read mapping: %w", err)
		}
		normalized, err := service.NormalizeWatchSourceReadMapping(&readMapping, s.AdapterType)
		if err != nil {
			return nil, fmt.Errorf("normalize watch source read mapping: %w", err)
		}
		s.ReadMapping = normalized
	}
	applyWatchSourceDefaults(s)
	service.HydrateWatchSourceDiagnosticState(s, time.Now().UTC())
	service.HydrateWatchSourceKeepaliveState(s, time.Now().UTC())
	return s, nil
}

func applyWatchSourceDefaults(s *service.WatchSource) {
	if s == nil {
		return
	}
	if s.AuthMode == "" {
		s.AuthMode = service.WatchSourceAuthModeManual
	}
	if s.KeepaliveIntervalSeconds <= 0 {
		s.KeepaliveIntervalSeconds = 300
	}
	if s.ProfilePath == "" {
		if s.AdapterType == service.WatchSourceAdapterNewAPI {
			s.ProfilePath = "/api/user/self"
		} else {
			s.ProfilePath = "/user/profile"
		}
	}
	if s.GroupsPath == "" {
		if s.AdapterType == service.WatchSourceAdapterNewAPI {
			s.GroupsPath = "/api/user/self/groups"
		} else {
			s.GroupsPath = "/groups/available"
		}
	}
	if s.RatesPath == "" && s.AdapterType != service.WatchSourceAdapterNewAPI {
		s.RatesPath = "/groups/rates"
	}
	if s.PricingPath == "" {
		if s.AdapterType == service.WatchSourceAdapterNewAPI {
			s.PricingPath = "/api/pricing"
		} else {
			s.PricingPath = "/channels/available"
		}
	}
	if s.KeysPath == "" {
		switch s.AdapterType {
		case service.WatchSourceAdapterNewAPI:
			s.KeysPath = "/api/token/?p=0&size=100"
		case service.WatchSourceAdapterCustom:
		default:
			s.KeysPath = "/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai"
		}
	}
	if s.LoginPath == "" {
		if s.AdapterType == service.WatchSourceAdapterNewAPI {
			s.LoginPath = "/api/user/login"
		} else {
			s.LoginPath = "/auth/login"
		}
	}
	if s.HeartbeatPath == "" {
		s.HeartbeatPath = s.ProfilePath
	}
}

func fallbackWatchCredentialType(credentialType string) string {
	switch credentialType {
	case service.WatchCredentialAPIKey, service.WatchCredentialCookie:
		return credentialType
	default:
		return service.WatchCredentialBearer
	}
}

func (r *watchSourceRepository) GetSource(ctx context.Context, id int64) (*service.WatchSource, error) {
	s, err := scanWatchSource(r.db.QueryRowContext(ctx, `SELECT `+watchSourceColumns+` FROM watch_sources s WHERE s.id=$1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrWatchSourceNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get watch source: %w", err)
	}
	return s, nil
}

func (r *watchSourceRepository) ListSources(ctx context.Context) ([]*service.WatchSource, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+watchSourceColumns+` FROM watch_sources s ORDER BY s.id`)
	if err != nil {
		return nil, fmt.Errorf("list watch sources: %w", err)
	}
	defer rows.Close()
	return collectWatchSources(rows)
}

func (r *watchSourceRepository) ClaimDueSources(ctx context.Context, now time.Time, limit int) ([]*service.WatchSource, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx, `
WITH due AS (
	SELECT id FROM watch_sources
	WHERE enabled=TRUE AND (
		last_check_at IS NULL OR
		last_check_at + make_interval(secs => CASE
			WHEN LOWER(COALESCE(last_error_code, '')) IN ('unauthorized','credential_missing','credential_invalid','credential_decrypt_failed')
				THEN GREATEST(polling_interval_seconds, 900)
			ELSE polling_interval_seconds
		END) <= $1
	)
	ORDER BY last_check_at NULLS FIRST, id
	FOR UPDATE SKIP LOCKED
	LIMIT $2
)
UPDATE watch_sources s
SET last_check_at=$1, last_check_status='checking', last_error_code=NULL, updated_at=NOW()
FROM due WHERE s.id=due.id
RETURNING `+watchSourceColumns, now, limit)
	if err != nil {
		return nil, fmt.Errorf("claim due watch sources: %w", err)
	}
	defer rows.Close()
	return collectWatchSources(rows)
}

func (r *watchSourceRepository) ClaimDueKeepaliveSources(ctx context.Context, now time.Time, limit int) ([]*service.WatchSource, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := r.db.QueryContext(ctx, `
WITH due AS (
	SELECT id FROM watch_sources
	WHERE enabled=TRUE AND keepalive_enabled=TRUE
		AND (last_keepalive_at IS NULL OR last_keepalive_at + make_interval(secs => keepalive_interval_seconds) <= $1)
	ORDER BY last_keepalive_at NULLS FIRST, id
	FOR UPDATE SKIP LOCKED
	LIMIT $2
)
UPDATE watch_sources s SET last_keepalive_at=$1, last_keepalive_status='checking', last_keepalive_error_code=NULL, updated_at=NOW()
FROM due WHERE s.id=due.id
RETURNING `+watchSourceColumns, now, limit)
	if err != nil {
		return nil, fmt.Errorf("claim due watch source keepalives: %w", err)
	}
	defer rows.Close()
	return collectWatchSources(rows)
}

func collectWatchSources(rows *sql.Rows) ([]*service.WatchSource, error) {
	out := make([]*service.WatchSource, 0)
	for rows.Next() {
		s, err := scanWatchSource(rows)
		if err != nil {
			return nil, fmt.Errorf("scan watch source: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate watch sources: %w", err)
	}
	return out, nil
}

func (r *watchSourceRepository) DeleteSource(ctx context.Context, id int64) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM watch_sources WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("delete watch source: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return service.ErrWatchSourceNotFound
	}
	return nil
}

func (r *watchSourceRepository) GetSourceCredential(ctx context.Context, id int64) (string, string, error) {
	var credentialType, encryptedValue string
	err := r.db.QueryRowContext(ctx, `SELECT credential_type, encrypted_value FROM watch_source_credentials WHERE source_id=$1`, id).Scan(&credentialType, &encryptedValue)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", service.ErrWatchSourceCredentialAbsent
	}
	if err != nil {
		return "", "", fmt.Errorf("get watch source credential: %w", err)
	}
	if encryptedValue == "" {
		return "", "", service.ErrWatchSourceCredentialAbsent
	}
	return credentialType, encryptedValue, nil
}

func (r *watchSourceRepository) GetSourceCredentialBundle(ctx context.Context, id int64) (*service.WatchSourceCredentialBundle, error) {
	var bundle service.WatchSourceCredentialBundle
	err := r.db.QueryRowContext(ctx, `
SELECT credential_type, COALESCE(encrypted_value,''), COALESCE(encrypted_login_value,'')
FROM watch_source_credentials WHERE source_id=$1`, id).Scan(&bundle.CredentialType, &bundle.EncryptedValue, &bundle.EncryptedLoginValue)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrWatchSourceCredentialAbsent
	}
	if err != nil {
		return nil, fmt.Errorf("get watch source credential bundle: %w", err)
	}
	if bundle.EncryptedValue == "" && bundle.EncryptedLoginValue == "" {
		return nil, service.ErrWatchSourceCredentialAbsent
	}
	return &bundle, nil
}

func (r *watchSourceRepository) UpdateSourceCredential(ctx context.Context, sourceID int64, credentialType, encryptedValue string, updatedAt time.Time) error {
	if sourceID <= 0 || encryptedValue == "" {
		return fmt.Errorf("invalid watch source credential update")
	}
	credentialType = fallbackWatchCredentialType(credentialType)
	result, err := r.db.ExecContext(ctx, `
INSERT INTO watch_source_credentials (source_id, credential_type, encrypted_value, token_updated_at, updated_at)
VALUES ($1,$2,$3,$4,NOW())
ON CONFLICT (source_id) DO UPDATE SET credential_type=EXCLUDED.credential_type,
encrypted_value=EXCLUDED.encrypted_value, token_updated_at=EXCLUDED.token_updated_at, updated_at=NOW()`,
		sourceID, credentialType, encryptedValue, updatedAt)
	if err != nil {
		return fmt.Errorf("update watch source credential: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return service.ErrWatchSourceNotFound
	}
	return nil
}

func (r *watchSourceRepository) SaveSourceObservation(ctx context.Context, sourceID int64, observation service.WatchSourceObservation) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin save watch observation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var sourceName string
	var rechargeRatio float64
	var autoFollowKeyGroup bool
	if err = tx.QueryRowContext(ctx, `SELECT name,recharge_ratio,auto_follow_key_group FROM watch_sources WHERE id=$1`, sourceID).Scan(&sourceName, &rechargeRatio, &autoFollowKeyGroup); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return service.ErrWatchSourceNotFound
		}
		return fmt.Errorf("load watch source snapshot metadata: %w", err)
	}
	result, err := tx.ExecContext(ctx, `
UPDATE watch_sources SET last_check_status=$2::VARCHAR(32), last_check_at=$3,
	last_success_at=CASE WHEN $2::VARCHAR(32) IN ('healthy','degraded') THEN $3 ELSE last_success_at END,
	last_error_code=NULLIF($4::TEXT,'')::VARCHAR(64), last_latency_ms=$5,
	last_balance=CASE WHEN $2::VARCHAR(32) IN ('healthy','degraded') THEN $6 ELSE last_balance END, updated_at=NOW()
WHERE id=$1`, sourceID, observation.Status, observation.ObservedAt, observation.ErrorCode, observation.LatencyMs, observation.Balance)
	if err != nil {
		return fmt.Errorf("update watch source observation: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return service.ErrWatchSourceNotFound
	}
	if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_checks (target_type,target_id,status,error_code,latency_ms,observed_at,expires_at)
VALUES ('source',$1,$2,NULLIF($3,''),$4,$5,$6)`, sourceID, observation.Status, observation.ErrorCode, observation.LatencyMs, observation.ObservedAt, observation.ExpiresAt); err != nil {
		return fmt.Errorf("insert watch source check: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `
DELETE FROM watch_checks WHERE id IN (
	SELECT id FROM watch_checks WHERE target_type='source' AND target_id=$1
	ORDER BY observed_at DESC,id DESC OFFSET 500
)`, sourceID); err != nil {
		return fmt.Errorf("trim watch source checks: %w", err)
	}
	if observation.Status == "healthy" || observation.Status == "degraded" {
		// Resolve the observed Key assignment before price-change events are
		// evaluated, so an ambiguous assignment cannot make a pricing rule due.
		if err = reconcileWatchSourceKeyGroupMappings(ctx, tx, sourceID, sourceName, autoFollowKeyGroup, observation); err != nil {
			return err
		}
		groupNameByExternalID := make(map[string]string, len(observation.Groups))
		for _, group := range observation.Groups {
			groupNameByExternalID[group.ExternalID] = group.Name
			nextValue := group.RateMultiplier
			if group.UserRateMultiplier != nil {
				nextValue = *group.UserRateMultiplier
			}
			changeResult, changeErr := tx.ExecContext(ctx, `
INSERT INTO watch_price_changes
(source_id,group_external_id,platform,model,component,previous_value,next_value,change_kind,observed_at,source_name_snapshot,group_name_snapshot)
SELECT $1::BIGINT,$2::VARCHAR(128),$3::VARCHAR(64),''::VARCHAR(255),'group_multiplier'::VARCHAR(32),COALESCE(user_rate_multiplier,rate_multiplier),$4::NUMERIC(20,8),
	CASE WHEN $4::NUMERIC(20,8)>COALESCE(user_rate_multiplier,rate_multiplier) THEN 'increase' ELSE 'decrease' END,$5::TIMESTAMPTZ,$6::TEXT,$7::TEXT
FROM watch_source_groups WHERE source_id=$1::BIGINT AND external_id=$2::VARCHAR(128)
			AND COALESCE(user_rate_multiplier,rate_multiplier) IS DISTINCT FROM $4::NUMERIC(20,8)`, sourceID, group.ExternalID, group.Platform, nextValue, group.ObservedAt, sourceName, group.Name)
			if changeErr != nil {
				return fmt.Errorf("record watch group price change: %w", changeErr)
			}
			if changed, _ := changeResult.RowsAffected(); changed > 0 {
				if err = bumpWatchPricingRulesForGroupChange(ctx, tx, sourceID, group.ExternalID, group.ObservedAt); err != nil {
					return err
				}
			}
			if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_group_history
(source_id,source_name_snapshot,group_external_id,group_name_snapshot,platform,rate_multiplier,user_rate_multiplier,recharge_ratio,effective_rate_multiplier,observed_at)
SELECT $1::BIGINT,$2::TEXT,$3::VARCHAR(128),$4::TEXT,$5::VARCHAR(64),$6::NUMERIC(20,8),$7::NUMERIC(20,8),$8::NUMERIC(20,8),
	(COALESCE($7::NUMERIC(20,8),$6::NUMERIC(20,8))/$8::NUMERIC(20,8))::NUMERIC(20,8),$9::TIMESTAMPTZ
WHERE NOT EXISTS (
	SELECT 1 FROM (
		SELECT rate_multiplier,user_rate_multiplier,recharge_ratio
		FROM watch_source_group_history
		WHERE source_id=$1::BIGINT AND group_external_id=$3::VARCHAR(128)
		ORDER BY observed_at DESC,id DESC LIMIT 1
	) last
	WHERE last.rate_multiplier IS NOT DISTINCT FROM $6::NUMERIC(20,8)
	  AND last.user_rate_multiplier IS NOT DISTINCT FROM $7::NUMERIC(20,8)
	  AND last.recharge_ratio IS NOT DISTINCT FROM $8::NUMERIC(20,8)
)`, sourceID, sourceName, group.ExternalID, group.Name, group.Platform, group.RateMultiplier, group.UserRateMultiplier, rechargeRatio, group.ObservedAt); err != nil {
				return fmt.Errorf("record watch source group history: %w", err)
			}
		}
		for _, price := range observation.Prices {
			groupName := groupNameByExternalID[price.GroupExternalID]
			if groupName == "" {
				groupName = price.GroupExternalID
			}
			changeResult, changeErr := tx.ExecContext(ctx, `
INSERT INTO watch_price_changes
(source_id,group_external_id,platform,model,component,previous_value,next_value,change_kind,observed_at,source_name_snapshot,group_name_snapshot)
SELECT $1::BIGINT,$2::VARCHAR(128),$3::VARCHAR(64),$4::VARCHAR(255),$5::VARCHAR(32),value,$6::NUMERIC(20,8),
	CASE WHEN $6::NUMERIC(20,8)>value THEN 'increase' ELSE 'decrease' END,$7::TIMESTAMPTZ,$8::TEXT,$9::TEXT
FROM watch_source_prices WHERE source_id=$1::BIGINT AND group_external_id=$2::VARCHAR(128) AND platform=$3::VARCHAR(64) AND model=$4::VARCHAR(255) AND component=$5::VARCHAR(32)
			AND value IS DISTINCT FROM $6::NUMERIC(20,8)`, sourceID, price.GroupExternalID, price.Platform, price.Model, price.Component, price.Value, price.ObservedAt, sourceName, groupName)
			if changeErr != nil {
				return fmt.Errorf("record watch model price change: %w", changeErr)
			}
			if changed, _ := changeResult.RowsAffected(); changed > 0 {
				if err = bumpWatchPricingRulesForModelChange(ctx, tx, sourceID, price.GroupExternalID, price.Platform, price.Model, price.Component, price.ObservedAt); err != nil {
					return err
				}
			}
			if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_price_history
(source_id,source_name_snapshot,group_external_id,group_name_snapshot,platform,model,component,value,recharge_ratio,effective_value,observed_at)
SELECT $1::BIGINT,$2::TEXT,$3::VARCHAR(128),$4::TEXT,$5::VARCHAR(64),$6::VARCHAR(255),$7::VARCHAR(32),$8::NUMERIC(20,8),$9::NUMERIC(20,8),
	($8::NUMERIC(20,8)/$9::NUMERIC(20,8))::NUMERIC(20,8),$10::TIMESTAMPTZ
WHERE NOT EXISTS (
	SELECT 1 FROM (
		SELECT value,recharge_ratio
		FROM watch_source_price_history
		WHERE source_id=$1::BIGINT AND group_external_id=$3::VARCHAR(128) AND platform=$5::VARCHAR(64) AND model=$6::VARCHAR(255) AND component=$7::VARCHAR(32)
		ORDER BY observed_at DESC,id DESC LIMIT 1
	) last
	WHERE last.value IS NOT DISTINCT FROM $8::NUMERIC(20,8)
	  AND last.recharge_ratio IS NOT DISTINCT FROM $9::NUMERIC(20,8)
)`, sourceID, sourceName, price.GroupExternalID, groupName, price.Platform, price.Model, price.Component, price.Value, rechargeRatio, price.ObservedAt); err != nil {
				return fmt.Errorf("record watch source price history: %w", err)
			}
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM watch_source_groups WHERE source_id=$1`, sourceID); err != nil {
			return fmt.Errorf("clear watch source groups: %w", err)
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM watch_source_prices WHERE source_id=$1`, sourceID); err != nil {
			return fmt.Errorf("clear watch source prices: %w", err)
		}
		for _, group := range observation.Groups {
			if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_groups
(source_id,external_id,name,platform,rate_multiplier,user_rate_multiplier,pricing_available,observed_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, sourceID, group.ExternalID, group.Name, group.Platform,
				group.RateMultiplier, group.UserRateMultiplier, group.PricingAvailable, group.ObservedAt); err != nil {
				return fmt.Errorf("insert watch source group: %w", err)
			}
		}
		for _, price := range observation.Prices {
			if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_prices
(source_id,group_external_id,platform,model,component,value,observed_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)`, sourceID, price.GroupExternalID, price.Platform,
				price.Model, price.Component, price.Value, price.ObservedAt); err != nil {
				return fmt.Errorf("insert watch source price: %w", err)
			}
		}
		if observation.SourceKeys != nil {
			if _, err = tx.ExecContext(ctx, `DELETE FROM watch_source_keys WHERE source_id=$1`, sourceID); err != nil {
				return fmt.Errorf("clear watch source keys: %w", err)
			}
			for _, key := range observation.SourceKeys {
				groupIDs, marshalErr := json.Marshal(key.GroupExternalIDs)
				if marshalErr != nil {
					return fmt.Errorf("encode watch source key groups: %w", marshalErr)
				}
				groupNames, marshalErr := json.Marshal(key.GroupNames)
				if marshalErr != nil {
					return fmt.Errorf("encode watch source key group names: %w", marshalErr)
				}
				if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_source_keys
(source_id,external_id,label,status,group_external_ids,group_names,key_digest,summary,external_created_at,observed_at)
VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,NULLIF($7,''),NULLIF($8,''),$9,$10)`,
					sourceID, key.ExternalID, key.Label, key.Status, string(groupIDs), string(groupNames),
					"", key.Summary, key.ExternalCreatedAt, key.ObservedAt); err != nil {
					return fmt.Errorf("insert watch source key: %w", err)
				}
			}
		}
		if _, err = tx.ExecContext(ctx, `
DELETE FROM watch_price_changes WHERE id IN (
	SELECT id FROM watch_price_changes WHERE source_id=$1
	ORDER BY observed_at DESC,id DESC OFFSET 1000
)`, sourceID); err != nil {
			return fmt.Errorf("trim watch price changes: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit watch source observation: %w", err)
	}
	return nil
}

type watchSourceMappingFollowRow struct {
	accountID           int64
	keyExternalID       string
	groupExternalID     string
	mappingMethod       string
	bindingState        string
	confirmedGroupIDs   []string
	sourceKeyObservedAt *time.Time
	updatedAt           time.Time
}

func reconcileWatchSourceKeyGroupMappings(
	ctx context.Context,
	tx *sql.Tx,
	sourceID int64,
	sourceName string,
	autoFollow bool,
	observation service.WatchSourceObservation,
) error {
	if !autoFollow || observation.SourceKeys == nil {
		return nil
	}
	groupNames := make(map[string]string, len(observation.Groups))
	for _, group := range observation.Groups {
		groupID := strings.TrimSpace(group.ExternalID)
		if groupID != "" {
			groupNames[groupID] = group.Name
		}
	}
	keys := make(map[string]service.WatchSourceKeyObservation, len(observation.SourceKeys))
	for _, key := range observation.SourceKeys {
		keyID := strings.TrimSpace(key.ExternalID)
		if keyID != "" {
			keys[keyID] = key
		}
	}

	rows, err := tx.QueryContext(ctx, `
SELECT account_id,source_key_external_id,COALESCE(source_group_external_id,''),mapping_method,
       COALESCE(group_binding_state,'confirmed'),COALESCE(confirmed_group_external_ids::text,'[]'),
       source_key_observed_at,updated_at
FROM watch_account_upstream_mappings
WHERE source_id=$1
ORDER BY account_id
FOR UPDATE`, sourceID)
	if err != nil {
		return fmt.Errorf("lock watch account mappings for source key group follow: %w", err)
	}
	mappings := make([]watchSourceMappingFollowRow, 0)
	for rows.Next() {
		var item watchSourceMappingFollowRow
		var confirmedGroupIDsRaw string
		if err = rows.Scan(&item.accountID, &item.keyExternalID, &item.groupExternalID, &item.mappingMethod,
			&item.bindingState, &confirmedGroupIDsRaw, &item.sourceKeyObservedAt, &item.updatedAt); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan watch account mapping for source key group follow: %w", err)
		}
		item.confirmedGroupIDs = normalizeWatchObservedGroupIDs(decodeWatchStringJSONArray(confirmedGroupIDsRaw))
		mappings = append(mappings, item)
	}
	if err = rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate watch account mappings for source key group follow: %w", err)
	}
	if err = rows.Close(); err != nil {
		return fmt.Errorf("close watch account mappings for source key group follow: %w", err)
	}

	for _, mapping := range mappings {
		if !observation.ObservedAt.After(mapping.updatedAt) {
			continue
		}
		if mapping.sourceKeyObservedAt != nil && !observation.ObservedAt.After(*mapping.sourceKeyObservedAt) {
			continue
		}
		key, keyFound := keys[mapping.keyExternalID]
		if !keyFound || !service.WatchSourceKeyIsActive(key.Status) {
			if err = markWatchMappingNeedsConfirmation(ctx, tx, sourceID, mapping, observation.ObservedAt); err != nil {
				return err
			}
			continue
		}
		observedGroupIDs := normalizeWatchObservedGroupIDs(key.GroupExternalIDs)
		if len(observedGroupIDs) != 1 {
			if len(observedGroupIDs) > 1 && mapping.bindingState == "confirmed" &&
				watchStringSlicesEqual(observedGroupIDs, mapping.confirmedGroupIDs) &&
				watchStringSliceContains(observedGroupIDs, mapping.groupExternalID) {
				if err = updateWatchMappingObservation(ctx, tx, sourceID, mapping, "confirmed", observedGroupIDs, observation.ObservedAt); err != nil {
					return err
				}
				continue
			}
			if err = markWatchMappingNeedsConfirmation(ctx, tx, sourceID, mapping, observation.ObservedAt); err != nil {
				return err
			}
			continue
		}

		targetGroupID := observedGroupIDs[0]
		targetGroupName, groupFound := groupNames[targetGroupID]
		if !groupFound {
			if err = markWatchMappingNeedsConfirmation(ctx, tx, sourceID, mapping, observation.ObservedAt); err != nil {
				return err
			}
			continue
		}
		if mapping.groupExternalID == targetGroupID {
			stateChanged := mapping.bindingState != "confirmed"
			if err = updateWatchMappingObservation(ctx, tx, sourceID, mapping, "confirmed", observedGroupIDs, observation.ObservedAt); err != nil {
				return err
			}
			if stateChanged {
				if err = insertWatchAccountMappingHistory(ctx, tx, sourceID, sourceName, mapping, key.Label,
					targetGroupID, targetGroupName, observation.ObservedAt); err != nil {
					return err
				}
				if err = bumpWatchPricingRulesForAccountMappingChange(ctx, tx, mapping.accountID, sourceID, mapping.keyExternalID, observation.ObservedAt); err != nil {
					return err
				}
			}
			continue
		}
		if err = rebindWatchAccountMapping(ctx, tx, sourceID, sourceName, mapping, key, targetGroupID, targetGroupName, observedGroupIDs, observation.ObservedAt); err != nil {
			return err
		}
		if err = bumpWatchPricingRulesForAccountMappingChange(ctx, tx, mapping.accountID, sourceID, mapping.keyExternalID, observation.ObservedAt); err != nil {
			return err
		}
	}
	return nil
}

func markWatchMappingNeedsConfirmation(ctx context.Context, tx *sql.Tx, sourceID int64, mapping watchSourceMappingFollowRow, observedAt time.Time) error {
	stateChanged := mapping.bindingState != "needs_confirmation"
	if err := updateWatchMappingObservation(ctx, tx, sourceID, mapping, "needs_confirmation", mapping.confirmedGroupIDs, observedAt); err != nil {
		return err
	}
	if stateChanged {
		if err := closeWatchAccountMappingHistory(ctx, tx, mapping.accountID, observedAt); err != nil {
			return err
		}
		return bumpWatchPricingRulesForAccountMappingChange(ctx, tx, mapping.accountID, sourceID, mapping.keyExternalID, observedAt)
	}
	return nil
}

func updateWatchMappingObservation(ctx context.Context, tx *sql.Tx, sourceID int64, mapping watchSourceMappingFollowRow, state string, confirmedGroupIDs []string, observedAt time.Time) error {
	payload, err := json.Marshal(confirmedGroupIDs)
	if err != nil {
		return fmt.Errorf("encode confirmed source key groups: %w", err)
	}
	result, err := tx.ExecContext(ctx, `
UPDATE watch_account_upstream_mappings
SET group_binding_state=$4::VARCHAR(24),confirmed_group_external_ids=$5::jsonb,source_key_observed_at=$6,
    updated_at=CASE
        WHEN group_binding_state IS DISTINCT FROM $4::VARCHAR(24) OR confirmed_group_external_ids IS DISTINCT FROM $5::jsonb THEN NOW()
        ELSE updated_at
    END
WHERE account_id=$1 AND source_id=$2 AND source_key_external_id=$3
  AND (source_key_observed_at IS NULL OR source_key_observed_at < $6)`,
		mapping.accountID, sourceID, mapping.keyExternalID, state, string(payload), observedAt)
	if err != nil {
		return fmt.Errorf("update watch source key group observation: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return nil
	}
	return nil
}

func rebindWatchAccountMapping(
	ctx context.Context,
	tx *sql.Tx,
	sourceID int64,
	sourceName string,
	mapping watchSourceMappingFollowRow,
	key service.WatchSourceKeyObservation,
	targetGroupID string,
	targetGroupName string,
	confirmedGroupIDs []string,
	observedAt time.Time,
) error {
	payload, err := json.Marshal(confirmedGroupIDs)
	if err != nil {
		return fmt.Errorf("encode rebound source key groups: %w", err)
	}
	if err = closeWatchAccountMappingHistory(ctx, tx, mapping.accountID, observedAt); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
UPDATE watch_account_upstream_mappings
SET source_group_external_id=$4,mapping_method='auto',group_binding_state='confirmed',
    confirmed_group_external_ids=$5::jsonb,source_key_observed_at=$6,updated_by=NULL,updated_at=NOW()
WHERE account_id=$1 AND source_id=$2 AND source_key_external_id=$3
  AND source_group_external_id IS DISTINCT FROM $4
  AND (source_key_observed_at IS NULL OR source_key_observed_at < $6)`,
		mapping.accountID, sourceID, mapping.keyExternalID, targetGroupID, string(payload), observedAt)
	if err != nil {
		return fmt.Errorf("rebind watch account mapping to source key group: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil
	}
	if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mapping_history
(account_id,source_id,source_name_snapshot,source_key_external_id,source_key_label_snapshot,
 source_group_external_id,source_group_name_snapshot,mapping_method,valid_from,updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,'auto',$8,NULL)`,
		mapping.accountID, sourceID, sourceName, mapping.keyExternalID, key.Label,
		targetGroupID, targetGroupName, observedAt); err != nil {
		return fmt.Errorf("insert rebound watch account mapping history: %w", err)
	}
	return nil
}

func closeWatchAccountMappingHistory(ctx context.Context, tx *sql.Tx, accountID int64, observedAt time.Time) error {
	if _, err := tx.ExecContext(ctx, `
UPDATE watch_account_upstream_mapping_history
SET valid_to=$2
WHERE account_id=$1 AND valid_to IS NULL AND valid_from < $2`, accountID, observedAt); err != nil {
		return fmt.Errorf("close watch account mapping history for source key group follow: %w", err)
	}
	return nil
}

func insertWatchAccountMappingHistory(
	ctx context.Context,
	tx *sql.Tx,
	sourceID int64,
	sourceName string,
	mapping watchSourceMappingFollowRow,
	keyLabel string,
	groupExternalID string,
	groupName string,
	observedAt time.Time,
) error {
	method := strings.TrimSpace(mapping.mappingMethod)
	if method == "" {
		method = "manual"
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO watch_account_upstream_mapping_history
(account_id,source_id,source_name_snapshot,source_key_external_id,source_key_label_snapshot,
 source_group_external_id,source_group_name_snapshot,mapping_method,valid_from,updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)`, mapping.accountID, sourceID, sourceName,
		mapping.keyExternalID, keyLabel, groupExternalID, groupName, method, observedAt); err != nil {
		return fmt.Errorf("restore watch account mapping history after source key group confirmation: %w", err)
	}
	return nil
}

func bumpWatchPricingRulesForAccountMappingChange(ctx context.Context, tx *sql.Tx, accountID, sourceID int64, keyExternalID string, observedAt time.Time) error {
	_, err := tx.ExecContext(ctx, `
UPDATE watch_pricing_rules r
SET next_run_at=CASE WHEN r.next_run_at IS NULL OR r.next_run_at > $2 THEN $2 ELSE r.next_run_at END,
    updated_at=NOW()
WHERE r.enabled=TRUE
  AND EXISTS (
	SELECT 1
	FROM account_groups ag
	JOIN accounts a ON a.id=ag.account_id AND a.deleted_at IS NULL
	JOIN watch_account_upstream_mappings m
	  ON m.account_id=ag.account_id
	 AND m.source_id=$3
	 AND m.source_key_external_id=$4
	 AND COALESCE(m.group_binding_state,'confirmed')='confirmed'
	WHERE ag.account_id=$1
	  AND ag.group_id=r.target_group_id
	  AND a.status='active'
	  AND a.schedulable=TRUE
	  )`, accountID, observedAt, sourceID, keyExternalID)
	if err != nil {
		return fmt.Errorf("trigger watch pricing rules for source key group follow: %w", err)
	}
	return nil
}

func normalizeWatchObservedGroupIDs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func watchStringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func watchStringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func bumpWatchPricingRulesForGroupChange(ctx context.Context, tx *sql.Tx, sourceID int64, groupExternalID string, observedAt time.Time) error {
	_, err := tx.ExecContext(ctx, `
UPDATE watch_pricing_rules r
SET next_run_at=CASE WHEN r.next_run_at IS NULL OR r.next_run_at > $3 THEN $3 ELSE r.next_run_at END, updated_at=NOW()
WHERE r.enabled=TRUE
  AND r.mode='group_multiplier'
  AND EXISTS (
	SELECT 1
	FROM account_groups ag
	JOIN accounts a
	  ON a.id=ag.account_id
	 AND a.deleted_at IS NULL
	 AND a.status='active'
	 AND a.schedulable=TRUE
	JOIN watch_account_upstream_mappings m ON m.account_id=ag.account_id
	WHERE ag.group_id=r.target_group_id
	  AND m.source_id=$1
	  AND m.source_group_external_id=$2
	  AND COALESCE(m.group_binding_state,'confirmed')='confirmed'
  )`, sourceID, groupExternalID, observedAt)
	if err != nil {
		return fmt.Errorf("trigger watch pricing rules for group change: %w", err)
	}
	return nil
}

func bumpWatchPricingRulesForModelChange(ctx context.Context, tx *sql.Tx, sourceID int64, groupExternalID, platform, model, component string, observedAt time.Time) error {
	_, err := tx.ExecContext(ctx, `
UPDATE watch_pricing_rules r
SET next_run_at=CASE WHEN r.next_run_at IS NULL OR r.next_run_at > $6 THEN $6 ELSE r.next_run_at END, updated_at=NOW()
WHERE r.enabled=TRUE
  AND r.mode='model_price'
  AND LOWER(r.model)=LOWER($4)
  AND r.component=$5
  AND ($3='' OR r.platform='' OR LOWER(r.platform)=LOWER($3))
  AND EXISTS (
	SELECT 1
	FROM account_groups ag
	JOIN accounts a
	  ON a.id=ag.account_id
	 AND a.deleted_at IS NULL
	 AND a.status='active'
	 AND a.schedulable=TRUE
	JOIN watch_account_upstream_mappings m ON m.account_id=ag.account_id
	WHERE ag.group_id=r.target_group_id
	  AND m.source_id=$1
	  AND m.source_group_external_id=$2
	  AND COALESCE(m.group_binding_state,'confirmed')='confirmed'
  )`, sourceID, groupExternalID, platform, model, component, observedAt)
	if err != nil {
		return fmt.Errorf("trigger watch pricing rules for model change: %w", err)
	}
	return nil
}

func (r *watchSourceRepository) SaveSourceKeepalive(ctx context.Context, sourceID int64, observation service.WatchSourceObservation) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin save watch keepalive: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `
UPDATE watch_sources SET last_keepalive_status=$2::VARCHAR(32), last_keepalive_at=$3,
	last_keepalive_success_at=CASE WHEN $2::VARCHAR(32) IN ('healthy','degraded') THEN $3 ELSE last_keepalive_success_at END,
	last_keepalive_error_code=NULLIF($4::TEXT,'')::VARCHAR(64), last_keepalive_latency_ms=$5,
	last_token_refreshed_at=CASE WHEN $6::BOOLEAN THEN $3 ELSE last_token_refreshed_at END,
	last_balance=CASE WHEN $2::VARCHAR(32) IN ('healthy','degraded') AND $7::NUMERIC(20,8) IS NOT NULL THEN $7 ELSE last_balance END,
	updated_at=NOW()
WHERE id=$1`, sourceID, observation.Status, observation.ObservedAt, observation.ErrorCode, observation.LatencyMs, observation.TokenRefreshed, observation.Balance)
	if err != nil {
		return fmt.Errorf("update watch source keepalive: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return service.ErrWatchSourceNotFound
	}
	if _, err = tx.ExecContext(ctx, `
INSERT INTO watch_checks (target_type,target_id,status,error_code,latency_ms,observed_at,expires_at)
VALUES ('source_keepalive',$1,$2,NULLIF($3,''),$4,$5,$6)`, sourceID, observation.Status, observation.ErrorCode, observation.LatencyMs, observation.ObservedAt, observation.ExpiresAt); err != nil {
		return fmt.Errorf("insert watch source keepalive check: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `
DELETE FROM watch_checks WHERE id IN (
	SELECT id FROM watch_checks WHERE target_type='source_keepalive' AND target_id=$1
	ORDER BY observed_at DESC,id DESC OFFSET 500
)`, sourceID); err != nil {
		return fmt.Errorf("trim watch source keepalive checks: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit watch source keepalive: %w", err)
	}
	return nil
}

func (r *watchSourceRepository) GetSourceSnapshot(ctx context.Context, sourceID int64) (*service.WatchSourceSnapshot, error) {
	source, err := r.GetSource(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	snapshot := &service.WatchSourceSnapshot{Source: source, Groups: []service.WatchSourceGroupObservation{}, Prices: []service.WatchSourcePriceObservation{}, SourceKeys: []service.WatchSourceKeyObservation{}}
	snapshot.Balance = source.LastBalance
	checks, err := r.ListSourceChecks(ctx, sourceID, 1)
	if err != nil {
		return nil, err
	}
	if len(checks) > 0 {
		snapshot.Check = &checks[0]
	}
	rows, err := r.db.QueryContext(ctx, `SELECT external_id,name,platform,rate_multiplier,user_rate_multiplier,pricing_available,observed_at FROM watch_source_groups WHERE source_id=$1 ORDER BY name,external_id`, sourceID)
	if err != nil {
		return nil, fmt.Errorf("list watch source groups: %w", err)
	}
	for rows.Next() {
		var group service.WatchSourceGroupObservation
		if err = rows.Scan(&group.ExternalID, &group.Name, &group.Platform, &group.RateMultiplier, &group.UserRateMultiplier, &group.PricingAvailable, &group.ObservedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan watch source group: %w", err)
		}
		snapshot.Groups = append(snapshot.Groups, group)
	}
	if err = rows.Close(); err != nil {
		return nil, fmt.Errorf("close watch source groups: %w", err)
	}
	rows, err = r.db.QueryContext(ctx, `SELECT group_external_id,platform,model,component,value,observed_at FROM watch_source_prices WHERE source_id=$1 ORDER BY platform,model,component`, sourceID)
	if err != nil {
		return nil, fmt.Errorf("list watch source prices: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var price service.WatchSourcePriceObservation
		if err = rows.Scan(&price.GroupExternalID, &price.Platform, &price.Model, &price.Component, &price.Value, &price.ObservedAt); err != nil {
			return nil, fmt.Errorf("scan watch source price: %w", err)
		}
		snapshot.Prices = append(snapshot.Prices, price)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows, err = r.db.QueryContext(ctx, `
SELECT external_id,label,COALESCE(status,''),group_external_ids::text,group_names::text,COALESCE(summary,''),external_created_at,observed_at
FROM watch_source_keys WHERE source_id=$1 ORDER BY label,external_id`, sourceID)
	if err != nil {
		return nil, fmt.Errorf("list watch source keys: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var key service.WatchSourceKeyObservation
		var groupIDsRaw, groupNamesRaw string
		if err = rows.Scan(&key.ExternalID, &key.Label, &key.Status, &groupIDsRaw, &groupNamesRaw, &key.Summary, &key.ExternalCreatedAt, &key.ObservedAt); err != nil {
			return nil, fmt.Errorf("scan watch source key: %w", err)
		}
		key.GroupExternalIDs = decodeWatchStringJSONArray(groupIDsRaw)
		key.GroupNames = decodeWatchStringJSONArray(groupNamesRaw)
		snapshot.SourceKeys = append(snapshot.SourceKeys, key)
	}
	return snapshot, rows.Err()
}

func decodeWatchStringJSONArray(raw string) []string {
	if raw == "" || raw == "null" {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}
	if values == nil {
		return []string{}
	}
	return values
}

func (r *watchSourceRepository) ListSourceChecks(ctx context.Context, sourceID int64, limit int) ([]service.WatchSourceCheck, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT id,target_id,status,COALESCE(error_code,''),latency_ms,observed_at,expires_at
FROM watch_checks WHERE target_type='source' AND target_id=$1 ORDER BY observed_at DESC,id DESC LIMIT $2`, sourceID, limit)
	if err != nil {
		return nil, fmt.Errorf("list watch source checks: %w", err)
	}
	defer rows.Close()
	out := make([]service.WatchSourceCheck, 0)
	for rows.Next() {
		var check service.WatchSourceCheck
		if err = rows.Scan(&check.ID, &check.SourceID, &check.Status, &check.ErrorCode, &check.LatencyMs, &check.ObservedAt, &check.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan watch source check: %w", err)
		}
		out = append(out, check)
	}
	return out, rows.Err()
}

func (r *watchSourceRepository) ListSourceKeepaliveChecks(ctx context.Context, sourceID int64, limit int) ([]service.WatchSourceCheck, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT id,target_id,status,COALESCE(error_code,''),latency_ms,observed_at,expires_at
FROM watch_checks WHERE target_type='source_keepalive' AND target_id=$1 ORDER BY observed_at DESC,id DESC LIMIT $2`, sourceID, limit)
	if err != nil {
		return nil, fmt.Errorf("list watch source keepalive checks: %w", err)
	}
	defer rows.Close()
	out := make([]service.WatchSourceCheck, 0)
	for rows.Next() {
		var check service.WatchSourceCheck
		if err = rows.Scan(&check.ID, &check.SourceID, &check.Status, &check.ErrorCode, &check.LatencyMs, &check.ObservedAt, &check.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan watch source keepalive check: %w", err)
		}
		out = append(out, check)
	}
	return out, rows.Err()
}

func (r *watchSourceRepository) ListPricingObservations(ctx context.Context, mode service.WatchPriceMode, platform, model string, component service.WatchPriceComponent) ([]service.WatchPricingObservation, error) {
	query := `
	SELECT s.id,s.name,g.external_id,g.name,g.platform,
	(COALESCE(g.user_rate_multiplier,g.rate_multiplier)/s.recharge_ratio)::DOUBLE PRECISION,
	COALESCE(s.last_check_status,''),COALESCE(s.last_error_code,''),g.observed_at,
	c.expires_at,s.last_balance,s.low_balance_threshold
FROM watch_sources s
JOIN watch_source_groups g ON g.source_id=s.id
LEFT JOIN LATERAL (
	SELECT expires_at FROM watch_checks
	WHERE target_type='source' AND target_id=s.id
	ORDER BY observed_at DESC,id DESC LIMIT 1
) c ON TRUE
WHERE s.enabled=TRUE
ORDER BY s.id,g.name,g.external_id`
	args := []any{}
	if mode == service.WatchPriceModeModelPrice {
		query = `
	SELECT s.id,s.name,g.external_id,g.name,COALESCE(p.platform,g.platform),
	(p.value/s.recharge_ratio)::DOUBLE PRECISION,
	COALESCE(s.last_check_status,''),COALESCE(s.last_error_code,''),g.observed_at,
	c.expires_at,s.last_balance,s.low_balance_threshold
FROM watch_sources s
JOIN watch_source_groups g ON g.source_id=s.id
LEFT JOIN watch_source_prices p ON p.source_id=s.id AND p.group_external_id=g.external_id
	AND LOWER(p.model)=LOWER($1) AND p.component=$2
	AND ($3='' OR LOWER(p.platform)=LOWER($3))
LEFT JOIN LATERAL (
	SELECT expires_at FROM watch_checks
	WHERE target_type='source' AND target_id=s.id
	ORDER BY observed_at DESC,id DESC LIMIT 1
) c ON TRUE
WHERE s.enabled=TRUE
ORDER BY s.id,g.name,g.external_id`
		args = []any{model, component, platform}
	}
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list watch pricing observations: %w", err)
	}
	defer rows.Close()
	out := make([]service.WatchPricingObservation, 0)
	for rows.Next() {
		var item service.WatchPricingObservation
		if err = rows.Scan(&item.SourceID, &item.SourceName, &item.GroupExternalID, &item.GroupName, &item.Platform,
			&item.Value, &item.Status, &item.ErrorCode, &item.ObservedAt, &item.ExpiresAt,
			&item.LastBalance, &item.BalanceMinimum); err != nil {
			return nil, fmt.Errorf("scan watch pricing observation: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *watchSourceRepository) ListPriceChanges(ctx context.Context, limit int) ([]service.WatchPriceChange, error) {
	return r.ListFilteredPriceChanges(ctx, service.WatchPriceChangeFilter{Limit: limit})
}

func (r *watchSourceRepository) ListFilteredPriceChanges(ctx context.Context, filter service.WatchPriceChangeFilter) ([]service.WatchPriceChange, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT c.id,c.source_id,COALESCE(NULLIF(c.source_name_snapshot,''),s.name),c.group_external_id,
	COALESCE(NULLIF(c.group_name_snapshot,''),g.name,c.group_external_id),
	c.platform,c.model,c.component,
	c.previous_value,c.next_value,c.change_kind,c.observed_at
FROM watch_price_changes c
JOIN watch_sources s ON s.id=c.source_id
LEFT JOIN watch_source_groups g ON g.source_id=c.source_id AND g.external_id=c.group_external_id
WHERE ($1::BIGINT = 0 OR c.source_id = $1::BIGINT)
  AND ($2::TEXT = '' OR c.group_external_id = $2::TEXT)
  AND ($3::TEXT = '' OR $3::TEXT = 'all' OR c.change_kind = $3::TEXT)
  AND ($4::TEXT = '' OR LOWER(c.platform) = LOWER($4::TEXT))
  AND ($5::TEXT = '' OR LOWER(c.model) = LOWER($5::TEXT))
  AND ($6::TEXT = '' OR c.component = $6::TEXT)
  AND ($7::BIGINT = 0 OR c.id > $7::BIGINT)
ORDER BY
	CASE WHEN $7::BIGINT > 0 THEN c.id END ASC,
	CASE WHEN $7::BIGINT = 0 THEN c.observed_at END DESC,
	CASE WHEN $7::BIGINT = 0 THEN c.id END DESC
LIMIT $8`,
		filter.SourceID, filter.GroupExternalID, filter.ChangeKind,
		strings.TrimSpace(filter.Platform), strings.TrimSpace(filter.Model), strings.TrimSpace(filter.Component), filter.AfterID, limit)
	if err != nil {
		return nil, fmt.Errorf("list watch price changes: %w", err)
	}
	defer rows.Close()
	out := make([]service.WatchPriceChange, 0)
	for rows.Next() {
		var item service.WatchPriceChange
		if err = rows.Scan(&item.ID, &item.SourceID, &item.SourceName, &item.GroupExternalID, &item.GroupName, &item.Platform,
			&item.Model, &item.Component, &item.PreviousValue, &item.NextValue, &item.ChangeKind, &item.ObservedAt); err != nil {
			return nil, fmt.Errorf("scan watch price change: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *watchSourceRepository) GetOperationsUsageSummary(ctx context.Context, start, end time.Time) (*service.WatchOperationsUsageSummary, error) {
	summary := &service.WatchOperationsUsageSummary{WindowStart: start, WindowEnd: end}
	var revenue, estimatedCost float64
	err := r.db.QueryRowContext(ctx, `
WITH usage_scope AS (
		SELECT
			id,
			request_id,
			account_id,
			group_id,
			billing_type,
			created_at,
		actual_cost::DOUBLE PRECISION AS actual_cost,
		COALESCE(account_stats_cost,total_cost)::DOUBLE PRECISION AS usage_base_cost
	FROM usage_logs
	WHERE created_at >= $1 AND created_at < $2
),
resolved AS (
	SELECT
			u.*,
			h.source_id,
			h.source_group_external_id,
			gh.effective_rate_multiplier::DOUBLE PRECISION AS effective_rate_multiplier,
			CASE WHEN u.billing_type=0 THEN funding.principal_amount ELSE u.actual_cost END AS recognized_revenue,
			CASE WHEN u.billing_type<>0 THEN TRUE ELSE funding.allocation_count>0 AND funding.unknown_amount=0 END AS revenue_known
	FROM usage_scope u
	LEFT JOIN LATERAL (
		SELECT source_id, source_group_external_id
		FROM watch_account_upstream_mapping_history
		WHERE account_id = u.account_id
		  AND valid_from <= u.created_at
		  AND (valid_to IS NULL OR valid_to > u.created_at)
		  AND source_group_external_id <> ''
		ORDER BY valid_from DESC, id DESC
		LIMIT 1
	) h ON TRUE
	LEFT JOIN LATERAL (
		SELECT effective_rate_multiplier
		FROM watch_source_group_history
		WHERE source_id = h.source_id
		  AND group_external_id = h.source_group_external_id
		  AND observed_at <= u.created_at
		ORDER BY observed_at DESC, id DESC
		LIMIT 1
		) gh ON TRUE
		LEFT JOIN LATERAL (
			SELECT
				COALESCE(SUM(principal_amount),0)::DOUBLE PRECISION AS principal_amount,
				COALESCE(SUM(unknown_amount),0)::DOUBLE PRECISION AS unknown_amount,
				COUNT(*)::BIGINT AS allocation_count
			FROM balance_source_allocations
			WHERE request_id=u.request_id
		) funding ON TRUE
	)
	SELECT
		COUNT(*)::BIGINT,
			COALESCE(SUM(CASE WHEN revenue_known THEN recognized_revenue ELSE 0 END),0)::DOUBLE PRECISION,
			COALESCE(SUM(CASE WHEN effective_rate_multiplier IS NULL THEN 0 ELSE usage_base_cost*effective_rate_multiplier END),0)::DOUBLE PRECISION,
			COALESCE(SUM(CASE WHEN revenue_known AND effective_rate_multiplier IS NOT NULL AND recognized_revenue + 0.0000000001 < usage_base_cost*effective_rate_multiplier THEN 1 ELSE 0 END),0)::BIGINT,
			COALESCE(SUM(CASE WHEN effective_rate_multiplier IS NULL OR NOT revenue_known THEN 1 ELSE 0 END),0)::BIGINT,
		COUNT(DISTINCT account_id)::BIGINT,
		COUNT(DISTINCT group_id)::BIGINT
	FROM resolved`, start, end).Scan(
		&summary.RequestCount,
		&revenue,
		&estimatedCost,
		&summary.LossRequestCount,
		&summary.UnresolvedRequestCount,
		&summary.AccountCount,
		&summary.GroupCount,
	)
	if err != nil {
		return nil, fmt.Errorf("get watch operations usage summary: %w", err)
	}
	summary.Revenue = revenue
	summary.EstimatedUpstreamCost = estimatedCost
	summary.GrossProfit = revenue - estimatedCost
	if revenue > 0 {
		margin := summary.GrossProfit / revenue
		summary.GrossMargin = &margin
	}
	return summary, nil
}

func (r *watchSourceRepository) ListIntegrationAccountHealth(ctx context.Context, filter service.WatchIntegrationAccountHealthFilter, windowStart, windowEnd time.Time) ([]service.WatchIntegrationAccountHealthRow, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("nil watch source repository")
	}
	limit := filter.Limit
	if limit <= 0 || limit > 1000 {
		limit = 500
	}

	args := []any{windowStart.UTC(), windowEnd.UTC()}
	baseConditions := []string{"a.deleted_at IS NULL"}
	outerConditions := make([]string, 0, 4)
	addBaseCondition := func(condition string, values ...any) {
		baseConditions = append(baseConditions, condition)
		args = append(args, values...)
	}
	addOuterCondition := func(condition string, values ...any) {
		outerConditions = append(outerConditions, condition)
		args = append(args, values...)
	}

	if platform := strings.ToLower(strings.TrimSpace(filter.Platform)); platform != "" {
		addBaseCondition(fmt.Sprintf("LOWER(COALESCE(NULLIF(a.platform,''),'unknown')) = $%d", len(args)+1), platform)
	}
	if filter.SourceID > 0 {
		addBaseCondition(fmt.Sprintf("COALESCE(m.source_id,0) = $%d", len(args)+1), filter.SourceID)
	}
	if search := strings.ToLower(strings.TrimSpace(filter.Search)); search != "" {
		like := "%" + search + "%"
		startArg := len(args) + 1
		addOuterCondition(fmt.Sprintf(`(
			LOWER(COALESCE(account_name,'')) LIKE $%d OR
			LOWER(COALESCE(platform,'')) LIKE $%d OR
			LOWER(COALESCE(account_base_url,'')) LIKE $%d OR
			LOWER(COALESCE(source_name,'')) LIKE $%d OR
			LOWER(COALESCE(source_group_name,'')) LIKE $%d OR
			LOWER(COALESCE(main_error,'')) LIKE $%d
		)`, startArg, startArg+1, startArg+2, startArg+3, startArg+4, startArg+5), like, like, like, like, like, like)
	}
	if status := strings.ToLower(strings.TrimSpace(filter.Status)); status != "" && status != "all" {
		switch status {
		case string(service.WatchIntegrationAccountHealthHealthy), string(service.WatchIntegrationAccountHealthAbnormal), string(service.WatchIntegrationAccountHealthObserving), string(service.WatchIntegrationAccountHealthDisabled):
			addOuterCondition(fmt.Sprintf("health_status = $%d", len(args)+1), status)
		default:
			return nil, fmt.Errorf("invalid watch integration status")
		}
	}

	baseWhere := "WHERE " + strings.Join(baseConditions, " AND ")
	outerWhere := ""
	if len(outerConditions) > 0 {
		outerWhere = "WHERE " + strings.Join(outerConditions, " AND ")
	}
	query := fmt.Sprintf(`
WITH successes AS (
	SELECT account_id, COUNT(1)::BIGINT AS success_count, MAX(created_at) AS last_success_at
	FROM usage_logs
	WHERE created_at >= $1 AND created_at < $2 AND account_id IS NOT NULL
	GROUP BY account_id
),
failures AS (
	SELECT
		account_id,
		COUNT(1)::BIGINT AS failure_count,
		MAX(created_at) AS last_failure_at,
		(ARRAY_AGG(COALESCE(NULLIF(provider_error_code,''), NULLIF(error_type,''), NULLIF(error_phase,''), 'unknown') ORDER BY created_at DESC, id DESC))[1] AS main_error
	FROM ops_error_logs
	WHERE created_at >= $1 AND created_at < $2
		AND account_id IS NOT NULL
		AND COALESCE(status_code, 0) >= 400
	GROUP BY account_id
),
latest_mapping AS (
	SELECT DISTINCT ON (m.account_id)
		m.account_id,
		m.source_id,
		s.name AS source_name,
		m.source_group_external_id,
		COALESCE(NULLIF(g.name,''), NULLIF(h.source_group_name_snapshot,''), NULLIF(m.source_group_external_id,''), '') AS source_group_name
	FROM watch_account_upstream_mappings m
	LEFT JOIN watch_sources s ON s.id=m.source_id
	LEFT JOIN watch_source_groups g ON g.source_id=m.source_id AND g.external_id=m.source_group_external_id
	LEFT JOIN LATERAL (
		SELECT source_group_name_snapshot
		FROM watch_account_upstream_mapping_history h
		WHERE h.account_id=m.account_id
		  AND h.source_id=m.source_id
		  AND h.source_group_external_id=COALESCE(NULLIF(m.source_group_external_id,''),'')
		  AND h.valid_to IS NULL
		ORDER BY h.valid_from DESC, h.id DESC
		LIMIT 1
	) h ON TRUE
	ORDER BY m.account_id, m.updated_at DESC, m.created_at DESC
),
base AS (
	SELECT
		a.id AS account_id,
		a.name AS account_name,
		COALESCE(NULLIF(a.platform,''),'unknown') AS platform,
		COALESCE(NULLIF(a.status,''),'unknown') AS account_status,
		COALESCE(a.schedulable, FALSE) AS schedulable,
		COALESCE(
			NULLIF(a.credentials->>'base_url',''),
			CASE
				WHEN LOWER(COALESCE(a.extra->>'custom_base_url_enabled','false')) IN ('true','1','yes')
				THEN COALESCE(a.extra->>'custom_base_url','')
				ELSE ''
			END,
			''
		) AS account_base_url,
		COALESCE(m.source_id,0) AS source_id,
		COALESCE(m.source_name,'') AS source_name,
		COALESCE(m.source_group_external_id,'') AS source_group_external_id,
		COALESCE(m.source_group_name,'') AS source_group_name,
		CASE
			WHEN successes.last_success_at IS NULL THEN failures.last_failure_at
			WHEN failures.last_failure_at IS NULL THEN successes.last_success_at
			WHEN successes.last_success_at > failures.last_failure_at THEN successes.last_success_at
			ELSE failures.last_failure_at
		END AS last_request_at,
		COALESCE(successes.success_count,0)::BIGINT AS success_count,
		COALESCE(failures.failure_count,0)::BIGINT AS failure_count,
		COALESCE(failures.main_error,'') AS main_error
	FROM accounts a
	LEFT JOIN successes ON successes.account_id=a.id
	LEFT JOIN failures ON failures.account_id=a.id
	LEFT JOIN latest_mapping m ON m.account_id=a.id
	%s
),
ranked AS (
	SELECT
		*,
		(success_count + failure_count)::BIGINT AS request_count,
		CASE WHEN success_count + failure_count > 0 THEN (success_count::DOUBLE PRECISION / (success_count + failure_count)::DOUBLE PRECISION) END AS success_rate,
		CASE
			WHEN account_status <> 'active' THEN 'disabled'
			WHEN schedulable IS NOT TRUE THEN 'disabled'
			WHEN success_count + failure_count = 0 THEN 'observing'
			WHEN success_count::DOUBLE PRECISION / (success_count + failure_count)::DOUBLE PRECISION >= 0.95 THEN 'healthy'
			ELSE 'abnormal'
		END AS health_status,
		CASE
			WHEN account_status <> 'active' THEN 'account is disabled'
			WHEN schedulable IS NOT TRUE THEN 'account is not schedulable'
			WHEN success_count + failure_count = 0 THEN 'no calls in health window'
			WHEN success_count::DOUBLE PRECISION / (success_count + failure_count)::DOUBLE PRECISION < 0.95 THEN 'success rate below threshold'
			ELSE ''
		END AS status_reason
	FROM base
)
SELECT
	account_id,
	account_name,
	platform,
	account_status,
	schedulable,
	account_base_url,
	source_id,
	source_name,
	source_group_external_id,
	source_group_name,
	last_request_at,
	request_count,
	success_count,
	failure_count,
	success_rate,
	main_error,
	health_status,
	status_reason
FROM ranked
%s
ORDER BY
	CASE health_status WHEN 'abnormal' THEN 0 WHEN 'observing' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,
	last_request_at DESC NULLS LAST,
	account_id ASC
LIMIT $%d`, baseWhere, outerWhere, len(args)+1)
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list watch integration account health: %w", err)
	}
	defer rows.Close()
	out := make([]service.WatchIntegrationAccountHealthRow, 0)
	for rows.Next() {
		var (
			row           service.WatchIntegrationAccountHealthRow
			sourceID      sql.NullInt64
			lastRequestAt sql.NullTime
			successRate   sql.NullFloat64
			status        string
		)
		if err = rows.Scan(
			&row.AccountID,
			&row.AccountName,
			&row.Platform,
			&row.AccountStatus,
			&row.Schedulable,
			&row.AccountBaseURL,
			&sourceID,
			&row.SourceName,
			&row.SourceGroupID,
			&row.SourceGroupName,
			&lastRequestAt,
			&row.WindowRequestCount,
			&row.SuccessCount,
			&row.FailureCount,
			&successRate,
			&row.MainError,
			&status,
			&row.StatusReason,
		); err != nil {
			return nil, fmt.Errorf("scan watch integration account health: %w", err)
		}
		row.Status = service.WatchIntegrationAccountHealthStatus(status)
		if sourceID.Valid {
			row.SourceID = sourceID.Int64
		}
		if lastRequestAt.Valid {
			value := lastRequestAt.Time
			row.LastRequestAt = &value
		}
		if successRate.Valid {
			value := successRate.Float64
			row.SuccessRate = &value
		}
		out = append(out, row)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate watch integration account health: %w", err)
	}
	return out, nil
}
