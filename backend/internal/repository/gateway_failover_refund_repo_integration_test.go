//go:build integration

package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestGatewayFailoverRefundCandidates_DryRunAndStageAreIdempotentAndDoNotRefund(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	usageRepo := NewUsageLogRepository(client, integrationDB).(*usageLogRepository)
	billingRepo := NewUsageBillingRepository(client, integrationDB).(*usageBillingRepository)
	user := mustCreateUser(t, client, &service.User{
		Email: fmt.Sprintf("failover-refund-user-%d@example.com", time.Now().UnixNano()), PasswordHash: "hash", Balance: 100,
	})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "sk-refund-" + uuid.NewString(), Name: "refund"})
	account := mustCreateAccount(t, client, &service.Account{Name: "refund-account-" + uuid.NewString(), Type: service.AccountTypeAPIKey})
	status := 524
	attempt := &service.GatewayFailoverAttempt{
		RequestID: "local:" + uuid.NewString(), RequestFingerprint: "payload", UserID: user.ID, APIKeyID: apiKey.ID,
		AccountID: account.ID, AttemptNo: 1, FailureKind: "http_status", UpstreamStatusCode: &status,
		State: "failed", BillingStatus: service.GatewayFailoverBillingNotBillable, InputTokens: 10,
	}
	require.NoError(t, billingRepo.UpsertGatewayFailoverAttempt(ctx, attempt))
	_, err := integrationDB.ExecContext(ctx, `
		UPDATE gateway_failover_attempts
		SET billing_status = 'settled', settled_cost = 1.25, reserved_cost = 1.25
		WHERE request_id = $1 AND attempt_no = 1
	`, attempt.RequestID)
	require.NoError(t, err)

	filter := service.GatewayFailoverRefundFilter{StartAt: time.Now().Add(-time.Hour), EndAt: time.Now().Add(time.Hour), UserID: user.ID}
	before, err := usageRepo.DryRunGatewayFailoverRefunds(ctx, filter)
	require.NoError(t, err)
	require.Equal(t, 1, before.AttemptCount)
	require.InDelta(t, 1.25, before.OutstandingCost, 0.000000001)
	require.Equal(t, "untracked", before.Candidates[0].CandidateStatus)

	first, err := usageRepo.StageGatewayFailoverRefundCandidates(ctx, filter)
	require.NoError(t, err)
	second, err := usageRepo.StageGatewayFailoverRefundCandidates(ctx, filter)
	require.NoError(t, err)
	require.Equal(t, 1, first)
	require.Zero(t, second)

	after, err := usageRepo.DryRunGatewayFailoverRefunds(ctx, filter)
	require.NoError(t, err)
	require.Equal(t, "candidate", after.Candidates[0].CandidateStatus)
	require.InDelta(t, 1.25, after.OutstandingCost, 0.000000001)

	var balance float64
	require.NoError(t, integrationDB.QueryRowContext(ctx, "SELECT balance FROM users WHERE id = $1", user.ID).Scan(&balance))
	require.InDelta(t, 100, balance, 0.000000001, "staging candidates must not change balance")
}
