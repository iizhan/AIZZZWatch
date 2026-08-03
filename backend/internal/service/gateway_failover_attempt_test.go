package service

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type gatewayFailoverAttemptRepoStub struct {
	attempt *GatewayFailoverAttempt
	err     error
}

func (s *gatewayFailoverAttemptRepoStub) Apply(context.Context, *UsageBillingCommand) (*UsageBillingApplyResult, error) {
	panic("unexpected Apply call")
}

func (s *gatewayFailoverAttemptRepoStub) ReserveBatchImageBalance(context.Context, *BatchImageBalanceHoldCommand) (*BatchImageBalanceHoldResult, error) {
	panic("unexpected ReserveBatchImageBalance call")
}

func (s *gatewayFailoverAttemptRepoStub) CaptureBatchImageBalance(context.Context, *BatchImageBalanceHoldCommand) (*BatchImageBalanceHoldResult, error) {
	panic("unexpected CaptureBatchImageBalance call")
}

func (s *gatewayFailoverAttemptRepoStub) ReleaseBatchImageBalance(context.Context, *BatchImageBalanceHoldCommand) (*BatchImageBalanceHoldResult, error) {
	panic("unexpected ReleaseBatchImageBalance call")
}

func (s *gatewayFailoverAttemptRepoStub) UpsertGatewayFailoverAttempt(_ context.Context, attempt *GatewayFailoverAttempt) error {
	s.attempt = attempt
	return s.err
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

func TestObserveGatewayFailoverAttemptRecordsEstimateWithoutMonetarySettlement(t *testing.T) {
	repo := &gatewayFailoverAttemptRepoStub{}
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

	result, err := recordGatewayFailoverAttemptEstimate(context.Background(), repo, input)

	require.NoError(t, err)
	require.False(t, result.Applied)
	require.Equal(t, GatewayFailoverBillingNotBillable, result.BillingStatus)
	require.Positive(t, result.InputTokens)
	require.Zero(t, result.EstimatedCost)
	require.Same(t, input.Attempt, repo.attempt)
	require.Equal(t, result.InputTokens, repo.attempt.InputTokens)
	require.Equal(t, GatewayFailoverBillingNotBillable, repo.attempt.BillingStatus)
}

func TestObserveGatewayFailoverAttemptLargeResponsesPayloadNeverSettlesMoney(t *testing.T) {
	repo := &gatewayFailoverAttemptRepoStub{}
	payload := `{"model":"gpt-4o","input":[{"role":"user","content":[{"type":"input_text","text":"hello"},{"type":"input_image","image_url":"data:image/png;base64,` + strings.Repeat("A", 256*1024) + `"}]}]}`
	input := &GatewayFailoverChargeInput{
		Attempt: &GatewayFailoverAttempt{
			RequestID: "local:req-large-responses", UserID: 11, APIKeyID: 22,
			AccountID: 33, AttemptNo: 1, State: "failed",
		},
		Endpoint: GatewayFailoverEndpointResponses, RequestBody: []byte(payload), Model: "gpt-4o",
		APIKey: &APIKey{ID: 22, User: &User{ID: 11}}, Account: &Account{ID: 33, Type: AccountTypeAPIKey},
	}

	result, err := recordGatewayFailoverAttemptEstimate(context.Background(), repo, input)

	require.NoError(t, err)
	require.False(t, result.Applied)
	require.Zero(t, result.EstimatedCost)
	require.Equal(t, GatewayFailoverBillingNotBillable, result.BillingStatus)
	require.Equal(t, GatewayFailoverBillingNotBillable, repo.attempt.BillingStatus)
}
