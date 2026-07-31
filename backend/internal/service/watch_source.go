package service

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"
)

const (
	WatchSourceAdapterSub2API = "sub2api"
	WatchSourceAdapterNewAPI  = "newapi"
	WatchSourceAdapterCustom  = "custom"

	WatchCredentialBearer = "bearer"
	WatchCredentialAPIKey = "api_key"
	WatchCredentialCookie = "cookie"

	WatchSourceAuthModeManual   = "manual"
	WatchSourceAuthModePassword = "password"
)

var (
	ErrWatchSourceNotFound         = errors.New("watch source not found")
	ErrWatchSourceCredentialAbsent = errors.New("watch source credential is not configured")
	ErrWatchPricingRuleNotFound    = errors.New("watch pricing rule not found")

	ErrWatchSourceCredentialLoadFailed              = errors.New("watch source credential load failed")
	ErrWatchSourceCredentialDecryptFailed           = errors.New("watch source credential decrypt failed")
	ErrWatchSourceObservationPersistFailed          = errors.New("watch source observation persist failed")
	ErrWatchSourceSnapshotUnavailable               = errors.New("watch source snapshot unavailable")
	ErrWatchSourcePasswordAuthUnsupported           = errors.New("watch source password auth is unsupported for this adapter")
	ErrWatchSourceInteractiveAuthRequired           = errors.New("watch source login requires interactive verification")
	ErrWatchSourcePasswordAuthFailed                = errors.New("watch source password auth failed")
	ErrWatchSourcePasswordAuthUnavailable           = errors.New("watch source password auth unavailable")
	ErrWatchSourcePasswordAuthInvalidResponse       = errors.New("watch source password auth returned invalid response")
	ErrWatchSourcePasswordAuthMissingToken          = errors.New("watch source password auth returned no access token")
	ErrWatchSourcePasswordAuthMissingDetails        = errors.New("watch source password auth requires email and password")
	ErrWatchSourceInteractiveAuthSessionNotFound    = errors.New("watch source interactive auth session not found")
	ErrWatchSourceInteractiveAuthSessionExpired     = errors.New("watch source interactive auth session expired")
	ErrWatchSourceInteractiveAuthCredentialMissing  = errors.New("watch source interactive auth credential is missing")
	ErrWatchSourceInteractiveAuthCredentialTooLarge = errors.New("watch source interactive auth credential is too large")
)

type WatchSource struct {
	ID                       int64                   `json:"id"`
	Name                     string                  `json:"name"`
	AdapterType              string                  `json:"adapter_type"`
	BaseURL                  string                  `json:"base_url"`
	APIBaseURL               string                  `json:"api_base_url"`
	RechargeRatio            float64                 `json:"recharge_ratio"`
	LowBalanceThreshold      float64                 `json:"low_balance_threshold"`
	PollingIntervalSeconds   int                     `json:"polling_interval_seconds"`
	RequestTimeoutSeconds    int                     `json:"request_timeout_seconds"`
	AuthMode                 string                  `json:"auth_mode"`
	ProfilePath              string                  `json:"profile_path"`
	GroupsPath               string                  `json:"groups_path"`
	RatesPath                string                  `json:"rates_path"`
	PricingPath              string                  `json:"pricing_path"`
	KeysPath                 string                  `json:"keys_path"`
	LoginPath                string                  `json:"login_path"`
	LoginUsernameHint        string                  `json:"login_username_hint,omitempty"`
	HeartbeatPath            string                  `json:"heartbeat_path"`
	ReadMapping              *WatchSourceReadMapping `json:"read_mapping,omitempty"`
	KeepaliveEnabled         bool                    `json:"keepalive_enabled"`
	KeepaliveIntervalSeconds int                     `json:"keepalive_interval_seconds"`
	Enabled                  bool                    `json:"enabled"`
	HasCredential            bool                    `json:"has_credential"`
	HasLoginCredential       bool                    `json:"has_login_credential"`
	CredentialType           string                  `json:"credential_type,omitempty"`
	LastCheckStatus          string                  `json:"last_check_status,omitempty"`
	LastCheckAt              *time.Time              `json:"last_check_at,omitempty"`
	LastSuccessAt            *time.Time              `json:"last_success_at,omitempty"`
	LastErrorCode            string                  `json:"last_error_code,omitempty"`
	LastLatencyMs            *int                    `json:"last_latency_ms,omitempty"`
	LastBalance              *float64                `json:"last_balance,omitempty"`
	NextCheckAt              *time.Time              `json:"next_check_at,omitempty"`
	NextCheckInSeconds       int                     `json:"next_check_in_seconds"`
	CheckDue                 bool                    `json:"check_due"`
	DiagnosticState          string                  `json:"diagnostic_state,omitempty"`
	DiagnosticStateReason    string                  `json:"diagnostic_state_reason,omitempty"`
	LastKeepaliveStatus      string                  `json:"last_keepalive_status,omitempty"`
	LastKeepaliveAt          *time.Time              `json:"last_keepalive_at,omitempty"`
	LastKeepaliveSuccessAt   *time.Time              `json:"last_keepalive_success_at,omitempty"`
	LastKeepaliveErrorCode   string                  `json:"last_keepalive_error_code,omitempty"`
	LastKeepaliveLatencyMs   *int                    `json:"last_keepalive_latency_ms,omitempty"`
	LastTokenRefreshedAt     *time.Time              `json:"last_token_refreshed_at,omitempty"`
	NextKeepaliveAt          *time.Time              `json:"next_keepalive_at,omitempty"`
	NextKeepaliveInSeconds   int                     `json:"next_keepalive_in_seconds"`
	KeepaliveDue             bool                    `json:"keepalive_due"`
	KeepaliveActive          bool                    `json:"keepalive_active"`
	KeepaliveState           string                  `json:"keepalive_state,omitempty"`
	KeepaliveStateReason     string                  `json:"keepalive_state_reason,omitempty"`
	KeepaliveValidUntil      *time.Time              `json:"keepalive_valid_until,omitempty"`
	CreatedBy                *int64                  `json:"created_by,omitempty"`
	UpdatedBy                *int64                  `json:"updated_by,omitempty"`
	CreatedAt                time.Time               `json:"created_at"`
	UpdatedAt                time.Time               `json:"updated_at"`
}

type WatchSourceCredential struct {
	AccessToken string `json:"access_token,omitempty"`
	APIKey      string `json:"api_key,omitempty"`
	Cookie      string `json:"cookie,omitempty"`
	UserAgent   string `json:"user_agent,omitempty"`
}

type WatchSourceLoginCredential struct {
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"`
	UserAgent string `json:"user_agent,omitempty"`
}

type WatchSourceReadMapping struct {
	Version      int                                         `json:"version,omitempty"`
	Template     string                                      `json:"template,omitempty"`
	Capabilities map[string]WatchSourceReadCapabilityMapping `json:"capabilities,omitempty"`
}

type WatchSourceReadCapabilityMapping struct {
	ObjectPath  string            `json:"object_path,omitempty"`
	RecordsPath string            `json:"records_path,omitempty"`
	RecordMode  string            `json:"record_mode,omitempty"`
	Fields      map[string]string `json:"fields,omitempty"`
}

func (c WatchSourceCredential) SecretFor(credentialType string) string {
	switch credentialType {
	case WatchCredentialAPIKey:
		return strings.TrimSpace(c.APIKey)
	case WatchCredentialCookie:
		return strings.TrimSpace(c.Cookie)
	default:
		return strings.TrimSpace(c.AccessToken)
	}
}

type WatchSourceMutation struct {
	Source               *WatchSource
	CredentialType       string
	EncryptedSecret      string
	EncryptedLoginSecret string
	ClearCredential      bool
	ClearLoginCredential bool
}

type WatchSourceCredentialBundle struct {
	CredentialType      string
	EncryptedValue      string
	EncryptedLoginValue string
}

type WatchSourceGroupObservation struct {
	ExternalID         string    `json:"external_id"`
	Name               string    `json:"name"`
	Platform           string    `json:"platform"`
	RateMultiplier     float64   `json:"rate_multiplier"`
	UserRateMultiplier *float64  `json:"user_rate_multiplier,omitempty"`
	PricingAvailable   bool      `json:"pricing_available"`
	ObservedAt         time.Time `json:"observed_at"`
}

type WatchSourcePriceObservation struct {
	GroupExternalID string    `json:"group_external_id"`
	Platform        string    `json:"platform"`
	Model           string    `json:"model"`
	Component       string    `json:"component"`
	Value           float64   `json:"value"`
	ObservedAt      time.Time `json:"observed_at"`
}

type WatchSourceKeyObservation struct {
	ExternalID        string     `json:"external_id"`
	Label             string     `json:"label"`
	Status            string     `json:"status,omitempty"`
	GroupExternalIDs  []string   `json:"group_external_ids"`
	GroupNames        []string   `json:"group_names"`
	Summary           string     `json:"summary,omitempty"`
	ExternalCreatedAt *time.Time `json:"external_created_at,omitempty"`
	ObservedAt        time.Time  `json:"observed_at"`
	KeyDigest         string     `json:"-"`
}

type WatchSourceCheck struct {
	ID         int64     `json:"id"`
	SourceID   int64     `json:"source_id"`
	Status     string    `json:"status"`
	ErrorCode  string    `json:"error_code,omitempty"`
	LatencyMs  *int      `json:"latency_ms,omitempty"`
	ObservedAt time.Time `json:"observed_at"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type WatchSourceObservation struct {
	Status         string
	ErrorCode      string
	LatencyMs      *int
	ObservedAt     time.Time
	ExpiresAt      time.Time
	Balance        *float64
	Groups         []WatchSourceGroupObservation
	Prices         []WatchSourcePriceObservation
	SourceKeys     []WatchSourceKeyObservation
	TokenRefreshed bool
}

type WatchSourceSnapshot struct {
	Source     *WatchSource                  `json:"source"`
	Check      *WatchSourceCheck             `json:"check,omitempty"`
	Balance    *float64                      `json:"balance,omitempty"`
	Groups     []WatchSourceGroupObservation `json:"groups"`
	Prices     []WatchSourcePriceObservation `json:"prices"`
	SourceKeys []WatchSourceKeyObservation   `json:"source_keys"`
}

type WatchPricingObservation struct {
	SourceID        int64
	SourceName      string
	GroupExternalID string
	GroupName       string
	Platform        string
	Value           *float64
	Status          string
	ErrorCode       string
	ObservedAt      time.Time
	ExpiresAt       *time.Time
	LastBalance     *float64
	BalanceMinimum  float64
}

type WatchPriceChange struct {
	ID              int64     `json:"id"`
	SourceID        int64     `json:"source_id"`
	SourceName      string    `json:"source_name"`
	GroupExternalID string    `json:"group_external_id"`
	GroupName       string    `json:"group_name,omitempty"`
	Platform        string    `json:"platform"`
	Model           string    `json:"model,omitempty"`
	Component       string    `json:"component"`
	PreviousValue   float64   `json:"previous_value"`
	NextValue       float64   `json:"next_value"`
	ChangeKind      string    `json:"change_kind"`
	ObservedAt      time.Time `json:"observed_at"`
}

type WatchAccountUpstreamMapping struct {
	AccountID             int64     `json:"account_id"`
	AccountName           string    `json:"account_name,omitempty"`
	Platform              string    `json:"platform,omitempty"`
	SourceID              int64     `json:"source_id"`
	SourceName            string    `json:"source_name,omitempty"`
	SourceKeyExternalID   string    `json:"source_key_external_id"`
	SourceKeyLabel        string    `json:"source_key_label,omitempty"`
	SourceGroupExternalID string    `json:"source_group_external_id,omitempty"`
	SourceGroupName       string    `json:"source_group_name,omitempty"`
	MappingMethod         string    `json:"mapping_method"`
	UpdatedBy             *int64    `json:"updated_by,omitempty"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type WatchAccountMappingInput struct {
	AccountID             int64  `json:"account_id"`
	SourceID              int64  `json:"source_id"`
	SourceKeyExternalID   string `json:"source_key_external_id"`
	SourceGroupExternalID string `json:"source_group_external_id,omitempty"`
	MappingMethod         string `json:"mapping_method,omitempty"`
}

type WatchAccountMappingRow struct {
	AccountID             int64                        `json:"account_id"`
	AccountName           string                       `json:"account_name"`
	Platform              string                       `json:"platform"`
	Schedulable           bool                         `json:"schedulable"`
	AccountBaseURL        string                       `json:"account_base_url,omitempty"`
	Mapping               *WatchAccountUpstreamMapping `json:"mapping,omitempty"`
	MappingStatus         string                       `json:"mapping_status"`
	Reason                string                       `json:"reason,omitempty"`
	InTargetGroup         bool                         `json:"in_target_group"`
	TargetGroupID         int64                        `json:"target_group_id,omitempty"`
	ParticipationReason   string                       `json:"participation_reason,omitempty"`
	AutoMatchedSourceID   int64                        `json:"auto_matched_source_id,omitempty"`
	AutoMatchedSourceName string                       `json:"auto_matched_source_name,omitempty"`
}

type WatchAccountMappingsView struct {
	TargetGroupID int64                    `json:"target_group_id,omitempty"`
	GeneratedAt   time.Time                `json:"generated_at"`
	Accounts      []WatchAccountMappingRow `json:"accounts"`
	Sources       []*WatchSource           `json:"sources"`
}

type WatchAccountMappingScanRequest struct {
	TargetGroupID int64  `json:"target_group_id,omitempty"`
	Platform      string `json:"platform,omitempty"`
}

type WatchAccountMappingCandidateGroup struct {
	ExternalID string  `json:"external_id"`
	Name       string  `json:"name"`
	Platform   string  `json:"platform,omitempty"`
	FinalCost  float64 `json:"final_cost,omitempty"`
}

type WatchAccountMappingCandidate struct {
	AccountID             int64                               `json:"account_id"`
	AccountName           string                              `json:"account_name"`
	Platform              string                              `json:"platform"`
	AccountBaseURL        string                              `json:"account_base_url,omitempty"`
	SourceID              int64                               `json:"source_id,omitempty"`
	SourceName            string                              `json:"source_name,omitempty"`
	SourceKeyExternalID   string                              `json:"source_key_external_id,omitempty"`
	SourceKeyLabel        string                              `json:"source_key_label,omitempty"`
	SourceGroupExternalID string                              `json:"source_group_external_id,omitempty"`
	SourceGroupName       string                              `json:"source_group_name,omitempty"`
	Groups                []WatchAccountMappingCandidateGroup `json:"groups,omitempty"`
	Status                string                              `json:"status"`
	Reason                string                              `json:"reason,omitempty"`
	InTargetGroup         bool                                `json:"in_target_group"`
	TargetGroupID         int64                               `json:"target_group_id,omitempty"`
	ParticipationReason   string                              `json:"participation_reason,omitempty"`
}

type WatchAccountMappingScanResult struct {
	TargetGroupID  int64                          `json:"target_group_id,omitempty"`
	GeneratedAt    time.Time                      `json:"generated_at"`
	Candidates     []WatchAccountMappingCandidate `json:"candidates"`
	ReadyCount     int                            `json:"ready_count"`
	AmbiguousCount int                            `json:"ambiguous_count"`
	MappedCount    int                            `json:"mapped_count"`
}

type WatchAccountMappingBatchConfirmRequest struct {
	Confirmed bool                       `json:"confirmed"`
	Items     []WatchAccountMappingInput `json:"items"`
}

type WatchAccountMappingBatchFailure struct {
	AccountID int64  `json:"account_id"`
	Reason    string `json:"reason"`
}

type WatchAccountMappingBatchConfirmResult struct {
	Saved     []WatchAccountUpstreamMapping     `json:"saved"`
	Failed    []WatchAccountMappingBatchFailure `json:"failed"`
	UpdatedAt time.Time                         `json:"updated_at"`
}

type WatchPricingBoardFilter struct {
	SourceID   int64  `json:"source_id,omitempty"`
	Platform   string `json:"platform,omitempty"`
	Tag        string `json:"tag,omitempty"`
	Search     string `json:"search,omitempty"`
	ChangeKind string `json:"change_kind,omitempty"`
	InUse      string `json:"in_use,omitempty"`
	Sort       string `json:"sort,omitempty"`
	Order      string `json:"order,omitempty"`
}

type WatchPricingBoardModelPrice struct {
	Platform        string     `json:"platform"`
	Model           string     `json:"model"`
	InputPrice      *float64   `json:"input_price,omitempty"`
	OutputPrice     *float64   `json:"output_price,omitempty"`
	PerRequestPrice *float64   `json:"per_request_price,omitempty"`
	ObservedAt      *time.Time `json:"observed_at,omitempty"`
}

type WatchPricingBoardRow struct {
	SourceID           int64                         `json:"source_id"`
	SourceName         string                        `json:"source_name"`
	AdapterType        string                        `json:"adapter_type"`
	GroupExternalID    string                        `json:"group_external_id"`
	GroupName          string                        `json:"group_name"`
	Platform           string                        `json:"platform"`
	Tags               []string                      `json:"tags,omitempty"`
	RateMultiplier     float64                       `json:"rate_multiplier"`
	UserRateMultiplier *float64                      `json:"user_rate_multiplier,omitempty"`
	RechargeRatio      float64                       `json:"recharge_ratio"`
	FinalMultiplier    float64                       `json:"final_multiplier"`
	ModelPrices        []WatchPricingBoardModelPrice `json:"model_prices,omitempty"`
	ChangeKind         string                        `json:"change_kind,omitempty"`
	PreviousValue      *float64                      `json:"previous_value,omitempty"`
	NextValue          *float64                      `json:"next_value,omitempty"`
	ChangeObservedAt   *time.Time                    `json:"change_observed_at,omitempty"`
	InUse              bool                          `json:"in_use"`
	InUseAccountCount  int64                         `json:"in_use_account_count"`
	SourceStatus       string                        `json:"source_status,omitempty"`
	SourceErrorCode    string                        `json:"source_error_code,omitempty"`
	ObservedAt         time.Time                     `json:"observed_at"`
}

type WatchPricingBoard struct {
	GeneratedAt time.Time              `json:"generated_at"`
	Rows        []WatchPricingBoardRow `json:"rows"`
}

type WatchIntegrationAccountHealthStatus string

const (
	WatchIntegrationAccountHealthHealthy   WatchIntegrationAccountHealthStatus = "healthy"
	WatchIntegrationAccountHealthAbnormal  WatchIntegrationAccountHealthStatus = "abnormal"
	WatchIntegrationAccountHealthObserving WatchIntegrationAccountHealthStatus = "observing"
	WatchIntegrationAccountHealthDisabled  WatchIntegrationAccountHealthStatus = "disabled"
)

type WatchIntegrationAccountHealthFilter struct {
	Status        string
	Platform      string
	SourceID      int64
	Search        string
	WindowSeconds int
	Limit         int
}

type WatchIntegrationAccountHealthRow struct {
	AccountID          int64                               `json:"account_id"`
	AccountName        string                              `json:"account_name"`
	Platform           string                              `json:"platform"`
	AccountStatus      string                              `json:"account_status,omitempty"`
	Schedulable        bool                                `json:"schedulable"`
	AccountBaseURL     string                              `json:"account_base_url,omitempty"`
	SourceID           int64                               `json:"source_id,omitempty"`
	SourceName         string                              `json:"source_name,omitempty"`
	SourceGroupID      string                              `json:"source_group_external_id,omitempty"`
	SourceGroupName    string                              `json:"source_group_name,omitempty"`
	LastRequestAt      *time.Time                          `json:"last_request_at,omitempty"`
	WindowRequestCount int64                               `json:"window_request_count"`
	SuccessCount       int64                               `json:"success_count"`
	FailureCount       int64                               `json:"failure_count"`
	SuccessRate        *float64                            `json:"success_rate,omitempty"`
	MainError          string                              `json:"main_error,omitempty"`
	Status             WatchIntegrationAccountHealthStatus `json:"status"`
	StatusReason       string                              `json:"status_reason,omitempty"`
}

type WatchIntegrationAccountHealthList struct {
	GeneratedAt    time.Time                          `json:"generated_at"`
	WindowStart    time.Time                          `json:"window_start"`
	WindowEnd      time.Time                          `json:"window_end"`
	WindowSeconds  int                                `json:"window_seconds"`
	HealthyCount   int                                `json:"healthy_count"`
	AbnormalCount  int                                `json:"abnormal_count"`
	ObservingCount int                                `json:"observing_count"`
	DisabledCount  int                                `json:"disabled_count"`
	Items          []WatchIntegrationAccountHealthRow `json:"items"`
}

func HydrateWatchSourceDiagnosticState(source *WatchSource, now time.Time) {
	if source == nil {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if source.PollingIntervalSeconds <= 0 {
		source.PollingIntervalSeconds = 60
	}
	source.NextCheckAt = nil
	source.NextCheckInSeconds = 0
	source.CheckDue = false
	source.DiagnosticState = "waiting"
	source.DiagnosticStateReason = ""
	if !source.Enabled {
		source.DiagnosticStateReason = "source is disabled"
		return
	}
	if source.LastCheckAt == nil {
		next := now
		source.NextCheckAt = &next
		source.CheckDue = true
		source.DiagnosticStateReason = "source has not been checked"
		return
	}
	next := source.LastCheckAt.UTC().Add(time.Duration(source.PollingIntervalSeconds) * time.Second)
	source.NextCheckAt = &next
	if remaining := next.Sub(now); remaining > 0 {
		source.NextCheckInSeconds = int(math.Ceil(remaining.Seconds()))
	} else {
		source.CheckDue = true
	}
	switch strings.ToLower(strings.TrimSpace(source.LastCheckStatus)) {
	case "checking":
		source.DiagnosticState = "checking"
		source.CheckDue = false
	case "error":
		source.DiagnosticState = "failed"
		source.DiagnosticStateReason = source.LastErrorCode
	case "healthy", "degraded", "success":
		source.DiagnosticState = "completed"
	default:
		source.DiagnosticState = "waiting"
		if source.CheckDue {
			source.DiagnosticStateReason = "diagnostic is due"
		}
	}
}

func HydrateWatchSourceKeepaliveState(source *WatchSource, now time.Time) {
	if source == nil {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if source.KeepaliveIntervalSeconds <= 0 {
		source.KeepaliveIntervalSeconds = 300
	}
	source.NextKeepaliveAt = nil
	source.NextKeepaliveInSeconds = 0
	source.KeepaliveDue = false
	source.KeepaliveActive = false
	source.KeepaliveState = "waiting"
	source.KeepaliveStateReason = ""
	source.KeepaliveValidUntil = nil
	if !source.Enabled {
		source.KeepaliveState = "disabled"
		source.KeepaliveStateReason = "source is disabled"
		return
	}
	if !source.KeepaliveEnabled {
		source.KeepaliveState = "disabled"
		source.KeepaliveStateReason = "keepalive is disabled"
		return
	}
	if source.LastKeepaliveSuccessAt != nil {
		validUntil := source.LastKeepaliveSuccessAt.UTC().Add(time.Duration(source.KeepaliveIntervalSeconds*2) * time.Second)
		source.KeepaliveValidUntil = &validUntil
		source.KeepaliveActive = !now.After(validUntil)
	}
	if source.LastKeepaliveAt == nil {
		next := now
		source.NextKeepaliveAt = &next
		source.KeepaliveDue = true
		source.KeepaliveStateReason = "keepalive has not been checked"
		return
	}
	next := source.LastKeepaliveAt.UTC().Add(time.Duration(source.KeepaliveIntervalSeconds) * time.Second)
	source.NextKeepaliveAt = &next
	if remaining := next.Sub(now); remaining > 0 {
		source.NextKeepaliveInSeconds = int(math.Ceil(remaining.Seconds()))
	} else {
		source.KeepaliveDue = true
	}
	switch strings.ToLower(strings.TrimSpace(source.LastKeepaliveStatus)) {
	case "checking":
		source.KeepaliveState = "checking"
		source.KeepaliveDue = false
	case "error":
		source.KeepaliveState = "failed"
		source.KeepaliveStateReason = source.LastKeepaliveErrorCode
	case "healthy", "degraded", "success":
		if source.KeepaliveActive {
			source.KeepaliveState = "active"
		} else {
			source.KeepaliveState = "failed"
			source.KeepaliveStateReason = "keepalive success expired"
		}
	default:
		source.KeepaliveState = "waiting"
		if source.KeepaliveDue {
			source.KeepaliveStateReason = "keepalive is due"
		}
	}
}

type WatchPriceChangeFilter struct {
	SourceID        int64
	AfterID         int64
	GroupExternalID string
	Platform        string
	Model           string
	Component       string
	ChangeKind      string
	Limit           int
}

type WatchPricingHistoryFilter struct {
	SourceID        int64  `json:"source_id"`
	GroupExternalID string `json:"group_external_id"`
	Platform        string `json:"platform,omitempty"`
	Model           string `json:"model,omitempty"`
	Component       string `json:"component,omitempty"`
	ChangeKind      string `json:"change_kind,omitempty"`
	Limit           int    `json:"limit,omitempty"`
}

type WatchPricingHistoryPoint struct {
	ObservedAt time.Time `json:"observed_at"`
	Value      float64   `json:"value"`
}

type WatchPricingHistorySummary struct {
	MinValue    *float64 `json:"min_value,omitempty"`
	MaxValue    *float64 `json:"max_value,omitempty"`
	RecordCount int      `json:"record_count"`
}

type WatchPricingHistory struct {
	SourceID        int64                      `json:"source_id"`
	SourceName      string                     `json:"source_name,omitempty"`
	GroupExternalID string                     `json:"group_external_id"`
	GroupName       string                     `json:"group_name,omitempty"`
	Component       string                     `json:"component"`
	Platform        string                     `json:"platform,omitempty"`
	Model           string                     `json:"model,omitempty"`
	Summary         WatchPricingHistorySummary `json:"summary"`
	Points          []WatchPricingHistoryPoint `json:"points"`
	Events          []WatchPriceChange         `json:"events"`
	GeneratedAt     time.Time                  `json:"generated_at"`
}

type WatchPriceAudit struct {
	ID                       int64               `json:"id"`
	TargetType               string              `json:"target_type"`
	TargetID                 int64               `json:"target_id"`
	TargetGroupID            int64               `json:"target_group_id"`
	Mode                     WatchPriceMode      `json:"mode"`
	Component                WatchPriceComponent `json:"component,omitempty"`
	PreviousValue            *float64            `json:"previous_value,omitempty"`
	NextValue                *float64            `json:"next_value,omitempty"`
	CandidateSourceID        *int64              `json:"candidate_source_id,omitempty"`
	CandidateGroupExternalID string              `json:"candidate_group_external_id,omitempty"`
	Action                   string              `json:"action"`
	Reason                   string              `json:"reason,omitempty"`
	ActorUserID              *int64              `json:"actor_user_id,omitempty"`
	IdempotencyKey           string              `json:"idempotency_key,omitempty"`
	Platform                 string              `json:"platform,omitempty"`
	Model                    string              `json:"model,omitempty"`
	RollbackOfID             *int64              `json:"rollback_of_id,omitempty"`
	CreatedAt                time.Time           `json:"created_at"`
	UpdatedAt                time.Time           `json:"updated_at"`
}

type WatchPricingRule struct {
	ID              int64               `json:"id"`
	Name            string              `json:"name"`
	TargetGroupID   int64               `json:"target_group_id"`
	Mode            WatchPriceMode      `json:"mode"`
	Platform        string              `json:"platform,omitempty"`
	Model           string              `json:"model,omitempty"`
	Component       WatchPriceComponent `json:"component"`
	Enabled         bool                `json:"enabled"`
	IntervalSeconds int                 `json:"interval_seconds"`
	AdjustmentStep  float64             `json:"adjustment_step"`
	RunSequence     int64               `json:"run_sequence"`
	LastRunAt       *time.Time          `json:"last_run_at,omitempty"`
	NextRunAt       *time.Time          `json:"next_run_at,omitempty"`
	LastStatus      string              `json:"last_status,omitempty"`
	LastErrorCode   string              `json:"last_error_code,omitempty"`
	CreatedBy       *int64              `json:"created_by,omitempty"`
	UpdatedBy       *int64              `json:"updated_by,omitempty"`
	CreatedAt       time.Time           `json:"created_at"`
	UpdatedAt       time.Time           `json:"updated_at"`
}

type WatchPricingRuleInput struct {
	Name            string              `json:"name"`
	TargetGroupID   int64               `json:"target_group_id"`
	Mode            WatchPriceMode      `json:"mode"`
	Platform        string              `json:"platform"`
	Model           string              `json:"model"`
	Component       WatchPriceComponent `json:"component"`
	Enabled         bool                `json:"enabled"`
	IntervalSeconds int                 `json:"interval_seconds"`
	AdjustmentStep  float64             `json:"adjustment_step"`
}

type WatchPricingRuleRunResult struct {
	Rule      *WatchPricingRule    `json:"rule"`
	Preview   *WatchPricingPreview `json:"preview,omitempty"`
	Audit     *WatchPriceAudit     `json:"audit,omitempty"`
	Status    string               `json:"status"`
	ErrorCode string               `json:"error_code,omitempty"`
}

type WatchSourceRepository interface {
	CreateSource(ctx context.Context, mutation WatchSourceMutation) (*WatchSource, error)
	UpdateSource(ctx context.Context, mutation WatchSourceMutation) (*WatchSource, error)
	GetSource(ctx context.Context, id int64) (*WatchSource, error)
	ListSources(ctx context.Context) ([]*WatchSource, error)
	ClaimDueSources(ctx context.Context, now time.Time, limit int) ([]*WatchSource, error)
	ClaimDueKeepaliveSources(ctx context.Context, now time.Time, limit int) ([]*WatchSource, error)
	DeleteSource(ctx context.Context, id int64) error
	GetSourceCredential(ctx context.Context, id int64) (credentialType, encryptedValue string, err error)
	GetSourceCredentialBundle(ctx context.Context, id int64) (*WatchSourceCredentialBundle, error)
	UpdateSourceCredential(ctx context.Context, sourceID int64, credentialType, encryptedValue string, updatedAt time.Time) error
	SaveSourceObservation(ctx context.Context, sourceID int64, observation WatchSourceObservation) error
	SaveSourceKeepalive(ctx context.Context, sourceID int64, observation WatchSourceObservation) error
	GetSourceSnapshot(ctx context.Context, sourceID int64) (*WatchSourceSnapshot, error)
	ListSourceChecks(ctx context.Context, sourceID int64, limit int) ([]WatchSourceCheck, error)
	ListSourceKeepaliveChecks(ctx context.Context, sourceID int64, limit int) ([]WatchSourceCheck, error)
	ListPricingObservations(ctx context.Context, mode WatchPriceMode, platform, model string, component WatchPriceComponent) ([]WatchPricingObservation, error)
	ListPriceChanges(ctx context.Context, limit int) ([]WatchPriceChange, error)
	ListFilteredPriceChanges(ctx context.Context, filter WatchPriceChangeFilter) ([]WatchPriceChange, error)
	ListPricingBoardRows(ctx context.Context, filter WatchPricingBoardFilter) (*WatchPricingBoard, error)
	ListPricingHistory(ctx context.Context, filter WatchPricingHistoryFilter) (*WatchPricingHistory, error)
	ListIntegrationAccountHealth(ctx context.Context, filter WatchIntegrationAccountHealthFilter, windowStart, windowEnd time.Time) ([]WatchIntegrationAccountHealthRow, error)
	ListAccountUpstreamMappings(ctx context.Context, accountIDs []int64) ([]WatchAccountUpstreamMapping, error)
	ListAllAccountUpstreamMappings(ctx context.Context) ([]WatchAccountUpstreamMapping, error)
	SaveAccountUpstreamMapping(ctx context.Context, mapping WatchAccountUpstreamMapping) (*WatchAccountUpstreamMapping, error)
	DeleteAccountUpstreamMapping(ctx context.Context, accountID int64) error
	ReservePriceAudit(ctx context.Context, audit WatchPriceAudit) (*WatchPriceAudit, bool, error)
	GetPriceAudit(ctx context.Context, id int64) (*WatchPriceAudit, error)
	GetPriceAuditByIdempotencyKey(ctx context.Context, key string) (*WatchPriceAudit, error)
	CompletePriceAudit(ctx context.Context, id int64, action, reason string) (*WatchPriceAudit, error)
	ListPriceAudits(ctx context.Context, limit int) ([]WatchPriceAudit, error)
	GetOperationsUsageSummary(ctx context.Context, start, end time.Time) (*WatchOperationsUsageSummary, error)
	CreatePricingRule(ctx context.Context, rule WatchPricingRule) (*WatchPricingRule, error)
	UpdatePricingRule(ctx context.Context, rule WatchPricingRule) (*WatchPricingRule, error)
	GetPricingRule(ctx context.Context, id int64) (*WatchPricingRule, error)
	ListPricingRules(ctx context.Context) ([]WatchPricingRule, error)
	DeletePricingRule(ctx context.Context, id int64) error
	ClaimDuePricingRules(ctx context.Context, now time.Time, limit int) ([]WatchPricingRule, error)
	ClaimPricingRuleRun(ctx context.Context, id int64, now time.Time) (*WatchPricingRule, error)
	FinishPricingRuleRun(ctx context.Context, id, sequence int64, status, errorCode string) (*WatchPricingRule, error)
}
