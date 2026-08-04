package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"
)

const (
	WatchRateAnomalyUnderpriced = "underpriced"
	WatchRateAnomalyOverpriced  = "overpriced"
	WatchRateAnomalyOpen        = "open"
	WatchRateAnomalyResolved    = "resolved"
)

var (
	ErrWatchRateAnomalyNotFound                  = errors.New("watch rate anomaly not found")
	ErrWatchRateCompensationConfirmationRequired = errors.New("watch rate compensation confirmation required")
	ErrWatchRateCompensationSelectionRequired    = errors.New("watch rate compensation user selection required")
	ErrWatchRateCompensationIdempotencyMismatch  = errors.New("watch rate compensation idempotency mismatch")
)

type WatchBalanceCacheInvalidator interface {
	InvalidateUserBalance(context.Context, int64) error
}

type WatchRateEvidenceSummary struct {
	PricingSource         string `json:"pricing_source"`
	OfficialProbeCount    int    `json:"official_probe_count"`
	WatchFallbackCount    int    `json:"watch_fallback_count"`
	EvidenceMismatchCount int    `json:"evidence_mismatch_count"`
}

type WatchRateAnomaly struct {
	ID                    int64      `json:"id"`
	PricingRuleID         *int64     `json:"pricing_rule_id,omitempty"`
	TargetGroupID         int64      `json:"target_group_id"`
	GroupName             string     `json:"group_name"`
	Kind                  string     `json:"kind"`
	Status                string     `json:"status"`
	CurrentValue          float64    `json:"current_value"`
	TargetValue           float64    `json:"target_value"`
	HighestUpstreamCost   float64    `json:"highest_upstream_cost"`
	PricingSource         string     `json:"pricing_source"`
	OfficialProbeCount    int        `json:"official_probe_count"`
	WatchFallbackCount    int        `json:"watch_fallback_count"`
	EvidenceMismatchCount int        `json:"evidence_mismatch_count"`
	DetectedAt            time.Time  `json:"detected_at"`
	LastObservedAt        time.Time  `json:"last_observed_at"`
	ResolvedAt            *time.Time `json:"resolved_at,omitempty"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

type WatchRateAnomalyFilter struct {
	Status string
	Limit  int
}

type WatchRateAnomalyReconcileInput struct {
	PricingRuleID       int64
	TargetGroupID       int64
	CurrentValue        float64
	TargetValue         float64
	HighestUpstreamCost float64
	Evidence            WatchRateEvidenceSummary
	ObservedAt          time.Time
}

type WatchRateCompensationRow struct {
	UserID                 int64   `json:"user_id"`
	Username               string  `json:"username"`
	Email                  string  `json:"email"`
	RequestCount           int64   `json:"request_count"`
	EligibleRequestCount   int64   `json:"eligible_request_count"`
	UnresolvedRequestCount int64   `json:"unresolved_request_count"`
	ActualCost             float64 `json:"actual_cost"`
	ExpectedCost           float64 `json:"expected_cost"`
	CandidateAmount        float64 `json:"candidate_amount"`
	Eligible               bool    `json:"eligible"`
	Reason                 string  `json:"reason,omitempty"`
	AlreadyCompensated     bool    `json:"already_compensated"`
}

type WatchRateCompensationPreview struct {
	Anomaly         WatchRateAnomaly           `json:"anomaly"`
	WindowStart     time.Time                  `json:"window_start"`
	WindowEnd       time.Time                  `json:"window_end"`
	UserCount       int                        `json:"user_count"`
	EligibleCount   int                        `json:"eligible_count"`
	RequestCount    int64                      `json:"request_count"`
	ActualCost      float64                    `json:"actual_cost"`
	ExpectedCost    float64                    `json:"expected_cost"`
	CandidateAmount float64                    `json:"candidate_amount"`
	UnresolvedCount int64                      `json:"unresolved_request_count"`
	Rows            []WatchRateCompensationRow `json:"rows"`
	GeneratedAt     time.Time                  `json:"generated_at"`
}

type WatchRateCompensationApplyInput struct {
	UserIDs        []int64 `json:"user_ids"`
	Confirmed      bool    `json:"confirmed"`
	IdempotencyKey string  `json:"idempotency_key"`
	Reason         string  `json:"reason"`
}

type WatchRateCompensationApplyResult struct {
	AnomalyID         int64     `json:"anomaly_id"`
	AppliedUserIDs    []int64   `json:"applied_user_ids"`
	SkippedUserIDs    []int64   `json:"skipped_user_ids"`
	AppliedCount      int       `json:"applied_count"`
	CompensatedAmount float64   `json:"compensated_amount"`
	AppliedAt         time.Time `json:"applied_at"`
	Replayed          bool      `json:"replayed"`
}

type WatchRateExternalCompensationInput struct {
	TargetGroupID  int64     `json:"target_group_id"`
	UserID         int64     `json:"user_id"`
	WindowStart    time.Time `json:"window_start"`
	WindowEnd      time.Time `json:"window_end"`
	Amount         float64   `json:"amount"`
	IdempotencyKey string    `json:"idempotency_key"`
	Reason         string    `json:"reason"`
}

type WatchRateAnomalyRepository interface {
	ReconcileWatchRateAnomaly(context.Context, WatchRateAnomalyReconcileInput) (*WatchRateAnomaly, error)
	ListWatchRateAnomalies(context.Context, WatchRateAnomalyFilter) ([]WatchRateAnomaly, error)
	PreviewWatchRateCompensation(context.Context, int64, time.Time) (*WatchRateCompensationPreview, error)
	ApplyWatchRateCompensation(context.Context, int64, WatchRateCompensationApplyInput, int64, time.Time) (*WatchRateCompensationApplyResult, error)
	RecordExternalWatchRateCompensation(context.Context, WatchRateExternalCompensationInput, int64, time.Time) error
}

func summarizeWatchRateEvidence(rows []WatchPricingAccountCostRow) WatchRateEvidenceSummary {
	summary := WatchRateEvidenceSummary{}
	for _, row := range rows {
		switch row.PricingSource {
		case "official_probe":
			summary.OfficialProbeCount++
		case "watch_fallback":
			summary.WatchFallbackCount++
		}
		if row.EvidenceMismatch {
			summary.EvidenceMismatchCount++
		}
	}
	switch {
	case summary.OfficialProbeCount > 0 && summary.WatchFallbackCount > 0:
		summary.PricingSource = "mixed"
	case summary.OfficialProbeCount > 0:
		summary.PricingSource = "official_probe"
	case summary.WatchFallbackCount > 0:
		summary.PricingSource = "watch_fallback"
	default:
		summary.PricingSource = "unresolved"
	}
	return summary
}

func (s *WatchService) reconcilePricingRuleAnomaly(ctx context.Context, rule *WatchPricingRule, preview *WatchPricingPreview, currentValue float64, observedAt time.Time) (*WatchRateAnomaly, error) {
	repo, ok := s.sources.(WatchRateAnomalyRepository)
	if !ok || rule == nil || preview == nil || preview.TargetValue == nil || rule.Mode != WatchPriceModeGroupMultiplier {
		return nil, nil
	}
	highestCost := math.Max(0, *preview.TargetValue-0.01)
	return repo.ReconcileWatchRateAnomaly(ctx, WatchRateAnomalyReconcileInput{
		PricingRuleID: rule.ID, TargetGroupID: rule.TargetGroupID,
		CurrentValue: currentValue, TargetValue: *preview.TargetValue, HighestUpstreamCost: highestCost,
		Evidence: summarizeWatchRateEvidence(preview.CostRows), ObservedAt: observedAt,
	})
}

func (s *WatchService) ListRateAnomalies(ctx context.Context, filter WatchRateAnomalyFilter) ([]WatchRateAnomaly, error) {
	repo, ok := s.sources.(WatchRateAnomalyRepository)
	if !ok {
		return nil, fmt.Errorf("watch rate anomaly repository is unavailable")
	}
	filter.Status = strings.TrimSpace(filter.Status)
	if filter.Status != "" && filter.Status != "all" && filter.Status != WatchRateAnomalyOpen && filter.Status != WatchRateAnomalyResolved {
		return nil, fmt.Errorf("invalid watch rate anomaly status")
	}
	return repo.ListWatchRateAnomalies(ctx, filter)
}

func (s *WatchService) PreviewRateCompensation(ctx context.Context, anomalyID int64) (*WatchRateCompensationPreview, error) {
	repo, ok := s.sources.(WatchRateAnomalyRepository)
	if !ok || anomalyID <= 0 {
		return nil, fmt.Errorf("watch rate compensation is unavailable")
	}
	return repo.PreviewWatchRateCompensation(ctx, anomalyID, time.Now().UTC())
}

func (s *WatchService) ApplyRateCompensation(ctx context.Context, anomalyID int64, input WatchRateCompensationApplyInput, operatorUserID int64) (*WatchRateCompensationApplyResult, error) {
	if !input.Confirmed {
		return nil, ErrWatchRateCompensationConfirmationRequired
	}
	if len(input.UserIDs) == 0 {
		return nil, ErrWatchRateCompensationSelectionRequired
	}
	for _, userID := range input.UserIDs {
		if userID <= 0 {
			return nil, ErrWatchRateCompensationSelectionRequired
		}
	}
	if err := validateWatchCompensationKey(input.IdempotencyKey); err != nil {
		return nil, err
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if len(input.Reason) == 0 || len(input.Reason) > 500 {
		return nil, fmt.Errorf("compensation reason must contain 1 to 500 characters")
	}
	if len(input.UserIDs) > 200 {
		return nil, fmt.Errorf("compensation user selection exceeds 200 users")
	}
	repo, ok := s.sources.(WatchRateAnomalyRepository)
	if !ok || anomalyID <= 0 || operatorUserID <= 0 {
		return nil, fmt.Errorf("watch rate compensation is unavailable")
	}
	result, err := repo.ApplyWatchRateCompensation(ctx, anomalyID, input, operatorUserID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if s.compensationCache != nil {
		for _, userID := range result.AppliedUserIDs {
			if err := s.compensationCache.InvalidateUserBalance(ctx, userID); err != nil {
				slog.Warn("watch rate compensation balance cache invalidation failed", "user_id", userID, "error", err)
			}
		}
	}
	return result, nil
}

func (s *WatchService) RecordExternalRateCompensation(ctx context.Context, input WatchRateExternalCompensationInput, operatorUserID int64) error {
	if input.TargetGroupID <= 0 || input.UserID <= 0 || operatorUserID <= 0 || input.Amount <= 0 ||
		math.IsNaN(input.Amount) || math.IsInf(input.Amount, 0) || input.WindowStart.IsZero() || !input.WindowStart.Before(input.WindowEnd) {
		return fmt.Errorf("invalid external compensation record")
	}
	if err := validateWatchCompensationKey(input.IdempotencyKey); err != nil {
		return err
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if len(input.Reason) == 0 || len(input.Reason) > 500 {
		return fmt.Errorf("compensation reason must contain 1 to 500 characters")
	}
	repo, ok := s.sources.(WatchRateAnomalyRepository)
	if !ok {
		return fmt.Errorf("watch rate compensation is unavailable")
	}
	return repo.RecordExternalWatchRateCompensation(ctx, input, operatorUserID, time.Now().UTC())
}

func validateWatchCompensationKey(value string) error {
	value = strings.TrimSpace(value)
	if len(value) < 8 || len(value) > 128 {
		return fmt.Errorf("idempotency key must contain 8 to 128 characters")
	}
	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' && r != ':' {
			return fmt.Errorf("idempotency key contains unsupported characters")
		}
	}
	return nil
}
