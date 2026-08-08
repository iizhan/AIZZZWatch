//go:build unit

package repository

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
	"github.com/stretchr/testify/require"
)

func TestUpsertGatewayFailoverAttemptUsesRequestAndAttemptIdempotency(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	mock.ExpectExec(`(?s)INSERT INTO gateway_failover_attempts.*ON CONFLICT \(request_id, attempt_no\) DO UPDATE`).
		WithArgs("local:req-1", "hash", int64(1), int64(2), nil, int64(3), 1,
			"http_status", sqlmock.AnyArg(), "failed", service.GatewayFailoverBillingPendingReconciliation,
			0, 120, false, "upstream-1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	status := 524
	err = (&usageBillingRepository{db: db}).UpsertGatewayFailoverAttempt(context.Background(), &service.GatewayFailoverAttempt{
		RequestID: "local:req-1", RequestFingerprint: "hash", UserID: 1, APIKeyID: 2,
		AccountID: 3, AttemptNo: 1, FailureKind: "http_status", UpstreamStatusCode: &status,
		State: "failed", BillingStatus: service.GatewayFailoverBillingPendingReconciliation,
		DurationMS: 120, UpstreamRequestID: "upstream-1",
	})
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListGatewayFailoverAttemptsFiltersByAuthenticatedUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer func() { _ = db.Close() }()

	mock.ExpectQuery(`(?s)FROM gateway_failover_attempts.*WHERE user_id = \$1 AND request_id = ANY\(\$2\)`).
		WithArgs(int64(7), pq.Array([]string{"local:req-1"})).
		WillReturnRows(sqlmock.NewRows([]string{
			"request_id", "attempt_no", "state", "billing_status", "upstream_status_code",
			"duration_ms", "input_tokens", "output_tokens", "reserved_cost", "settled_cost",
		}).AddRow("local:req-1", 1, "failed", "settled", 524, 90, 120, 0, 0.02, 0.02).
			AddRow("local:req-1", 2, "succeeded", "standard_usage", nil, 140, 0, 0, 0, 0))

	repo := &usageLogRepository{db: db}
	items, err := repo.ListGatewayFailoverAttemptsByRequests(context.Background(), 7, []string{"local:req-1"})
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, 2, items[0].AttemptCount)
	require.Equal(t, service.GatewayFailoverBillingSettled, items[0].BillingStatus)
	require.Equal(t, 120, items[0].Attempts[0].InputTokens)
	require.InDelta(t, 0.02, items[0].Attempts[0].SettledCost, 0.000001)
	require.NoError(t, mock.ExpectationsWereMet())
}
