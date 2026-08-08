package repository

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strconv"
	"strings"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/service"
)

type usageBillingRepository struct {
	db *sql.DB
}

const balanceSourceEpsilon = 0.00000001

type balanceSourceLot struct {
	sourceType                string
	id                        int64
	principal, bonus, unknown float64
}

type batchImageBalanceSourceHold struct {
	lotID                     int64
	principal, bonus, unknown float64
}

func NewUsageBillingRepository(_ *dbent.Client, sqlDB *sql.DB) service.UsageBillingRepository {
	return &usageBillingRepository{db: sqlDB}
}

func (r *usageBillingRepository) Apply(ctx context.Context, cmd *service.UsageBillingCommand) (_ *service.UsageBillingApplyResult, err error) {
	if cmd == nil {
		return &service.UsageBillingApplyResult{}, nil
	}
	if r == nil || r.db == nil {
		return nil, errors.New("usage billing repository db is nil")
	}

	cmd.Normalize()
	if cmd.RequestID == "" {
		return nil, service.ErrUsageBillingRequestIDRequired
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	applied, err := r.claimUsageBillingKey(ctx, tx, cmd)
	if err != nil {
		return nil, err
	}
	if !applied {
		return &service.UsageBillingApplyResult{Applied: false}, nil
	}

	result := &service.UsageBillingApplyResult{Applied: true}
	if err := r.applyUsageBillingEffects(ctx, tx, cmd, result); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	tx = nil
	return result, nil
}

func (r *usageBillingRepository) UpsertGatewayFailoverAttempt(ctx context.Context, attempt *service.GatewayFailoverAttempt) error {
	if attempt == nil {
		return nil
	}
	if r == nil || r.db == nil {
		return errors.New("usage billing repository db is nil")
	}
	attempt.Normalize()
	if attempt.RequestID == "" || attempt.AttemptNo <= 0 || attempt.UserID <= 0 || attempt.APIKeyID <= 0 {
		return errors.New("invalid gateway failover attempt identity")
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO gateway_failover_attempts (
			request_id, request_fingerprint, user_id, api_key_id, group_id,
			account_id, attempt_no, failure_kind, upstream_status_code, state,
			billing_status, input_tokens, duration_ms, response_started, upstream_request_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULLIF($15, ''))
		ON CONFLICT (request_id, attempt_no) DO UPDATE SET
			failure_kind = EXCLUDED.failure_kind,
			upstream_status_code = EXCLUDED.upstream_status_code,
			state = EXCLUDED.state,
			billing_status = CASE
				WHEN gateway_failover_attempts.billing_status IN ('settled', 'released')
					THEN gateway_failover_attempts.billing_status
				ELSE EXCLUDED.billing_status
			END,
			input_tokens = EXCLUDED.input_tokens,
			duration_ms = EXCLUDED.duration_ms,
			response_started = EXCLUDED.response_started,
			upstream_request_id = COALESCE(EXCLUDED.upstream_request_id, gateway_failover_attempts.upstream_request_id),
			updated_at = NOW()
	`, attempt.RequestID, attempt.RequestFingerprint, attempt.UserID, attempt.APIKeyID, attempt.GroupID,
		attempt.AccountID, attempt.AttemptNo, attempt.FailureKind, attempt.UpstreamStatusCode, attempt.State,
		attempt.BillingStatus, attempt.InputTokens, attempt.DurationMS, attempt.ResponseStarted, attempt.UpstreamRequestID)
	return err
}

func (r *usageBillingRepository) claimUsageBillingKey(ctx context.Context, tx *sql.Tx, cmd *service.UsageBillingCommand) (bool, error) {
	return r.claimUsageBillingRequest(ctx, tx, cmd.RequestID, cmd.APIKeyID, cmd.RequestFingerprint)
}

func (r *usageBillingRepository) claimUsageBillingRequest(ctx context.Context, tx *sql.Tx, requestID string, apiKeyID int64, requestFingerprint string) (bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `
		INSERT INTO usage_billing_dedup (request_id, api_key_id, request_fingerprint)
		VALUES ($1, $2, $3)
		ON CONFLICT (request_id, api_key_id) DO NOTHING
		RETURNING id
	`, requestID, apiKeyID, requestFingerprint).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		var existingFingerprint string
		if err := tx.QueryRowContext(ctx, `
			SELECT request_fingerprint
			FROM usage_billing_dedup
			WHERE request_id = $1 AND api_key_id = $2
		`, requestID, apiKeyID).Scan(&existingFingerprint); err != nil {
			return false, err
		}
		if strings.TrimSpace(existingFingerprint) != strings.TrimSpace(requestFingerprint) {
			return false, service.ErrUsageBillingRequestConflict
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var archivedFingerprint string
	err = tx.QueryRowContext(ctx, `
		SELECT request_fingerprint
		FROM usage_billing_dedup_archive
		WHERE request_id = $1 AND api_key_id = $2
	`, requestID, apiKeyID).Scan(&archivedFingerprint)
	if err == nil {
		if strings.TrimSpace(archivedFingerprint) != strings.TrimSpace(requestFingerprint) {
			return false, service.ErrUsageBillingRequestConflict
		}
		return false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	return true, nil
}

func (r *usageBillingRepository) ReserveBatchImageBalance(ctx context.Context, cmd *service.BatchImageBalanceHoldCommand) (*service.BatchImageBalanceHoldResult, error) {
	return r.applyBatchImageBalanceHold(ctx, cmd, reserveUsageBillingBatchImageBalance)
}

func (r *usageBillingRepository) CaptureBatchImageBalance(ctx context.Context, cmd *service.BatchImageBalanceHoldCommand) (*service.BatchImageBalanceHoldResult, error) {
	return r.applyBatchImageBalanceHold(ctx, cmd, captureUsageBillingBatchImageBalance)
}

func (r *usageBillingRepository) ReleaseBatchImageBalance(ctx context.Context, cmd *service.BatchImageBalanceHoldCommand) (*service.BatchImageBalanceHoldResult, error) {
	return r.applyBatchImageBalanceHold(ctx, cmd, releaseUsageBillingBatchImageBalance)
}

func (r *usageBillingRepository) applyBatchImageBalanceHold(
	ctx context.Context,
	cmd *service.BatchImageBalanceHoldCommand,
	apply func(context.Context, *sql.Tx, *service.BatchImageBalanceHoldCommand) (*service.BatchImageBalanceHoldResult, error),
) (_ *service.BatchImageBalanceHoldResult, err error) {
	if cmd == nil {
		return &service.BatchImageBalanceHoldResult{}, nil
	}
	if r == nil || r.db == nil {
		return nil, errors.New("usage billing repository db is nil")
	}
	cmd.Normalize()
	if cmd.RequestID == "" {
		return nil, service.ErrUsageBillingRequestIDRequired
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	applied, err := r.claimUsageBillingRequest(ctx, tx, cmd.RequestID, cmd.APIKeyID, cmd.RequestFingerprint)
	if err != nil {
		return nil, err
	}
	if !applied {
		return &service.BatchImageBalanceHoldResult{Applied: false}, nil
	}

	result, err := apply(ctx, tx, cmd)
	if err != nil {
		return nil, err
	}
	if result == nil {
		result = &service.BatchImageBalanceHoldResult{}
	}
	result.Applied = true

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	tx = nil
	return result, nil
}

func (r *usageBillingRepository) applyUsageBillingEffects(ctx context.Context, tx *sql.Tx, cmd *service.UsageBillingCommand, result *service.UsageBillingApplyResult) error {
	if cmd.SubscriptionCost > 0 && cmd.SubscriptionID != nil {
		if err := incrementUsageBillingSubscription(ctx, tx, *cmd.SubscriptionID, cmd.SubscriptionCost); err != nil {
			return err
		}
	}

	if cmd.BalanceCost > 0 {
		newBalance, sufficient, err := deductUsageBillingBalance(ctx, tx, cmd.UserID, cmd.BalanceCost)
		if err != nil {
			return err
		}
		result.NewBalance = &newBalance
		result.BalanceOverdrafted = !sufficient
		balanceBefore, err := unheldBalanceSourceAmount(ctx, tx, cmd.UserID, newBalance+cmd.BalanceCost)
		if err != nil {
			return err
		}
		if err := allocateUsageBalanceSources(ctx, tx, cmd.UserID, cmd.RequestID, cmd.BalanceCost, balanceBefore); err != nil {
			return err
		}
	}

	if cmd.APIKeyQuotaCost > 0 {
		exhausted, err := incrementUsageBillingAPIKeyQuota(ctx, tx, cmd.APIKeyID, cmd.APIKeyQuotaCost)
		if err != nil {
			return err
		}
		result.APIKeyQuotaExhausted = exhausted
	}

	if cmd.APIKeyRateLimitCost > 0 {
		if err := incrementUsageBillingAPIKeyRateLimit(ctx, tx, cmd.APIKeyID, cmd.APIKeyRateLimitCost); err != nil {
			return err
		}
	}

	if cmd.AccountQuotaCost > 0 && (strings.EqualFold(cmd.AccountType, service.AccountTypeAPIKey) || strings.EqualFold(cmd.AccountType, service.AccountTypeBedrock)) {
		quotaState, err := incrementUsageBillingAccountQuota(ctx, tx, cmd.AccountID, cmd.AccountQuotaCost)
		if err != nil {
			return err
		}
		result.QuotaState = quotaState
	}

	return nil
}

func unheldBalanceSourceAmount(ctx context.Context, tx *sql.Tx, userID int64, availableBalance float64) (float64, error) {
	var frozenBalance, trackedHolds float64
	err := tx.QueryRowContext(ctx, `
		SELECT
			COALESCE(u.frozen_balance, 0)::double precision,
			COALESCE((
				SELECT SUM(h.principal_amount+h.bonus_amount+h.unknown_amount)
				FROM balance_source_holds h
				WHERE h.user_id=u.id
			), 0)::double precision
		FROM users u
		WHERE u.id=$1 AND u.deleted_at IS NULL
	`, userID).Scan(&frozenBalance, &trackedHolds)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, service.ErrUserNotFound
	}
	if err != nil {
		return 0, err
	}
	return math.Max(availableBalance+frozenBalance-trackedHolds, 0), nil
}

func reconcileBalanceSourceLots(ctx context.Context, tx *sql.Tx, userID int64, balanceBefore float64) ([]balanceSourceLot, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,source_type,remaining_principal::double precision,remaining_bonus::double precision,remaining_unknown::double precision FROM balance_source_lots WHERE user_id=$1 AND remaining_principal+remaining_bonus+remaining_unknown>0 ORDER BY CASE WHEN source_type IN ('historical_opening','balance_reconciliation_unknown') THEN 0 ELSE 1 END,created_at,id FOR UPDATE`, userID)
	if err != nil {
		return nil, err
	}
	lots := make([]balanceSourceLot, 0)
	var ledgerBalance float64
	for rows.Next() {
		var lot balanceSourceLot
		if err := rows.Scan(&lot.id, &lot.sourceType, &lot.principal, &lot.bonus, &lot.unknown); err != nil {
			rows.Close()
			return nil, err
		}
		lots = append(lots, lot)
		ledgerBalance += lot.principal + lot.bonus + lot.unknown
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	expectedBalance := math.Max(balanceBefore, 0)
	if ledgerBalance > expectedBalance+balanceSourceEpsilon {
		drift := ledgerBalance - expectedBalance
		for _, component := range []string{"principal", "bonus", "unknown"} {
			for index := range lots {
				if drift <= balanceSourceEpsilon {
					break
				}
				var available *float64
				switch component {
				case "principal":
					available = &lots[index].principal
				case "bonus":
					available = &lots[index].bonus
				default:
					available = &lots[index].unknown
				}
				deduct := minFloat64(drift, *available)
				if deduct <= 0 {
					continue
				}
				*available -= deduct
				drift -= deduct
				query := `UPDATE balance_source_lots SET remaining_` + component + `=remaining_` + component + `-$1 WHERE id=$2`
				if _, err := tx.ExecContext(ctx, query, deduct, lots[index].id); err != nil {
					return nil, err
				}
			}
		}
	} else if ledgerBalance+balanceSourceEpsilon < expectedBalance {
		gap := expectedBalance - ledgerBalance
		var lotID int64
		if err := tx.QueryRowContext(ctx, `INSERT INTO balance_source_lots (user_id,source_type,principal_amount,bonus_amount,unknown_amount,remaining_principal,remaining_bonus,remaining_unknown) VALUES ($1,'balance_reconciliation_unknown',0,0,$2,0,0,$2) RETURNING id`, userID, gap).Scan(&lotID); err != nil {
			return nil, err
		}
		lots = append([]balanceSourceLot{{id: lotID, sourceType: "balance_reconciliation_unknown", unknown: gap}}, lots...)
	}
	return lots, nil
}

func allocateUsageBalanceSources(ctx context.Context, tx *sql.Tx, userID int64, requestID string, amount, balanceBefore float64) error {
	lots, err := reconcileBalanceSourceLots(ctx, tx, userID, balanceBefore)
	if err != nil {
		return err
	}
	remaining := amount
	for _, lot := range lots {
		if remaining <= balanceSourceEpsilon {
			break
		}
		principal := minFloat64(remaining, lot.principal)
		remaining -= principal
		bonus := minFloat64(remaining, lot.bonus)
		remaining -= bonus
		unknown := minFloat64(remaining, lot.unknown)
		remaining -= unknown
		if principal+bonus+unknown <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE balance_source_lots SET remaining_principal=remaining_principal-$1,remaining_bonus=remaining_bonus-$2,remaining_unknown=remaining_unknown-$3 WHERE id=$4`, principal, bonus, unknown, lot.id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO balance_source_allocations (lot_id,user_id,request_id,idempotency_key,principal_amount,bonus_amount,unknown_amount) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING`, lot.id, userID, requestID, "usage:"+requestID+":"+strconv.FormatInt(lot.id, 10), principal, bonus, unknown); err != nil {
			return err
		}
	}
	if remaining > balanceSourceEpsilon {
		var lotID int64
		if err := tx.QueryRowContext(ctx, `INSERT INTO balance_source_lots (user_id,source_type,principal_amount,bonus_amount,unknown_amount,remaining_principal,remaining_bonus,remaining_unknown) VALUES ($1,'historical_unknown',0,0,$2,0,0,0) RETURNING id`, userID, remaining).Scan(&lotID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO balance_source_allocations (lot_id,user_id,request_id,idempotency_key,principal_amount,bonus_amount,unknown_amount) VALUES ($1,$2,$3,$4,0,0,$5)`, lotID, userID, requestID, "usage:"+requestID+":unknown", remaining); err != nil {
			return err
		}
	}
	return nil
}

func minFloat64(left, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func incrementUsageBillingSubscription(ctx context.Context, tx *sql.Tx, subscriptionID int64, costUSD float64) error {
	const updateSQL = `
		UPDATE user_subscriptions us
		SET
			daily_usage_usd = us.daily_usage_usd + $1,
			weekly_usage_usd = us.weekly_usage_usd + $1,
			monthly_usage_usd = us.monthly_usage_usd + $1,
			updated_at = NOW()
		FROM groups g
		WHERE us.id = $2
			AND us.deleted_at IS NULL
			AND us.group_id = g.id
			AND g.deleted_at IS NULL
	`
	res, err := tx.ExecContext(ctx, updateSQL, costUSD, subscriptionID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected > 0 {
		return nil
	}
	return service.ErrSubscriptionNotFound
}

func deductUsageBillingBalance(ctx context.Context, tx *sql.Tx, userID int64, amount float64) (float64, bool, error) {
	var newBalance float64
	err := tx.QueryRowContext(ctx, `
		UPDATE users
		SET balance = balance - $1,
			updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL AND balance >= $1
		RETURNING balance
	`, amount, userID).Scan(&newBalance)
	if err == nil {
		return newBalance, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}

	err = tx.QueryRowContext(ctx, `
		UPDATE users
		SET balance = balance - $1,
			updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL
		RETURNING balance
	`, amount, userID).Scan(&newBalance)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, service.ErrUserNotFound
	}
	if err != nil {
		return 0, false, err
	}
	return newBalance, false, nil
}

func reserveUsageBillingBatchImageBalance(ctx context.Context, tx *sql.Tx, cmd *service.BatchImageBalanceHoldCommand) (*service.BatchImageBalanceHoldResult, error) {
	if cmd.HoldAmount <= 0 {
		return &service.BatchImageBalanceHoldResult{}, nil
	}
	var balance, frozen float64
	err := tx.QueryRowContext(ctx, `
		UPDATE users
		SET balance = balance - $1,
			frozen_balance = COALESCE(frozen_balance, 0) + $1,
			updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL AND balance >= $1
		RETURNING balance, frozen_balance
	`, cmd.HoldAmount, cmd.UserID).Scan(&balance, &frozen)
	if err == nil {
		balanceBeforeHold, sourceErr := unheldBalanceSourceAmount(ctx, tx, cmd.UserID, balance)
		if sourceErr != nil {
			return nil, sourceErr
		}
		if sourceErr := reserveBatchImageBalanceSources(ctx, tx, cmd, balanceBeforeHold); sourceErr != nil {
			return nil, sourceErr
		}
		return &service.BatchImageBalanceHoldResult{NewBalance: &balance, FrozenBalance: &frozen}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if exists, existsErr := userExistsForBilling(ctx, tx, cmd.UserID); existsErr != nil {
		return nil, existsErr
	} else if !exists {
		return nil, service.ErrUserNotFound
	}
	return nil, service.ErrBatchImageInsufficientBalance
}

func captureUsageBillingBatchImageBalance(ctx context.Context, tx *sql.Tx, cmd *service.BatchImageBalanceHoldCommand) (*service.BatchImageBalanceHoldResult, error) {
	if cmd.HoldAmount <= 0 && cmd.ActualAmount <= 0 {
		return &service.BatchImageBalanceHoldResult{}, nil
	}
	if cmd.ActualAmount-cmd.HoldAmount > 0.00000001 {
		return nil, service.ErrBatchImageSettlementCostExceedsHold
	}
	var balance, frozen float64
	err := tx.QueryRowContext(ctx, `
		UPDATE users
		SET balance = balance
				+ CASE WHEN $1 > $2 THEN $1 - $2 ELSE 0 END
				- CASE WHEN $2 > $1 THEN $2 - $1 ELSE 0 END,
			frozen_balance = COALESCE(frozen_balance, 0) - $1,
			updated_at = NOW()
		WHERE id = $3 AND deleted_at IS NULL AND COALESCE(frozen_balance, 0) >= $1
		RETURNING balance, frozen_balance
	`, cmd.HoldAmount, cmd.ActualAmount, cmd.UserID).Scan(&balance, &frozen)
	if err == nil {
		tracked, sourceErr := captureBatchImageBalanceSources(ctx, tx, cmd)
		if sourceErr != nil {
			return nil, sourceErr
		}
		if !tracked && cmd.ActualAmount > balanceSourceEpsilon {
			balanceBeforeCapture, sourceErr := unheldBalanceSourceAmount(ctx, tx, cmd.UserID, balance+cmd.ActualAmount)
			if sourceErr != nil {
				return nil, sourceErr
			}
			if sourceErr := allocateUsageBalanceSources(ctx, tx, cmd.UserID, cmd.RequestID, cmd.ActualAmount, balanceBeforeCapture); sourceErr != nil {
				return nil, sourceErr
			}
		}
		return &service.BatchImageBalanceHoldResult{NewBalance: &balance, FrozenBalance: &frozen}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if exists, existsErr := userExistsForBilling(ctx, tx, cmd.UserID); existsErr != nil {
		return nil, existsErr
	} else if !exists {
		return nil, service.ErrUserNotFound
	}
	return nil, errors.New("batch image frozen balance is insufficient")
}

func releaseUsageBillingBatchImageBalance(ctx context.Context, tx *sql.Tx, cmd *service.BatchImageBalanceHoldCommand) (*service.BatchImageBalanceHoldResult, error) {
	if cmd.HoldAmount <= 0 {
		return &service.BatchImageBalanceHoldResult{}, nil
	}
	// 释放前校验该 job 确实预留过 hold（hold request id 已被 claim），
	// 防止从未成功冻结的 job 触发"幻影释放"，从其他用户的冻结资金池中凭空生成余额。
	held, heldErr := batchImageHoldClaimExists(ctx, tx, service.BatchImageHoldRequestID(cmd.BatchID), cmd.APIKeyID)
	if heldErr != nil {
		return nil, heldErr
	}
	if !held {
		logger.LegacyPrintf("repository.usage_billing", "[BatchImage] release skipped, hold was never reserved: batch=%s", cmd.BatchID)
		return &service.BatchImageBalanceHoldResult{}, nil
	}
	var balance, frozen float64
	err := tx.QueryRowContext(ctx, `
		UPDATE users
		SET balance = balance + $1,
			frozen_balance = COALESCE(frozen_balance, 0) - $1,
			updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL AND COALESCE(frozen_balance, 0) >= $1
		RETURNING balance, frozen_balance
	`, cmd.HoldAmount, cmd.UserID).Scan(&balance, &frozen)
	if err == nil {
		if sourceErr := releaseBatchImageBalanceSources(ctx, tx, cmd); sourceErr != nil {
			return nil, sourceErr
		}
		return &service.BatchImageBalanceHoldResult{NewBalance: &balance, FrozenBalance: &frozen}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if exists, existsErr := userExistsForBilling(ctx, tx, cmd.UserID); existsErr != nil {
		return nil, existsErr
	} else if !exists {
		return nil, service.ErrUserNotFound
	}
	return nil, errors.New("batch image frozen balance is insufficient")
}

func reserveBatchImageBalanceSources(ctx context.Context, tx *sql.Tx, cmd *service.BatchImageBalanceHoldCommand, balanceBefore float64) error {
	if strings.TrimSpace(cmd.BatchID) == "" {
		return errors.New("batch image balance source hold requires batch id")
	}
	lots, err := reconcileBalanceSourceLots(ctx, tx, cmd.UserID, balanceBefore)
	if err != nil {
		return err
	}
	remaining := cmd.HoldAmount
	for _, lot := range lots {
		if remaining <= balanceSourceEpsilon {
			break
		}
		principal := minFloat64(remaining, lot.principal)
		remaining -= principal
		bonus := minFloat64(remaining, lot.bonus)
		remaining -= bonus
		unknown := minFloat64(remaining, lot.unknown)
		remaining -= unknown
		if principal+bonus+unknown <= balanceSourceEpsilon {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE balance_source_lots SET remaining_principal=remaining_principal-$1,remaining_bonus=remaining_bonus-$2,remaining_unknown=remaining_unknown-$3 WHERE id=$4`, principal, bonus, unknown, lot.id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO balance_source_holds (lot_id,user_id,batch_id,principal_amount,bonus_amount,unknown_amount) VALUES ($1,$2,$3,$4,$5,$6)`, lot.id, cmd.UserID, cmd.BatchID, principal, bonus, unknown); err != nil {
			return err
		}
	}
	if remaining > balanceSourceEpsilon {
		return errors.New("batch image balance source hold is incomplete")
	}
	return nil
}

func loadBatchImageBalanceSourceHolds(ctx context.Context, tx *sql.Tx, userID int64, batchID string) ([]batchImageBalanceSourceHold, error) {
	rows, err := tx.QueryContext(ctx, `SELECT lot_id,principal_amount::double precision,bonus_amount::double precision,unknown_amount::double precision FROM balance_source_holds WHERE user_id=$1 AND batch_id=$2 ORDER BY id FOR UPDATE`, userID, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	holds := make([]batchImageBalanceSourceHold, 0)
	for rows.Next() {
		var hold batchImageBalanceSourceHold
		if err := rows.Scan(&hold.lotID, &hold.principal, &hold.bonus, &hold.unknown); err != nil {
			return nil, err
		}
		holds = append(holds, hold)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return holds, nil
}

func captureBatchImageBalanceSources(ctx context.Context, tx *sql.Tx, cmd *service.BatchImageBalanceHoldCommand) (bool, error) {
	holds, err := loadBatchImageBalanceSourceHolds(ctx, tx, cmd.UserID, cmd.BatchID)
	if err != nil || len(holds) == 0 {
		return false, err
	}
	if err := validateBatchImageBalanceSourceHoldAmount(holds, cmd.HoldAmount); err != nil {
		return true, err
	}
	remaining := cmd.ActualAmount
	for _, hold := range holds {
		principal := minFloat64(remaining, hold.principal)
		remaining -= principal
		bonus := minFloat64(remaining, hold.bonus)
		remaining -= bonus
		unknown := minFloat64(remaining, hold.unknown)
		remaining -= unknown
		releasePrincipal := hold.principal - principal
		releaseBonus := hold.bonus - bonus
		releaseUnknown := hold.unknown - unknown
		if releasePrincipal+releaseBonus+releaseUnknown > balanceSourceEpsilon {
			if _, err := tx.ExecContext(ctx, `UPDATE balance_source_lots SET remaining_principal=remaining_principal+$1,remaining_bonus=remaining_bonus+$2,remaining_unknown=remaining_unknown+$3 WHERE id=$4`, releasePrincipal, releaseBonus, releaseUnknown, hold.lotID); err != nil {
				return true, err
			}
		}
		if principal+bonus+unknown > balanceSourceEpsilon {
			if _, err := tx.ExecContext(ctx, `INSERT INTO balance_source_allocations (lot_id,user_id,request_id,idempotency_key,principal_amount,bonus_amount,unknown_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`, hold.lotID, cmd.UserID, cmd.RequestID, "usage:"+cmd.RequestID+":"+strconv.FormatInt(hold.lotID, 10), principal, bonus, unknown); err != nil {
				return true, err
			}
		}
	}
	if remaining > balanceSourceEpsilon {
		return true, errors.New("batch image balance source capture exceeds tracked hold")
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM balance_source_holds WHERE user_id=$1 AND batch_id=$2`, cmd.UserID, cmd.BatchID); err != nil {
		return true, err
	}
	return true, nil
}

func releaseBatchImageBalanceSources(ctx context.Context, tx *sql.Tx, cmd *service.BatchImageBalanceHoldCommand) error {
	holds, err := loadBatchImageBalanceSourceHolds(ctx, tx, cmd.UserID, cmd.BatchID)
	if err != nil || len(holds) == 0 {
		return err
	}
	if err := validateBatchImageBalanceSourceHoldAmount(holds, cmd.HoldAmount); err != nil {
		return err
	}
	for _, hold := range holds {
		if _, err := tx.ExecContext(ctx, `UPDATE balance_source_lots SET remaining_principal=remaining_principal+$1,remaining_bonus=remaining_bonus+$2,remaining_unknown=remaining_unknown+$3 WHERE id=$4`, hold.principal, hold.bonus, hold.unknown, hold.lotID); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM balance_source_holds WHERE user_id=$1 AND batch_id=$2`, cmd.UserID, cmd.BatchID)
	return err
}

func validateBatchImageBalanceSourceHoldAmount(holds []batchImageBalanceSourceHold, expected float64) error {
	var actual float64
	for _, hold := range holds {
		actual += hold.principal + hold.bonus + hold.unknown
	}
	if math.Abs(actual-expected) > balanceSourceEpsilon {
		return errors.New("batch image balance source hold amount does not match frozen balance")
	}
	return nil
}

// batchImageHoldClaimExists 检查 hold request id 是否已在 dedup（或归档）表中被 claim，
// 即该 batch 的冻结操作确实成功提交过。
func batchImageHoldClaimExists(ctx context.Context, tx *sql.Tx, holdRequestID string, apiKeyID int64) (bool, error) {
	var exists int
	err := tx.QueryRowContext(ctx, `
		SELECT 1
		FROM usage_billing_dedup
		WHERE request_id = $1 AND api_key_id = $2
	`, holdRequestID, apiKeyID).Scan(&exists)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	err = tx.QueryRowContext(ctx, `
		SELECT 1
		FROM usage_billing_dedup_archive
		WHERE request_id = $1 AND api_key_id = $2
	`, holdRequestID, apiKeyID).Scan(&exists)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return false, err
}

func userExistsForBilling(ctx context.Context, tx *sql.Tx, userID int64) (bool, error) {
	var exists int
	err := tx.QueryRowContext(ctx, `
		SELECT 1
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
	`, userID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func incrementUsageBillingAPIKeyQuota(ctx context.Context, tx *sql.Tx, apiKeyID int64, amount float64) (bool, error) {
	var exhausted bool
	err := tx.QueryRowContext(ctx, `
		UPDATE api_keys
		SET quota_used = quota_used + $1,
			status = CASE
				WHEN quota > 0
					AND status = $3
					AND quota_used < quota
					AND quota_used + $1 >= quota
				THEN $4
				ELSE status
			END,
			updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL
		RETURNING quota > 0 AND quota_used >= quota AND quota_used - $1 < quota
	`, amount, apiKeyID, service.StatusAPIKeyActive, service.StatusAPIKeyQuotaExhausted).Scan(&exhausted)
	if errors.Is(err, sql.ErrNoRows) {
		return false, service.ErrAPIKeyNotFound
	}
	if err != nil {
		return false, err
	}
	return exhausted, nil
}

func incrementUsageBillingAPIKeyRateLimit(ctx context.Context, tx *sql.Tx, apiKeyID int64, cost float64) error {
	res, err := tx.ExecContext(ctx, `
		UPDATE api_keys SET
			usage_5h = CASE WHEN window_5h_start IS NOT NULL AND window_5h_start + INTERVAL '5 hours' <= NOW() THEN $1 ELSE usage_5h + $1 END,
			usage_1d = CASE WHEN window_1d_start IS NOT NULL AND window_1d_start + INTERVAL '24 hours' <= NOW() THEN $1 ELSE usage_1d + $1 END,
			usage_7d = CASE WHEN window_7d_start IS NOT NULL AND window_7d_start + INTERVAL '7 days' <= NOW() THEN $1 ELSE usage_7d + $1 END,
			window_5h_start = CASE WHEN window_5h_start IS NULL OR window_5h_start + INTERVAL '5 hours' <= NOW() THEN NOW() ELSE window_5h_start END,
			window_1d_start = CASE WHEN window_1d_start IS NULL OR window_1d_start + INTERVAL '24 hours' <= NOW() THEN date_trunc('day', NOW()) ELSE window_1d_start END,
			window_7d_start = CASE WHEN window_7d_start IS NULL OR window_7d_start + INTERVAL '7 days' <= NOW() THEN date_trunc('day', NOW()) ELSE window_7d_start END,
			updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL
	`, cost, apiKeyID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return service.ErrAPIKeyNotFound
	}
	return nil
}

func incrementUsageBillingAccountQuota(ctx context.Context, tx *sql.Tx, accountID int64, amount float64) (*service.AccountQuotaState, error) {
	rows, err := tx.QueryContext(ctx,
		`UPDATE accounts SET extra = (
			COALESCE(extra, '{}'::jsonb)
			|| jsonb_build_object('quota_used', COALESCE((extra->>'quota_used')::numeric, 0) + $1)
			|| CASE WHEN COALESCE((extra->>'quota_daily_limit')::numeric, 0) > 0 THEN
				jsonb_build_object(
					'quota_daily_used',
					CASE WHEN `+dailyExpiredExpr+`
					THEN $1
					ELSE COALESCE((extra->>'quota_daily_used')::numeric, 0) + $1 END,
					'quota_daily_start',
					CASE WHEN `+dailyExpiredExpr+`
					THEN `+nowUTC+`
					ELSE COALESCE(extra->>'quota_daily_start', `+nowUTC+`) END
				)
				|| CASE WHEN `+dailyExpiredExpr+` AND `+nextDailyResetAtExpr+` IS NOT NULL
				   THEN jsonb_build_object('quota_daily_reset_at', `+nextDailyResetAtExpr+`)
				   ELSE '{}'::jsonb END
			ELSE '{}'::jsonb END
			|| CASE WHEN COALESCE((extra->>'quota_weekly_limit')::numeric, 0) > 0 THEN
				jsonb_build_object(
					'quota_weekly_used',
					CASE WHEN `+weeklyExpiredExpr+`
					THEN $1
					ELSE COALESCE((extra->>'quota_weekly_used')::numeric, 0) + $1 END,
					'quota_weekly_start',
					CASE WHEN `+weeklyExpiredExpr+`
					THEN `+nowUTC+`
					ELSE COALESCE(extra->>'quota_weekly_start', `+nowUTC+`) END
				)
				|| CASE WHEN `+weeklyExpiredExpr+` AND `+nextWeeklyResetAtExpr+` IS NOT NULL
				   THEN jsonb_build_object('quota_weekly_reset_at', `+nextWeeklyResetAtExpr+`)
				   ELSE '{}'::jsonb END
			ELSE '{}'::jsonb END
		), updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL
		RETURNING
			COALESCE((extra->>'quota_used')::numeric, 0),
			COALESCE((extra->>'quota_limit')::numeric, 0),
			COALESCE((extra->>'quota_daily_used')::numeric, 0),
			COALESCE((extra->>'quota_daily_limit')::numeric, 0),
			COALESCE((extra->>'quota_weekly_used')::numeric, 0),
			COALESCE((extra->>'quota_weekly_limit')::numeric, 0)`,
		amount, accountID)
	if err != nil {
		return nil, err
	}

	var state service.AccountQuotaState
	if rows.Next() {
		if err := rows.Scan(
			&state.TotalUsed, &state.TotalLimit,
			&state.DailyUsed, &state.DailyLimit,
			&state.WeeklyUsed, &state.WeeklyLimit,
		); err != nil {
			_ = rows.Close()
			return nil, err
		}
	} else {
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, err
		}
		_ = rows.Close()
		return nil, service.ErrAccountNotFound
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	// 必须在执行下一条 SQL 前显式关闭 rows：pq 驱动在同一连接上
	// 不允许前一条查询的结果集未耗尽时启动新查询，否则会返回
	// "unexpected Parse response" 错误。
	if err := rows.Close(); err != nil {
		return nil, err
	}
	// 任意维度额度在本次递增中从"未超"跨越到"已超"时，必须刷新调度快照，
	// 否则 Redis 中缓存的 Account 仍显示旧的 used 值，后续请求会继续选中本账号，
	// 最终观察到 daily_used / weekly_used 大幅超过配置的 limit。
	// 对于日/周额度，即使本次触发了周期重置（pre=0、post=amount），
	// 判定式 (post-amount) < limit 同样成立，逻辑与总额度保持一致。
	crossedTotal := state.TotalLimit > 0 && state.TotalUsed >= state.TotalLimit && (state.TotalUsed-amount) < state.TotalLimit
	crossedDaily := state.DailyLimit > 0 && state.DailyUsed >= state.DailyLimit && (state.DailyUsed-amount) < state.DailyLimit
	crossedWeekly := state.WeeklyLimit > 0 && state.WeeklyUsed >= state.WeeklyLimit && (state.WeeklyUsed-amount) < state.WeeklyLimit
	if crossedTotal || crossedDaily || crossedWeekly {
		if err := enqueueSchedulerOutbox(ctx, tx, service.SchedulerOutboxEventAccountChanged, &accountID, nil, nil); err != nil {
			logger.LegacyPrintf("repository.usage_billing", "[SchedulerOutbox] enqueue quota exceeded failed: account=%d err=%v", accountID, err)
			return nil, err
		}
	}
	return &state, nil
}
