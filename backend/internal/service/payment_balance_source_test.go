package service

import (
	"context"
	"testing"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/payment"
)

func TestRecordBalanceSourceLotSeparatesRechargePrincipalAndBonus(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	client := dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, db)))
	defer func() { _ = client.Close() }()
	service := &PaymentService{entClient: client}
	order := &dbent.PaymentOrder{ID: 18, UserID: 42, OrderType: payment.OrderTypeBalance}

	mock.ExpectQuery(`SELECT CAST\(COALESCE\(recharge_base_amount,amount\) AS DOUBLE PRECISION\)`).
		WithArgs(int64(18)).
		WillReturnRows(sqlmock.NewRows([]string{"base", "bonus", "legacy"}).AddRow(10.0, 2.0, false))
	mock.ExpectExec(`INSERT INTO balance_source_lots`).
		WithArgs(int64(42), "payment_recharge", int64(18), 10.0, 2.0, 0.0).
		WillReturnResult(sqlmock.NewResult(1, 1))

	require.NoError(t, service.recordBalanceSourceLot(context.Background(), order))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestRecordBalanceSourceLotMarksLegacyRechargeUnknown(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	client := dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, db)))
	defer func() { _ = client.Close() }()
	service := &PaymentService{entClient: client}
	order := &dbent.PaymentOrder{ID: 19, UserID: 42, OrderType: payment.OrderTypeBalance}

	mock.ExpectQuery(`SELECT CAST\(COALESCE\(recharge_base_amount,amount\) AS DOUBLE PRECISION\)`).
		WithArgs(int64(19)).
		WillReturnRows(sqlmock.NewRows([]string{"base", "bonus", "legacy"}).AddRow(12.0, 0.0, true))
	mock.ExpectExec(`INSERT INTO balance_source_lots`).
		WithArgs(int64(42), "payment_legacy_unknown", int64(19), 0.0, 0.0, 12.0).
		WillReturnResult(sqlmock.NewResult(1, 1))

	require.NoError(t, service.recordBalanceSourceLot(context.Background(), order))
	require.NoError(t, mock.ExpectationsWereMet())
}
