package service

import (
	"context"
	"testing"
	"time"
)

type stubWatchPricingRuleRunnerService struct {
	rules []WatchPricingRule
	ran   chan int64
}

func (s *stubWatchPricingRuleRunnerService) ClaimDuePricingRules(ctx context.Context, limit int) ([]WatchPricingRule, error) {
	if len(s.rules) > limit {
		return s.rules[:limit], nil
	}
	return s.rules, nil
}

func (s *stubWatchPricingRuleRunnerService) RunClaimedPricingRule(ctx context.Context, rule WatchPricingRule) (*WatchPricingRuleRunResult, error) {
	s.ran <- rule.ID
	return &WatchPricingRuleRunResult{Rule: &rule, Status: "skipped"}, nil
}

func TestWatchPricingRuleRunnerScanRunsClaimedRules(t *testing.T) {
	stub := &stubWatchPricingRuleRunnerService{
		rules: []WatchPricingRule{{ID: 7, Name: "rule"}},
		ran:   make(chan int64, 1),
	}
	runner := newWatchPricingRuleRunner(stub)

	runner.scan()

	select {
	case got := <-stub.ran:
		if got != 7 {
			t.Fatalf("RunClaimedPricingRule() rule ID = %d, want 7", got)
		}
	case <-time.After(time.Second):
		t.Fatal("runner did not execute claimed rule")
	}
}
