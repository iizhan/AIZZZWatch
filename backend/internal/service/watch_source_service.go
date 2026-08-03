package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

type WatchSourceInput struct {
	Name                     string                  `json:"name"`
	AdapterType              string                  `json:"adapter_type"`
	BaseURL                  string                  `json:"base_url"`
	APIBaseURL               string                  `json:"api_base_url"`
	RechargeRatio            float64                 `json:"recharge_ratio"`
	LowBalanceThreshold      float64                 `json:"low_balance_threshold"`
	PollingIntervalSeconds   int                     `json:"polling_interval_seconds"`
	RequestTimeoutSeconds    int                     `json:"request_timeout_seconds"`
	KeepaliveEnabled         *bool                   `json:"keepalive_enabled"`
	KeepaliveIntervalSeconds int                     `json:"keepalive_interval_seconds"`
	AutoFollowKeyGroup       *bool                   `json:"auto_follow_key_group"`
	ProfilePath              string                  `json:"profile_path"`
	GroupsPath               string                  `json:"groups_path"`
	RatesPath                string                  `json:"rates_path"`
	PricingPath              string                  `json:"pricing_path"`
	KeysPath                 string                  `json:"keys_path"`
	LoginPath                string                  `json:"login_path"`
	HeartbeatPath            string                  `json:"heartbeat_path"`
	ReadMapping              *WatchSourceReadMapping `json:"read_mapping,omitempty"`
	Enabled                  bool                    `json:"enabled"`
	AuthMode                 string                  `json:"auth_mode"`
	LoginUsername            string                  `json:"login_username"`
	LoginEmail               string                  `json:"login_email"`
	LoginPassword            string                  `json:"login_password"`
	CredentialType           string                  `json:"credential_type"`
	Credential               *WatchSourceCredential  `json:"credential,omitempty"`
	ClearCredential          bool                    `json:"clear_credential"`
}

type WatchSourceService struct {
	repo                WatchSourceRepository
	encryptor           SecretEncryptor
	allowPrivateNetwork bool
	now                 func() time.Time
	checks              singleflight.Group
	passwordLogin       func(ctx context.Context, source *WatchSource, email, password string, credential WatchSourceCredential, allowPrivate bool) (WatchSourceCredential, error)
	interactiveAuthMu   sync.Mutex
	interactiveAuth     map[string]WatchSourceInteractiveAuthSession
}

type stableSecretEncryptor interface {
	EncryptionKeyConfigured() bool
}

const (
	watchSourceMaxAttempts                     = 3
	watchSourceRetryDelay                      = 200 * time.Millisecond
	watchSourceInteractiveExtraHeaderMaxLength = 256
)

func NewWatchSourceService(repo WatchSourceRepository, encryptor SecretEncryptor) *WatchSourceService {
	return &WatchSourceService{repo: repo, encryptor: encryptor, now: time.Now, passwordLogin: loginWatchSourceWithPassword, interactiveAuth: map[string]WatchSourceInteractiveAuthSession{}}
}

func (s *WatchSourceService) ensureStableEncryptionForCredentialWrite() error {
	if checker, ok := s.encryptor.(stableSecretEncryptor); ok && !checker.EncryptionKeyConfigured() {
		return ErrWatchSourceStableEncryptionRequired
	}
	return nil
}

func newWatchSourceServiceForTest(repo WatchSourceRepository, encryptor SecretEncryptor, allowPrivate bool) *WatchSourceService {
	service := NewWatchSourceService(repo, encryptor)
	service.allowPrivateNetwork = allowPrivate
	return service
}

func (s *WatchSourceService) Create(ctx context.Context, input WatchSourceInput, actorID int64) (*WatchSource, error) {
	mutation, err := s.prepareMutation(ctx, input, actorID, 0)
	if err != nil {
		return nil, err
	}
	source := mutation.Source
	source.CreatedBy = &actorID
	source.UpdatedBy = &actorID
	return s.repo.CreateSource(ctx, *mutation)
}

func (s *WatchSourceService) Update(ctx context.Context, id int64, input WatchSourceInput, actorID int64) (*WatchSource, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid watch source id")
	}
	mutation, err := s.prepareMutation(ctx, input, actorID, id)
	if err != nil {
		return nil, err
	}
	source := mutation.Source
	source.ID = id
	source.UpdatedBy = &actorID
	return s.repo.UpdateSource(ctx, *mutation)
}

const (
	watchSourceInteractiveAuthTTL             = 10 * time.Minute
	watchSourceInteractiveCredentialMaxLength = 64 * 1024
	watchSourceInteractiveUserAgentMaxLength  = 512
)

type WatchSourceInteractiveAuthSession struct {
	SessionID  string    `json:"session_id"`
	SourceID   int64     `json:"source_id"`
	SourceName string    `json:"source_name"`
	AuthURL    string    `json:"auth_url"`
	Status     string    `json:"status"`
	ExpiresAt  time.Time `json:"expires_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type WatchSourceInteractiveAuthCompleteRequest struct {
	SessionID      string                 `json:"session_id"`
	CredentialType string                 `json:"credential_type"`
	Credential     *WatchSourceCredential `json:"credential,omitempty"`
	Validate       bool                   `json:"validate"`
}

type WatchSourceInteractiveAuthCompleteResult struct {
	Status   string               `json:"status"`
	Source   *WatchSource         `json:"source"`
	Snapshot *WatchSourceSnapshot `json:"snapshot,omitempty"`
}

func (s *WatchSourceService) StartInteractiveAuth(ctx context.Context, sourceID, actorID int64) (*WatchSourceInteractiveAuthSession, error) {
	if sourceID <= 0 || actorID <= 0 {
		return nil, fmt.Errorf("invalid watch source interactive auth request")
	}
	source, err := s.repo.GetSource(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	sessionID, err := randomWatchSourceInteractiveSessionID()
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	session := WatchSourceInteractiveAuthSession{
		SessionID:  sessionID,
		SourceID:   source.ID,
		SourceName: source.Name,
		AuthURL:    source.BaseURL,
		Status:     "pending",
		CreatedAt:  now,
		ExpiresAt:  now.Add(watchSourceInteractiveAuthTTL),
	}
	s.interactiveAuthMu.Lock()
	defer s.interactiveAuthMu.Unlock()
	s.cleanupExpiredInteractiveAuthLocked(now)
	if s.interactiveAuth == nil {
		s.interactiveAuth = map[string]WatchSourceInteractiveAuthSession{}
	}
	s.interactiveAuth[watchSourceInteractiveAuthKey(actorID, sessionID)] = session
	return &session, nil
}

func (s *WatchSourceService) GetInteractiveAuthSession(_ context.Context, sourceID, actorID int64, sessionID string) (*WatchSourceInteractiveAuthSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sourceID <= 0 || actorID <= 0 || sessionID == "" {
		return nil, fmt.Errorf("invalid watch source interactive auth session")
	}
	now := s.now().UTC()
	s.interactiveAuthMu.Lock()
	defer s.interactiveAuthMu.Unlock()
	session, ok := s.interactiveAuth[watchSourceInteractiveAuthKey(actorID, sessionID)]
	if !ok || session.SourceID != sourceID {
		s.cleanupExpiredInteractiveAuthLocked(now)
		return nil, ErrWatchSourceInteractiveAuthSessionNotFound
	}
	if !session.ExpiresAt.After(now) {
		delete(s.interactiveAuth, watchSourceInteractiveAuthKey(actorID, sessionID))
		return nil, ErrWatchSourceInteractiveAuthSessionExpired
	}
	s.cleanupExpiredInteractiveAuthLocked(now)
	copy := session
	return &copy, nil
}

func (s *WatchSourceService) CompleteInteractiveAuth(ctx context.Context, sourceID, actorID int64, req WatchSourceInteractiveAuthCompleteRequest) (*WatchSourceInteractiveAuthCompleteResult, error) {
	session, err := s.GetInteractiveAuthSession(ctx, sourceID, actorID, req.SessionID)
	if err != nil {
		return nil, err
	}
	credentialType, err := normalizeWatchSourceInteractiveCredentialType(req.CredentialType)
	if err != nil {
		return nil, err
	}
	credential, err := normalizeWatchSourceInteractiveCredential(credentialType, req.Credential)
	if err != nil {
		return nil, err
	}
	if credential.SecretFor(credentialType) == "" {
		return nil, ErrWatchSourceInteractiveAuthCredentialMissing
	}
	source, err := s.repo.GetSource(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	input := WatchSourceInput{
		Name: source.Name, AdapterType: source.AdapterType, BaseURL: source.BaseURL, APIBaseURL: source.APIBaseURL,
		RechargeRatio: source.RechargeRatio, LowBalanceThreshold: source.LowBalanceThreshold,
		PollingIntervalSeconds: source.PollingIntervalSeconds, RequestTimeoutSeconds: source.RequestTimeoutSeconds,
		KeepaliveEnabled: &source.KeepaliveEnabled, KeepaliveIntervalSeconds: source.KeepaliveIntervalSeconds,
		ProfilePath: source.ProfilePath, GroupsPath: source.GroupsPath, RatesPath: source.RatesPath,
		PricingPath: source.PricingPath, KeysPath: source.KeysPath, LoginPath: source.LoginPath,
		HeartbeatPath: source.HeartbeatPath, ReadMapping: source.ReadMapping, Enabled: source.Enabled,
		AuthMode: WatchSourceAuthModeManual, CredentialType: credentialType, Credential: &credential,
	}
	saved, err := s.Update(ctx, sourceID, input, actorID)
	if err != nil {
		return nil, err
	}
	result := &WatchSourceInteractiveAuthCompleteResult{Status: "saved", Source: saved}
	if req.Validate {
		snapshot, checkErr := s.RunCheck(ctx, sourceID)
		if checkErr != nil {
			return nil, checkErr
		}
		result.Status = "validated"
		result.Source = snapshot.Source
		result.Snapshot = snapshot
	}
	s.interactiveAuthMu.Lock()
	if stored, ok := s.interactiveAuth[watchSourceInteractiveAuthKey(actorID, session.SessionID)]; ok {
		stored.Status = "completed"
		s.interactiveAuth[watchSourceInteractiveAuthKey(actorID, session.SessionID)] = stored
	}
	delete(s.interactiveAuth, watchSourceInteractiveAuthKey(actorID, session.SessionID))
	s.interactiveAuthMu.Unlock()
	return result, nil
}

func (s *WatchSourceService) cleanupExpiredInteractiveAuthLocked(now time.Time) {
	for key, session := range s.interactiveAuth {
		if !session.ExpiresAt.After(now) {
			delete(s.interactiveAuth, key)
		}
	}
}

func watchSourceInteractiveAuthKey(actorID int64, sessionID string) string {
	return fmt.Sprintf("%d:%s", actorID, strings.TrimSpace(sessionID))
}

func randomWatchSourceInteractiveSessionID() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate watch source interactive auth session: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func normalizeWatchSourceInteractiveCredentialType(value string) (string, error) {
	credentialType := strings.ToLower(strings.TrimSpace(value))
	switch credentialType {
	case WatchCredentialBearer, WatchCredentialAPIKey, WatchCredentialCookie:
		return credentialType, nil
	default:
		return "", fmt.Errorf("unsupported watch source credential type")
	}
}

func normalizeWatchSourceInteractiveCredential(credentialType string, credential *WatchSourceCredential) (WatchSourceCredential, error) {
	if credential == nil {
		return WatchSourceCredential{}, ErrWatchSourceInteractiveAuthCredentialMissing
	}
	extraHeaders, err := normalizeWatchSourceCredentialExtraHeaders(credential.ExtraHeaders)
	if err != nil {
		return WatchSourceCredential{}, err
	}
	normalized := WatchSourceCredential{UserAgent: strings.TrimSpace(credential.UserAgent), ExtraHeaders: extraHeaders}
	if len(normalized.UserAgent) > watchSourceInteractiveUserAgentMaxLength {
		return WatchSourceCredential{}, ErrWatchSourceInteractiveAuthCredentialTooLarge
	}
	switch credentialType {
	case WatchCredentialAPIKey:
		normalized.APIKey = strings.TrimSpace(credential.APIKey)
	case WatchCredentialCookie:
		normalized.Cookie = strings.TrimSpace(credential.Cookie)
	default:
		token := strings.TrimSpace(credential.AccessToken)
		if len(token) >= len("Bearer ") && strings.EqualFold(token[:len("Bearer ")], "Bearer ") {
			token = strings.TrimSpace(token[len("Bearer "):])
		}
		normalized.AccessToken = token
	}
	if len(normalized.SecretFor(credentialType)) > watchSourceInteractiveCredentialMaxLength {
		return WatchSourceCredential{}, ErrWatchSourceInteractiveAuthCredentialTooLarge
	}
	return normalized, nil
}

func normalizeWatchSourceCredentialExtraHeaders(headers map[string]string) (map[string]string, error) {
	if len(headers) == 0 {
		return nil, nil
	}
	normalized := make(map[string]string, 1)
	for key, value := range headers {
		name := strings.ToLower(strings.TrimSpace(key))
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if name != "new-api-user" {
			return nil, ErrWatchSourceInteractiveAuthCredentialInvalid
		}
		if len(trimmed) > watchSourceInteractiveExtraHeaderMaxLength || strings.ContainsAny(trimmed, "\r\n") {
			return nil, ErrWatchSourceInteractiveAuthCredentialInvalid
		}
		normalized["new-api-user"] = trimmed
	}
	if len(normalized) == 0 {
		return nil, nil
	}
	return normalized, nil
}

func (s *WatchSourceService) prepareMutation(ctx context.Context, input WatchSourceInput, actorID, existingID int64) (*WatchSourceMutation, error) {
	if s == nil || s.repo == nil || s.encryptor == nil {
		return nil, fmt.Errorf("watch source service is unavailable")
	}
	var existing *WatchSource
	if existingID > 0 {
		var err error
		existing, err = s.repo.GetSource(ctx, existingID)
		if err != nil {
			return nil, err
		}
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 100 {
		return nil, fmt.Errorf("watch source name must contain 1 to 100 characters")
	}
	adapter := strings.ToLower(strings.TrimSpace(input.AdapterType))
	if adapter != WatchSourceAdapterSub2API && adapter != WatchSourceAdapterNewAPI && adapter != WatchSourceAdapterCustom {
		return nil, fmt.Errorf("unsupported watch source adapter")
	}
	baseURL, err := normalizeWatchSourceURL(input.BaseURL)
	if err != nil {
		return nil, err
	}
	apiBaseInput := strings.TrimSpace(input.APIBaseURL)
	if apiBaseInput == "" {
		apiBaseInput = baseURL
		if adapter != WatchSourceAdapterNewAPI && !strings.HasSuffix(strings.ToLower(apiBaseInput), "/api/v1") {
			apiBaseInput += "/api/v1"
		}
	}
	if adapter == WatchSourceAdapterNewAPI {
		apiBaseInput = stripWatchNewAPIBaseSuffix(apiBaseInput)
	}
	apiBaseURL, err := normalizeWatchSourceURL(apiBaseInput)
	if err != nil {
		return nil, fmt.Errorf("invalid watch source api base url: %w", err)
	}
	ratio := input.RechargeRatio
	if ratio == 0 {
		ratio = 1
	}
	if ratio <= 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio > 1_000_000 {
		return nil, fmt.Errorf("recharge_ratio must be positive and finite")
	}
	if input.LowBalanceThreshold < 0 || math.IsNaN(input.LowBalanceThreshold) || math.IsInf(input.LowBalanceThreshold, 0) {
		return nil, fmt.Errorf("low_balance_threshold must be non-negative and finite")
	}
	interval := input.PollingIntervalSeconds
	if interval == 0 {
		interval = 60
	}
	if interval < 30 || interval > 3600 {
		return nil, fmt.Errorf("polling_interval_seconds must be between 30 and 3600")
	}
	timeout := input.RequestTimeoutSeconds
	if timeout == 0 {
		timeout = 15
	}
	if timeout < 3 || timeout > 60 {
		return nil, fmt.Errorf("request_timeout_seconds must be between 3 and 60")
	}
	keepaliveEnabled := true
	if existing != nil {
		keepaliveEnabled = existing.KeepaliveEnabled
	}
	if input.KeepaliveEnabled != nil {
		keepaliveEnabled = *input.KeepaliveEnabled
	}
	autoFollowKeyGroup := true
	if existing != nil {
		autoFollowKeyGroup = existing.AutoFollowKeyGroup
	}
	if input.AutoFollowKeyGroup != nil {
		autoFollowKeyGroup = *input.AutoFollowKeyGroup
	}
	keepaliveInterval := input.KeepaliveIntervalSeconds
	if keepaliveInterval == 0 {
		if existing != nil && existing.KeepaliveIntervalSeconds > 0 {
			keepaliveInterval = existing.KeepaliveIntervalSeconds
		} else {
			keepaliveInterval = 300
		}
	}
	if keepaliveInterval < 30 || keepaliveInterval > 86400 {
		return nil, fmt.Errorf("keepalive_interval_seconds must be between 30 and 86400")
	}
	paths, err := normalizeWatchSourcePaths(adapter, input, existing)
	if err != nil {
		return nil, err
	}
	readMapping, err := NormalizeWatchSourceReadMapping(input.ReadMapping, adapter)
	if err != nil {
		return nil, err
	}
	authMode := strings.ToLower(strings.TrimSpace(input.AuthMode))
	if authMode == "" {
		if existing != nil && existing.AuthMode != "" {
			authMode = existing.AuthMode
		} else {
			authMode = WatchSourceAuthModeManual
		}
	}
	if authMode != WatchSourceAuthModeManual && authMode != WatchSourceAuthModePassword {
		return nil, fmt.Errorf("unsupported watch source auth mode")
	}
	source := &WatchSource{
		Name: name, AdapterType: adapter, BaseURL: baseURL, APIBaseURL: apiBaseURL,
		RechargeRatio: ratio, LowBalanceThreshold: input.LowBalanceThreshold,
		PollingIntervalSeconds: interval, RequestTimeoutSeconds: timeout,
		AuthMode: authMode, ProfilePath: paths.ProfilePath, GroupsPath: paths.GroupsPath,
		RatesPath: paths.RatesPath, PricingPath: paths.PricingPath, KeysPath: paths.KeysPath,
		LoginPath: paths.LoginPath, LoginUsernameHint: existingWatchLoginUsernameHint(existing),
		HeartbeatPath: paths.HeartbeatPath, ReadMapping: readMapping,
		KeepaliveEnabled: keepaliveEnabled, KeepaliveIntervalSeconds: keepaliveInterval,
		AutoFollowKeyGroup: autoFollowKeyGroup, Enabled: input.Enabled,
		UpdatedBy: &actorID,
	}
	credentialType := strings.ToLower(strings.TrimSpace(input.CredentialType))
	encrypted := ""
	encryptedLogin := ""
	mutation := &WatchSourceMutation{Source: source}
	switch authMode {
	case WatchSourceAuthModeManual:
		mutation.ClearLoginCredential = true
		if input.Credential == nil {
			mutation.ClearCredential = input.ClearCredential
			return mutation, nil
		}
		if credentialType == "" {
			credentialType = WatchCredentialBearer
		}
		if credentialType != WatchCredentialBearer && credentialType != WatchCredentialAPIKey && credentialType != WatchCredentialCookie {
			return nil, fmt.Errorf("unsupported watch source credential type")
		}
		if input.Credential.SecretFor(credentialType) == "" {
			return nil, fmt.Errorf("watch source credential is empty")
		}
		if err := s.ensureStableEncryptionForCredentialWrite(); err != nil {
			return nil, err
		}
		payload, marshalErr := json.Marshal(input.Credential)
		if marshalErr != nil {
			return nil, fmt.Errorf("encode watch source credential: %w", marshalErr)
		}
		encrypted, err = s.encryptor.Encrypt(string(payload))
		if err != nil {
			return nil, fmt.Errorf("encrypt watch source credential: %w", err)
		}
		mutation.CredentialType = credentialType
		mutation.EncryptedSecret = encrypted
	case WatchSourceAuthModePassword:
		if strings.TrimSpace(paths.LoginPath) == "" {
			return nil, ErrWatchSourcePasswordAuthUnsupported
		}
		loginCredential := WatchSourceCredential{}
		if input.Credential != nil {
			loginCredential.UserAgent = input.Credential.UserAgent
		}
		username := firstNonEmptyWatchString(input.LoginUsername, input.LoginEmail)
		password := strings.TrimSpace(input.LoginPassword)
		if password == "" {
			if existing != nil && existing.HasLoginCredential {
				mutation.CredentialType = firstNonEmptyWatchString(existing.CredentialType, WatchCredentialBearer)
				return mutation, nil
			}
			return nil, ErrWatchSourcePasswordAuthMissingDetails
		}
		if strings.TrimSpace(username) == "" {
			return nil, ErrWatchSourcePasswordAuthMissingDetails
		}
		if err := s.ensureStableEncryptionForCredentialWrite(); err != nil {
			return nil, err
		}
		source.LoginUsernameHint = maskWatchLoginUsername(username)
		loginFunc := s.passwordLogin
		if loginFunc == nil {
			loginFunc = loginWatchSourceWithPassword
		}
		credential, loginErr := loginFunc(ctx, source, username, input.LoginPassword, loginCredential, s.allowPrivateNetwork)
		if loginErr != nil {
			return nil, loginErr
		}
		credentialType = credentialTypeForWatchCredential(credential)
		credentialPayload, marshalErr := json.Marshal(credential)
		if marshalErr != nil {
			return nil, fmt.Errorf("encode watch source credential: %w", marshalErr)
		}
		encrypted, err = s.encryptor.Encrypt(string(credentialPayload))
		if err != nil {
			return nil, fmt.Errorf("encrypt watch source credential: %w", err)
		}
		loginPayload, marshalErr := json.Marshal(WatchSourceLoginCredential{
			Username:  strings.TrimSpace(username),
			Password:  input.LoginPassword,
			UserAgent: strings.TrimSpace(loginCredential.UserAgent),
		})
		if marshalErr != nil {
			return nil, fmt.Errorf("encode watch source login credential: %w", marshalErr)
		}
		encryptedLogin, err = s.encryptor.Encrypt(string(loginPayload))
		if err != nil {
			return nil, fmt.Errorf("encrypt watch source login credential: %w", err)
		}
		mutation.CredentialType = credentialType
		mutation.EncryptedSecret = encrypted
		mutation.EncryptedLoginSecret = encryptedLogin
	default:
		return nil, fmt.Errorf("unsupported watch source auth mode")
	}
	return mutation, nil
}

func normalizeWatchSourceURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Hostname() == "" {
		return "", fmt.Errorf("watch source url is invalid")
	}
	if parsed.Scheme != "https" {
		return "", fmt.Errorf("watch source url must use HTTPS")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("watch source url must not contain credentials, query, or fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return strings.TrimRight(parsed.String(), "/"), nil
}

type watchSourcePathConfig struct {
	ProfilePath   string
	GroupsPath    string
	RatesPath     string
	PricingPath   string
	KeysPath      string
	LoginPath     string
	HeartbeatPath string
}

func normalizeWatchSourcePaths(adapter string, input WatchSourceInput, existing *WatchSource) (watchSourcePathConfig, error) {
	paths := defaultWatchSourcePaths(adapter)
	if existing != nil && existing.AdapterType == adapter {
		paths = watchSourcePathConfig{
			ProfilePath:   firstNonEmptyWatchString(existing.ProfilePath, paths.ProfilePath),
			GroupsPath:    firstNonEmptyWatchString(existing.GroupsPath, paths.GroupsPath),
			RatesPath:     firstNonEmptyWatchString(existing.RatesPath, paths.RatesPath),
			PricingPath:   firstNonEmptyWatchString(existing.PricingPath, paths.PricingPath),
			KeysPath:      firstNonEmptyWatchString(existing.KeysPath, paths.KeysPath),
			LoginPath:     firstNonEmptyWatchString(existing.LoginPath, paths.LoginPath),
			HeartbeatPath: firstNonEmptyWatchString(existing.HeartbeatPath, paths.HeartbeatPath),
		}
	}
	candidates := []struct {
		name       string
		value      string
		allowEmpty bool
		apply      func(string)
	}{
		{"profile_path", input.ProfilePath, false, func(value string) { paths.ProfilePath = value }},
		{"groups_path", input.GroupsPath, false, func(value string) { paths.GroupsPath = value }},
		{"rates_path", input.RatesPath, true, func(value string) { paths.RatesPath = value }},
		{"pricing_path", input.PricingPath, true, func(value string) { paths.PricingPath = value }},
		{"keys_path", input.KeysPath, true, func(value string) { paths.KeysPath = value }},
		{"login_path", input.LoginPath, true, func(value string) { paths.LoginPath = value }},
		{"heartbeat_path", input.HeartbeatPath, false, func(value string) { paths.HeartbeatPath = value }},
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.value) == "" {
			continue
		}
		normalized, err := normalizeWatchEndpointPath(candidate.name, candidate.value, candidate.allowEmpty)
		if err != nil {
			return watchSourcePathConfig{}, err
		}
		candidate.apply(normalized)
	}
	if paths.HeartbeatPath == "" {
		paths.HeartbeatPath = paths.ProfilePath
	}
	return paths, nil
}

func defaultWatchSourcePaths(adapter string) watchSourcePathConfig {
	switch adapter {
	case WatchSourceAdapterNewAPI:
		return watchSourcePathConfig{
			ProfilePath: "/api/user/self", GroupsPath: "/api/user/self/groups",
			PricingPath: "/api/pricing", KeysPath: watchDefaultNewAPIKeyPath,
			LoginPath: "/api/user/login", HeartbeatPath: "/api/user/self",
		}
	case WatchSourceAdapterCustom:
		return watchSourcePathConfig{
			ProfilePath: "/user/profile", GroupsPath: "/groups/available", RatesPath: "/groups/rates",
			PricingPath: "/channels/available", LoginPath: "/auth/login", HeartbeatPath: "/user/profile",
		}
	default:
		return watchSourcePathConfig{
			ProfilePath: "/user/profile", GroupsPath: "/groups/available", RatesPath: "/groups/rates",
			PricingPath: "/channels/available", KeysPath: watchDefaultSub2APIKeyPath,
			LoginPath: "/auth/login", HeartbeatPath: "/user/profile",
		}
	}
}

func normalizeWatchEndpointPath(field, raw string, allowEmpty bool) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		if allowEmpty {
			return "", nil
		}
		return "", fmt.Errorf("%s must not be empty", field)
	}
	if len(value) > 1000 || strings.ContainsAny(value, "\\\r\n\t") {
		return "", fmt.Errorf("%s is invalid", field)
	}
	if !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "", fmt.Errorf("%s must be a relative API path", field)
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s must be a relative API path", field)
	}
	return value, nil
}

func firstNonEmptyWatchString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (s *WatchSourceService) List(ctx context.Context) ([]*WatchSource, error) {
	return s.repo.ListSources(ctx)
}

func (s *WatchSourceService) Get(ctx context.Context, id int64) (*WatchSourceSnapshot, error) {
	snapshot, err := s.repo.GetSourceSnapshot(ctx, id)
	if err != nil {
		return nil, wrapWatchSourceSnapshotError(err)
	}
	return snapshot, nil
}

func (s *WatchSourceService) Delete(ctx context.Context, id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid watch source id")
	}
	return s.repo.DeleteSource(ctx, id)
}

func (s *WatchSourceService) ListChecks(ctx context.Context, id int64, limit int) ([]WatchSourceCheck, error) {
	return s.repo.ListSourceChecks(ctx, id, limit)
}

func (s *WatchSourceService) ListKeepaliveChecks(ctx context.Context, id int64, limit int) ([]WatchSourceCheck, error) {
	return s.repo.ListSourceKeepaliveChecks(ctx, id, limit)
}

func (s *WatchSourceService) ListPriceChanges(ctx context.Context, filter WatchPriceChangeFilter) ([]WatchPriceChange, error) {
	return s.repo.ListFilteredPriceChanges(ctx, filter)
}

func (s *WatchSourceService) RunCheck(ctx context.Context, id int64) (*WatchSourceSnapshot, error) {
	value, err, _ := s.checks.Do(fmt.Sprintf("source:%d", id), func() (any, error) {
		return s.runCheck(ctx, id)
	})
	if err != nil {
		return nil, err
	}
	return value.(*WatchSourceSnapshot), nil
}

func (s *WatchSourceService) RunKeepalive(ctx context.Context, id int64) (*WatchSourceSnapshot, error) {
	value, err, _ := s.checks.Do(fmt.Sprintf("source-keepalive:%d", id), func() (any, error) {
		return s.runKeepalive(ctx, id)
	})
	if err != nil {
		return nil, err
	}
	return value.(*WatchSourceSnapshot), nil
}

func (s *WatchSourceService) FetchMappingSnapshot(ctx context.Context, id int64) (*WatchSourceSnapshot, error) {
	source, err := s.repo.GetSource(ctx, id)
	if err != nil {
		return nil, err
	}
	credentialType, encrypted, err := s.repo.GetSourceCredential(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrWatchSourceCredentialLoadFailed, err)
	}
	plain, err := s.encryptor.Decrypt(encrypted)
	if err != nil {
		return nil, ErrWatchSourceCredentialDecryptFailed
	}
	var credential WatchSourceCredential
	if err = json.Unmarshal([]byte(plain), &credential); err != nil {
		return nil, ErrWatchSourceCredentialLoadFailed
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(source.RequestTimeoutSeconds)*time.Second)
	defer cancel()
	observation, err := fetchWatchSourceWithRetry(checkCtx, source, credentialType, credential, s.allowPrivateNetwork)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	for index := range observation.Groups {
		if observation.Groups[index].ObservedAt.IsZero() {
			observation.Groups[index].ObservedAt = now
		}
	}
	for index := range observation.Prices {
		if observation.Prices[index].ObservedAt.IsZero() {
			observation.Prices[index].ObservedAt = now
		}
	}
	for index := range observation.SourceKeys {
		if observation.SourceKeys[index].ObservedAt.IsZero() {
			observation.SourceKeys[index].ObservedAt = now
		}
	}
	sourceCopy := *source
	sourceCopy.LastCheckStatus = "healthy"
	sourceCopy.LastCheckAt = &now
	return &WatchSourceSnapshot{
		Source:     &sourceCopy,
		Balance:    observation.Balance,
		Groups:     observation.Groups,
		Prices:     observation.Prices,
		SourceKeys: observation.SourceKeys,
	}, nil
}

func (s *WatchSourceService) runCheck(ctx context.Context, id int64) (*WatchSourceSnapshot, error) {
	source, err := s.repo.GetSource(ctx, id)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	expiresAt := now.Add(time.Duration(source.PollingIntervalSeconds*2) * time.Second)
	credentialType, encrypted, err := s.repo.GetSourceCredential(ctx, id)
	if err != nil {
		if !errors.Is(err, ErrWatchSourceCredentialAbsent) {
			return nil, fmt.Errorf("%w: %w", ErrWatchSourceCredentialLoadFailed, err)
		}
		observation := WatchSourceObservation{Status: "error", ErrorCode: "credential_missing", ObservedAt: now, ExpiresAt: expiresAt}
		return s.saveObservationAndSnapshot(ctx, id, observation)
	}
	plain, err := s.encryptor.Decrypt(encrypted)
	if err != nil {
		observation := WatchSourceObservation{Status: "error", ErrorCode: "credential_decrypt_failed", ObservedAt: now, ExpiresAt: expiresAt}
		return s.saveObservationAndSnapshot(ctx, id, observation)
	}
	var credential WatchSourceCredential
	if err = json.Unmarshal([]byte(plain), &credential); err != nil {
		observation := WatchSourceObservation{Status: "error", ErrorCode: "credential_invalid", ObservedAt: now, ExpiresAt: expiresAt}
		return s.saveObservationAndSnapshot(ctx, id, observation)
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(source.RequestTimeoutSeconds)*time.Second)
	defer cancel()
	observation, checkErr := fetchWatchSourceWithRetry(checkCtx, source, credentialType, credential, s.allowPrivateNetwork)
	observation.ObservedAt = now
	observation.ExpiresAt = expiresAt
	if checkErr != nil {
		observation.Status = "error"
		observation.ErrorCode = watchConnectorErrorCode(checkErr)
	} else {
		observation.Status = "healthy"
		if observation.Balance != nil && *observation.Balance < source.LowBalanceThreshold {
			observation.Status = "degraded"
			observation.ErrorCode = "low_balance"
		}
	}
	return s.saveObservationAndSnapshot(ctx, id, observation)
}

func (s *WatchSourceService) runKeepalive(ctx context.Context, id int64) (*WatchSourceSnapshot, error) {
	source, err := s.repo.GetSource(ctx, id)
	if err != nil {
		return nil, err
	}
	now := s.now().UTC()
	expiresAt := now.Add(time.Duration(source.KeepaliveIntervalSeconds*2) * time.Second)
	bundle, err := s.repo.GetSourceCredentialBundle(ctx, id)
	if err != nil {
		if !errors.Is(err, ErrWatchSourceCredentialAbsent) {
			return nil, fmt.Errorf("%w: %w", ErrWatchSourceCredentialLoadFailed, err)
		}
		observation := WatchSourceObservation{Status: "error", ErrorCode: "credential_missing", ObservedAt: now, ExpiresAt: expiresAt}
		return s.saveKeepaliveAndSnapshot(ctx, id, observation)
	}

	credentialType := bundle.CredentialType
	if credentialType == "" {
		credentialType = WatchCredentialBearer
	}
	credential, tokenRefreshed, err := s.resolveKeepaliveCredential(ctx, source, bundle, credentialType, now)
	if err != nil {
		observation := WatchSourceObservation{
			Status: "error", ErrorCode: watchSourceAuthErrorCode(err), ObservedAt: now, ExpiresAt: expiresAt,
			TokenRefreshed: tokenRefreshed,
		}
		return s.saveKeepaliveAndSnapshot(ctx, id, observation)
	}

	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(source.RequestTimeoutSeconds)*time.Second)
	defer cancel()
	observation, checkErr := fetchWatchSourceHeartbeat(checkCtx, source, credentialType, credential, s.allowPrivateNetwork)
	observation.ObservedAt = now
	observation.ExpiresAt = expiresAt
	observation.TokenRefreshed = tokenRefreshed
	if checkErr != nil {
		observation.Status = "error"
		observation.ErrorCode = watchConnectorErrorCode(checkErr)
	} else {
		observation.Status = "healthy"
		if observation.Balance != nil && *observation.Balance < source.LowBalanceThreshold {
			observation.Status = "degraded"
			observation.ErrorCode = "low_balance"
		}
	}
	return s.saveKeepaliveAndSnapshot(ctx, id, observation)
}

func (s *WatchSourceService) resolveKeepaliveCredential(ctx context.Context, source *WatchSource, bundle *WatchSourceCredentialBundle, credentialType string, now time.Time) (WatchSourceCredential, bool, error) {
	if source.AuthMode == WatchSourceAuthModePassword {
		if bundle.EncryptedLoginValue == "" {
			return WatchSourceCredential{}, false, ErrWatchSourcePasswordAuthMissingDetails
		}
		plainLogin, err := s.encryptor.Decrypt(bundle.EncryptedLoginValue)
		if err != nil {
			return WatchSourceCredential{}, false, ErrWatchSourceCredentialDecryptFailed
		}
		var loginCredential WatchSourceLoginCredential
		if err = json.Unmarshal([]byte(plainLogin), &loginCredential); err != nil {
			return WatchSourceCredential{}, false, ErrWatchSourceCredentialLoadFailed
		}
		loginFunc := s.passwordLogin
		if loginFunc == nil {
			loginFunc = loginWatchSourceWithPassword
		}
		exchanged, err := loginFunc(ctx, source, loginCredential.Username, loginCredential.Password, WatchSourceCredential{UserAgent: loginCredential.UserAgent}, s.allowPrivateNetwork)
		if err != nil {
			return WatchSourceCredential{}, false, err
		}
		if err = s.ensureStableEncryptionForCredentialWrite(); err != nil {
			return WatchSourceCredential{}, false, err
		}
		payload, err := json.Marshal(exchanged)
		if err != nil {
			return WatchSourceCredential{}, false, fmt.Errorf("encode watch source credential: %w", err)
		}
		encrypted, err := s.encryptor.Encrypt(string(payload))
		if err != nil {
			return WatchSourceCredential{}, false, fmt.Errorf("encrypt watch source credential: %w", err)
		}
		if err = s.repo.UpdateSourceCredential(ctx, source.ID, credentialTypeForWatchCredential(exchanged), encrypted, now); err != nil {
			return WatchSourceCredential{}, false, err
		}
		return exchanged, true, nil
	}
	if bundle.EncryptedValue == "" {
		return WatchSourceCredential{}, false, ErrWatchSourceCredentialAbsent
	}
	plain, err := s.encryptor.Decrypt(bundle.EncryptedValue)
	if err != nil {
		return WatchSourceCredential{}, false, ErrWatchSourceCredentialDecryptFailed
	}
	var credential WatchSourceCredential
	if err = json.Unmarshal([]byte(plain), &credential); err != nil {
		return WatchSourceCredential{}, false, ErrWatchSourceCredentialLoadFailed
	}
	return credential, false, nil
}

func (s *WatchSourceService) saveObservationAndSnapshot(ctx context.Context, id int64, observation WatchSourceObservation) (*WatchSourceSnapshot, error) {
	if err := s.repo.SaveSourceObservation(ctx, id, observation); err != nil {
		if errors.Is(err, ErrWatchSourceNotFound) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %w", ErrWatchSourceObservationPersistFailed, err)
	}
	snapshot, err := s.repo.GetSourceSnapshot(ctx, id)
	if err != nil {
		return nil, wrapWatchSourceSnapshotError(err)
	}
	return snapshot, nil
}

func (s *WatchSourceService) saveKeepaliveAndSnapshot(ctx context.Context, id int64, observation WatchSourceObservation) (*WatchSourceSnapshot, error) {
	if err := s.repo.SaveSourceKeepalive(ctx, id, observation); err != nil {
		if errors.Is(err, ErrWatchSourceNotFound) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: %w", ErrWatchSourceObservationPersistFailed, err)
	}
	snapshot, err := s.repo.GetSourceSnapshot(ctx, id)
	if err != nil {
		return nil, wrapWatchSourceSnapshotError(err)
	}
	return snapshot, nil
}

func wrapWatchSourceSnapshotError(err error) error {
	if errors.Is(err, ErrWatchSourceNotFound) {
		return err
	}
	return fmt.Errorf("%w: %w", ErrWatchSourceSnapshotUnavailable, err)
}

func (s *WatchSourceService) DueSourceIDs(ctx context.Context, limit int) ([]int64, error) {
	sources, err := s.repo.ClaimDueSources(ctx, s.now().UTC(), limit)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(sources))
	for _, source := range sources {
		ids = append(ids, source.ID)
	}
	return ids, nil
}

func (s *WatchSourceService) DueKeepaliveSourceIDs(ctx context.Context, limit int) ([]int64, error) {
	sources, err := s.repo.ClaimDueKeepaliveSources(ctx, s.now().UTC(), limit)
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(sources))
	for _, source := range sources {
		ids = append(ids, source.ID)
	}
	return ids, nil
}

func fetchWatchSourceWithRetry(ctx context.Context, source *WatchSource, credentialType string, credential WatchSourceCredential, allowPrivate bool) (WatchSourceObservation, error) {
	var observation WatchSourceObservation
	var err error
	for attempt := 0; attempt < watchSourceMaxAttempts; attempt++ {
		observation, err = fetchWatchSource(ctx, source, credentialType, credential, allowPrivate)
		if err == nil || !isRetryableWatchConnectorError(err) || attempt == watchSourceMaxAttempts-1 {
			return observation, err
		}
		delay := watchSourceRetryDelay * time.Duration(1<<attempt)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return observation, ctx.Err()
		case <-timer.C:
		}
	}
	return observation, err
}

func isRetryableWatchConnectorError(err error) bool {
	var connectorErr *watchConnectorError
	if !errors.As(err, &connectorErr) {
		return false
	}
	switch connectorErr.code {
	case "network_error", "dns_error", "upstream_error", "read_error":
		return true
	default:
		return false
	}
}

func watchSourceAuthErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrWatchSourceCredentialAbsent):
		return "credential_missing"
	case errors.Is(err, ErrWatchSourceCredentialLoadFailed):
		return "credential_invalid"
	case errors.Is(err, ErrWatchSourceCredentialDecryptFailed):
		return "credential_decrypt_failed"
	case errors.Is(err, ErrWatchSourceInteractiveAuthRequired):
		return "interactive_auth_required"
	case errors.Is(err, ErrWatchSourcePasswordAuthMissingDetails):
		return "login_credential_missing"
	case errors.Is(err, ErrWatchSourcePasswordAuthFailed):
		return "password_auth_failed"
	case errors.Is(err, ErrWatchSourcePasswordAuthUnsupported):
		return "password_auth_unsupported"
	case errors.Is(err, ErrWatchSourcePasswordAuthUnavailable):
		return "password_auth_unavailable"
	case errors.Is(err, ErrWatchSourcePasswordAuthMissingToken):
		return "password_auth_missing_token"
	case errors.Is(err, ErrWatchSourcePasswordAuthInvalidResponse):
		return "password_auth_invalid_response"
	default:
		return watchConnectorErrorCode(err)
	}
}

func stripWatchNewAPIBaseSuffix(raw string) string {
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if strings.HasSuffix(strings.ToLower(value), "/api/v1") {
		return value[:len(value)-len("/api/v1")]
	}
	if strings.HasSuffix(strings.ToLower(value), "/api") {
		return value[:len(value)-len("/api")]
	}
	return raw
}

func existingWatchLoginUsernameHint(existing *WatchSource) string {
	if existing == nil {
		return ""
	}
	return strings.TrimSpace(existing.LoginUsernameHint)
}

func maskWatchLoginUsername(username string) string {
	value := strings.TrimSpace(username)
	if value == "" {
		return ""
	}
	if at := strings.LastIndex(value, "@"); at > 0 {
		local := []rune(value[:at])
		domain := value[at:]
		if len(local) <= 1 {
			return "*" + domain
		}
		maskLen := len(local) - 1
		if maskLen < 2 {
			maskLen = 2
		}
		return string(local[0]) + strings.Repeat("*", maskLen) + domain
	}
	runes := []rune(value)
	if len(runes) <= 2 {
		return strings.Repeat("*", len(runes))
	}
	maskLen := len(runes) - 2
	if maskLen < 2 {
		maskLen = 2
	}
	return string(runes[:1]) + strings.Repeat("*", maskLen) + string(runes[len(runes)-1:])
}
