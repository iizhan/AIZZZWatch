package service

import (
	"context"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

type gatewayFailoverSettlementRepoStub struct {
	attempt *GatewayFailoverAttempt
	billing *UsageBillingCommand
	result  *UsageBillingApplyResult
	err     error
}

func (s *gatewayFailoverSettlementRepoStub) Apply(context.Context, *UsageBillingCommand) (*UsageBillingApplyResult, error) {
	panic("unexpected Apply call")
}

func (s *gatewayFailoverSettlementRepoStub) ReserveBatchImageBalance(context.Context, *BatchImageBalanceHoldCommand) (*BatchImageBalanceHoldResult, error) {
	panic("unexpected ReserveBatchImageBalance call")
}

func (s *gatewayFailoverSettlementRepoStub) CaptureBatchImageBalance(context.Context, *BatchImageBalanceHoldCommand) (*BatchImageBalanceHoldResult, error) {
	panic("unexpected CaptureBatchImageBalance call")
}

func (s *gatewayFailoverSettlementRepoStub) ReleaseBatchImageBalance(context.Context, *BatchImageBalanceHoldCommand) (*BatchImageBalanceHoldResult, error) {
	panic("unexpected ReleaseBatchImageBalance call")
}

func (s *gatewayFailoverSettlementRepoStub) SettleGatewayFailoverAttempt(_ context.Context, attempt *GatewayFailoverAttempt, billing *UsageBillingCommand) (*UsageBillingApplyResult, error) {
	s.attempt = attempt
	s.billing = billing
	return s.result, s.err
}

func TestEstimateGatewayFailoverInputTokensSupportsTextEndpoints(t *testing.T) {
	tests := []struct {
		name     string
		endpoint GatewayFailoverEndpoint
		model    string
		body     string
	}{
		{name: "messages", endpoint: GatewayFailoverEndpointMessages, model: "claude-sonnet-4", body: `{"model":"claude-sonnet-4","messages":[{"role":"user","content":"hello"}]}`},
		{name: "responses", endpoint: GatewayFailoverEndpointResponses, model: "gpt-4o", body: `{"model":"gpt-4o","input":"hello"}`},
		{name: "chat completions", endpoint: GatewayFailoverEndpointChatCompletions, model: "gpt-4o", body: `{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}`},
		{name: "gemini", endpoint: GatewayFailoverEndpointGemini, model: "gemini-2.5-pro", body: `{"contents":[{"role":"user","parts":[{"text":"hello"}]}]}`},
		{name: "embeddings string", endpoint: GatewayFailoverEndpointEmbeddings, model: "text-embedding-3-small", body: `{"model":"text-embedding-3-small","input":"hello"}`},
		{name: "embeddings strings", endpoint: GatewayFailoverEndpointEmbeddings, model: "text-embedding-3-small", body: `{"model":"text-embedding-3-small","input":["hello","world"]}`},
		{name: "embeddings tokens", endpoint: GatewayFailoverEndpointEmbeddings, model: "text-embedding-3-small", body: `{"model":"text-embedding-3-small","input":[1,2,3]}`},
		{name: "embeddings token batches", endpoint: GatewayFailoverEndpointEmbeddings, model: "text-embedding-3-small", body: `{"model":"text-embedding-3-small","input":[[1,2],[3,4,5]]}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			count, err := estimateGatewayFailoverInputTokens(tt.endpoint, tt.model, []byte(tt.body))
			require.NoError(t, err)
			require.Positive(t, count)
		})
	}
}

func TestEstimateGatewayFailoverInputTokensRejectsUnsupportedEndpoint(t *testing.T) {
	_, err := estimateGatewayFailoverInputTokens(GatewayFailoverEndpoint("images"), "gpt-image-1", []byte(`{"prompt":"hello"}`))
	require.ErrorContains(t, err, "not billable")
}

func TestBuildGatewayFailoverBillingCommandUsesAttemptIdempotencyAndUserQuota(t *testing.T) {
	apiKey := &APIKey{ID: 22, User: &User{ID: 11}, Quota: 10, RateLimit5h: 5}
	input := &GatewayFailoverChargeInput{
		Attempt: &GatewayFailoverAttempt{RequestID: "local:req-1", RequestFingerprint: "payload", AttemptNo: 2},
		Model:   "gpt-4o", APIKey: apiKey, Account: &Account{ID: 33, Type: AccountTypeAPIKey},
	}

	first := buildGatewayFailoverBillingCommand(input, 128, 0.025)
	second := buildGatewayFailoverBillingCommand(input, 128, 0.025)

	require.Equal(t, first.RequestID, second.RequestID)
	require.Contains(t, first.RequestID, "failover:")
	require.Equal(t, 128, first.InputTokens)
	require.Zero(t, first.OutputTokens)
	require.InDelta(t, 0.025, first.BalanceCost, 0.000001)
	require.InDelta(t, 0.025, first.APIKeyQuotaCost, 0.000001)
	require.InDelta(t, 0.025, first.APIKeyRateLimitCost, 0.000001)
}

func TestChargeGatewayFailoverAttemptSettlesEstimatedInputCost(t *testing.T) {
	repo := &gatewayFailoverSettlementRepoStub{result: &UsageBillingApplyResult{Applied: true}}
	apiKey := &APIKey{ID: 22, User: &User{ID: 11}, Quota: 10, RateLimit5h: 5}
	input := &GatewayFailoverChargeInput{
		Attempt: &GatewayFailoverAttempt{
			RequestID: "local:req-charge", RequestFingerprint: "payload", UserID: 11, APIKeyID: 22,
			AccountID: 33, AttemptNo: 1, State: "failed", BillingStatus: GatewayFailoverBillingReserved,
		},
		Endpoint:    GatewayFailoverEndpointEmbeddings,
		RequestBody: []byte(`{"model":"text-embedding-3-small","input":"hello world"}`),
		Model:       "text-embedding-3-small", BillingModel: "claude-sonnet-4",
		APIKey: apiKey, Account: &Account{ID: 33, Type: AccountTypeAPIKey}, QuotaPlatform: PlatformOpenAI,
	}

	result, err := chargeGatewayFailoverAttempt(
		context.Background(), repo, NewBillingService(&config.Config{}, nil), nil, nil, nil, nil, input,
	)

	require.NoError(t, err)
	require.True(t, result.Applied)
	require.Equal(t, GatewayFailoverBillingSettled, result.BillingStatus)
	require.Positive(t, result.InputTokens)
	require.Positive(t, result.EstimatedCost)
	require.Same(t, input.Attempt, repo.attempt)
	require.Equal(t, result.InputTokens, repo.billing.InputTokens)
	require.Zero(t, repo.billing.OutputTokens)
	require.InDelta(t, result.EstimatedCost, repo.billing.BalanceCost, 0.000000001)
	require.InDelta(t, result.EstimatedCost, repo.billing.APIKeyQuotaCost, 0.000000001)
	require.InDelta(t, result.EstimatedCost, repo.billing.APIKeyRateLimitCost, 0.000000001)
}
