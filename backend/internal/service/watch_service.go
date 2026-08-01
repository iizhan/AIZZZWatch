package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
)

var (
	ErrWatchPricingFrozen       = errors.New("watch pricing is frozen")
	ErrWatchPricingConflict     = errors.New("watch pricing current value changed")
	ErrWatchPricingNotFound     = errors.New("watch pricing audit not found")
	ErrWatchIdempotencyMismatch = errors.New("watch pricing idempotency key was already used for another request")
)

const defaultWatchPricingRuleAdjustmentStep = 0.003

type WatchPriceMode string

const (
	WatchPriceModeGroupMultiplier WatchPriceMode = "group_multiplier"
	WatchPriceModeModelPrice      WatchPriceMode = "model_price"
)

type WatchPriceComponent string

const (
	WatchPriceComponentInput      WatchPriceComponent = "input"
	WatchPriceComponentOutput     WatchPriceComponent = "output"
	WatchPriceComponentPerRequest WatchPriceComponent = "per_request"
)

type WatchAccountHealth string

const (
	WatchAccountHealthAvailable WatchAccountHealth = "available"
	WatchAccountHealthBlocked   WatchAccountHealth = "blocked"
)

type WatchAccountStatus struct {
	ID             int64              `json:"id"`
	Name           string             `json:"name"`
	Platform       string             `json:"platform"`
	Health         WatchAccountHealth `json:"health"`
	Reason         string             `json:"reason,omitempty"`
	RateMultiplier float64            `json:"rate_multiplier"`
	ObservedAt     time.Time          `json:"observed_at"`
}

type WatchOverview struct {
	GeneratedAt     time.Time            `json:"generated_at"`
	Accounts        []WatchAccountStatus `json:"accounts"`
	ActiveAccounts  int                  `json:"active_accounts"`
	BlockedAccounts int                  `json:"blocked_accounts"`
	ActiveGroups    int                  `json:"active_groups"`
	ActiveChannels  int                  `json:"active_channels"`
	DetectionKind   string               `json:"detection_kind"`
}

type WatchPricingPreviewRequest struct {
	TargetGroupID  int64               `json:"target_group_id"`
	Mode           WatchPriceMode      `json:"mode"`
	Model          string              `json:"model"`
	Platform       string              `json:"platform"`
	Component      WatchPriceComponent `json:"component"`
	SourceGroupIDs []int64             `json:"source_group_ids"`
	AdjustmentStep float64             `json:"adjustment_step,omitempty"`
}

type WatchPricingCandidate struct {
	AccountID       int64     `json:"account_id,omitempty"`
	AccountName     string    `json:"account_name,omitempty"`
	SourceID        int64     `json:"source_id"`
	SourceName      string    `json:"source_name"`
	GroupID         int64     `json:"group_id,omitempty"`
	GroupExternalID string    `json:"group_external_id,omitempty"`
	GroupName       string    `json:"group_name"`
	Platform        string    `json:"platform,omitempty"`
	Value           float64   `json:"value"`
	Healthy         bool      `json:"healthy"`
	Reason          string    `json:"reason,omitempty"`
	ObservedAt      time.Time `json:"observed_at"`
}

type WatchPricingAccountCostRow struct {
	AccountID                 int64      `json:"account_id"`
	AccountName               string     `json:"account_name"`
	Platform                  string     `json:"platform"`
	SourceID                  int64      `json:"source_id,omitempty"`
	SourceName                string     `json:"source_name,omitempty"`
	SourceKeyExternalID       string     `json:"source_key_external_id,omitempty"`
	SourceKeyLabel            string     `json:"source_key_label,omitempty"`
	SourceGroupExternalID     string     `json:"source_group_external_id,omitempty"`
	SourceGroupName           string     `json:"source_group_name,omitempty"`
	SourceGroupRateMultiplier *float64   `json:"source_group_rate_multiplier,omitempty"`
	RechargeRatio             float64    `json:"recharge_ratio,omitempty"`
	EffectiveCost             *float64   `json:"effective_cost,omitempty"`
	Healthy                   bool       `json:"healthy"`
	Reason                    string     `json:"reason,omitempty"`
	ObservedAt                *time.Time `json:"observed_at,omitempty"`
}

type WatchPricingPreview struct {
	Mode          WatchPriceMode               `json:"mode"`
	Component     WatchPriceComponent          `json:"component,omitempty"`
	TargetGroupID int64                        `json:"target_group_id"`
	CurrentValue  *float64                     `json:"current_value,omitempty"`
	TargetValue   *float64                     `json:"target_value,omitempty"`
	ProposedValue *float64                     `json:"proposed_value,omitempty"`
	Candidates    []WatchPricingCandidate      `json:"candidates"`
	CostRows      []WatchPricingAccountCostRow `json:"cost_rows"`
	Frozen        bool                         `json:"frozen"`
	FreezeReason  string                       `json:"freeze_reason,omitempty"`
	GeneratedAt   time.Time                    `json:"generated_at"`
}

type WatchPricingApplyRequest struct {
	WatchPricingPreviewRequest
	ExpectedCurrentValue float64 `json:"expected_current_value"`
	ProposedValue        float64 `json:"proposed_value"`
	Confirmed            bool    `json:"confirmed"`
	IdempotencyKey       string  `json:"idempotency_key"`
}

type WatchPricingRollbackRequest struct {
	ExpectedCurrentValue float64 `json:"expected_current_value"`
	Confirmed            bool    `json:"confirmed"`
	IdempotencyKey       string  `json:"idempotency_key"`
}

type WatchService struct {
	accounts       AdminAccountRepository
	groups         GroupRepository
	channels       ChannelRepository
	sources        WatchSourceRepository
	groupService   *GroupService
	channelService *ChannelService
}

func NewWatchService(accounts AdminAccountRepository, groups GroupRepository, channels ChannelRepository, sources WatchSourceRepository, groupService *GroupService, channelService *ChannelService) *WatchService {
	return &WatchService{accounts: accounts, groups: groups, channels: channels, sources: sources, groupService: groupService, channelService: channelService}
}

func (s *WatchService) GetOverview(ctx context.Context) (*WatchOverview, error) {
	now := time.Now().UTC()
	accounts, err := s.accounts.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch accounts: %w", err)
	}
	if len(accounts) > 1000 {
		accounts = accounts[:1000]
	}
	out := &WatchOverview{GeneratedAt: now, DetectionKind: "configuration", Accounts: make([]WatchAccountStatus, 0, len(accounts))}
	for _, account := range accounts {
		health := WatchAccountHealthAvailable
		reason := ""
		if !account.IsSchedulable() {
			health = WatchAccountHealthBlocked
			reason = "account is not schedulable"
		}
		if health == WatchAccountHealthAvailable {
			out.ActiveAccounts++
		} else {
			out.BlockedAccounts++
		}
		out.Accounts = append(out.Accounts, WatchAccountStatus{ID: account.ID, Name: account.Name, Platform: account.Platform, Health: health, Reason: reason, RateMultiplier: account.BillingRateMultiplier(), ObservedAt: now})
	}
	groups, err := s.groups.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch groups: %w", err)
	}
	out.ActiveGroups = len(groups)
	channels, err := s.channels.ListAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch channels: %w", err)
	}
	for _, channel := range channels {
		if channel.IsActive() {
			out.ActiveChannels++
		}
	}
	return out, nil
}

func (s *WatchService) PreviewPricing(ctx context.Context, req WatchPricingPreviewRequest) (*WatchPricingPreview, error) {
	if req.TargetGroupID <= 0 {
		return nil, fmt.Errorf("target_group_id must be positive")
	}
	if req.Mode == "" {
		req.Mode = WatchPriceModeGroupMultiplier
	}
	if req.Mode != WatchPriceModeGroupMultiplier && req.Mode != WatchPriceModeModelPrice {
		return nil, fmt.Errorf("unsupported watch pricing mode")
	}
	if req.Mode == WatchPriceModeModelPrice && strings.TrimSpace(req.Model) == "" {
		return nil, fmt.Errorf("model is required for model price mode")
	}
	if req.Component == "" {
		req.Component = WatchPriceComponentInput
	}
	if req.Component != WatchPriceComponentInput && req.Component != WatchPriceComponentOutput && req.Component != WatchPriceComponentPerRequest {
		return nil, fmt.Errorf("unsupported price component")
	}
	if req.AdjustmentStep < 0 || math.IsNaN(req.AdjustmentStep) || math.IsInf(req.AdjustmentStep, 0) {
		return nil, fmt.Errorf("adjustment_step must be positive")
	}
	target, err := s.groups.GetByID(ctx, req.TargetGroupID)
	if err != nil {
		return nil, fmt.Errorf("load target group: %w", err)
	}
	if !target.IsActive() {
		return nil, fmt.Errorf("target group is not active")
	}
	now := time.Now().UTC()
	preview := &WatchPricingPreview{Mode: req.Mode, Component: req.Component, TargetGroupID: req.TargetGroupID, GeneratedAt: now, Candidates: []WatchPricingCandidate{}, CostRows: []WatchPricingAccountCostRow{}}
	if req.Mode == WatchPriceModeGroupMultiplier {
		current := target.RateMultiplier
		preview.CurrentValue = &current
	} else {
		if s.channels == nil {
			preview.Frozen = true
			preview.FreezeReason = "target channel repository is unavailable"
			return preview, nil
		}
		channelID, lookupErr := s.channels.GetChannelIDByGroupID(ctx, req.TargetGroupID)
		if lookupErr != nil {
			return nil, fmt.Errorf("load target channel: %w", lookupErr)
		}
		if channelID <= 0 {
			preview.Frozen = true
			preview.FreezeReason = "target group is not associated with a channel"
			return preview, nil
		}
		pricing, listErr := s.channels.ListModelPricing(ctx, channelID)
		if listErr != nil {
			return nil, fmt.Errorf("list target channel pricing: %w", listErr)
		}
		if current, found := findModelPrice(pricing, req.Platform, req.Model, req.Component); found {
			preview.CurrentValue = &current
		}
		if preview.CurrentValue == nil {
			preview.Frozen = true
			preview.FreezeReason = "current model price is unavailable"
			return preview, nil
		}
	}
	if s.sources == nil {
		preview.Frozen = true
		preview.FreezeReason = "upstream observation repository is unavailable"
		return preview, nil
	}
	costRows, freezeReason, err := s.resolveTargetPricingCostRows(ctx, req, now)
	if err != nil {
		return nil, err
	}
	preview.CostRows = costRows
	var maxCost *float64
	for _, row := range costRows {
		if row.EffectiveCost == nil {
			continue
		}
		if maxCost == nil || *row.EffectiveCost > *maxCost {
			next := *row.EffectiveCost
			maxCost = &next
		}
		observedAt := now
		if row.ObservedAt != nil {
			observedAt = *row.ObservedAt
		}
		preview.Candidates = append(preview.Candidates, WatchPricingCandidate{
			AccountID: row.AccountID, AccountName: row.AccountName,
			SourceID: row.SourceID, SourceName: row.SourceName,
			GroupExternalID: row.SourceGroupExternalID, GroupName: row.SourceGroupName,
			Platform: row.Platform, Value: *row.EffectiveCost, Healthy: row.Healthy, Reason: row.Reason,
			ObservedAt: observedAt,
		})
	}
	sort.SliceStable(preview.Candidates, func(i, j int) bool {
		if preview.Candidates[i].Healthy != preview.Candidates[j].Healthy {
			return preview.Candidates[i].Healthy
		}
		if !watchValuesEqual(preview.Candidates[i].Value, preview.Candidates[j].Value) {
			return preview.Candidates[i].Value > preview.Candidates[j].Value
		}
		if preview.Candidates[i].SourceName != preview.Candidates[j].SourceName {
			return preview.Candidates[i].SourceName < preview.Candidates[j].SourceName
		}
		return preview.Candidates[i].GroupName < preview.Candidates[j].GroupName
	})
	if freezeReason != "" {
		preview.Frozen = true
		preview.FreezeReason = freezeReason
		return preview, nil
	}
	if maxCost == nil {
		preview.Frozen = true
		preview.FreezeReason = "target group has no resolved upstream account cost"
		return preview, nil
	}
	targetValue := roundWatchPrice(*maxCost + 0.01)
	preview.TargetValue = &targetValue
	proposed := nextWatchPricingProposal(*preview.CurrentValue, targetValue, req.AdjustmentStep)
	preview.ProposedValue = &proposed
	return preview, nil
}

func (s *WatchService) ApplyPricing(ctx context.Context, req WatchPricingApplyRequest, actorUserID int64) (*WatchPriceAudit, error) {
	normalizeWatchApplyRequest(&req)
	if err := validateWatchApplyRequest(req.Confirmed, req.IdempotencyKey, req.ExpectedCurrentValue, req.ProposedValue); err != nil {
		return nil, err
	}
	if existing, err := s.sources.GetPriceAuditByIdempotencyKey(ctx, req.IdempotencyKey); err != nil {
		return nil, err
	} else if existing != nil {
		if !auditMatchesApply(existing, req) {
			return nil, ErrWatchIdempotencyMismatch
		}
		return s.resumePriceAudit(ctx, existing)
	}

	preview, err := s.PreviewPricing(ctx, req.WatchPricingPreviewRequest)
	if err != nil {
		return nil, err
	}
	audit, err := s.newApplyAudit(ctx, req, preview, actorUserID)
	if err != nil {
		return nil, err
	}
	reserved, created, err := s.sources.ReservePriceAudit(ctx, audit)
	if err != nil {
		return nil, err
	}
	if !created {
		if !auditMatchesApply(reserved, req) {
			return nil, ErrWatchIdempotencyMismatch
		}
		return s.resumePriceAudit(ctx, reserved)
	}
	if preview.Frozen {
		completed, completeErr := s.sources.CompletePriceAudit(ctx, reserved.ID, "frozen", preview.FreezeReason)
		if completeErr != nil {
			return nil, completeErr
		}
		return completed, ErrWatchPricingFrozen
	}
	if preview.CurrentValue == nil || preview.ProposedValue == nil ||
		!watchValuesEqual(*preview.CurrentValue, req.ExpectedCurrentValue) ||
		!watchValuesEqual(*preview.ProposedValue, req.ProposedValue) {
		completed, completeErr := s.sources.CompletePriceAudit(ctx, reserved.ID, "conflict", "preview values changed")
		if completeErr != nil {
			return nil, completeErr
		}
		return completed, ErrWatchPricingConflict
	}
	return s.executeReservedPriceAudit(ctx, reserved, "applied")
}

func (s *WatchService) RollbackPricing(ctx context.Context, auditID int64, req WatchPricingRollbackRequest, actorUserID int64) (*WatchPriceAudit, error) {
	if auditID <= 0 {
		return nil, ErrWatchPricingNotFound
	}
	if err := validateWatchApplyRequest(req.Confirmed, req.IdempotencyKey, req.ExpectedCurrentValue, req.ExpectedCurrentValue); err != nil {
		return nil, err
	}
	if existing, err := s.sources.GetPriceAuditByIdempotencyKey(ctx, req.IdempotencyKey); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.RollbackOfID == nil || *existing.RollbackOfID != auditID {
			return nil, ErrWatchIdempotencyMismatch
		}
		return s.resumePriceAudit(ctx, existing)
	}
	original, err := s.sources.GetPriceAudit(ctx, auditID)
	if err != nil {
		return nil, err
	}
	if original == nil || original.Action != "applied" || original.PreviousValue == nil || original.NextValue == nil {
		return nil, ErrWatchPricingNotFound
	}
	actor := actorUserID
	rollbackOf := original.ID
	audit := WatchPriceAudit{
		TargetType: original.TargetType, TargetID: original.TargetID, Mode: original.Mode,
		TargetGroupID: original.TargetGroupID,
		Component:     original.Component, PreviousValue: &req.ExpectedCurrentValue, NextValue: original.PreviousValue,
		Action: "applying", ActorUserID: &actor, IdempotencyKey: req.IdempotencyKey,
		Platform: original.Platform, Model: original.Model, RollbackOfID: &rollbackOf,
	}
	reserved, created, err := s.sources.ReservePriceAudit(ctx, audit)
	if err != nil {
		return nil, err
	}
	if !created {
		return s.resumePriceAudit(ctx, reserved)
	}
	if !watchValuesEqual(*original.NextValue, req.ExpectedCurrentValue) {
		completed, completeErr := s.sources.CompletePriceAudit(ctx, reserved.ID, "conflict", "rollback expected value does not match applied value")
		if completeErr != nil {
			return nil, completeErr
		}
		return completed, ErrWatchPricingConflict
	}
	return s.executeReservedPriceAudit(ctx, reserved, "rolled_back")
}

func (s *WatchService) ListPriceAudits(ctx context.Context, limit int) ([]WatchPriceAudit, error) {
	return s.sources.ListPriceAudits(ctx, limit)
}

type watchMappingAccountPager interface {
	ListWatchMappingAccountPage(ctx context.Context, params pagination.PaginationParams, platform string) ([]Account, *pagination.PaginationResult, error)
}

func (s *WatchService) ListAccountMappings(ctx context.Context, targetGroupID int64, platform string, page, pageSize int) (*WatchAccountMappingsView, error) {
	if s == nil || s.accounts == nil || s.sources == nil {
		return nil, fmt.Errorf("watch account mapping service is unavailable")
	}
	accounts, pageResult, err := s.listMappingAccountPage(ctx, targetGroupID, platform, page, pageSize)
	if err != nil {
		return nil, fmt.Errorf("list watch mapping accounts: %w", err)
	}
	accountIDs := make([]int64, 0, len(accounts))
	for i := range accounts {
		accountIDs = append(accountIDs, accounts[i].ID)
	}
	mappings, err := s.sources.ListAccountUpstreamMappings(ctx, accountIDs)
	if err != nil {
		return nil, fmt.Errorf("list watch account mappings: %w", err)
	}
	mappingByAccount := make(map[int64]WatchAccountUpstreamMapping, len(mappings))
	for _, mapping := range mappings {
		mappingByAccount[mapping.AccountID] = mapping
	}
	sources, err := s.sources.ListSources(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch sources for mappings: %w", err)
	}
	rows := make([]WatchAccountMappingRow, 0, len(accounts))
	for _, account := range accounts {
		row := WatchAccountMappingRow{
			AccountID: account.ID, AccountName: account.Name, Platform: account.Platform,
			Schedulable: account.IsSchedulable(), AccountBaseURL: watchPrimaryAccountBaseURL(&account),
			MappingStatus: "unmapped",
		}
		applyWatchAccountMappingParticipation(&row, account, targetGroupID)
		if mapping, ok := mappingByAccount[account.ID]; ok {
			row.Mapping = &mapping
			row.MappingStatus = "mapped"
			rows = append(rows, row)
			continue
		}
		if len(watchAccountSourceHostKeys([]Account{account})) == 0 {
			row.Reason = "account upstream base_url is not configured"
		} else if watchAccountCredentialDigest(&account) == "" {
			row.Reason = "account upstream key is not available for automatic matching"
		}
		rows = append(rows, row)
	}
	return &WatchAccountMappingsView{
		TargetGroupID: targetGroupID,
		GeneratedAt:   time.Now().UTC(),
		Accounts:      rows,
		Sources:       sources,
		Total:         pageResult.Total,
		Page:          pageResult.Page,
		PageSize:      pageResult.PageSize,
		Pages:         pageResult.Pages,
	}, nil
}

func (s *WatchService) SaveAccountMapping(ctx context.Context, input WatchAccountMappingInput, actorUserID int64) (*WatchAccountUpstreamMapping, error) {
	if s == nil || s.accounts == nil || s.sources == nil {
		return nil, fmt.Errorf("watch account mapping service is unavailable")
	}
	if input.AccountID <= 0 || input.SourceID <= 0 {
		return nil, fmt.Errorf("account_id and source_id are required")
	}
	input.SourceKeyExternalID = strings.TrimSpace(input.SourceKeyExternalID)
	input.SourceGroupExternalID = strings.TrimSpace(input.SourceGroupExternalID)
	if input.SourceKeyExternalID == "" {
		return nil, fmt.Errorf("source_key_external_id is required")
	}
	account, err := s.accounts.GetByID(ctx, input.AccountID)
	if err != nil {
		return nil, fmt.Errorf("load account for watch mapping: %w", err)
	}
	snapshot, err := s.sources.GetSourceSnapshot(ctx, input.SourceID)
	if err != nil {
		return nil, fmt.Errorf("load source snapshot for watch mapping: %w", err)
	}
	if snapshot == nil || snapshot.Source == nil {
		return nil, fmt.Errorf("source snapshot is unavailable")
	}
	key := watchFindSourceKey(snapshot.SourceKeys, input.SourceKeyExternalID)
	if key == nil {
		return nil, fmt.Errorf("source key observation is unavailable")
	}
	if input.SourceGroupExternalID != "" {
		if len(key.GroupExternalIDs) > 0 && !watchStringSliceContains(key.GroupExternalIDs, input.SourceGroupExternalID) {
			return nil, fmt.Errorf("source group is not assigned to source key")
		}
		if watchFindSourceGroup(snapshot.Groups, input.SourceGroupExternalID) == nil {
			return nil, fmt.Errorf("source group observation is unavailable")
		}
	}
	if input.SourceGroupExternalID == "" {
		_, group, reason := watchResolveMappedSourceGroup(snapshot, WatchAccountUpstreamMapping{
			SourceKeyExternalID: input.SourceKeyExternalID,
		})
		if reason != "" {
			return nil, errors.New(reason)
		}
		if group == nil {
			return nil, fmt.Errorf("source group is required")
		}
		input.SourceGroupExternalID = group.ExternalID
	}
	method := strings.TrimSpace(input.MappingMethod)
	if method == "" {
		method = "manual"
	}
	if method != "manual" && method != "auto" {
		return nil, fmt.Errorf("unsupported account upstream mapping method")
	}
	actor := actorUserID
	mapping := WatchAccountUpstreamMapping{
		AccountID: input.AccountID, AccountName: account.Name, Platform: account.Platform,
		SourceID: input.SourceID, SourceName: snapshot.Source.Name,
		SourceKeyExternalID: input.SourceKeyExternalID, SourceKeyLabel: key.Label,
		SourceGroupExternalID: input.SourceGroupExternalID, MappingMethod: method, UpdatedBy: &actor,
	}
	if input.SourceGroupExternalID != "" {
		if group := watchFindSourceGroup(snapshot.Groups, input.SourceGroupExternalID); group != nil {
			mapping.SourceGroupName = group.Name
		}
	}
	return s.sources.SaveAccountUpstreamMapping(ctx, mapping)
}

func (s *WatchService) DeleteAccountMapping(ctx context.Context, accountID int64) error {
	if accountID <= 0 {
		return fmt.Errorf("invalid account id")
	}
	if s == nil || s.sources == nil {
		return fmt.Errorf("watch account mapping service is unavailable")
	}
	return s.sources.DeleteAccountUpstreamMapping(ctx, accountID)
}

func (s *WatchService) ScanAccountMappings(ctx context.Context, req WatchAccountMappingScanRequest, loadLiveSnapshot func(context.Context, int64) (*WatchSourceSnapshot, error)) (*WatchAccountMappingScanResult, error) {
	if s == nil || s.accounts == nil || s.sources == nil || loadLiveSnapshot == nil {
		return nil, fmt.Errorf("watch account mapping scanner is unavailable")
	}
	accounts, err := s.listMappingAccounts(ctx, req.TargetGroupID, req.Platform)
	if err != nil {
		return nil, err
	}
	accountIDs := make([]int64, 0, len(accounts))
	for i := range accounts {
		accountIDs = append(accountIDs, accounts[i].ID)
	}
	mappings, err := s.sources.ListAccountUpstreamMappings(ctx, accountIDs)
	if err != nil {
		return nil, fmt.Errorf("list watch account mappings before scan: %w", err)
	}
	mappingByAccount := make(map[int64]WatchAccountUpstreamMapping, len(mappings))
	for _, mapping := range mappings {
		mappingByAccount[mapping.AccountID] = mapping
	}
	sources, err := s.sources.ListSources(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch sources for mapping scan: %w", err)
	}
	snapshotCache := map[int64]*WatchSourceSnapshot{}
	loadSnapshot := func(sourceID int64) (*WatchSourceSnapshot, error) {
		if snapshot, ok := snapshotCache[sourceID]; ok {
			return snapshot, nil
		}
		snapshot, err := loadLiveSnapshot(ctx, sourceID)
		if err != nil {
			return nil, err
		}
		snapshotCache[sourceID] = snapshot
		return snapshot, nil
	}
	result := &WatchAccountMappingScanResult{
		TargetGroupID: req.TargetGroupID,
		GeneratedAt:   time.Now().UTC(),
		Candidates:    []WatchAccountMappingCandidate{},
	}
	for _, account := range accounts {
		candidate := s.scanOneAccountMapping(ctx, account, mappingByAccount, sources, req.TargetGroupID, loadSnapshot)
		switch candidate.Status {
		case "ready":
			result.ReadyCount++
		case "needs_group", "multiple_match":
			result.AmbiguousCount++
		case "mapped":
			result.MappedCount++
		}
		result.Candidates = append(result.Candidates, candidate)
	}
	return result, nil
}

func (s *WatchService) scanOneAccountMapping(ctx context.Context, account Account, mappingByAccount map[int64]WatchAccountUpstreamMapping, sources []*WatchSource, targetGroupID int64, loadSnapshot func(int64) (*WatchSourceSnapshot, error)) WatchAccountMappingCandidate {
	_ = ctx
	out := WatchAccountMappingCandidate{
		AccountID: account.ID, AccountName: account.Name, Platform: account.Platform,
		AccountBaseURL: watchPrimaryAccountBaseURL(&account), Status: "unmatched",
	}
	applyWatchAccountMappingCandidateParticipation(&out, account, targetGroupID)
	if mapping, ok := mappingByAccount[account.ID]; ok {
		out.Status = "mapped"
		out.SourceID = mapping.SourceID
		out.SourceName = mapping.SourceName
		out.SourceKeyExternalID = mapping.SourceKeyExternalID
		out.SourceKeyLabel = mapping.SourceKeyLabel
		out.SourceGroupExternalID = mapping.SourceGroupExternalID
		out.SourceGroupName = mapping.SourceGroupName
		return out
	}
	accountHosts := watchAccountSourceHostKeys([]Account{account})
	if len(accountHosts) == 0 {
		out.Reason = "account upstream base_url is not configured"
		return out
	}
	digest := watchAccountCredentialDigest(&account)
	if digest == "" {
		out.Reason = "account upstream key is not available for automatic matching"
		return out
	}
	type match struct {
		source   *WatchSource
		snapshot *WatchSourceSnapshot
		key      WatchSourceKeyObservation
	}
	matches := make([]match, 0, 1)
	var matchedSourceCount int
	var scannedSnapshotCount int
	var observedKeyCount int
	var comparableKeyCount int
	var scanError string
	for _, source := range sources {
		if source == nil || !source.Enabled || !watchSourceMatchesAccountHosts(source, accountHosts) {
			continue
		}
		matchedSourceCount++
		snapshot, err := loadSnapshot(source.ID)
		if err != nil {
			if scanError == "" {
				scanError = "source scan failed"
			}
			continue
		}
		if snapshot == nil {
			if scanError == "" {
				scanError = "source scan failed"
			}
			continue
		}
		scannedSnapshotCount++
		for _, key := range snapshot.SourceKeys {
			observedKeyCount++
			if key.KeyDigest == "" {
				continue
			}
			comparableKeyCount++
			if key.KeyDigest != "" && watchValuesEqualString(key.KeyDigest, digest) {
				keyCopy := key
				matches = append(matches, match{source: source, snapshot: snapshot, key: keyCopy})
			}
		}
	}
	if len(matches) == 0 {
		if matchedSourceCount == 0 {
			out.Reason = "account upstream source is not configured"
		} else if scannedSnapshotCount > 0 && (observedKeyCount == 0 || comparableKeyCount == 0) {
			out.Reason = "source keys do not provide comparable key digest"
		} else if scanError != "" {
			out.Reason = scanError
		} else {
			out.Reason = "account upstream key is not mapped"
		}
		return out
	}
	if len(matches) > 1 {
		out.Status = "multiple_match"
		out.Reason = "account upstream key matches multiple source key records"
		for _, item := range matches {
			if out.SourceID == 0 {
				out.SourceID = item.source.ID
				out.SourceName = item.source.Name
			}
		}
		return out
	}
	item := matches[0]
	out.SourceID = item.source.ID
	out.SourceName = item.source.Name
	out.SourceKeyExternalID = item.key.ExternalID
	out.SourceKeyLabel = item.key.Label
	out.Groups = watchCandidateGroupsForKey(item.snapshot, item.key)
	if len(item.key.GroupExternalIDs) == 1 {
		if group := watchFindSourceGroup(item.snapshot.Groups, item.key.GroupExternalIDs[0]); group != nil {
			out.SourceGroupExternalID = group.ExternalID
			out.SourceGroupName = group.Name
			out.Status = "ready"
			return out
		}
	}
	if len(item.key.GroupExternalIDs) == 0 && len(item.snapshot.Groups) == 1 {
		group := item.snapshot.Groups[0]
		out.SourceGroupExternalID = group.ExternalID
		out.SourceGroupName = group.Name
		out.Status = "ready"
		return out
	}
	out.Status = "needs_group"
	if len(item.key.GroupExternalIDs) > 1 {
		out.Reason = "source key belongs to multiple groups; select a source group"
	} else {
		out.Reason = "source key group is ambiguous"
	}
	return out
}

func watchCandidateGroupsForKey(snapshot *WatchSourceSnapshot, key WatchSourceKeyObservation) []WatchAccountMappingCandidateGroup {
	if snapshot == nil || snapshot.Source == nil {
		return nil
	}
	groupIDs := key.GroupExternalIDs
	if len(groupIDs) == 0 {
		for _, group := range snapshot.Groups {
			groupIDs = append(groupIDs, group.ExternalID)
		}
	}
	out := make([]WatchAccountMappingCandidateGroup, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		group := watchFindSourceGroup(snapshot.Groups, groupID)
		if group == nil {
			continue
		}
		rate := group.RateMultiplier
		if group.UserRateMultiplier != nil {
			rate = *group.UserRateMultiplier
		}
		finalCost := rate
		if snapshot.Source.RechargeRatio > 0 {
			finalCost = roundWatchPrice(rate / snapshot.Source.RechargeRatio)
		}
		out = append(out, WatchAccountMappingCandidateGroup{
			ExternalID: group.ExternalID, Name: group.Name, Platform: group.Platform, FinalCost: finalCost,
		})
	}
	return out
}

func (s *WatchService) ConfirmAccountMappingBatch(ctx context.Context, req WatchAccountMappingBatchConfirmRequest, actorUserID int64) (*WatchAccountMappingBatchConfirmResult, error) {
	if !req.Confirmed {
		return nil, fmt.Errorf("explicit confirmation is required")
	}
	if len(req.Items) == 0 {
		return &WatchAccountMappingBatchConfirmResult{Saved: []WatchAccountUpstreamMapping{}, Failed: []WatchAccountMappingBatchFailure{}, UpdatedAt: time.Now().UTC()}, nil
	}
	if len(req.Items) > 100 {
		return nil, fmt.Errorf("too many watch account mappings")
	}
	result := &WatchAccountMappingBatchConfirmResult{Saved: []WatchAccountUpstreamMapping{}, Failed: []WatchAccountMappingBatchFailure{}, UpdatedAt: time.Now().UTC()}
	for _, item := range req.Items {
		if item.MappingMethod == "" {
			item.MappingMethod = "auto"
		}
		saved, err := s.SaveAccountMapping(ctx, item, actorUserID)
		if err != nil {
			result.Failed = append(result.Failed, WatchAccountMappingBatchFailure{AccountID: item.AccountID, Reason: err.Error()})
			continue
		}
		result.Saved = append(result.Saved, *saved)
	}
	return result, nil
}

func (s *WatchService) listMappingAccounts(ctx context.Context, targetGroupID int64, platform string) ([]Account, error) {
	platform = strings.TrimSpace(platform)
	accounts, err := s.accounts.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("list watch mapping accounts: %w", err)
	}
	if platform == "" {
		return accounts, nil
	}
	filtered := make([]Account, 0, len(accounts))
	for _, account := range accounts {
		if strings.EqualFold(account.Platform, platform) {
			filtered = append(filtered, account)
		}
	}
	return filtered, nil
}

func (s *WatchService) listMappingAccountPage(ctx context.Context, targetGroupID int64, platform string, page, pageSize int) ([]Account, *pagination.PaginationResult, error) {
	platform = strings.TrimSpace(platform)
	params := pagination.PaginationParams{Page: page, PageSize: pageSize, SortBy: "priority", SortOrder: pagination.SortOrderAsc}
	if pager, ok := s.accounts.(watchMappingAccountPager); ok {
		return pager.ListWatchMappingAccountPage(ctx, params, platform)
	}

	accounts, err := s.listMappingAccounts(ctx, targetGroupID, platform)
	if err != nil {
		return nil, nil, err
	}
	total := len(accounts)
	start := params.Offset()
	if start > total {
		start = total
	}
	end := start + params.Limit()
	if end > total {
		end = total
	}
	pages := 0
	if total > 0 {
		pages = (total + params.Limit() - 1) / params.Limit()
	}
	return accounts[start:end], &pagination.PaginationResult{Total: int64(total), Page: page, PageSize: params.Limit(), Pages: pages}, nil
}

func applyWatchAccountMappingParticipation(row *WatchAccountMappingRow, account Account, targetGroupID int64) {
	if row == nil {
		return
	}
	row.TargetGroupID = targetGroupID
	row.InTargetGroup = targetGroupID <= 0 || watchAccountBelongsToGroup(account, targetGroupID)
	if targetGroupID > 0 && !row.InTargetGroup {
		row.ParticipationReason = "account is not in target group"
	}
}

func applyWatchAccountMappingCandidateParticipation(candidate *WatchAccountMappingCandidate, account Account, targetGroupID int64) {
	if candidate == nil {
		return
	}
	candidate.TargetGroupID = targetGroupID
	candidate.InTargetGroup = targetGroupID <= 0 || watchAccountBelongsToGroup(account, targetGroupID)
	if targetGroupID > 0 && !candidate.InTargetGroup {
		candidate.ParticipationReason = "account is not in target group"
	}
}

func watchAccountBelongsToGroup(account Account, targetGroupID int64) bool {
	if targetGroupID <= 0 {
		return true
	}
	for _, groupID := range account.GroupIDs {
		if groupID == targetGroupID {
			return true
		}
	}
	for _, group := range account.AccountGroups {
		if group.GroupID == targetGroupID {
			return true
		}
	}
	for _, group := range account.Groups {
		if group != nil && group.ID == targetGroupID {
			return true
		}
	}
	return false
}

func (s *WatchService) ListPricingBoard(ctx context.Context, filter WatchPricingBoardFilter) (*WatchPricingBoard, error) {
	if s == nil || s.sources == nil {
		return nil, fmt.Errorf("watch pricing board repository is unavailable")
	}
	filter.Platform = strings.TrimSpace(filter.Platform)
	filter.Tag = strings.TrimSpace(filter.Tag)
	filter.Search = strings.TrimSpace(filter.Search)
	filter.ChangeKind = strings.ToLower(strings.TrimSpace(filter.ChangeKind))
	filter.InUse = strings.TrimSpace(filter.InUse)
	filter.Sort = strings.TrimSpace(filter.Sort)
	filter.Order = strings.ToLower(strings.TrimSpace(filter.Order))
	return s.sources.ListPricingBoardRows(ctx, filter)
}

func (s *WatchService) GetPricingHistory(ctx context.Context, filter WatchPricingHistoryFilter) (*WatchPricingHistory, error) {
	if s == nil || s.sources == nil {
		return nil, fmt.Errorf("watch pricing history repository is unavailable")
	}
	filter.GroupExternalID = strings.TrimSpace(filter.GroupExternalID)
	filter.Platform = strings.TrimSpace(filter.Platform)
	filter.Model = strings.TrimSpace(filter.Model)
	filter.Component = strings.TrimSpace(filter.Component)
	filter.ChangeKind = strings.ToLower(strings.TrimSpace(filter.ChangeKind))
	return s.sources.ListPricingHistory(ctx, filter)
}

func (s *WatchService) ListPricingRules(ctx context.Context) ([]WatchPricingRule, error) {
	if s == nil || s.sources == nil {
		return nil, fmt.Errorf("watch pricing rule repository is unavailable")
	}
	return s.sources.ListPricingRules(ctx)
}

func (s *WatchService) CreatePricingRule(ctx context.Context, input WatchPricingRuleInput, actorUserID int64) (*WatchPricingRule, error) {
	rule, err := s.preparePricingRule(ctx, input)
	if err != nil {
		return nil, err
	}
	actor := actorUserID
	rule.CreatedBy = &actor
	rule.UpdatedBy = &actor
	return s.sources.CreatePricingRule(ctx, *rule)
}

func (s *WatchService) UpdatePricingRule(ctx context.Context, id int64, input WatchPricingRuleInput, actorUserID int64) (*WatchPricingRule, error) {
	if id <= 0 {
		return nil, ErrWatchPricingRuleNotFound
	}
	rule, err := s.preparePricingRule(ctx, input)
	if err != nil {
		return nil, err
	}
	actor := actorUserID
	rule.ID = id
	rule.UpdatedBy = &actor
	return s.sources.UpdatePricingRule(ctx, *rule)
}

func (s *WatchService) DeletePricingRule(ctx context.Context, id int64) error {
	if id <= 0 {
		return ErrWatchPricingRuleNotFound
	}
	if s == nil || s.sources == nil {
		return fmt.Errorf("watch pricing rule repository is unavailable")
	}
	return s.sources.DeletePricingRule(ctx, id)
}

func (s *WatchService) RunPricingRule(ctx context.Context, id int64, actorUserID int64) (*WatchPricingRuleRunResult, error) {
	if id <= 0 {
		return nil, ErrWatchPricingRuleNotFound
	}
	if s == nil || s.sources == nil {
		return nil, fmt.Errorf("watch pricing rule repository is unavailable")
	}
	rule, err := s.sources.ClaimPricingRuleRun(ctx, id, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return s.executePricingRuleRun(ctx, rule, actorUserID)
}

func (s *WatchService) ClaimDuePricingRules(ctx context.Context, limit int) ([]WatchPricingRule, error) {
	if s == nil || s.sources == nil {
		return nil, fmt.Errorf("watch pricing rule repository is unavailable")
	}
	return s.sources.ClaimDuePricingRules(ctx, time.Now().UTC(), limit)
}

func (s *WatchService) RunClaimedPricingRule(ctx context.Context, rule WatchPricingRule) (*WatchPricingRuleRunResult, error) {
	return s.executePricingRuleRun(ctx, &rule, 0)
}

func (s *WatchService) preparePricingRule(ctx context.Context, input WatchPricingRuleInput) (*WatchPricingRule, error) {
	if s == nil || s.sources == nil || s.groups == nil {
		return nil, fmt.Errorf("watch pricing service is unavailable")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 100 {
		return nil, fmt.Errorf("watch pricing rule name must contain 1 to 100 characters")
	}
	if input.TargetGroupID <= 0 {
		return nil, fmt.Errorf("target_group_id must be positive")
	}
	target, err := s.groups.GetByID(ctx, input.TargetGroupID)
	if err != nil {
		return nil, fmt.Errorf("load target group: %w", err)
	}
	if !target.IsActive() {
		return nil, fmt.Errorf("target group is not active")
	}
	mode := input.Mode
	if mode == "" {
		mode = WatchPriceModeGroupMultiplier
	}
	if mode != WatchPriceModeGroupMultiplier && mode != WatchPriceModeModelPrice {
		return nil, fmt.Errorf("unsupported watch pricing mode")
	}
	component := input.Component
	if component == "" {
		component = WatchPriceComponentInput
	}
	if component != WatchPriceComponentInput && component != WatchPriceComponentOutput && component != WatchPriceComponentPerRequest {
		return nil, fmt.Errorf("unsupported price component")
	}
	platform := strings.TrimSpace(input.Platform)
	model := strings.TrimSpace(input.Model)
	if mode == WatchPriceModeModelPrice && model == "" {
		return nil, fmt.Errorf("model is required for model price mode")
	}
	if mode == WatchPriceModeGroupMultiplier {
		model = ""
		component = WatchPriceComponentInput
	}
	interval := input.IntervalSeconds
	if interval == 0 {
		interval = 300
	}
	if interval < 60 || interval > 86400 {
		return nil, fmt.Errorf("interval_seconds must be between 60 and 86400")
	}
	adjustmentStep := input.AdjustmentStep
	if adjustmentStep == 0 {
		adjustmentStep = defaultWatchPricingRuleAdjustmentStep
	}
	if adjustmentStep <= 0 || math.IsNaN(adjustmentStep) || math.IsInf(adjustmentStep, 0) {
		return nil, fmt.Errorf("adjustment_step must be positive")
	}
	adjustmentStep = roundWatchPrice(adjustmentStep)
	if adjustmentStep <= 0 {
		return nil, fmt.Errorf("adjustment_step must be positive")
	}
	return &WatchPricingRule{
		Name: name, TargetGroupID: input.TargetGroupID, Mode: mode, Platform: platform, Model: model,
		Component: component, Enabled: input.Enabled, IntervalSeconds: interval, AdjustmentStep: adjustmentStep,
	}, nil
}

func (s *WatchService) executePricingRuleRun(ctx context.Context, rule *WatchPricingRule, actorUserID int64) (*WatchPricingRuleRunResult, error) {
	result := &WatchPricingRuleRunResult{Rule: rule, Status: "failed", ErrorCode: "unknown"}
	if rule == nil || rule.ID <= 0 {
		return result, ErrWatchPricingRuleNotFound
	}
	adjustmentStep := rule.AdjustmentStep
	if adjustmentStep <= 0 {
		adjustmentStep = defaultWatchPricingRuleAdjustmentStep
	}
	previewReq := WatchPricingPreviewRequest{
		TargetGroupID: rule.TargetGroupID, Mode: rule.Mode, Platform: rule.Platform,
		Model: rule.Model, Component: rule.Component, AdjustmentStep: adjustmentStep,
	}
	preview, err := s.PreviewPricing(ctx, previewReq)
	result.Preview = preview
	if err != nil {
		return s.finishPricingRuleRun(ctx, rule, result, "failed", "preview_failed")
	}
	if preview == nil || preview.Frozen || preview.CurrentValue == nil || preview.ProposedValue == nil {
		code := "frozen"
		if preview != nil && preview.FreezeReason != "" {
			code = preview.FreezeReason
		}
		return s.finishPricingRuleRun(ctx, rule, result, "frozen", code)
	}
	if watchValuesEqual(*preview.CurrentValue, *preview.ProposedValue) {
		return s.finishPricingRuleRun(ctx, rule, result, "skipped", "")
	}
	applyReq := WatchPricingApplyRequest{
		WatchPricingPreviewRequest: previewReq,
		ExpectedCurrentValue:       *preview.CurrentValue,
		ProposedValue:              *preview.ProposedValue,
		Confirmed:                  true,
		IdempotencyKey:             fmt.Sprintf("watch-pricing-rule:%d:%d", rule.ID, rule.RunSequence),
	}
	audit, applyErr := s.ApplyPricing(ctx, applyReq, actorUserID)
	result.Audit = audit
	switch {
	case applyErr == nil:
		return s.finishPricingRuleRun(ctx, rule, result, "applied", "")
	case errors.Is(applyErr, ErrWatchPricingFrozen):
		return s.finishPricingRuleRun(ctx, rule, result, "frozen", "pricing_frozen")
	case errors.Is(applyErr, ErrWatchPricingConflict):
		return s.finishPricingRuleRun(ctx, rule, result, "conflict", "pricing_conflict")
	case errors.Is(applyErr, ErrWatchIdempotencyMismatch):
		return s.finishPricingRuleRun(ctx, rule, result, "failed", "idempotency_mismatch")
	default:
		return s.finishPricingRuleRun(ctx, rule, result, "failed", "apply_failed")
	}
}

func (s *WatchService) finishPricingRuleRun(ctx context.Context, rule *WatchPricingRule, result *WatchPricingRuleRunResult, status, errorCode string) (*WatchPricingRuleRunResult, error) {
	result.Status = status
	result.ErrorCode = errorCode
	if s == nil || s.sources == nil || rule == nil {
		return result, nil
	}
	updated, err := s.sources.FinishPricingRuleRun(ctx, rule.ID, rule.RunSequence, status, errorCode)
	if err != nil {
		return result, err
	}
	result.Rule = updated
	return result, nil
}

func (s *WatchService) newApplyAudit(ctx context.Context, req WatchPricingApplyRequest, preview *WatchPricingPreview, actorUserID int64) (WatchPriceAudit, error) {
	audit := WatchPriceAudit{
		TargetType: "group", TargetID: req.TargetGroupID, Mode: req.Mode, Component: req.Component,
		TargetGroupID: req.TargetGroupID,
		PreviousValue: &req.ExpectedCurrentValue, NextValue: &req.ProposedValue, Action: "applying",
		IdempotencyKey: req.IdempotencyKey,
		Platform:       strings.TrimSpace(req.Platform), Model: strings.TrimSpace(req.Model),
	}
	if actorUserID > 0 {
		actor := actorUserID
		audit.ActorUserID = &actor
	}
	for i := range preview.Candidates {
		if preview.Candidates[i].Healthy {
			candidate := &preview.Candidates[i]
			audit.CandidateSourceID = &candidate.SourceID
			audit.CandidateGroupExternalID = candidate.GroupExternalID
			break
		}
	}
	if req.Mode == WatchPriceModeModelPrice {
		channelID, err := s.channels.GetChannelIDByGroupID(ctx, req.TargetGroupID)
		if err != nil {
			return WatchPriceAudit{}, fmt.Errorf("load target channel: %w", err)
		}
		if channelID <= 0 {
			return WatchPriceAudit{}, fmt.Errorf("target group is not associated with a channel")
		}
		audit.TargetType = "channel"
		audit.TargetID = channelID
	}
	return audit, nil
}

func (s *WatchService) resumePriceAudit(ctx context.Context, audit *WatchPriceAudit) (*WatchPriceAudit, error) {
	switch audit.Action {
	case "applied", "rolled_back":
		return audit, nil
	case "frozen":
		return audit, ErrWatchPricingFrozen
	case "conflict":
		return audit, ErrWatchPricingConflict
	case "failed":
		return audit, fmt.Errorf("watch pricing operation previously failed")
	case "applying":
		if audit.NextValue == nil || audit.PreviousValue == nil {
			return nil, fmt.Errorf("incomplete watch price audit")
		}
		current, found, err := s.currentAuditValue(ctx, audit)
		if err != nil {
			return nil, err
		}
		if found && watchValuesEqual(current, *audit.NextValue) {
			terminal := "applied"
			if audit.RollbackOfID != nil {
				terminal = "rolled_back"
			}
			return s.sources.CompletePriceAudit(ctx, audit.ID, terminal, "reconciled after retry")
		}
		if !found || !watchValuesEqual(current, *audit.PreviousValue) {
			completed, completeErr := s.sources.CompletePriceAudit(ctx, audit.ID, "conflict", "current value changed while retrying")
			if completeErr != nil {
				return nil, completeErr
			}
			return completed, ErrWatchPricingConflict
		}
		terminal := "applied"
		if audit.RollbackOfID != nil {
			terminal = "rolled_back"
		}
		return s.executeReservedPriceAudit(ctx, audit, terminal)
	default:
		return nil, fmt.Errorf("unsupported watch price audit action")
	}
}

func (s *WatchService) executeReservedPriceAudit(ctx context.Context, audit *WatchPriceAudit, terminal string) (*WatchPriceAudit, error) {
	if audit.PreviousValue == nil || audit.NextValue == nil || s.groupService == nil || s.channelService == nil {
		return nil, fmt.Errorf("watch pricing writer is unavailable")
	}
	var swapped bool
	var err error
	if audit.Mode == WatchPriceModeGroupMultiplier {
		_, swapped, err = s.groupService.CompareAndSwapRateMultiplier(ctx, audit.TargetID, *audit.PreviousValue, *audit.NextValue)
	} else {
		_, swapped, err = s.channelService.CompareAndSwapModelPrice(ctx, audit.TargetID, audit.Platform, audit.Model, string(audit.Component), *audit.PreviousValue, *audit.NextValue)
	}
	if err != nil {
		completed, completeErr := s.sources.CompletePriceAudit(ctx, audit.ID, "failed", "official service write failed")
		if completeErr != nil {
			return nil, completeErr
		}
		return completed, err
	}
	if !swapped {
		current, found, readErr := s.currentAuditValue(ctx, audit)
		if readErr == nil && found && watchValuesEqual(current, *audit.NextValue) {
			return s.sources.CompletePriceAudit(ctx, audit.ID, terminal, "reconciled concurrent retry")
		}
		completed, completeErr := s.sources.CompletePriceAudit(ctx, audit.ID, "conflict", "current value changed before write")
		if completeErr != nil {
			return nil, completeErr
		}
		return completed, ErrWatchPricingConflict
	}
	return s.sources.CompletePriceAudit(ctx, audit.ID, terminal, "")
}

func (s *WatchService) currentAuditValue(ctx context.Context, audit *WatchPriceAudit) (float64, bool, error) {
	if audit.Mode == WatchPriceModeGroupMultiplier {
		group, err := s.groupService.GetByID(ctx, audit.TargetID)
		if err != nil {
			return 0, false, err
		}
		return group.RateMultiplier, true, nil
	}
	channel, err := s.channelService.GetByID(ctx, audit.TargetID)
	if err != nil {
		return 0, false, err
	}
	value, found := findModelPrice(channel.ModelPricing, audit.Platform, audit.Model, audit.Component)
	return value, found, nil
}

func validateWatchApplyRequest(confirmed bool, key string, values ...float64) error {
	if !confirmed {
		return fmt.Errorf("explicit confirmation is required")
	}
	key = strings.TrimSpace(key)
	if len(key) < 8 || len(key) > 128 {
		return fmt.Errorf("idempotency key must contain 8 to 128 characters")
	}
	for _, r := range key {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' && r != ':' {
			return fmt.Errorf("idempotency key contains unsupported characters")
		}
	}
	for _, value := range values {
		if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("watch pricing values must be finite and non-negative")
		}
	}
	return nil
}

func normalizeWatchApplyRequest(req *WatchPricingApplyRequest) {
	if req.Mode == "" {
		req.Mode = WatchPriceModeGroupMultiplier
	}
	if req.Component == "" {
		req.Component = WatchPriceComponentInput
	}
	req.Platform = strings.TrimSpace(req.Platform)
	req.Model = strings.TrimSpace(req.Model)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
}

func auditMatchesApply(audit *WatchPriceAudit, req WatchPricingApplyRequest) bool {
	return audit != nil && audit.RollbackOfID == nil && audit.TargetGroupID == req.TargetGroupID && audit.Mode == req.Mode &&
		audit.Component == req.Component && audit.PreviousValue != nil && audit.NextValue != nil &&
		watchValuesEqual(*audit.PreviousValue, req.ExpectedCurrentValue) && watchValuesEqual(*audit.NextValue, req.ProposedValue) &&
		strings.EqualFold(audit.Platform, strings.TrimSpace(req.Platform)) && strings.EqualFold(audit.Model, strings.TrimSpace(req.Model))
}

func watchValuesEqual(left, right float64) bool {
	return math.Abs(left-right) < 0.000000005
}

func nextWatchPricingProposal(current, target, step float64) float64 {
	target = roundWatchPrice(target)
	current = roundWatchPrice(current)
	if step <= 0 || math.IsNaN(step) || math.IsInf(step, 0) || watchValuesEqual(current, target) {
		return target
	}
	step = roundWatchPrice(step)
	if current < target {
		next := roundWatchPrice(current + step)
		if next > target || watchValuesEqual(next, target) {
			return target
		}
		return next
	}
	next := roundWatchPrice(current - step)
	if next < target || watchValuesEqual(next, target) {
		return target
	}
	return next
}

func pricingCandidateFromObservation(observation WatchPricingObservation, req WatchPricingPreviewRequest, now time.Time) WatchPricingCandidate {
	candidate := WatchPricingCandidate{SourceID: observation.SourceID, SourceName: observation.SourceName, GroupExternalID: observation.GroupExternalID, GroupName: observation.GroupName, Platform: observation.Platform, ObservedAt: observation.ObservedAt}
	if observation.Status != "healthy" {
		candidate.Reason = observation.ErrorCode
		if candidate.Reason == "" {
			candidate.Reason = "source is not healthy"
		}
		return candidate
	}
	if observation.ExpiresAt == nil || !observation.ExpiresAt.After(now) {
		candidate.Reason = "observation expired"
		return candidate
	}
	if observation.LastBalance != nil && *observation.LastBalance < observation.BalanceMinimum {
		candidate.Reason = "low_balance"
		return candidate
	}
	if req.Platform != "" && !strings.EqualFold(strings.TrimSpace(req.Platform), strings.TrimSpace(observation.Platform)) {
		candidate.Reason = "platform mismatch"
		return candidate
	}
	if observation.Value == nil || *observation.Value < 0 || math.IsNaN(*observation.Value) || math.IsInf(*observation.Value, 0) {
		if req.Mode == WatchPriceModeModelPrice {
			candidate.Reason = "model price unavailable"
		} else {
			candidate.Reason = "multiplier unavailable"
		}
		return candidate
	}
	candidate.Value = *observation.Value
	candidate.Healthy = true
	return candidate
}

func (s *WatchService) resolveTargetPricingCostRows(ctx context.Context, req WatchPricingPreviewRequest, now time.Time) ([]WatchPricingAccountCostRow, string, error) {
	if s == nil || s.accounts == nil {
		return nil, "target account repository is unavailable", nil
	}
	if s.sources == nil {
		return nil, "upstream observation repository is unavailable", nil
	}
	platform := strings.TrimSpace(req.Platform)
	var (
		accounts []Account
		err      error
	)
	if platform != "" {
		accounts, err = s.accounts.ListSchedulableByGroupIDAndPlatform(ctx, req.TargetGroupID, platform)
	} else {
		accounts, err = s.accounts.ListSchedulableByGroupID(ctx, req.TargetGroupID)
	}
	if err != nil {
		return nil, "", fmt.Errorf("list target group schedulable accounts: %w", err)
	}
	if len(accounts) == 0 {
		return []WatchPricingAccountCostRow{}, "target group has no schedulable accounts", nil
	}
	accountIDs := make([]int64, 0, len(accounts))
	for i := range accounts {
		accountIDs = append(accountIDs, accounts[i].ID)
	}
	mappings, err := s.sources.ListAccountUpstreamMappings(ctx, accountIDs)
	if err != nil {
		return nil, "", fmt.Errorf("list watch account upstream mappings: %w", err)
	}
	mappingByAccount := make(map[int64]WatchAccountUpstreamMapping, len(mappings))
	for _, mapping := range mappings {
		mappingByAccount[mapping.AccountID] = mapping
	}
	sources, err := s.sources.ListSources(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("list watch sources for account pricing scope: %w", err)
	}
	sourceByID := make(map[int64]*WatchSource, len(sources))
	for _, source := range sources {
		if source != nil {
			sourceByID[source.ID] = source
		}
	}
	snapshotCache := make(map[int64]*WatchSourceSnapshot)
	loadSnapshot := func(sourceID int64) (*WatchSourceSnapshot, error) {
		if snapshot, ok := snapshotCache[sourceID]; ok {
			return snapshot, nil
		}
		snapshot, err := s.sources.GetSourceSnapshot(ctx, sourceID)
		if err != nil {
			return nil, fmt.Errorf("load watch source snapshot: %w", err)
		}
		snapshotCache[sourceID] = snapshot
		return snapshot, nil
	}

	rows := make([]WatchPricingAccountCostRow, 0, len(accounts))
	firstFreezeReason := ""
	for _, account := range accounts {
		row := WatchPricingAccountCostRow{
			AccountID: account.ID, AccountName: account.Name, Platform: account.Platform,
		}
		mapping, mapped := mappingByAccount[account.ID]
		if !mapped {
			row.Reason = "account upstream key is not mapped"
			if firstFreezeReason == "" {
				firstFreezeReason = row.Reason
			}
			rows = append(rows, row)
			continue
		}
		row.SourceID = mapping.SourceID
		row.SourceName = mapping.SourceName
		if row.SourceName == "" && sourceByID[mapping.SourceID] != nil {
			row.SourceName = sourceByID[mapping.SourceID].Name
		}
		row.SourceKeyExternalID = mapping.SourceKeyExternalID
		row.SourceKeyLabel = mapping.SourceKeyLabel
		row.SourceGroupExternalID = mapping.SourceGroupExternalID
		row.SourceGroupName = mapping.SourceGroupName

		snapshot, err := loadSnapshot(mapping.SourceID)
		if err != nil {
			return nil, "", err
		}
		if reason := watchSourceSnapshotFreezeReason(snapshot, now); reason != "" {
			row.Reason = reason
			if firstFreezeReason == "" {
				firstFreezeReason = reason
			}
			rows = append(rows, row)
			continue
		}
		key, group, reason := watchResolveMappedSourceGroup(snapshot, mapping)
		if key != nil && row.SourceKeyLabel == "" {
			row.SourceKeyLabel = key.Label
		}
		if group != nil {
			row.SourceGroupExternalID = group.ExternalID
			row.SourceGroupName = group.Name
			observedAt := group.ObservedAt
			row.ObservedAt = &observedAt
		}
		if reason != "" {
			row.Reason = reason
			if firstFreezeReason == "" {
				firstFreezeReason = reason
			}
			rows = append(rows, row)
			continue
		}
		if snapshot.Source == nil || snapshot.Source.RechargeRatio <= 0 || math.IsNaN(snapshot.Source.RechargeRatio) || math.IsInf(snapshot.Source.RechargeRatio, 0) {
			row.Reason = "source recharge ratio is invalid"
			if firstFreezeReason == "" {
				firstFreezeReason = row.Reason
			}
			rows = append(rows, row)
			continue
		}
		row.RechargeRatio = snapshot.Source.RechargeRatio
		effectiveCost, groupRate, observedAt, reason := watchResolveEffectiveAccountCost(snapshot, group.ExternalID, account.Platform, req)
		if reason != "" {
			row.Reason = reason
			if firstFreezeReason == "" {
				firstFreezeReason = reason
			}
			rows = append(rows, row)
			continue
		}
		row.EffectiveCost = &effectiveCost
		row.SourceGroupRateMultiplier = &groupRate
		row.ObservedAt = &observedAt
		row.Healthy = true
		rows = append(rows, row)
	}
	if firstFreezeReason != "" {
		return rows, firstFreezeReason, nil
	}
	return rows, "", nil
}

func (s *WatchService) resolveAutoAccountMapping(ctx context.Context, account Account, sources []*WatchSource, loadSnapshot func(int64) (*WatchSourceSnapshot, error)) (*WatchAccountUpstreamMapping, string, error) {
	_ = ctx
	accountHosts := watchAccountSourceHostKeys([]Account{account})
	if len(accountHosts) == 0 {
		return nil, "account upstream base_url is not configured", nil
	}
	digest := watchAccountCredentialDigest(&account)
	if digest == "" {
		return nil, "account upstream key is not available for automatic matching", nil
	}
	matchedSourceCount := 0
	candidates := make([]WatchAccountUpstreamMapping, 0, 1)
	for _, source := range sources {
		if source == nil || !source.Enabled || !watchSourceMatchesAccountHosts(source, accountHosts) {
			continue
		}
		matchedSourceCount++
		snapshot, err := loadSnapshot(source.ID)
		if err != nil {
			return nil, "", err
		}
		for _, key := range snapshot.SourceKeys {
			if key.KeyDigest != "" && watchValuesEqualString(key.KeyDigest, digest) {
				candidates = append(candidates, WatchAccountUpstreamMapping{
					AccountID: account.ID, AccountName: account.Name, Platform: account.Platform,
					SourceID: source.ID, SourceName: source.Name, SourceKeyExternalID: key.ExternalID,
					SourceKeyLabel: key.Label, MappingMethod: "auto",
				})
			}
		}
	}
	if len(candidates) == 1 {
		return &candidates[0], "", nil
	}
	if len(candidates) > 1 {
		return nil, "account upstream key matches multiple source key records", nil
	}
	if matchedSourceCount == 0 {
		return nil, "account upstream source is not configured", nil
	}
	return nil, "account upstream key is not mapped", nil
}

func watchSourceSnapshotFreezeReason(snapshot *WatchSourceSnapshot, now time.Time) string {
	if snapshot == nil || snapshot.Source == nil {
		return "source snapshot is unavailable"
	}
	if !snapshot.Source.Enabled {
		return "source is disabled"
	}
	if snapshot.Source.LastCheckStatus != "healthy" {
		if snapshot.Source.LastErrorCode != "" {
			return snapshot.Source.LastErrorCode
		}
		if snapshot.Source.LastCheckStatus == "" {
			return "source has not been checked"
		}
		return "source is not healthy"
	}
	if snapshot.Check == nil || !snapshot.Check.ExpiresAt.After(now) {
		return "observation expired"
	}
	if snapshot.Source.LastBalance != nil && *snapshot.Source.LastBalance < snapshot.Source.LowBalanceThreshold {
		return "low_balance"
	}
	return ""
}

func watchResolveMappedSourceGroup(snapshot *WatchSourceSnapshot, mapping WatchAccountUpstreamMapping) (*WatchSourceKeyObservation, *WatchSourceGroupObservation, string) {
	key := watchFindSourceKey(snapshot.SourceKeys, mapping.SourceKeyExternalID)
	if key == nil {
		return nil, nil, "source key observation is unavailable"
	}
	if reason := watchSourceKeyFreezeReason(key.Status); reason != "" {
		return key, nil, reason
	}
	groupID := strings.TrimSpace(mapping.SourceGroupExternalID)
	if groupID != "" {
		if len(key.GroupExternalIDs) > 0 && !watchStringSliceContains(key.GroupExternalIDs, groupID) {
			return key, nil, "mapped source group is not assigned to source key"
		}
		group := watchFindSourceGroup(snapshot.Groups, groupID)
		if group == nil {
			return key, nil, "mapped source group observation is unavailable"
		}
		return key, group, ""
	}
	if len(key.GroupExternalIDs) == 1 {
		group := watchFindSourceGroup(snapshot.Groups, key.GroupExternalIDs[0])
		if group == nil {
			return key, nil, "source key group observation is unavailable"
		}
		return key, group, ""
	}
	if len(key.GroupExternalIDs) > 1 {
		return key, nil, "source key belongs to multiple groups; select a source group"
	}
	if len(snapshot.Groups) == 1 {
		return key, &snapshot.Groups[0], ""
	}
	return key, nil, "source key group is ambiguous"
}

func watchResolveEffectiveAccountCost(snapshot *WatchSourceSnapshot, groupExternalID, accountPlatform string, req WatchPricingPreviewRequest) (float64, float64, time.Time, string) {
	group := watchFindSourceGroup(snapshot.Groups, groupExternalID)
	if group == nil {
		return 0, 0, time.Time{}, "source group observation is unavailable"
	}
	groupRate := group.RateMultiplier
	if group.UserRateMultiplier != nil {
		groupRate = *group.UserRateMultiplier
	}
	if groupRate < 0 || math.IsNaN(groupRate) || math.IsInf(groupRate, 0) {
		return 0, 0, time.Time{}, "source group multiplier is invalid"
	}
	if req.Mode == WatchPriceModeModelPrice {
		model := strings.TrimSpace(req.Model)
		component := string(req.Component)
		platform := strings.TrimSpace(req.Platform)
		if platform == "" {
			platform = strings.TrimSpace(accountPlatform)
		}
		for _, price := range snapshot.Prices {
			if price.GroupExternalID != groupExternalID || !strings.EqualFold(price.Model, model) || price.Component != component {
				continue
			}
			if platform != "" && !strings.EqualFold(platform, price.Platform) {
				continue
			}
			if price.Value < 0 || math.IsNaN(price.Value) || math.IsInf(price.Value, 0) {
				return 0, groupRate, time.Time{}, "source model price is invalid"
			}
			return roundWatchPrice(price.Value / snapshot.Source.RechargeRatio), groupRate, price.ObservedAt, ""
		}
		return 0, groupRate, time.Time{}, "source model price is unavailable"
	}
	return roundWatchPrice(groupRate / snapshot.Source.RechargeRatio), groupRate, group.ObservedAt, ""
}

func watchSourceKeyFreezeReason(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "active", "enabled", "enable", "normal", "ok", "true", "1":
		return ""
	case "disabled", "disable", "inactive", "paused", "stopped", "false", "0":
		return "source key is not active"
	default:
		return ""
	}
}

func watchFindSourceKey(keys []WatchSourceKeyObservation, externalID string) *WatchSourceKeyObservation {
	externalID = strings.TrimSpace(externalID)
	for i := range keys {
		if strings.TrimSpace(keys[i].ExternalID) == externalID {
			return &keys[i]
		}
	}
	return nil
}

func watchFindSourceGroup(groups []WatchSourceGroupObservation, externalID string) *WatchSourceGroupObservation {
	externalID = strings.TrimSpace(externalID)
	for i := range groups {
		if strings.TrimSpace(groups[i].ExternalID) == externalID {
			return &groups[i]
		}
	}
	return nil
}

func watchStringSliceContains(values []string, target string) bool {
	target = strings.TrimSpace(target)
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}

func watchSourceMatchesAccountHosts(source *WatchSource, accountHosts map[string]struct{}) bool {
	if source == nil || len(accountHosts) == 0 {
		return false
	}
	for _, rawURL := range []string{source.BaseURL, source.APIBaseURL} {
		if _, ok := accountHosts[watchURLHostKey(rawURL)]; ok {
			return true
		}
	}
	return false
}

func watchPrimaryAccountBaseURL(account *Account) string {
	for _, rawURL := range watchExplicitAccountBaseURLs(account) {
		if strings.TrimSpace(rawURL) != "" {
			return strings.TrimSpace(rawURL)
		}
	}
	return ""
}

func watchAccountCredentialDigest(account *Account) string {
	if account == nil {
		return ""
	}
	for _, key := range []string{"api_key", "upstream_key", "upstreamKey", "provider_key", "providerKey", "access_key", "accessKey", "key"} {
		value := strings.TrimSpace(account.GetCredential(key))
		if len(value) >= 8 && len(value) <= 4096 {
			sum := sha256.Sum256([]byte(value))
			return fmt.Sprintf("%x", sum)
		}
	}
	return ""
}

func watchValuesEqualString(left, right string) bool {
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

func (s *WatchService) resolveTargetPricingSourceIDs(ctx context.Context, req WatchPricingPreviewRequest) (map[int64]struct{}, string, error) {
	if s == nil || s.accounts == nil {
		return nil, "target account repository is unavailable", nil
	}
	if s.sources == nil {
		return nil, "upstream observation repository is unavailable", nil
	}
	platform := strings.TrimSpace(req.Platform)
	var (
		accounts []Account
		err      error
	)
	if platform != "" {
		accounts, err = s.accounts.ListSchedulableByGroupIDAndPlatform(ctx, req.TargetGroupID, platform)
	} else {
		accounts, err = s.accounts.ListSchedulableByGroupID(ctx, req.TargetGroupID)
	}
	if err != nil {
		return nil, "", fmt.Errorf("list target group schedulable accounts: %w", err)
	}
	if len(accounts) == 0 {
		return nil, "target group has no schedulable accounts", nil
	}
	accountHosts := watchAccountSourceHostKeys(accounts)
	if len(accountHosts) == 0 {
		return nil, "target group has no account upstream base_url", nil
	}
	sources, err := s.sources.ListSources(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("list watch sources for target pricing scope: %w", err)
	}
	allowed := make(map[int64]struct{})
	for _, source := range sources {
		if source == nil || !source.Enabled {
			continue
		}
		for _, rawURL := range []string{source.BaseURL, source.APIBaseURL} {
			if _, ok := accountHosts[watchURLHostKey(rawURL)]; ok {
				allowed[source.ID] = struct{}{}
				break
			}
		}
	}
	if len(allowed) == 0 {
		return nil, "target group has no matched watch upstream source", nil
	}
	return allowed, "", nil
}

func watchAccountSourceHostKeys(accounts []Account) map[string]struct{} {
	out := make(map[string]struct{})
	for i := range accounts {
		for _, rawURL := range watchExplicitAccountBaseURLs(&accounts[i]) {
			if key := watchURLHostKey(rawURL); key != "" {
				out[key] = struct{}{}
			}
		}
	}
	return out
}

func watchExplicitAccountBaseURLs(account *Account) []string {
	if account == nil {
		return nil
	}
	candidates := []string{
		account.GetCredential("base_url"),
		account.GetCredential("api_base_url"),
	}
	if account.IsCustomBaseURLEnabled() {
		candidates = append(candidates, account.GetCustomBaseURL())
	}
	return candidates
}

func watchURLHostKey(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || (strings.HasPrefix(rawURL, "/") && !strings.HasPrefix(rawURL, "//")) {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		parsed, err = url.Parse("https://" + strings.TrimLeft(rawURL, "/"))
		if err != nil || parsed.Host == "" {
			return ""
		}
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return ""
	}
	port := parsed.Port()
	scheme := strings.ToLower(parsed.Scheme)
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		return host + ":" + port
	}
	return host
}

func (s *WatchService) resolveSourceGroups(ctx context.Context, requested []int64, targetID int64) ([]int64, error) {
	if len(requested) > 100 {
		return nil, fmt.Errorf("source_group_ids exceeds limit")
	}
	if len(requested) > 0 {
		out := make([]int64, 0, len(requested))
		seen := make(map[int64]struct{}, len(requested))
		for _, id := range requested {
			if id > 0 && id != targetID {
				if _, ok := seen[id]; !ok {
					seen[id] = struct{}{}
					out = append(out, id)
				}
			}
		}
		return out, nil
	}
	groups, err := s.groups.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("list source groups: %w", err)
	}
	out := make([]int64, 0, len(groups))
	for _, group := range groups {
		if group.ID != targetID {
			out = append(out, group.ID)
		}
		if len(out) == 100 {
			break
		}
	}
	return out, nil
}

func findModelPrice(pricing []ChannelModelPricing, platform, model string, component WatchPriceComponent) (float64, bool) {
	for _, item := range pricing {
		if platform != "" && !strings.EqualFold(platform, item.Platform) {
			continue
		}
		matched := false
		for _, name := range item.Models {
			if strings.EqualFold(strings.TrimSpace(name), strings.TrimSpace(model)) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		var value *float64
		switch component {
		case WatchPriceComponentOutput:
			value = item.OutputPrice
		case WatchPriceComponentPerRequest:
			value = item.PerRequestPrice
		default:
			value = item.InputPrice
		}
		if value != nil && *value >= 0 && !math.IsNaN(*value) && !math.IsInf(*value, 0) {
			return *value, true
		}
	}
	return 0, false
}

func roundWatchPrice(value float64) float64 {
	return math.Round(value*100000000) / 100000000
}
