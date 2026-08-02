package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/apicompat"
	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
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

type GatewayFailoverAttemptSettlementRepository interface {
	SettleGatewayFailoverAttempt(ctx context.Context, attempt *GatewayFailoverAttempt, billing *UsageBillingCommand) (*UsageBillingApplyResult, error)
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

func (s *GatewayService) ChargeGatewayFailoverAttempt(ctx context.Context, input *GatewayFailoverChargeInput) (*GatewayFailoverChargeResult, error) {
	if s == nil {
		return nil, errors.New("gateway service is nil")
	}
	return chargeGatewayFailoverAttempt(ctx, s.usageBillingRepo, s.billingService, s.resolver, s.cfg, s.billingDeps(), s.ResolveUserGroupRateMultiplier, input)
}

func (s *OpenAIGatewayService) ChargeGatewayFailoverAttempt(ctx context.Context, input *GatewayFailoverChargeInput) (*GatewayFailoverChargeResult, error) {
	if s == nil {
		return nil, errors.New("openai gateway service is nil")
	}
	return chargeGatewayFailoverAttempt(ctx, s.usageBillingRepo, s.billingService, s.resolver, s.cfg, s.billingDeps(), s.ResolveUserGroupRateMultiplier, input)
}

type gatewayFailoverRateResolver func(context.Context, int64, int64, float64) float64

func chargeGatewayFailoverAttempt(
	ctx context.Context,
	repo UsageBillingRepository,
	billingService *BillingService,
	pricingResolver *ModelPricingResolver,
	cfg *config.Config,
	deps *billingDeps,
	resolveRate gatewayFailoverRateResolver,
	input *GatewayFailoverChargeInput,
) (*GatewayFailoverChargeResult, error) {
	if input == nil || input.Attempt == nil || input.APIKey == nil || input.APIKey.User == nil || input.Account == nil {
		return nil, errors.New("gateway failover charge input is incomplete")
	}
	if cfg != nil && cfg.RunMode == config.RunModeSimple {
		return nil, errors.New("gateway failover estimated charging is unavailable in simple mode")
	}
	settlementRepo, ok := repo.(GatewayFailoverAttemptSettlementRepository)
	if !ok || settlementRepo == nil {
		return nil, errors.New("gateway failover settlement repository is unavailable")
	}
	if billingService == nil {
		return nil, errors.New("gateway failover billing service is unavailable")
	}

	inputTokens, err := estimateGatewayFailoverInputTokens(input.Endpoint, input.Model, input.RequestBody)
	if err != nil {
		return nil, err
	}
	multiplier := 1.0
	if cfg != nil {
		multiplier = cfg.Default.RateMultiplier
	}
	if input.APIKey.GroupID != nil && input.APIKey.Group != nil && resolveRate != nil {
		multiplier = resolveRate(ctx, input.APIKey.User.ID, *input.APIKey.GroupID, input.APIKey.Group.RateMultiplier)
	}
	multiplier, _ = computePeakAwareMultipliers(input.APIKey, multiplier, timezone.Now())

	billingModel := strings.TrimSpace(input.BillingModel)
	if billingModel == "" {
		billingModel = strings.TrimSpace(input.Model)
	}
	if billingModel == "" {
		return nil, errors.New("gateway failover billing model is empty")
	}
	tokens := UsageTokens{InputTokens: inputTokens}
	var cost *CostBreakdown
	if pricingResolver != nil && input.APIKey.Group != nil {
		groupID := input.APIKey.Group.ID
		cost, err = billingService.CalculateCostUnified(CostInput{
			Ctx:            ctx,
			Model:          billingModel,
			GroupID:        &groupID,
			Tokens:         tokens,
			RequestCount:   1,
			RateMultiplier: multiplier,
			ServiceTier:    strings.TrimSpace(input.ServiceTier),
			Resolver:       pricingResolver,
		})
	} else {
		cost, err = billingService.CalculateCostWithServiceTier(billingModel, tokens, multiplier, input.ServiceTier)
	}
	if err != nil {
		return nil, fmt.Errorf("estimate gateway failover cost: %w", err)
	}
	if cost == nil || cost.ActualCost < 0 {
		return nil, errors.New("gateway failover estimated cost is invalid")
	}

	billing := buildGatewayFailoverBillingCommand(input, inputTokens, cost.ActualCost)
	applyResult, err := settlementRepo.SettleGatewayFailoverAttempt(ctx, input.Attempt, billing)
	if err != nil {
		return nil, err
	}
	if applyResult != nil && applyResult.Applied {
		finalizeGatewayFailoverCharge(ctx, &postUsageBillingParams{
			Cost:               &CostBreakdown{TotalCost: cost.TotalCost, ActualCost: cost.ActualCost},
			User:               input.APIKey.User,
			APIKey:             input.APIKey,
			Account:            input.Account,
			Subscription:       input.Subscription,
			IsSubscriptionBill: billing.SubscriptionCost > 0,
			Platform:           input.QuotaPlatform,
		}, deps, applyResult)
	}
	return &GatewayFailoverChargeResult{
		Applied:       applyResult != nil && applyResult.Applied,
		InputTokens:   inputTokens,
		EstimatedCost: cost.ActualCost,
		BillingStatus: GatewayFailoverBillingSettled,
	}, nil
}

func buildGatewayFailoverBillingCommand(input *GatewayFailoverChargeInput, inputTokens int, estimatedCost float64) *UsageBillingCommand {
	attempt := input.Attempt
	requestKeySource := fmt.Sprintf("%s|%d", strings.TrimSpace(attempt.RequestID), attempt.AttemptNo)
	requestKeyHash := sha256.Sum256([]byte(requestKeySource))
	billing := &UsageBillingCommand{
		RequestID:          "failover:" + hex.EncodeToString(requestKeyHash[:]),
		APIKeyID:           input.APIKey.ID,
		RequestPayloadHash: strings.TrimSpace(attempt.RequestFingerprint),
		UserID:             input.APIKey.User.ID,
		AccountID:          input.Account.ID,
		AccountType:        input.Account.Type,
		Model:              strings.TrimSpace(input.BillingModel),
		ServiceTier:        strings.TrimSpace(input.ServiceTier),
		InputTokens:        inputTokens,
		OutputTokens:       0,
	}
	if billing.Model == "" {
		billing.Model = strings.TrimSpace(input.Model)
	}
	if input.Subscription != nil && input.APIKey.Group != nil && input.APIKey.Group.IsSubscriptionType() {
		billing.SubscriptionID = &input.Subscription.ID
		billing.SubscriptionCost = estimatedCost
		billing.BillingType = BillingTypeSubscription
	} else {
		billing.BalanceCost = estimatedCost
		billing.BillingType = BillingTypeBalance
	}
	if input.APIKey.Quota > 0 {
		billing.APIKeyQuotaCost = estimatedCost
	}
	if input.APIKey.HasRateLimits() {
		billing.APIKeyRateLimitCost = estimatedCost
	}
	billing.Normalize()
	return billing
}

func finalizeGatewayFailoverCharge(ctx context.Context, p *postUsageBillingParams, deps *billingDeps, result *UsageBillingApplyResult) {
	if p == nil || p.Cost == nil || p.APIKey == nil || p.User == nil || deps == nil || deps.billingCacheService == nil {
		return
	}
	if p.IsSubscriptionBill && p.APIKey.GroupID != nil {
		deps.billingCacheService.QueueUpdateSubscriptionUsage(p.User.ID, *p.APIKey.GroupID, p.Cost.ActualCost)
	} else {
		syncBalanceCacheAfterDeduction(ctx, p, deps, result)
	}
	if p.APIKey.HasRateLimits() {
		deps.billingCacheService.QueueUpdateAPIKeyRateLimitUsage(p.APIKey.ID, p.Cost.ActualCost)
	}
	go notifyBalanceLow(p, deps, result)
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
