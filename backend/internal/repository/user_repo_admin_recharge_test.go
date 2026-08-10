package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestApplyAdminRechargeRollsBackWhenSourceLotFails(t *testing.T) {
	repo, mock := newRedeemAdjustmentRepoMock(t)
	command := service.AdminRechargeCommand{
		UserID:             42,
		PrincipalAmount:    100,
		BonusAmount:        20,
		Notes:              "campaign",
		ActorAdminID:       7,
		IdempotencyKeyHash: "hash",
		RedeemCode:         "ADMIN-RECHARGE-TEST",
	}

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT pg_advisory_xact_lock`).
		WithArgs("admin-recharge:7:hash").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT id, used_by,.*FROM redeem_codes.*FOR UPDATE`).
		WithArgs(service.AdjustmentTypeAdminBalance, int64(7), "hash").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "used_by", "admin_principal_amount", "admin_bonus_amount",
			"admin_balance_before", "admin_balance_after", "notes",
		}))
	mock.ExpectQuery(`(?s)UPDATE users.*total_recharged.*RETURNING balance`).
		WithArgs(120.0, 100.0, int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"balance_before", "balance_after"}).AddRow(5.0, 125.0))
	mock.ExpectQuery(`(?s)INSERT INTO redeem_codes.*RETURNING id`).
		WithArgs(
			"ADMIN-RECHARGE-TEST",
			service.AdjustmentTypeAdminBalance,
			120.0,
			service.StatusUsed,
			int64(42),
			"campaign",
			100.0,
			20.0,
			5.0,
			125.0,
			int64(7),
			"hash",
		).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(88)))
	mock.ExpectExec(`(?s)INSERT INTO balance_source_lots`).
		WithArgs(int64(42), int64(88), 100.0, 20.0).
		WillReturnError(errors.New("source lot unavailable"))
	mock.ExpectRollback()

	_, err := repo.ApplyAdminRecharge(context.Background(), command)
	require.ErrorContains(t, err, "record administrator recharge balance source")
	require.NoError(t, mock.ExpectationsWereMet())
}
