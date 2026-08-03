package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/apicompat"
)

const (
	GatewayFailoverBillingNotBillable           = "not_billable"
	GatewayFailoverBillingStandardUsage         = "standard_usage"
	GatewayFailoverBillingPendingReconciliation = "pending_reconciliation"
	GatewayFailoverBillingReserved              = "reserved"
	GatewayFailoverBillingSettled               = "settled"
	GatewayFailoverBillingReleased              = "released"
)

type GatewayFailoverAttempt struct {
	RequestID          string
	RequestFingerprint string
	UserID             int64
	APIKeyID           int64
	GroupID            *int64
	AccountID          int64
	AttemptNo          int
	FailureKind        string
	UpstreamStatusCode *int
	State              string
	BillingStatus      string
	InputTokens        int
	DurationMS         int
	ResponseStarted    bool
	UpstreamRequestID  string
}

func (a *GatewayFailoverAttempt) Normalize() {
	if a == nil {
		return
	}
	a.RequestID = strings.TrimSpace(a.RequestID)
	a.RequestFingerprint = strings.TrimSpace(a.RequestFingerprint)
	a.FailureKind = strings.TrimSpace(a.FailureKind)
	a.State = strings.TrimSpace(a.State)
	a.BillingStatus = strings.TrimSpace(a.BillingStatus)
	a.UpstreamRequestID = strings.TrimSpace(a.UpstreamRequestID)
}

type GatewayFailoverAttemptRepository interface {
	UpsertGatewayFailoverAttempt(ctx context.Context, attempt *GatewayFailoverAttempt) error
}

type GatewayFailoverEndpoint string

const (
	GatewayFailoverEndpointMessages        GatewayFailoverEndpoint = "messages"
	GatewayFailoverEndpointResponses       GatewayFailoverEndpoint = "responses"
	GatewayFailoverEndpointChatCompletions GatewayFailoverEndpoint = "chat_completions"
	GatewayFailoverEndpointGemini          GatewayFailoverEndpoint = "gemini_generate_content"
	GatewayFailoverEndpointEmbeddings      GatewayFailoverEndpoint = "embeddings"
)

type GatewayFailoverChargeInput struct {
	Attempt       *GatewayFailoverAttempt
	Endpoint      GatewayFailoverEndpoint
	RequestBody   []byte
	Model         string
	BillingModel  string
	ServiceTier   string
	APIKey        *APIKey
	Account       *Account
	Subscription  *UserSubscription
	QuotaPlatform string
}

type GatewayFailoverChargeResult struct {
	Applied       bool
	InputTokens   int
	EstimatedCost float64
	BillingStatus string
}

type GatewayFailoverAttemptPublic struct {
	AttemptNo          int     `json:"attempt_no"`
	State              string  `json:"state"`
	BillingStatus      string  `json:"billing_status"`
	UpstreamStatusCode *int    `json:"upstream_status_code,omitempty"`
	DurationMS         *int    `json:"duration_ms,omitempty"`
	InputTokens        int     `json:"input_tokens"`
	OutputTokens       int     `json:"output_tokens"`
	ReservedCost       float64 `json:"reserved_cost"`
	SettledCost        float64 `json:"settled_cost"`
}

type GatewayFailoverRequestSummary struct {
	RequestID     string                         `json:"request_id"`
	AttemptCount  int                            `json:"attempt_count"`
	BillingStatus string                         `json:"billing_status"`
	Attempts      []GatewayFailoverAttemptPublic `json:"attempts"`
}

type GatewayFailoverAttemptQueryRepository interface {
	ListGatewayFailoverAttemptsByRequests(ctx context.Context, userID int64, requestIDs []string) ([]GatewayFailoverRequestSummary, error)
}

type GatewayFailoverRefundFilter struct {
	StartAt time.Time
	EndAt   time.Time
	UserID  int64
}

func (f GatewayFailoverRefundFilter) Validate() error {
	if f.StartAt.IsZero() || f.EndAt.IsZero() || !f.StartAt.Before(f.EndAt) {
		return errors.New("gateway failover refund range is invalid")
	}
	if f.EndAt.Sub(f.StartAt) > 31*24*time.Hour {
		return errors.New("gateway failover refund range cannot exceed 31 days")
	}
	if f.UserID < 0 {
		return errors.New("gateway failover refund user is invalid")
	}
	return nil
}

type GatewayFailoverRefundCandidate struct {
	AttemptID           int64      `json:"attempt_id"`
	RefundKey           string     `json:"refund_key"`
	UserID              int64      `json:"user_id"`
	RequestID           string     `json:"request_id"`
	AttemptNo           int        `json:"attempt_no"`
	UpstreamStatusCode  *int       `json:"upstream_status_code,omitempty"`
	BillingStatus       string     `json:"billing_status"`
	CandidateStatus     string     `json:"candidate_status"`
	OriginalSettledCost float64    `json:"original_settled_cost"`
	RefundedCost        float64    `json:"refunded_cost"`
	OutstandingCost     float64    `json:"outstanding_cost"`
	AttemptedAt         time.Time  `json:"attempted_at"`
	RefundedAt          *time.Time `json:"refunded_at,omitempty"`
}

type GatewayFailoverRefundDryRun struct {
	GeneratedAt     time.Time                        `json:"generated_at"`
	StartAt         time.Time                        `json:"start_at"`
	EndAt           time.Time                        `json:"end_at"`
	UserID          int64                            `json:"user_id,omitempty"`
	UserCount       int                              `json:"user_count"`
	RequestCount    int                              `json:"request_count"`
	AttemptCount    int                              `json:"attempt_count"`
	CandidateCost   float64                          `json:"candidate_cost"`
	RefundedCost    float64                          `json:"refunded_cost"`
	OutstandingCost float64                          `json:"outstanding_cost"`
	Candidates      []GatewayFailoverRefundCandidate `json:"candidates"`
}

type GatewayFailoverRefundStageResult struct {
	StagedCount int                         `json:"staged_count"`
	DryRun      GatewayFailoverRefundDryRun `json:"dry_run"`
}

type GatewayFailoverRefundRepository interface {
	DryRunGatewayFailoverRefunds(ctx context.Context, filter GatewayFailoverRefundFilter) (*GatewayFailoverRefundDryRun, error)
	StageGatewayFailoverRefundCandidates(ctx context.Context, filter GatewayFailoverRefundFilter) (int, error)
}

func gatewayFailoverAttemptRepository(repo UsageBillingRepository) GatewayFailoverAttemptRepository {
	if repo == nil {
		return nil
	}
	attemptRepo, _ := repo.(GatewayFailoverAttemptRepository)
	return attemptRepo
}

func (s *GatewayService) RecordGatewayFailoverAttempt(ctx context.Context, attempt *GatewayFailoverAttempt) error {
	repo := gatewayFailoverAttemptRepository(s.usageBillingRepo)
	if repo == nil || attempt == nil || strings.TrimSpace(attempt.RequestID) == "" {
		return nil
	}
	attempt.Normalize()
	return repo.UpsertGatewayFailoverAttempt(ctx, attempt)
}

func (s *OpenAIGatewayService) RecordGatewayFailoverAttempt(ctx context.Context, attempt *GatewayFailoverAttempt) error {
	repo := gatewayFailoverAttemptRepository(s.usageBillingRepo)
	if repo == nil || attempt == nil || strings.TrimSpace(attempt.RequestID) == "" {
		return nil
	}
	attempt.Normalize()
	return repo.UpsertGatewayFailoverAttempt(ctx, attempt)
}

func (s *GatewayService) ObserveGatewayFailoverAttempt(ctx context.Context, input *GatewayFailoverChargeInput) (*GatewayFailoverChargeResult, error) {
	if s == nil {
		return nil, errors.New("gateway service is nil")
	}
	return recordGatewayFailoverAttemptEstimate(ctx, s.usageBillingRepo, input)
}

func (s *OpenAIGatewayService) ObserveGatewayFailoverAttempt(ctx context.Context, input *GatewayFailoverChargeInput) (*GatewayFailoverChargeResult, error) {
	if s == nil {
		return nil, errors.New("openai gateway service is nil")
	}
	return recordGatewayFailoverAttemptEstimate(ctx, s.usageBillingRepo, input)
}

// recordGatewayFailoverAttemptEstimate keeps an observational token estimate for
// operators, but deliberately has no access to the monetary billing repository.
// Failed upstream attempts are never user-billable; only the final successful
// usage record may apply balance or quota effects.
func recordGatewayFailoverAttemptEstimate(
	ctx context.Context,
	repo UsageBillingRepository,
	input *GatewayFailoverChargeInput,
) (*GatewayFailoverChargeResult, error) {
	if input == nil || input.Attempt == nil || input.APIKey == nil || input.APIKey.User == nil || input.Account == nil {
		return nil, errors.New("gateway failover charge input is incomplete")
	}
	attemptRepo := gatewayFailoverAttemptRepository(repo)
	if attemptRepo == nil {
		return nil, errors.New("gateway failover attempt repository is unavailable")
	}

	inputTokens, err := estimateGatewayFailoverInputTokens(input.Endpoint, input.Model, input.RequestBody)
	if err != nil {
		// Audit persistence must not turn an otherwise retryable upstream failure
		// into a client-visible gateway failure. Keep zero when estimation is not
		// available for an endpoint or payload shape.
		inputTokens = 0
	}

	input.Attempt.InputTokens = inputTokens
	input.Attempt.BillingStatus = GatewayFailoverBillingNotBillable
	if err := attemptRepo.UpsertGatewayFailoverAttempt(ctx, input.Attempt); err != nil {
		return nil, err
	}
	return &GatewayFailoverChargeResult{
		Applied:       false,
		InputTokens:   inputTokens,
		EstimatedCost: 0,
		BillingStatus: GatewayFailoverBillingNotBillable,
	}, nil
}

func estimateGatewayFailoverInputTokens(endpoint GatewayFailoverEndpoint, model string, body []byte) (int, error) {
	if len(body) == 0 {
		return 0, errors.New("gateway failover request body is empty")
	}
	var estimated int
	var err error
	switch endpoint {
	case GatewayFailoverEndpointMessages:
		estimated, err = EstimateGrokCountTokens(body)
	case GatewayFailoverEndpointResponses:
		var request apicompat.ResponsesRequest
		if err = json.Unmarshal(body, &request); err == nil {
			if strings.TrimSpace(request.Model) == "" {
				request.Model = model
			}
			estimated, err = estimateOpenAIInputTokens(openAIInputTokensCountRequest{
				Model: request.Model, Instructions: request.Instructions, Input: request.Input,
				Tools: request.Tools, ToolChoice: request.ToolChoice,
			})
		}
	case GatewayFailoverEndpointChatCompletions:
		var request apicompat.ChatCompletionsRequest
		if err = json.Unmarshal(body, &request); err == nil {
			if strings.TrimSpace(request.Model) == "" {
				request.Model = model
			}
			var converted *apicompat.ResponsesRequest
			converted, err = apicompat.ChatCompletionsToResponses(&request)
			if err == nil {
				estimated, err = estimateOpenAIInputTokens(openAIInputTokensCountRequest{
					Model: converted.Model, Instructions: converted.Instructions, Input: converted.Input,
					Tools: converted.Tools, ToolChoice: converted.ToolChoice,
				})
			}
		}
	case GatewayFailoverEndpointGemini:
		estimated = estimateGeminiCountTokens(body)
	case GatewayFailoverEndpointEmbeddings:
		estimated, err = estimateEmbeddingInputTokens(model, body)
	default:
		return 0, fmt.Errorf("gateway failover endpoint %q is not billable", endpoint)
	}
	if err != nil {
		return 0, fmt.Errorf("estimate gateway failover input tokens: %w", err)
	}
	if estimated < 1 {
		estimated = 1
	}
	return estimated, nil
}

func estimateEmbeddingInputTokens(model string, body []byte) (int, error) {
	var request struct {
		Model string          `json:"model"`
		Input json.RawMessage `json:"input"`
	}
	if err := json.Unmarshal(body, &request); err != nil {
		return 0, err
	}
	if strings.TrimSpace(request.Model) == "" {
		request.Model = model
	}
	codec, err := openAIInputTokensCodecForModel(request.Model)
	if err != nil {
		return 0, err
	}
	var single string
	if err := json.Unmarshal(request.Input, &single); err == nil {
		return codec.Count(single)
	}
	var multiple []string
	if err := json.Unmarshal(request.Input, &multiple); err == nil {
		total := 0
		for _, value := range multiple {
			count, countErr := codec.Count(value)
			if countErr != nil {
				return 0, countErr
			}
			total += count
		}
		return total, nil
	}
	var tokenIDs []int
	if err := json.Unmarshal(request.Input, &tokenIDs); err == nil {
		return len(tokenIDs), nil
	}
	var tokenBatches [][]int
	if err := json.Unmarshal(request.Input, &tokenBatches); err == nil {
		total := 0
		for _, batch := range tokenBatches {
			total += len(batch)
		}
		return total, nil
	}
	return 0, errors.New("unsupported embeddings input shape")
}
