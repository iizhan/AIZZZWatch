package service

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

const (
	watchPricingRuleRunnerScanInterval = 10 * time.Second
	watchPricingRuleRunnerConcurrency  = 2
	watchPricingRuleRunnerBatchSize    = 10
)

type watchPricingRuleRunnerService interface {
	ClaimDuePricingRules(ctx context.Context, limit int) ([]WatchPricingRule, error)
	RunClaimedPricingRule(ctx context.Context, rule WatchPricingRule) (*WatchPricingRuleRunResult, error)
}

type WatchPricingRuleRunner struct {
	service watchPricingRuleRunnerService
	ctx     context.Context
	cancel  context.CancelFunc
	sem     chan struct{}

	mu      sync.Mutex
	started bool
	stopped bool
	wg      sync.WaitGroup
}

func NewWatchPricingRuleRunner(service *WatchService) *WatchPricingRuleRunner {
	return newWatchPricingRuleRunner(service)
}

func newWatchPricingRuleRunner(service watchPricingRuleRunnerService) *WatchPricingRuleRunner {
	ctx, cancel := context.WithCancel(context.Background())
	return &WatchPricingRuleRunner{
		service: service,
		ctx:     ctx,
		cancel:  cancel,
		sem:     make(chan struct{}, watchPricingRuleRunnerConcurrency),
	}
}

func (r *WatchPricingRuleRunner) Start() {
	if r == nil || r.service == nil {
		return
	}
	r.mu.Lock()
	if r.started || r.stopped {
		r.mu.Unlock()
		return
	}
	r.started = true
	r.wg.Add(1)
	r.mu.Unlock()
	go r.loop()
}

func (r *WatchPricingRuleRunner) Stop() {
	if r == nil {
		return
	}
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		return
	}
	r.stopped = true
	r.cancel()
	r.mu.Unlock()
	r.wg.Wait()
}

func (r *WatchPricingRuleRunner) loop() {
	defer r.wg.Done()
	r.scan()
	ticker := time.NewTicker(watchPricingRuleRunnerScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.ctx.Done():
			return
		case <-ticker.C:
			r.scan()
		}
	}
}

func (r *WatchPricingRuleRunner) scan() {
	ctx, cancel := context.WithTimeout(r.ctx, 5*time.Second)
	rules, err := r.service.ClaimDuePricingRules(ctx, watchPricingRuleRunnerBatchSize)
	cancel()
	if err != nil {
		slog.Error("watch_pricing_rule: claim due rules failed", "error", err)
		return
	}
	for _, rule := range rules {
		select {
		case <-r.ctx.Done():
			return
		case r.sem <- struct{}{}:
			r.wg.Add(1)
			go r.runOne(rule)
		default:
			slog.Debug("watch_pricing_rule: worker pool full, defer rule", "rule_id", rule.ID)
			return
		}
	}
}

func (r *WatchPricingRuleRunner) runOne(rule WatchPricingRule) {
	defer r.wg.Done()
	defer func() { <-r.sem }()
	if _, err := r.service.RunClaimedPricingRule(r.ctx, rule); err != nil && r.ctx.Err() == nil {
		slog.Warn("watch_pricing_rule: scheduled run failed", "rule_id", rule.ID, "error", err)
	}
}
