//go:build integration

package repository

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRecommendationAndBalanceSourceSchema(t *testing.T) {
	tx := testTx(t)
	require.NoError(t, ApplyMigrations(context.Background(), integrationDB))

	requireColumn(t, tx, "payment_orders", "recharge_base_amount", "numeric", 0, true)
	requireColumn(t, tx, "payment_orders", "recharge_bonus_amount", "numeric", 0, true)
	requireColumn(t, tx, "payment_orders", "credited_amount", "numeric", 0, true)
	requireColumn(t, tx, "balance_source_lots", "unknown_amount", "numeric", 0, false)
	requireColumn(t, tx, "balance_source_lots", "remaining_unknown", "numeric", 0, false)
	requireColumn(t, tx, "balance_source_allocations", "request_id", "character varying", 128, false)
	requireColumn(t, tx, "balance_source_allocations", "unknown_amount", "numeric", 0, false)
	requireColumn(t, tx, "balance_source_holds", "batch_id", "character varying", 64, false)
	requireColumn(t, tx, "balance_source_holds", "bonus_amount", "numeric", 0, false)

	for _, tableName := range []string{
		"balance_source_lots",
		"balance_source_allocations",
		"balance_source_holds",
		"watch_public_pricing",
		"recommendation_model_options",
		"user_recommendations",
		"recommendation_rewards",
		"recommendation_reward_accruals",
	} {
		var regclass sql.NullString
		require.NoError(t, tx.QueryRowContext(context.Background(), "SELECT to_regclass('public.' || $1)", tableName).Scan(&regclass))
		require.Truef(t, regclass.Valid, "expected %s to exist", tableName)
	}

	requireIndex(t, tx, "balance_source_lots", "idx_balance_source_lots_source")
	requireIndex(t, tx, "balance_source_allocations", "balance_source_allocations_idempotency_key_key")
	requireIndex(t, tx, "balance_source_allocations", "idx_balance_source_allocations_request")
	requireIndex(t, tx, "balance_source_holds", "balance_source_holds_batch_id_lot_id_key")
	requireIndex(t, tx, "balance_source_holds", "idx_balance_source_holds_user_batch")
	requireIndex(t, tx, "watch_public_pricing", "watch_public_pricing_source_id_group_external_id_key")
	requireIndex(t, tx, "recommendation_rewards", "recommendation_rewards_idempotency_key_key")
	requireIndex(t, tx, "recommendation_reward_accruals", "recommendation_reward_accruals_reward_id_usage_log_id_key")

	var defaults int
	require.NoError(t, tx.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM recommendation_model_options WHERE model_key IN ('claude','gpt','gptpro')`).Scan(&defaults))
	require.Equal(t, 3, defaults)
}
