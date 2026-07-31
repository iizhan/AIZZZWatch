package service

import (
	"context"
	"fmt"
	"sort"
	"time"
)

const (
	WatchOperationsAlertSeverityCritical = "critical"
	WatchOperationsAlertSeverityWarning  = "warning"
	WatchOperationsAlertSeverityInfo     = "info"
)

type WatchOperationsUsageSummary struct {
	WindowStart            time.Time `json:"window_start"`
	WindowEnd              time.Time `json:"window_end"`
	RequestCount           int64     `json:"request_count"`
	LossRequestCount       int64     `json:"loss_request_count"`
	UnresolvedRequestCount int64     `json:"unresolved_request_count"`
	AccountCount           int64     `json:"account_count"`
	GroupCount             int64     `json:"group_count"`
	Revenue                float64   `json:"revenue"`
	EstimatedUpstreamCost  float64   `json:"estimated_upstream_cost"`
	GrossProfit            float64   `json:"gross_profit"`
	GrossMargin            *float64  `json:"gross_margin,omitempty"`
}

type WatchOperationsAlert struct {
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	Severity      string     `json:"severity"`
	EntityType    string     `json:"entity_type,omitempty"`
	EntityID      int64      `json:"entity_id,omitempty"`
	EntityName    string     `json:"entity_name,omitempty"`
	Status        string     `json:"status,omitempty"`
	ErrorCode     string     `json:"error_code,omitempty"`
	Platform      string     `json:"platform,omitempty"`
	Model         string     `json:"model,omitempty"`
	Component     string     `json:"component,omitempty"`
	Value         *float64   `json:"value,omitempty"`
	Threshold     *float64   `json:"threshold,omitempty"`
	PreviousValue *float64   `json:"previous_value,omitempty"`
	NextValue     *float64   `json:"next_value,omitempty"`
	ObservedAt    *time.Time `json:"observed_at,omitempty"`
}

type WatchOperationsReport struct {
	GeneratedAt time.Time                   `json:"generated_at"`
	WindowDays  int                         `json:"window_days"`
	Summary     WatchOperationsUsageSummary `json:"summary"`
	Alerts      []WatchOperationsAlert      `json:"alerts"`
}

func (s *WatchService) GetOperationsReport(ctx context.Context, days int) (*WatchOperationsReport, error) {
	if s == nil || s.sources == nil {
		return nil, fmt.Errorf("watch operations repository is unavailable")
	}
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	now := time.Now().UTC()
	start := now.AddDate(0, 0, -days)
	summary, err := s.sources.GetOperationsUsageSummary(ctx, start, now)
	if err != nil {
		return nil, err
	}
	alerts, err := s.collectOperationsAlerts(ctx, start)
	if err != nil {
		return nil, err
	}
	return &WatchOperationsReport{GeneratedAt: now, WindowDays: days, Summary: *summary, Alerts: alerts}, nil
}

func (s *WatchService) ListIntegrationAccountHealth(ctx context.Context, filter WatchIntegrationAccountHealthFilter) (*WatchIntegrationAccountHealthList, error) {
	if s == nil || s.sources == nil {
		return nil, fmt.Errorf("watch integration repository is unavailable")
	}
	now := time.Now().UTC()
	if filter.WindowSeconds <= 0 {
		filter.WindowSeconds = 1800
	}
	if filter.WindowSeconds < 300 {
		filter.WindowSeconds = 300
	}
	if filter.WindowSeconds > 86400 {
		filter.WindowSeconds = 86400
	}
	if filter.Limit <= 0 {
		filter.Limit = 500
	}
	if filter.Limit > 1000 {
		filter.Limit = 1000
	}
	windowStart := now.Add(-time.Duration(filter.WindowSeconds) * time.Second)
	rows, err := s.sources.ListIntegrationAccountHealth(ctx, filter, windowStart, now)
	if err != nil {
		return nil, err
	}
	out := &WatchIntegrationAccountHealthList{
		GeneratedAt:   now,
		WindowStart:   windowStart,
		WindowEnd:     now,
		WindowSeconds: filter.WindowSeconds,
		Items:         rows,
	}
	for _, row := range rows {
		switch row.Status {
		case WatchIntegrationAccountHealthHealthy:
			out.HealthyCount++
		case WatchIntegrationAccountHealthAbnormal:
			out.AbnormalCount++
		case WatchIntegrationAccountHealthDisabled:
			out.DisabledCount++
		default:
			out.ObservingCount++
		}
	}
	return out, nil
}

func (s *WatchService) collectOperationsAlerts(ctx context.Context, windowStart time.Time) ([]WatchOperationsAlert, error) {
	alerts := make([]WatchOperationsAlert, 0)
	sources, err := s.sources.ListSources(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch sources for operations alerts: %w", err)
	}
	for _, source := range sources {
		if source == nil || !source.Enabled {
			continue
		}
		if source.LastCheckStatus == "error" {
			alerts = append(alerts, WatchOperationsAlert{
				ID: fmt.Sprintf("source-error:%d", source.ID), Kind: "source_error", Severity: WatchOperationsAlertSeverityCritical,
				EntityType: "source", EntityID: source.ID, EntityName: source.Name,
				Status: source.LastCheckStatus, ErrorCode: source.LastErrorCode, ObservedAt: source.LastCheckAt,
			})
		}
		if source.LastCheckStatus == "degraded" {
			alerts = append(alerts, WatchOperationsAlert{
				ID: fmt.Sprintf("source-degraded:%d", source.ID), Kind: "source_degraded", Severity: WatchOperationsAlertSeverityWarning,
				EntityType: "source", EntityID: source.ID, EntityName: source.Name,
				Status: source.LastCheckStatus, ErrorCode: source.LastErrorCode, ObservedAt: source.LastCheckAt,
			})
		}
		if source.LastBalance != nil && *source.LastBalance < source.LowBalanceThreshold {
			value := *source.LastBalance
			threshold := source.LowBalanceThreshold
			alerts = append(alerts, WatchOperationsAlert{
				ID: fmt.Sprintf("source-low-balance:%d", source.ID), Kind: "source_low_balance", Severity: WatchOperationsAlertSeverityWarning,
				EntityType: "source", EntityID: source.ID, EntityName: source.Name,
				Value: &value, Threshold: &threshold, ObservedAt: source.LastCheckAt,
			})
		}
	}

	rules, err := s.sources.ListPricingRules(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch pricing rules for operations alerts: %w", err)
	}
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		switch rule.LastStatus {
		case "failed":
			alerts = append(alerts, pricingRuleAlert(rule, WatchOperationsAlertSeverityCritical))
		case "conflict", "frozen":
			alerts = append(alerts, pricingRuleAlert(rule, WatchOperationsAlertSeverityWarning))
		}
	}

	changes, err := s.sources.ListPriceChanges(ctx, 50)
	if err != nil {
		return nil, fmt.Errorf("list watch price changes for operations alerts: %w", err)
	}
	for _, change := range changes {
		if change.ChangeKind != "increase" || change.ObservedAt.Before(windowStart) {
			continue
		}
		previous := change.PreviousValue
		next := change.NextValue
		observedAt := change.ObservedAt
		alerts = append(alerts, WatchOperationsAlert{
			ID: fmt.Sprintf("price-increase:%d", change.ID), Kind: "price_increase", Severity: WatchOperationsAlertSeverityInfo,
			EntityType: "source", EntityID: change.SourceID, EntityName: change.SourceName,
			Platform: change.Platform, Model: change.Model, Component: change.Component,
			PreviousValue: &previous, NextValue: &next, ObservedAt: &observedAt,
		})
	}

	sort.SliceStable(alerts, func(i, j int) bool {
		left, right := alertSeverityRank(alerts[i].Severity), alertSeverityRank(alerts[j].Severity)
		if left != right {
			return left < right
		}
		return alertObservedAt(alerts[i]).After(alertObservedAt(alerts[j]))
	})
	if len(alerts) > 100 {
		alerts = alerts[:100]
	}
	return alerts, nil
}

func pricingRuleAlert(rule WatchPricingRule, severity string) WatchOperationsAlert {
	observedAt := rule.LastRunAt
	kind := "pricing_rule_" + rule.LastStatus
	return WatchOperationsAlert{
		ID: fmt.Sprintf("%s:%d", kind, rule.ID), Kind: kind, Severity: severity,
		EntityType: "pricing_rule", EntityID: rule.ID, EntityName: rule.Name,
		Status: rule.LastStatus, ErrorCode: rule.LastErrorCode, ObservedAt: observedAt,
	}
}

func alertSeverityRank(severity string) int {
	switch severity {
	case WatchOperationsAlertSeverityCritical:
		return 0
	case WatchOperationsAlertSeverityWarning:
		return 1
	default:
		return 2
	}
}

func alertObservedAt(alert WatchOperationsAlert) time.Time {
	if alert.ObservedAt == nil {
		return time.Time{}
	}
	return *alert.ObservedAt
}
