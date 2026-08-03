package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
)

type watchPreviewGroupRepo struct {
	GroupRepository
	group      *Group
	swapped    bool
	casCalls   int
	casWantOld float64
	casWantNew float64
}

func (r *watchPreviewGroupRepo) GetByID(ctx context.Context, id int64) (*Group, error) {
	return r.group, nil
}

func (r *watchPreviewGroupRepo) CompareAndSwapRateMultiplier(ctx context.Context, id int64, expected, next float64) (bool, error) {
	r.casCalls++
	r.casWantOld = expected
	r.casWantNew = next
	if r.group != nil && r.swapped {
		r.group.RateMultiplier = next
	}
	return r.swapped, nil
}

type watchPreviewChannelRepo struct {
	ChannelRepository
	channelID int64
}

func (r *watchPreviewChannelRepo) GetChannelIDByGroupID(ctx context.Context, groupID int64) (int64, error) {
	return r.channelID, nil
}

type watchPreviewSourceRepo struct {
	WatchSourceRepository
	listPricingCalls int
	listSourcesCalls int
	sources          []*WatchSource
	snapshots        map[int64]*WatchSourceSnapshot
	mappings         []WatchAccountUpstreamMapping
	observations     []WatchPricingObservation
	claimedRule      *WatchPricingRule
	finishedRule     *WatchPricingRule
	reservedAudit    *WatchPriceAudit
	completedAudit   *WatchPriceAudit
	savedMapping     *WatchAccountUpstreamMapping
	finishCalls      int
}

func (r *watchPreviewSourceRepo) ListSources(ctx context.Context) ([]*WatchSource, error) {
	r.listSourcesCalls++
	return r.sources, nil
}

func (r *watchPreviewSourceRepo) ListPricingObservations(ctx context.Context, mode WatchPriceMode, platform, model string, component WatchPriceComponent) ([]WatchPricingObservation, error) {
	r.listPricingCalls++
	return r.observations, nil
}

func (r *watchPreviewSourceRepo) GetSourceSnapshot(ctx context.Context, sourceID int64) (*WatchSourceSnapshot, error) {
	return r.snapshots[sourceID], nil
}

func (r *watchPreviewSourceRepo) ListAccountUpstreamMappings(ctx context.Context, accountIDs []int64) ([]WatchAccountUpstreamMapping, error) {
	allowed := make(map[int64]struct{}, len(accountIDs))
	for _, id := range accountIDs {
		allowed[id] = struct{}{}
	}
	out := make([]WatchAccountUpstreamMapping, 0, len(r.mappings))
	for _, mapping := range r.mappings {
		if _, ok := allowed[mapping.AccountID]; ok {
			out = append(out, mapping)
		}
	}
	return out, nil
}

func (r *watchPreviewSourceRepo) SaveAccountUpstreamMapping(_ context.Context, mapping WatchAccountUpstreamMapping) (*WatchAccountUpstreamMapping, error) {
	r.savedMapping = &mapping
	return &mapping, nil
}

func (r *watchPreviewSourceRepo) ClaimPricingRuleRun(ctx context.Context, id int64, now time.Time) (*WatchPricingRule, error) {
	if r.claimedRule == nil || r.claimedRule.ID != id {
		return nil, ErrWatchPricingRuleNotFound
	}
	rule := *r.claimedRule
	if rule.RunSequence == 0 {
		rule.RunSequence = 1
	}
	rule.LastStatus = "running"
	r.claimedRule = &rule
	return &rule, nil
}

func (r *watchPreviewSourceRepo) FinishPricingRuleRun(ctx context.Context, id, sequence int64, status, errorCode string) (*WatchPricingRule, error) {
	r.finishCalls++
	rule := *r.claimedRule
	rule.LastStatus = status
	rule.LastErrorCode = errorCode
	r.finishedRule = &rule
	return &rule, nil
}

func (r *watchPreviewSourceRepo) ReservePriceAudit(ctx context.Context, audit WatchPriceAudit) (*WatchPriceAudit, bool, error) {
	audit.ID = 99
	r.reservedAudit = &audit
	return &audit, false, nil
}

func (r *watchPreviewSourceRepo) GetPriceAuditByIdempotencyKey(ctx context.Context, key string) (*WatchPriceAudit, error) {
	return nil, nil
}

func (r *watchPreviewSourceRepo) CompletePriceAudit(ctx context.Context, id int64, action, reason string) (*WatchPriceAudit, error) {
	audit := WatchPriceAudit{ID: id, Action: action, Reason: reason}
	if r.reservedAudit != nil {
		audit = *r.reservedAudit
		audit.Action = action
		audit.Reason = reason
	}
	r.completedAudit = &audit
	return &audit, nil
}

type watchPreviewAccountRepo struct {
	AdminAccountRepository
	accounts      []Account
	groupCalls    int
	platformCalls int
	pageParams    pagination.PaginationParams
}

func (r *watchPreviewAccountRepo) GetByID(_ context.Context, id int64) (*Account, error) {
	for i := range r.accounts {
		if r.accounts[i].ID == id {
			account := r.accounts[i]
			return &account, nil
		}
	}
	return nil, ErrAccountNotFound
}

func (r *watchPreviewAccountRepo) ListSchedulableByGroupID(ctx context.Context, groupID int64) ([]Account, error) {
	r.groupCalls++
	return r.accounts, nil
}

func (r *watchPreviewAccountRepo) ListSchedulableByGroupIDAndPlatform(ctx context.Context, groupID int64, platform string) ([]Account, error) {
	r.platformCalls++
	out := make([]Account, 0, len(r.accounts))
	for _, account := range r.accounts {
		if strings.EqualFold(account.Platform, platform) {
			out = append(out, account)
		}
	}
	return out, nil
}

func (r *watchPreviewAccountRepo) ListActive(ctx context.Context) ([]Account, error) {
	return r.accounts, nil
}

func (r *watchPreviewAccountRepo) ListWatchMappingAccountPage(_ context.Context, params pagination.PaginationParams, platform string) ([]Account, *pagination.PaginationResult, error) {
	r.pageParams = params
	filtered := make([]Account, 0, len(r.accounts))
	for _, account := range r.accounts {
		if platform == "" || strings.EqualFold(account.Platform, platform) {
			filtered = append(filtered, account)
		}
	}
	start := params.Offset()
	if start > len(filtered) {
		start = len(filtered)
	}
	end := start + params.Limit()
	if end > len(filtered) {
		end = len(filtered)
	}
	pages := 0
	if len(filtered) > 0 {
		pages = (len(filtered) + params.Limit() - 1) / params.Limit()
	}
	return filtered[start:end], &pagination.PaginationResult{Total: int64(len(filtered)), Page: params.Page, PageSize: params.Limit(), Pages: pages}, nil
}

func watchTestSourceSnapshot(source *WatchSource, observedAt, expiresAt time.Time, keys []WatchSourceKeyObservation, groups []WatchSourceGroupObservation, prices []WatchSourcePriceObservation) *WatchSourceSnapshot {
	sourceCopy := *source
	sourceCopy.LastCheckStatus = "healthy"
	sourceCopy.LastCheckAt = &observedAt
	sourceCopy.LastSuccessAt = &observedAt
	return &WatchSourceSnapshot{
		Source: &sourceCopy,
		Check:  &WatchSourceCheck{SourceID: source.ID, Status: "healthy", ObservedAt: observedAt, ExpiresAt: expiresAt},
		Groups: groups, Prices: prices, SourceKeys: keys,
	}
}

func watchTestDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func TestFindModelPriceSelectsRequestedComponent(t *testing.T) {
	in := 0.12
	out := 0.34
	perRequest := 0.56
	pricing := []ChannelModelPricing{{Platform: "openai", Models: []string{"gpt-4o"}, InputPrice: &in, OutputPrice: &out, PerRequestPrice: &perRequest}}

	for _, test := range []struct {
		name      string
		component WatchPriceComponent
		want      float64
	}{
		{name: "input", component: WatchPriceComponentInput, want: in},
		{name: "output", component: WatchPriceComponentOutput, want: out},
		{name: "per request", component: WatchPriceComponentPerRequest, want: perRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := findModelPrice(pricing, "OPENAI", "GPT-4O", test.component)
			if !ok || got != test.want {
				t.Fatalf("findModelPrice() = (%v, %v), want (%v, true)", got, ok, test.want)
			}
		})
	}
}

func TestFindModelPriceRejectsMissingOrInvalidValue(t *testing.T) {
	invalid := -1.0
	pricing := []ChannelModelPricing{{Platform: "openai", Models: []string{"gpt-4o"}, InputPrice: &invalid}}
	if got, ok := findModelPrice(pricing, "openai", "gpt-4o", WatchPriceComponentInput); ok || got != 0 {
		t.Fatalf("findModelPrice() = (%v, %v), want (0, false)", got, ok)
	}
}

func TestRoundWatchPriceAddsStablePrecision(t *testing.T) {
	if got := roundWatchPrice(0.1 + 0.01); got != 0.11 {
		t.Fatalf("roundWatchPrice() = %v, want 0.11", got)
	}
}

func TestNextWatchPricingProposalMovesTowardTargetWithoutOvershoot(t *testing.T) {
	for _, test := range []struct {
		name    string
		current float64
		target  float64
		step    float64
		want    float64
	}{
		{name: "increase by step", current: 0.3, target: 0.51, step: 0.003, want: 0.303},
		{name: "increase reaches target when gap smaller than step", current: 0.508, target: 0.51, step: 0.003, want: 0.51},
		{name: "decrease by step", current: 1, target: 0.51, step: 0.003, want: 0.997},
		{name: "decrease reaches target when gap smaller than step", current: 0.512, target: 0.51, step: 0.003, want: 0.51},
		{name: "equal target skips", current: 0.51, target: 0.51, step: 0.003, want: 0.51},
		{name: "zero step keeps direct target for manual path", current: 0.3, target: 0.51, step: 0, want: 0.51},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := nextWatchPricingProposal(test.current, test.target, test.step); got != test.want {
				t.Fatalf("nextWatchPricingProposal() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPreparePricingRuleDefaultsAndValidatesAdjustmentStep(t *testing.T) {
	svc := NewWatchService(
		nil,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		nil,
		&watchPreviewSourceRepo{},
		nil,
		nil,
	)

	rule, err := svc.preparePricingRule(context.Background(), WatchPricingRuleInput{
		Name: "default-step", TargetGroupID: 7, Mode: WatchPriceModeGroupMultiplier,
		Enabled: true, IntervalSeconds: 300,
	})
	if err != nil {
		t.Fatalf("preparePricingRule() default step error = %v", err)
	}
	if rule.AdjustmentStep != 0.003 {
		t.Fatalf("default AdjustmentStep = %v, want 0.003", rule.AdjustmentStep)
	}

	rule, err = svc.preparePricingRule(context.Background(), WatchPricingRuleInput{
		Name: "explicit-step", TargetGroupID: 7, Mode: WatchPriceModeGroupMultiplier,
		Enabled: true, IntervalSeconds: 300, AdjustmentStep: 0.001,
	})
	if err != nil {
		t.Fatalf("preparePricingRule() explicit step error = %v", err)
	}
	if rule.AdjustmentStep != 0.001 {
		t.Fatalf("explicit AdjustmentStep = %v, want 0.001", rule.AdjustmentStep)
	}

	if _, err = svc.preparePricingRule(context.Background(), WatchPricingRuleInput{
		Name: "invalid-step", TargetGroupID: 7, Mode: WatchPriceModeGroupMultiplier,
		Enabled: true, IntervalSeconds: 300, AdjustmentStep: -0.001,
	}); err == nil || !strings.Contains(err.Error(), "adjustment_step") {
		t.Fatalf("preparePricingRule() invalid step error = %v, want adjustment_step validation", err)
	}
}

func TestPricingCandidateFromObservationAppliesEligibilityRules(t *testing.T) {
	now := time.Now().UTC()
	value := 0.01
	balance := 20.0
	future := now.Add(time.Minute)
	base := WatchPricingObservation{SourceID: 1, SourceName: "Source", GroupExternalID: "g1", GroupName: "Group", Platform: "openai", Value: &value, Status: "healthy", ObservedAt: now, ExpiresAt: &future, LastBalance: &balance, BalanceMinimum: 10}
	req := WatchPricingPreviewRequest{Mode: WatchPriceModeGroupMultiplier, Platform: "openai"}

	if candidate := pricingCandidateFromObservation(base, req, now); !candidate.Healthy || candidate.Value != value {
		t.Fatalf("healthy candidate = %#v", candidate)
	}

	expired := base
	past := now.Add(-time.Second)
	expired.ExpiresAt = &past
	if candidate := pricingCandidateFromObservation(expired, req, now); candidate.Healthy || candidate.Reason != "observation expired" {
		t.Fatalf("expired candidate = %#v", candidate)
	}

	lowBalance := base
	low := 1.0
	lowBalance.LastBalance = &low
	if candidate := pricingCandidateFromObservation(lowBalance, req, now); candidate.Healthy || candidate.Reason != "low_balance" {
		t.Fatalf("low balance candidate = %#v", candidate)
	}

	degraded := base
	degraded.Status = "degraded"
	degraded.ErrorCode = "low_balance"
	if candidate := pricingCandidateFromObservation(degraded, req, now); candidate.Healthy || candidate.Reason != "low_balance" {
		t.Fatalf("degraded candidate = %#v", candidate)
	}

	missingPrice := base
	missingPrice.Value = nil
	req.Mode = WatchPriceModeModelPrice
	if candidate := pricingCandidateFromObservation(missingPrice, req, now); candidate.Healthy || candidate.Reason != "model price unavailable" {
		t.Fatalf("missing model candidate = %#v", candidate)
	}
}

func TestPreviewPricingModelPriceFreezesWhenTargetGroupHasNoChannel(t *testing.T) {
	sourceRepo := &watchPreviewSourceRepo{}
	svc := NewWatchService(
		nil,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		&watchPreviewChannelRepo{channelID: 0},
		sourceRepo,
		nil,
		nil,
	)

	preview, err := svc.PreviewPricing(context.Background(), WatchPricingPreviewRequest{
		TargetGroupID: 7,
		Mode:          WatchPriceModeModelPrice,
		Model:         "gpt-test",
		Component:     WatchPriceComponentInput,
	})

	if err != nil {
		t.Fatalf("PreviewPricing() error = %v", err)
	}
	if preview == nil || !preview.Frozen || preview.FreezeReason != "target group is not associated with a channel" {
		t.Fatalf("PreviewPricing() preview = %#v, want frozen target channel state", preview)
	}
	if sourceRepo.listPricingCalls != 0 {
		t.Fatalf("ListPricingObservations() calls = %d, want 0 when current target price is unavailable", sourceRepo.listPricingCalls)
	}
}

func TestPreviewPricingUsesHighestEffectiveCostFromMatchedTargetSources(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	sourceA := &WatchSource{ID: 1, Name: "站点 A", BaseURL: "https://site-a.example", APIBaseURL: "https://api.site-a.example/v1", RechargeRatio: 1, Enabled: true}
	sourceB := &WatchSource{ID: 2, Name: "站点 B", BaseURL: "https://site-b.example", APIBaseURL: "https://api.site-b.example/v1", RechargeRatio: 1, Enabled: true}
	sourceC := &WatchSource{ID: 3, Name: "站点 C", BaseURL: "https://site-c.example", APIBaseURL: "https://api.site-c.example/v1", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{sourceA, sourceB, sourceC},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(sourceA, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "A Key", GroupExternalIDs: []string{"a"}}},
				[]WatchSourceGroupObservation{{ExternalID: "a", Name: "A", Platform: PlatformOpenAI, RateMultiplier: 0.20, ObservedAt: now}},
				nil,
			),
			2: watchTestSourceSnapshot(sourceB, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-b", Label: "B Key", GroupExternalIDs: []string{"b"}}},
				[]WatchSourceGroupObservation{{ExternalID: "b", Name: "B", Platform: PlatformOpenAI, RateMultiplier: 0.30, ObservedAt: now}},
				nil,
			),
			3: watchTestSourceSnapshot(sourceC, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-c", Label: "C Key", GroupExternalIDs: []string{"c"}}},
				[]WatchSourceGroupObservation{{ExternalID: "c", Name: "C", Platform: PlatformOpenAI, RateMultiplier: 0.50, ObservedAt: now}},
				nil,
			),
		},
		mappings: []WatchAccountUpstreamMapping{
			{AccountID: 11, SourceID: 1, SourceName: "站点 A", SourceKeyExternalID: "key-a", SourceGroupExternalID: "a", MappingMethod: "manual"},
			{AccountID: 12, SourceID: 2, SourceName: "站点 B", SourceKeyExternalID: "key-b", SourceGroupExternalID: "b", MappingMethod: "manual"},
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.site-a.example/v1"}},
		{ID: 12, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://site-b.example/v1"}},
	}}
	svc := NewWatchService(
		accountRepo,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		nil,
		sourceRepo,
		nil,
		nil,
	)

	preview, err := svc.PreviewPricing(context.Background(), WatchPricingPreviewRequest{
		TargetGroupID: 7,
		Mode:          WatchPriceModeGroupMultiplier,
		Platform:      PlatformOpenAI,
	})

	if err != nil {
		t.Fatalf("PreviewPricing() error = %v", err)
	}
	if preview == nil || preview.ProposedValue == nil {
		t.Fatalf("PreviewPricing() preview = %#v, want proposed value", preview)
	}
	if got, want := *preview.ProposedValue, 0.31; got != want {
		t.Fatalf("ProposedValue = %v, want %v", got, want)
	}
	if len(preview.Candidates) != 2 {
		t.Fatalf("Candidates len = %d, want 2 matched target sources", len(preview.Candidates))
	}
	if len(preview.CostRows) != 2 {
		t.Fatalf("CostRows len = %d, want 2 account cost rows", len(preview.CostRows))
	}
	if preview.Candidates[0].SourceID != 2 {
		t.Fatalf("first candidate SourceID = %d, want highest effective cost source 2", preview.Candidates[0].SourceID)
	}
	if accountRepo.platformCalls != 1 || accountRepo.groupCalls != 0 {
		t.Fatalf("account repo calls platform=%d group=%d, want platform=1 group=0", accountRepo.platformCalls, accountRepo.groupCalls)
	}
}

func TestPreviewPricingUsesRechargeAdjustedEffectiveCosts(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	sourceA := &WatchSource{ID: 1, Name: "1:1 站点", APIBaseURL: "https://api.one-to-one.example/v1", RechargeRatio: 1, Enabled: true}
	sourceB := &WatchSource{ID: 2, Name: "1:10 站点", APIBaseURL: "https://api.one-to-ten.example/v1", RechargeRatio: 10, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{sourceA, sourceB},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(sourceA, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "A Key", GroupExternalIDs: []string{"a"}}},
				[]WatchSourceGroupObservation{{ExternalID: "a", Name: "A", Platform: PlatformOpenAI, RateMultiplier: 0.20, ObservedAt: now}},
				nil,
			),
			2: watchTestSourceSnapshot(sourceB, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-b", Label: "B Key", GroupExternalIDs: []string{"b"}}},
				[]WatchSourceGroupObservation{{ExternalID: "b", Name: "B", Platform: PlatformOpenAI, RateMultiplier: 0.30, ObservedAt: now}},
				nil,
			),
		},
		mappings: []WatchAccountUpstreamMapping{
			{AccountID: 11, SourceID: 1, SourceName: "1:1 站点", SourceKeyExternalID: "key-a", SourceGroupExternalID: "a", MappingMethod: "manual"},
			{AccountID: 12, SourceID: 2, SourceName: "1:10 站点", SourceKeyExternalID: "key-b", SourceGroupExternalID: "b", MappingMethod: "manual"},
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.one-to-one.example/v1"}},
		{ID: 12, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.one-to-ten.example/v1"}},
	}}
	svc := NewWatchService(
		accountRepo,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		nil,
		sourceRepo,
		nil,
		nil,
	)

	preview, err := svc.PreviewPricing(context.Background(), WatchPricingPreviewRequest{
		TargetGroupID: 7,
		Mode:          WatchPriceModeGroupMultiplier,
		Platform:      PlatformOpenAI,
	})

	if err != nil {
		t.Fatalf("PreviewPricing() error = %v", err)
	}
	if preview == nil || preview.ProposedValue == nil {
		t.Fatalf("PreviewPricing() preview = %#v, want proposed value", preview)
	}
	if got, want := *preview.ProposedValue, 0.21; got != want {
		t.Fatalf("ProposedValue = %v, want %v", got, want)
	}
	if got, want := *preview.CostRows[1].EffectiveCost, 0.03; got != want {
		t.Fatalf("second account effective cost = %v, want %v", got, want)
	}
}

func TestPreviewPricingFollowsUpstreamCostIncrease(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	sourceA := &WatchSource{ID: 1, Name: "1:1 站点", APIBaseURL: "https://api.one-to-one.example/v1", RechargeRatio: 1, Enabled: true}
	sourceB := &WatchSource{ID: 2, Name: "1:10 站点", APIBaseURL: "https://api.one-to-ten.example/v1", RechargeRatio: 10, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{sourceA, sourceB},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(sourceA, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "A Key", GroupExternalIDs: []string{"a"}}},
				[]WatchSourceGroupObservation{{ExternalID: "a", Name: "A", Platform: PlatformOpenAI, RateMultiplier: 0.50, ObservedAt: now}},
				nil,
			),
			2: watchTestSourceSnapshot(sourceB, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-b", Label: "B Key", GroupExternalIDs: []string{"b"}}},
				[]WatchSourceGroupObservation{{ExternalID: "b", Name: "B", Platform: PlatformOpenAI, RateMultiplier: 0.30, ObservedAt: now}},
				nil,
			),
		},
		mappings: []WatchAccountUpstreamMapping{
			{AccountID: 11, SourceID: 1, SourceName: "1:1 站点", SourceKeyExternalID: "key-a", SourceGroupExternalID: "a", MappingMethod: "manual"},
			{AccountID: 12, SourceID: 2, SourceName: "1:10 站点", SourceKeyExternalID: "key-b", SourceGroupExternalID: "b", MappingMethod: "manual"},
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.one-to-one.example/v1"}},
		{ID: 12, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.one-to-ten.example/v1"}},
	}}
	svc := NewWatchService(
		accountRepo,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		nil,
		sourceRepo,
		nil,
		nil,
	)

	preview, err := svc.PreviewPricing(context.Background(), WatchPricingPreviewRequest{
		TargetGroupID: 7,
		Mode:          WatchPriceModeGroupMultiplier,
		Platform:      PlatformOpenAI,
	})

	if err != nil {
		t.Fatalf("PreviewPricing() error = %v", err)
	}
	if preview == nil || preview.ProposedValue == nil {
		t.Fatalf("PreviewPricing() preview = %#v, want proposed value", preview)
	}
	if got, want := *preview.ProposedValue, 0.51; got != want {
		t.Fatalf("ProposedValue = %v, want %v", got, want)
	}
	if preview.TargetValue == nil || *preview.TargetValue != 0.51 {
		t.Fatalf("TargetValue = %#v, want 0.51", preview.TargetValue)
	}
}

func TestPreviewPricingAdjustmentStepProposesSingleStepTowardTarget(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	source := &WatchSource{ID: 1, Name: "上游 A", APIBaseURL: "https://api.upstream.example/v1", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "A Key", GroupExternalIDs: []string{"g1"}}},
				[]WatchSourceGroupObservation{{ExternalID: "g1", Name: "Team A", Platform: PlatformOpenAI, RateMultiplier: 0.5, ObservedAt: now}},
				nil,
			),
		},
		mappings: []WatchAccountUpstreamMapping{{AccountID: 11, SourceID: 1, SourceName: "上游 A", SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", MappingMethod: "manual"}},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.upstream.example/v1"}},
	}}
	svc := NewWatchService(
		accountRepo,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 0.3}},
		nil,
		sourceRepo,
		nil,
		nil,
	)

	preview, err := svc.PreviewPricing(context.Background(), WatchPricingPreviewRequest{
		TargetGroupID:  7,
		Mode:           WatchPriceModeGroupMultiplier,
		Platform:       PlatformOpenAI,
		AdjustmentStep: 0.001,
	})

	if err != nil {
		t.Fatalf("PreviewPricing() error = %v", err)
	}
	if preview == nil || preview.TargetValue == nil || preview.ProposedValue == nil {
		t.Fatalf("PreviewPricing() preview = %#v, want target and proposed values", preview)
	}
	if got, want := *preview.TargetValue, 0.51; got != want {
		t.Fatalf("TargetValue = %v, want %v", got, want)
	}
	if got, want := *preview.ProposedValue, 0.301; got != want {
		t.Fatalf("ProposedValue = %v, want one step to %v", got, want)
	}
}

func TestPreviewPricingFreezesWhenSourceKeyHasMultipleGroupsWithoutSelection(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	source := &WatchSource{ID: 1, Name: "多分组站点", APIBaseURL: "https://api.multi.example/v1", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "A Key", GroupExternalIDs: []string{"cheap", "expensive"}}},
				[]WatchSourceGroupObservation{
					{ExternalID: "cheap", Name: "Cheap", Platform: PlatformOpenAI, RateMultiplier: 0.10, ObservedAt: now},
					{ExternalID: "expensive", Name: "Expensive", Platform: PlatformOpenAI, RateMultiplier: 0.50, ObservedAt: now},
				},
				nil,
			),
		},
		mappings: []WatchAccountUpstreamMapping{
			{AccountID: 11, SourceID: 1, SourceName: "多分组站点", SourceKeyExternalID: "key-a", MappingMethod: "manual"},
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.multi.example/v1"}},
	}}
	svc := NewWatchService(
		accountRepo,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		nil,
		sourceRepo,
		nil,
		nil,
	)

	preview, err := svc.PreviewPricing(context.Background(), WatchPricingPreviewRequest{
		TargetGroupID: 7,
		Mode:          WatchPriceModeGroupMultiplier,
		Platform:      PlatformOpenAI,
	})

	if err != nil {
		t.Fatalf("PreviewPricing() error = %v", err)
	}
	if preview == nil || !preview.Frozen || preview.FreezeReason != "source key belongs to multiple groups; select a source group" {
		t.Fatalf("PreviewPricing() preview = %#v, want ambiguous-key frozen state", preview)
	}
	if len(preview.CostRows) != 1 || preview.CostRows[0].EffectiveCost != nil {
		t.Fatalf("CostRows = %#v, want unresolved ambiguous account cost", preview.CostRows)
	}
}

func TestPreviewPricingFreezesWhenTargetGroupHasNoConfirmedMapping(t *testing.T) {
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{
			{ID: 1, Name: "站点 A", APIBaseURL: "https://api.site-a.example/v1", RechargeRatio: 1, Enabled: true},
		},
		snapshots: map[int64]*WatchSourceSnapshot{},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"api_key": "sk-account-not-mapped", "base_url": "https://other.example/v1"}},
	}}
	svc := NewWatchService(
		accountRepo,
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		nil,
		sourceRepo,
		nil,
		nil,
	)

	preview, err := svc.PreviewPricing(context.Background(), WatchPricingPreviewRequest{
		TargetGroupID: 7,
		Mode:          WatchPriceModeGroupMultiplier,
		Platform:      PlatformOpenAI,
	})

	if err != nil {
		t.Fatalf("PreviewPricing() error = %v", err)
	}
	if preview == nil || !preview.Frozen || preview.FreezeReason != "account upstream key is not mapped" {
		t.Fatalf("PreviewPricing() preview = %#v, want unconfirmed-mapping frozen state", preview)
	}
	if sourceRepo.listPricingCalls != 0 {
		t.Fatalf("ListPricingObservations() calls = %d, want 0 when target scope is unmatched", sourceRepo.listPricingCalls)
	}
}

func TestRunPricingRuleReturnsFrozenResultWhenTargetGroupHasNoSchedulableAccounts(t *testing.T) {
	sourceRepo := &watchPreviewSourceRepo{
		claimedRule: &WatchPricingRule{
			ID:              3,
			Name:            "auto",
			TargetGroupID:   7,
			Mode:            WatchPriceModeGroupMultiplier,
			Component:       WatchPriceComponentInput,
			Enabled:         true,
			IntervalSeconds: 300,
			RunSequence:     1,
		},
	}
	svc := NewWatchService(
		&watchPreviewAccountRepo{accounts: []Account{}},
		&watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 1}},
		nil,
		sourceRepo,
		nil,
		nil,
	)

	result, err := svc.RunPricingRule(context.Background(), 3, 1)

	if err != nil {
		t.Fatalf("RunPricingRule() error = %v, want structured frozen result without transport failure", err)
	}
	if result == nil || result.Status != "frozen" || result.ErrorCode != "target group has no schedulable accounts" {
		t.Fatalf("RunPricingRule() = %#v, want frozen no-schedulable result", result)
	}
	if result.Preview == nil || !result.Preview.Frozen || result.Preview.FreezeReason != "target group has no schedulable accounts" {
		t.Fatalf("RunPricingRule() preview = %#v, want frozen preview reason", result.Preview)
	}
	if sourceRepo.finishCalls != 1 || sourceRepo.finishedRule == nil || sourceRepo.finishedRule.LastStatus != "frozen" {
		t.Fatalf("FinishPricingRuleRun status = %#v calls=%d, want frozen exactly once", sourceRepo.finishedRule, sourceRepo.finishCalls)
	}
}

func TestRunPricingRuleAppliesSuggestedGroupMultiplier(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	source := &WatchSource{ID: 1, Name: "上游 A", APIBaseURL: "https://api.upstream.example/v1", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "A Key", GroupExternalIDs: []string{"g1"}}},
				[]WatchSourceGroupObservation{{ExternalID: "g1", Name: "Team A", Platform: PlatformOpenAI, RateMultiplier: 0.5, ObservedAt: now}},
				nil,
			),
		},
		mappings: []WatchAccountUpstreamMapping{{AccountID: 11, SourceID: 1, SourceName: "上游 A", SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", MappingMethod: "manual"}},
		claimedRule: &WatchPricingRule{
			ID:              4,
			Name:            "auto",
			TargetGroupID:   7,
			Mode:            WatchPriceModeGroupMultiplier,
			Component:       WatchPriceComponentInput,
			Enabled:         true,
			IntervalSeconds: 300,
			RunSequence:     1,
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.upstream.example/v1"}},
	}}
	groupRepo := &watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 0.3}, swapped: true}
	svc := NewWatchService(
		accountRepo,
		groupRepo,
		nil,
		sourceRepo,
		NewGroupService(groupRepo, nil),
		NewChannelService(&watchPreviewChannelRepo{}, nil, nil, nil),
	)

	result, err := svc.RunPricingRule(context.Background(), 4, 1)

	if err != nil {
		t.Fatalf("RunPricingRule() error = %v", err)
	}
	if result == nil || result.Status != "applied" || result.Preview == nil || result.Preview.ProposedValue == nil {
		t.Fatalf("RunPricingRule() = %#v, want applied result", result)
	}
	if result.Preview.TargetValue == nil || *result.Preview.TargetValue != 0.51 {
		t.Fatalf("TargetValue = %#v, want 0.51", result.Preview.TargetValue)
	}
	if got, want := *result.Preview.ProposedValue, 0.303; got != want {
		t.Fatalf("ProposedValue = %v, want %v", got, want)
	}
	if groupRepo.casCalls != 1 || groupRepo.casWantOld != 0.3 || groupRepo.casWantNew != 0.303 {
		t.Fatalf("CAS calls=%d old=%v new=%v, want one CAS 0.3→0.303", groupRepo.casCalls, groupRepo.casWantOld, groupRepo.casWantNew)
	}
	if sourceRepo.completedAudit == nil || sourceRepo.completedAudit.Action != "applied" {
		t.Fatalf("completed audit = %#v, want applied audit", sourceRepo.completedAudit)
	}
}

func TestRunPricingRuleSkipsWhenCurrentAlreadyMatchesTarget(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	source := &WatchSource{ID: 1, Name: "上游 A", APIBaseURL: "https://api.upstream.example/v1", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "A Key", GroupExternalIDs: []string{"g1"}}},
				[]WatchSourceGroupObservation{{ExternalID: "g1", Name: "Team A", Platform: PlatformOpenAI, RateMultiplier: 0.5, ObservedAt: now}},
				nil,
			),
		},
		mappings: []WatchAccountUpstreamMapping{{AccountID: 11, SourceID: 1, SourceName: "上游 A", SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", MappingMethod: "manual"}},
		claimedRule: &WatchPricingRule{
			ID:              5,
			Name:            "auto-skip",
			TargetGroupID:   7,
			Mode:            WatchPriceModeGroupMultiplier,
			Component:       WatchPriceComponentInput,
			Enabled:         true,
			IntervalSeconds: 300,
			AdjustmentStep:  0.003,
			RunSequence:     1,
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"base_url": "https://api.upstream.example/v1"}},
	}}
	groupRepo := &watchPreviewGroupRepo{group: &Group{ID: 7, Status: StatusActive, RateMultiplier: 0.51}, swapped: true}
	svc := NewWatchService(
		accountRepo,
		groupRepo,
		nil,
		sourceRepo,
		NewGroupService(groupRepo, nil),
		NewChannelService(&watchPreviewChannelRepo{}, nil, nil, nil),
	)

	result, err := svc.RunPricingRule(context.Background(), 5, 1)

	if err != nil {
		t.Fatalf("RunPricingRule() error = %v", err)
	}
	if result == nil || result.Status != "skipped" || result.Preview == nil || result.Preview.ProposedValue == nil {
		t.Fatalf("RunPricingRule() = %#v, want skipped result", result)
	}
	if got, want := *result.Preview.ProposedValue, 0.51; got != want {
		t.Fatalf("ProposedValue = %v, want %v", got, want)
	}
	if groupRepo.casCalls != 0 {
		t.Fatalf("CAS calls = %d, want 0 for skipped rule", groupRepo.casCalls)
	}
}

func TestScanAccountMappingsFindsUniqueDigestCandidateWithoutSaving(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	source := &WatchSource{ID: 1, Name: "上游 A", BaseURL: "https://api.upstream.example", APIBaseURL: "https://api.upstream.example/v1", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "Key A", GroupExternalIDs: []string{"g1"}, KeyDigest: watchTestDigest("sk-match")}},
				[]WatchSourceGroupObservation{{ExternalID: "g1", Name: "Team A", Platform: PlatformOpenAI, RateMultiplier: 0.2, ObservedAt: now}},
				nil,
			),
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Name: "local", Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Status: StatusActive, Schedulable: true, GroupIDs: []int64{7}, Credentials: map[string]any{"api_key": "sk-match", "base_url": "https://api.upstream.example/v1"}},
	}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	result, err := svc.ScanAccountMappings(context.Background(), WatchAccountMappingScanRequest{TargetGroupID: 7, Platform: PlatformOpenAI}, func(_ context.Context, id int64) (*WatchSourceSnapshot, error) {
		return sourceRepo.snapshots[id], nil
	})

	if err != nil {
		t.Fatalf("ScanAccountMappings() error = %v", err)
	}
	if result.ReadyCount != 1 || len(result.Candidates) != 1 {
		t.Fatalf("ScanAccountMappings() = %#v, want one ready candidate", result)
	}
	candidate := result.Candidates[0]
	if candidate.Status != "ready" || candidate.SourceID != 1 || candidate.SourceKeyExternalID != "key-a" || candidate.SourceGroupExternalID != "g1" {
		t.Fatalf("candidate = %#v, want resolved ready mapping candidate", candidate)
	}
	if !candidate.InTargetGroup || candidate.ParticipationReason != "" {
		t.Fatalf("candidate participation = in_group:%v reason:%q, want target participant", candidate.InTargetGroup, candidate.ParticipationReason)
	}
	if len(sourceRepo.mappings) != 0 {
		t.Fatalf("sourceRepo.mappings len = %d, want scan to avoid writing formal mappings", len(sourceRepo.mappings))
	}
}

func TestScanAccountMappingsSourceFilterNarrowsCandidatesBeforeMatching(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	sourceA := &WatchSource{ID: 1, Name: "Source A", BaseURL: "https://api.upstream.example", RechargeRatio: 1, Enabled: true}
	sourceB := &WatchSource{ID: 2, Name: "Source B", BaseURL: "https://api.upstream.example", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{sourceA, sourceB},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(sourceA, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Status: "active", GroupExternalIDs: []string{"g1"}, KeyDigest: watchTestDigest("sk-match")}},
				[]WatchSourceGroupObservation{{ExternalID: "g1", Name: "Group A", ObservedAt: now}}, nil),
			2: watchTestSourceSnapshot(sourceB, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-b", Status: "active", GroupExternalIDs: []string{"g2"}, KeyDigest: watchTestDigest("sk-match")}},
				[]WatchSourceGroupObservation{{ExternalID: "g2", Name: "Group B", ObservedAt: now}}, nil),
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{{
		ID: 11, Name: "local", Platform: PlatformOpenAI, Status: StatusActive,
		Credentials: map[string]any{"api_key": "sk-match", "base_url": "https://api.upstream.example/v1"},
	}}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	result, err := svc.ScanAccountMappings(context.Background(), WatchAccountMappingScanRequest{SourceID: 2}, func(_ context.Context, sourceID int64) (*WatchSourceSnapshot, error) {
		return sourceRepo.snapshots[sourceID], nil
	})
	if err != nil {
		t.Fatalf("ScanAccountMappings() error = %v", err)
	}
	if len(result.Candidates) != 1 || result.Candidates[0].Status != "ready" || result.Candidates[0].SourceID != 2 {
		t.Fatalf("ScanAccountMappings() = %#v, want source-filtered ready candidate", result)
	}
}

func TestScanAccountMappingsExplainsMissingComparableKeyDigest(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(time.Minute)
	source := &WatchSource{ID: 1, Name: "上游 A", BaseURL: "https://api.upstream.example", APIBaseURL: "https://api.upstream.example/v1", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, future,
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "Key A", GroupExternalIDs: []string{"g1"}}},
				[]WatchSourceGroupObservation{{ExternalID: "g1", Name: "Team A", Platform: PlatformOpenAI, RateMultiplier: 0.2, ObservedAt: now}},
				nil,
			),
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Name: "local", Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Status: StatusActive, Schedulable: true, GroupIDs: []int64{7}, Credentials: map[string]any{"api_key": "sk-local", "base_url": "https://api.upstream.example/v1"}},
	}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	result, err := svc.ScanAccountMappings(context.Background(), WatchAccountMappingScanRequest{TargetGroupID: 7, Platform: PlatformOpenAI}, func(_ context.Context, id int64) (*WatchSourceSnapshot, error) {
		return sourceRepo.snapshots[id], nil
	})

	if err != nil {
		t.Fatalf("ScanAccountMappings() error = %v", err)
	}
	if len(result.Candidates) != 1 {
		t.Fatalf("candidate len = %d, want 1", len(result.Candidates))
	}
	candidate := result.Candidates[0]
	if candidate.Status != "unmatched" || candidate.Reason != "source keys do not provide comparable key digest" {
		t.Fatalf("candidate = %#v, want explicit missing comparable key reason", candidate)
	}
}

func TestScanAccountMappingsSurfacesPendingGroupConfirmation(t *testing.T) {
	now := time.Now().UTC()
	account := Account{ID: 11, Name: "account", Platform: PlatformOpenAI}
	source := &WatchSource{ID: 1, Name: "source", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, now.Add(time.Minute),
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "Key A", Status: "active", GroupExternalIDs: []string{"g2"}, ObservedAt: now}},
				[]WatchSourceGroupObservation{{ExternalID: "g2", Name: "Group 2", RateMultiplier: 0.3, ObservedAt: now}}, nil),
		},
		mappings: []WatchAccountUpstreamMapping{{
			AccountID: 11, SourceID: 1, SourceName: "source", SourceKeyExternalID: "key-a",
			SourceGroupExternalID: "g1", GroupBindingState: "needs_confirmation",
		}},
	}
	svc := NewWatchService(&watchPreviewAccountRepo{accounts: []Account{account}}, nil, nil, sourceRepo, nil, nil)

	result, err := svc.ScanAccountMappings(context.Background(), WatchAccountMappingScanRequest{}, func(_ context.Context, sourceID int64) (*WatchSourceSnapshot, error) {
		return sourceRepo.snapshots[sourceID], nil
	})
	if err != nil {
		t.Fatalf("ScanAccountMappings() error = %v", err)
	}
	if len(result.Candidates) != 1 || result.Candidates[0].Status != "needs_confirmation" {
		t.Fatalf("ScanAccountMappings() = %#v, want pending confirmation candidate", result)
	}
	if result.ReadyCount != 1 || result.AmbiguousCount != 0 || result.MappedCount != 0 {
		t.Fatalf("ScanAccountMappings() counts = ready %d ambiguous %d mapped %d", result.ReadyCount, result.AmbiguousCount, result.MappedCount)
	}
	candidate := result.Candidates[0]
	if candidate.SourceGroupExternalID != "g2" || candidate.SourceGroupName != "Group 2" || len(candidate.Groups) != 1 {
		t.Fatalf("pending candidate = %#v, want latest single group ready for explicit confirmation", candidate)
	}
}

func TestScanAccountMappingsPendingGroupConfirmationRequiresChoiceForMultipleGroups(t *testing.T) {
	now := time.Now().UTC()
	source := &WatchSource{ID: 1, Name: "source", RechargeRatio: 1, Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{source},
		snapshots: map[int64]*WatchSourceSnapshot{
			1: watchTestSourceSnapshot(source, now, now.Add(time.Minute),
				[]WatchSourceKeyObservation{{ExternalID: "key-a", Status: "active", GroupExternalIDs: []string{"g2", "g3"}, ObservedAt: now}},
				[]WatchSourceGroupObservation{{ExternalID: "g2", Name: "Group 2"}, {ExternalID: "g3", Name: "Group 3"}}, nil),
		},
		mappings: []WatchAccountUpstreamMapping{{AccountID: 11, SourceID: 1, SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", GroupBindingState: "needs_confirmation"}},
	}
	svc := NewWatchService(&watchPreviewAccountRepo{accounts: []Account{{ID: 11, Name: "account", Platform: PlatformOpenAI}}}, nil, nil, sourceRepo, nil, nil)

	result, err := svc.ScanAccountMappings(context.Background(), WatchAccountMappingScanRequest{}, func(_ context.Context, sourceID int64) (*WatchSourceSnapshot, error) {
		return sourceRepo.snapshots[sourceID], nil
	})
	if err != nil {
		t.Fatalf("ScanAccountMappings() error = %v", err)
	}
	candidate := result.Candidates[0]
	if candidate.Status != "needs_confirmation" || candidate.SourceGroupExternalID != "" || len(candidate.Groups) != 2 {
		t.Fatalf("pending candidate = %#v, want explicit choice among current groups", candidate)
	}
}

func TestConfirmAccountMappingBatchRevalidatesAndSavesCurrentAutomaticCandidate(t *testing.T) {
	now := time.Now().UTC()
	source := &WatchSource{ID: 1, Name: "source", BaseURL: "https://api.upstream.example", Enabled: true, RechargeRatio: 1}
	snapshot := watchTestSourceSnapshot(source, now, now.Add(time.Minute),
		[]WatchSourceKeyObservation{{ExternalID: "key-a", Label: "Key A", Status: "active", KeyDigest: watchTestDigest("sk-current"), GroupExternalIDs: []string{"g1"}, ObservedAt: now}},
		[]WatchSourceGroupObservation{{ExternalID: "g1", Name: "Group 1", ObservedAt: now}}, nil)
	sourceRepo := &watchPreviewSourceRepo{}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{{
		ID: 11, Name: "account", Platform: PlatformOpenAI,
		Credentials: map[string]any{"api_key": "sk-current", "base_url": "https://api.upstream.example/v1"},
	}}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)
	loadCalls := 0

	result, err := svc.ConfirmAccountMappingBatch(context.Background(), WatchAccountMappingBatchConfirmRequest{
		Confirmed: true,
		Items:     []WatchAccountMappingInput{{AccountID: 11, SourceID: 1, SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", MappingMethod: "auto"}},
	}, 7, func(context.Context, int64) (*WatchSourceSnapshot, error) {
		loadCalls++
		return snapshot, nil
	})

	if err != nil {
		t.Fatalf("ConfirmAccountMappingBatch() error = %v", err)
	}
	if len(result.Saved) != 1 || len(result.Failed) != 0 || sourceRepo.savedMapping == nil {
		t.Fatalf("result = %#v saved mapping = %#v, want one saved automatic mapping", result, sourceRepo.savedMapping)
	}
	if sourceRepo.savedMapping.MappingMethod != "auto" || sourceRepo.savedMapping.SourceGroupExternalID != "g1" {
		t.Fatalf("saved mapping = %#v, want current automatic group g1", sourceRepo.savedMapping)
	}
	if loadCalls != 1 {
		t.Fatalf("live snapshot calls = %d, want 1", loadCalls)
	}
}

func TestConfirmAccountMappingBatchRejectsStaleAutomaticCandidatesWithoutSaving(t *testing.T) {
	now := time.Now().UTC()
	tests := []struct {
		name       string
		account    Account
		key        WatchSourceKeyObservation
		groupIDs   []string
		wantReason string
	}{
		{
			name:       "credential changed after scan",
			account:    Account{ID: 11, Credentials: map[string]any{"api_key": "sk-changed", "base_url": "https://api.upstream.example/v1"}},
			key:        WatchSourceKeyObservation{ExternalID: "key-a", Status: "active", KeyDigest: watchTestDigest("sk-before"), GroupExternalIDs: []string{"g1"}},
			wantReason: "account upstream key no longer matches",
		},
		{
			name:       "base url changed after scan",
			account:    Account{ID: 11, Credentials: map[string]any{"api_key": "sk-current", "base_url": "https://other.example/v1"}},
			key:        WatchSourceKeyObservation{ExternalID: "key-a", Status: "active", KeyDigest: watchTestDigest("sk-current"), GroupExternalIDs: []string{"g1"}},
			wantReason: "account upstream source no longer matches",
		},
		{
			name:       "key disabled after scan",
			account:    Account{ID: 11, Credentials: map[string]any{"api_key": "sk-current", "base_url": "https://api.upstream.example/v1"}},
			key:        WatchSourceKeyObservation{ExternalID: "key-a", Status: "disabled", KeyDigest: watchTestDigest("sk-current"), GroupExternalIDs: []string{"g1"}},
			wantReason: "source key is not active",
		},
		{
			name:       "group changed after scan",
			account:    Account{ID: 11, Credentials: map[string]any{"api_key": "sk-current", "base_url": "https://api.upstream.example/v1"}},
			key:        WatchSourceKeyObservation{ExternalID: "key-a", Status: "active", KeyDigest: watchTestDigest("sk-current"), GroupExternalIDs: []string{"g2"}},
			groupIDs:   []string{"g2"},
			wantReason: "source group is not assigned to source key",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := &WatchSource{ID: 1, Name: "source", BaseURL: "https://api.upstream.example", Enabled: true, RechargeRatio: 1}
			groups := []WatchSourceGroupObservation{{ExternalID: "g1", Name: "Group 1", ObservedAt: now}}
			if len(test.groupIDs) > 0 {
				groups = []WatchSourceGroupObservation{{ExternalID: test.groupIDs[0], Name: "Current Group", ObservedAt: now}}
			}
			snapshot := watchTestSourceSnapshot(source, now, now.Add(time.Minute), []WatchSourceKeyObservation{test.key}, groups, nil)
			sourceRepo := &watchPreviewSourceRepo{}
			svc := NewWatchService(&watchPreviewAccountRepo{accounts: []Account{test.account}}, nil, nil, sourceRepo, nil, nil)

			result, err := svc.ConfirmAccountMappingBatch(context.Background(), WatchAccountMappingBatchConfirmRequest{
				Confirmed: true,
				Items:     []WatchAccountMappingInput{{AccountID: 11, SourceID: 1, SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", MappingMethod: "auto"}},
			}, 7, func(context.Context, int64) (*WatchSourceSnapshot, error) { return snapshot, nil })

			if err != nil {
				t.Fatalf("ConfirmAccountMappingBatch() error = %v", err)
			}
			if len(result.Saved) != 0 || len(result.Failed) != 1 || result.Failed[0].Reason != test.wantReason {
				t.Fatalf("result = %#v, want one safe rejection %q", result, test.wantReason)
			}
			if sourceRepo.savedMapping != nil {
				t.Fatalf("saved mapping = %#v, want no write", sourceRepo.savedMapping)
			}
		})
	}
}

func TestListAccountMappingsMarksAccountsOutsideTargetGroup(t *testing.T) {
	sourceRepo := &watchPreviewSourceRepo{sources: []*WatchSource{}}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Name: "not-in-group", Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Status: StatusActive, Schedulable: true, GroupIDs: []int64{99}, Credentials: map[string]any{"api_key": "sk-local", "base_url": "https://api.upstream.example/v1"}},
	}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	view, err := svc.ListAccountMappings(context.Background(), WatchAccountMappingListRequest{TargetGroupID: 7, Platform: PlatformOpenAI, Page: 1, PageSize: 20})

	if err != nil {
		t.Fatalf("ListAccountMappings() error = %v", err)
	}
	if len(view.Accounts) != 1 {
		t.Fatalf("Accounts len = %d, want account still visible with target participation hint", len(view.Accounts))
	}
	row := view.Accounts[0]
	if row.InTargetGroup || row.ParticipationReason != "account is not in target group" {
		t.Fatalf("row participation = in_group:%v reason:%q, want explicit non-participant state", row.InTargetGroup, row.ParticipationReason)
	}
}

func TestListAccountMappingsReturnsRequestedPageAndTotal(t *testing.T) {
	sourceRepo := &watchPreviewSourceRepo{sources: []*WatchSource{}}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Name: "first", Platform: PlatformOpenAI, Status: StatusActive},
		{ID: 12, Name: "second", Platform: PlatformOpenAI, Status: StatusActive},
		{ID: 13, Name: "third", Platform: PlatformAnthropic, Status: StatusActive},
	}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	view, err := svc.ListAccountMappings(context.Background(), WatchAccountMappingListRequest{Platform: PlatformOpenAI, Page: 2, PageSize: 1})
	if err != nil {
		t.Fatalf("ListAccountMappings() error = %v", err)
	}
	if len(view.Accounts) != 1 || view.Accounts[0].AccountID != 12 {
		t.Fatalf("Accounts = %#v, want second OpenAI account", view.Accounts)
	}
	if view.Total != 2 || view.Page != 2 || view.PageSize != 1 || view.Pages != 2 {
		t.Fatalf("pagination = total:%d page:%d page_size:%d pages:%d", view.Total, view.Page, view.PageSize, view.Pages)
	}
	if accountRepo.pageParams.SortBy != "priority" || accountRepo.pageParams.SortOrder != pagination.SortOrderAsc {
		t.Fatalf("page params = %#v, want stable priority ordering", accountRepo.pageParams)
	}
}

func TestListAccountMappingsFiltersBySearchStatusAndSourceBeforePagination(t *testing.T) {
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{{ID: 1, Name: "Source A"}, {ID: 2, Name: "Source B"}},
		mappings: []WatchAccountUpstreamMapping{
			{AccountID: 11, SourceID: 1, GroupBindingState: "confirmed"},
			{AccountID: 12, SourceID: 2, GroupBindingState: "needs_confirmation"},
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Name: "first", Platform: PlatformOpenAI, Status: StatusActive},
		{ID: 12, Name: "second", Platform: PlatformOpenAI, Status: StatusActive, Credentials: map[string]any{"base_url": "https://second.example/v1"}},
		{ID: 13, Name: "third", Platform: PlatformOpenAI, Status: StatusActive},
	}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	view, err := svc.ListAccountMappings(context.Background(), WatchAccountMappingListRequest{
		Platform: PlatformOpenAI, Search: "second.example", MappingStatus: "needs_confirmation", SourceID: 2, Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListAccountMappings() error = %v", err)
	}
	if len(view.Accounts) != 1 || view.Accounts[0].AccountID != 12 {
		t.Fatalf("Accounts = %#v, want matching pending mapping", view.Accounts)
	}
	if view.Total != 1 || view.Page != 1 || view.Pages != 1 {
		t.Fatalf("pagination = total:%d page:%d pages:%d, want filtered total", view.Total, view.Page, view.Pages)
	}
}

func TestListAccountMappingsFiltersMappingMethodBeforePagination(t *testing.T) {
	sourceRepo := &watchPreviewSourceRepo{
		sources: []*WatchSource{{ID: 1, Name: "Source A"}},
		mappings: []WatchAccountUpstreamMapping{
			{AccountID: 11, SourceID: 1, MappingMethod: "auto", GroupBindingState: "confirmed"},
			{AccountID: 12, SourceID: 1, MappingMethod: "manual", GroupBindingState: "confirmed"},
		},
	}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{
		{ID: 11, Name: "auto", Platform: PlatformOpenAI, Status: StatusActive},
		{ID: 12, Name: "manual", Platform: PlatformOpenAI, Status: StatusActive},
	}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	view, err := svc.ListAccountMappings(context.Background(), WatchAccountMappingListRequest{
		MappingStatus: "mapped", MappingMethod: "manual", Page: 1, PageSize: 1,
	})
	if err != nil {
		t.Fatalf("ListAccountMappings() error = %v", err)
	}
	if len(view.Accounts) != 1 || view.Accounts[0].AccountID != 12 || view.Total != 1 || view.Pages != 1 {
		t.Fatalf("view = %#v, want one paginated manual mapping", view)
	}
}

func TestWatchURLHostKeyNormalizesComparableHosts(t *testing.T) {
	tests := []struct {
		raw  string
		want string
	}{
		{raw: "https://UPSTREAM.example.com:443/v1", want: "upstream.example.com"},
		{raw: "http://127.0.0.1:8080/v1", want: "127.0.0.1:8080"},
		{raw: "relay.example.com/v1", want: "relay.example.com"},
		{raw: "/v1", want: ""},
		{raw: "javascript:alert(1)", want: ""},
	}
	for _, test := range tests {
		if got := watchURLHostKey(test.raw); got != test.want {
			t.Fatalf("watchURLHostKey(%q) = %q, want %q", test.raw, got, test.want)
		}
	}
}

func TestSaveAccountMappingConfirmsCurrentSourceKeyGroupSet(t *testing.T) {
	now := time.Now().UTC()
	source := &WatchSource{ID: 1, Name: "source", Enabled: true}
	sourceRepo := &watchPreviewSourceRepo{snapshots: map[int64]*WatchSourceSnapshot{
		1: {
			Source: source,
			SourceKeys: []WatchSourceKeyObservation{{
				ExternalID: "key-a", Label: "Key A", Status: "active",
				GroupExternalIDs: []string{"g2", "g1", "g2"}, ObservedAt: now,
			}},
			Groups: []WatchSourceGroupObservation{
				{ExternalID: "g1", Name: "Group 1"},
				{ExternalID: "g2", Name: "Group 2"},
			},
		},
	}}
	accountRepo := &watchPreviewAccountRepo{accounts: []Account{{ID: 11, Name: "account", Platform: PlatformOpenAI}}}
	svc := NewWatchService(accountRepo, nil, nil, sourceRepo, nil, nil)

	_, err := svc.SaveAccountMapping(context.Background(), WatchAccountMappingInput{
		AccountID: 11, SourceID: 1, SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", MappingMethod: "manual",
	}, 7)
	if err != nil {
		t.Fatalf("SaveAccountMapping() error = %v", err)
	}
	if sourceRepo.savedMapping == nil {
		t.Fatal("SaveAccountMapping() did not persist mapping")
	}
	if sourceRepo.savedMapping.GroupBindingState != "confirmed" {
		t.Fatalf("GroupBindingState = %q, want confirmed", sourceRepo.savedMapping.GroupBindingState)
	}
	if got := strings.Join(sourceRepo.savedMapping.ConfirmedGroupExternalIDs, ","); got != "g1,g2" {
		t.Fatalf("ConfirmedGroupExternalIDs = %q, want g1,g2", got)
	}
	if sourceRepo.savedMapping.SourceKeyObservedAt == nil || !sourceRepo.savedMapping.SourceKeyObservedAt.Equal(now) {
		t.Fatalf("SourceKeyObservedAt = %v, want %v", sourceRepo.savedMapping.SourceKeyObservedAt, now)
	}
}

func TestWatchResolveMappedSourceGroupFreezesPendingConfirmation(t *testing.T) {
	key, group, reason := watchResolveMappedSourceGroup(&WatchSourceSnapshot{}, WatchAccountUpstreamMapping{
		SourceKeyExternalID: "key-a", SourceGroupExternalID: "g1", GroupBindingState: "needs_confirmation",
	})
	if key != nil || group != nil || reason != "source key group assignment changed; confirmation required" {
		t.Fatalf("watchResolveMappedSourceGroup() = (%#v, %#v, %q)", key, group, reason)
	}
}
