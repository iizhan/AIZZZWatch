package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestDryRunGatewayFailoverRefundsAggregatesCostsWithDecimalPrecision(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	observedAt := time.Date(2026, 8, 3, 1, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"id", "user_id", "request_id", "attempt_no", "upstream_status_code",
		"billing_status", "settled_cost", "created_at", "refund_key", "candidate_status",
		"refunded_cost", "refunded_at",
	}).
		AddRow(1, 42, "local:req-a", 1, 524, "settled", "89.717516", observedAt, "", "untracked", "0", nil).
		AddRow(2, 42, "local:req-b", 1, 502, "settled", "57.715592", observedAt, "", "untracked", "0", nil)
	mock.ExpectQuery("FROM gateway_failover_attempts").WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), int64(42)).WillReturnRows(rows)

	repo := &usageLogRepository{db: db}
	report, err := repo.DryRunGatewayFailoverRefunds(context.Background(), service.GatewayFailoverRefundFilter{
		StartAt: observedAt.Add(-time.Hour), EndAt: observedAt.Add(time.Hour), UserID: 42,
	})

	require.NoError(t, err)
	require.Equal(t, 2, report.AttemptCount)
	require.Equal(t, 2, report.RequestCount)
	require.Equal(t, 1, report.UserCount)
	require.Equal(t, 147.433108, report.CandidateCost)
	require.Equal(t, 147.433108, report.OutstandingCost)
	require.Zero(t, report.RefundedCost)
	require.NoError(t, mock.ExpectationsWereMet())
}
