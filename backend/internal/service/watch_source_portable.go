package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	WatchSourcePortableFormat  = "sub2api-watch-sources"
	WatchSourcePortableVersion = 1

	watchSourcePortableMaxSources     = 100
	watchSourcePortableMinPasswordLen = 12
	watchSourcePortableSaltSize       = 16
	watchSourcePortableNonceSize      = 12
	watchSourcePortableKeySize        = 32
	watchSourcePortableArgonTime      = 2
	watchSourcePortableArgonMemoryKiB = 64 * 1024
	watchSourcePortableArgonThreads   = 1
)

type WatchSourceExportRequest struct {
	SourceIDs          []int64 `json:"source_ids,omitempty"`
	Password           string  `json:"password"`
	IncludeCredentials bool    `json:"include_credentials"`
}

type WatchSourceImportPreviewRequest struct {
	Package  WatchSourcePortableEnvelope `json:"package"`
	Password string                      `json:"password"`
}

type WatchSourceImportApplyRequest struct {
	Package   WatchSourcePortableEnvelope      `json:"package"`
	Password  string                           `json:"password"`
	Decisions []WatchSourceImportApplyDecision `json:"decisions"`
}

type WatchSourceImportApplyDecision struct {
	Index  int    `json:"index"`
	Action string `json:"action"`
	Name   string `json:"name,omitempty"`
}

type WatchSourcePortableEnvelope struct {
	Format     string                    `json:"format"`
	Version    int                       `json:"version"`
	Encrypted  bool                      `json:"encrypted"`
	CreatedAt  time.Time                 `json:"created_at"`
	KDF        WatchSourcePortableKDF    `json:"kdf"`
	Cipher     WatchSourcePortableCipher `json:"cipher"`
	Ciphertext string                    `json:"ciphertext"`
}

type WatchSourcePortableKDF struct {
	Name        string `json:"name"`
	Salt        string `json:"salt"`
	Time        uint32 `json:"time"`
	MemoryKiB   uint32 `json:"memory_kib"`
	Parallelism uint8  `json:"parallelism"`
	KeyLength   uint32 `json:"key_length"`
}

type WatchSourcePortableCipher struct {
	Name  string `json:"name"`
	Nonce string `json:"nonce"`
}

type WatchSourceImportPreview struct {
	Format  string                         `json:"format"`
	Version int                            `json:"version"`
	Count   int                            `json:"count"`
	Items   []WatchSourceImportPreviewItem `json:"items"`
}

type WatchSourceImportPreviewItem struct {
	Index              int    `json:"index"`
	Name               string `json:"name"`
	AdapterType        string `json:"adapter_type"`
	BaseURL            string `json:"base_url"`
	AuthMode           string `json:"auth_mode"`
	HasCredential      bool   `json:"has_credential"`
	HasLoginCredential bool   `json:"has_login_credential"`
	ExistingSourceID   int64  `json:"existing_source_id,omitempty"`
	DefaultAction      string `json:"default_action"`
	Reason             string `json:"reason,omitempty"`
}

type WatchSourceImportResult struct {
	Created int                           `json:"created"`
	Updated int                           `json:"updated"`
	Skipped int                           `json:"skipped"`
	Failed  int                           `json:"failed"`
	Items   []WatchSourceImportResultItem `json:"items"`
}

type WatchSourceImportResultItem struct {
	Index    int    `json:"index"`
	Name     string `json:"name"`
	Action   string `json:"action"`
	SourceID int64  `json:"source_id,omitempty"`
	Status   string `json:"status"`
	Reason   string `json:"reason,omitempty"`
}

type watchSourcePortablePayload struct {
	Format     string                      `json:"format"`
	Version    int                         `json:"version"`
	ExportedAt time.Time                   `json:"exported_at"`
	Sources    []watchSourcePortableSource `json:"sources"`
}

type watchSourcePortableSource struct {
	Name                     string                      `json:"name"`
	AdapterType              string                      `json:"adapter_type"`
	BaseURL                  string                      `json:"base_url"`
	APIBaseURL               string                      `json:"api_base_url,omitempty"`
	RechargeRatio            float64                     `json:"recharge_ratio"`
	LowBalanceThreshold      float64                     `json:"low_balance_threshold"`
	PollingIntervalSeconds   int                         `json:"polling_interval_seconds"`
	RequestTimeoutSeconds    int                         `json:"request_timeout_seconds"`
	KeepaliveEnabled         bool                        `json:"keepalive_enabled"`
	KeepaliveIntervalSeconds int                         `json:"keepalive_interval_seconds"`
	ProfilePath              string                      `json:"profile_path,omitempty"`
	GroupsPath               string                      `json:"groups_path,omitempty"`
	RatesPath                string                      `json:"rates_path,omitempty"`
	PricingPath              string                      `json:"pricing_path,omitempty"`
	KeysPath                 string                      `json:"keys_path,omitempty"`
	LoginPath                string                      `json:"login_path,omitempty"`
	HeartbeatPath            string                      `json:"heartbeat_path,omitempty"`
	ReadMapping              *WatchSourceReadMapping     `json:"read_mapping,omitempty"`
	Enabled                  bool                        `json:"enabled"`
	AuthMode                 string                      `json:"auth_mode"`
	LoginUsernameHint        string                      `json:"login_username_hint,omitempty"`
	CredentialType           string                      `json:"credential_type,omitempty"`
	Credential               *WatchSourceCredential      `json:"credential,omitempty"`
	LoginCredential          *WatchSourceLoginCredential `json:"login_credential,omitempty"`
}

func (s *WatchSourceService) ExportSources(ctx context.Context, req WatchSourceExportRequest) (*WatchSourcePortableEnvelope, error) {
	if err := validateWatchSourcePortablePassword(req.Password); err != nil {
		return nil, err
	}
	sources, err := s.repo.ListSources(ctx)
	if err != nil {
		return nil, err
	}
	selected := selectWatchSourcesForExport(sources, req.SourceIDs)
	if len(selected) == 0 {
		return nil, fmt.Errorf("watch source export has no selected sources")
	}
	if len(selected) > watchSourcePortableMaxSources {
		return nil, fmt.Errorf("watch source export supports at most %d sources", watchSourcePortableMaxSources)
	}
	payload := watchSourcePortablePayload{
		Format:     WatchSourcePortableFormat,
		Version:    WatchSourcePortableVersion,
		ExportedAt: s.now().UTC(),
		Sources:    make([]watchSourcePortableSource, 0, len(selected)),
	}
	for _, source := range selected {
		item := watchSourceToPortableSource(source)
		if req.IncludeCredentials {
			if err := s.attachPortableCredentials(ctx, source, &item); err != nil {
				return nil, err
			}
		}
		payload.Sources = append(payload.Sources, item)
	}
	return encryptWatchSourcePortablePayload(req.Password, payload, s.now().UTC())
}

func (s *WatchSourceService) PreviewImportSources(ctx context.Context, req WatchSourceImportPreviewRequest) (*WatchSourceImportPreview, error) {
	payload, err := decryptWatchSourcePortablePayload(req.Password, req.Package)
	if err != nil {
		return nil, err
	}
	existing, err := s.repo.ListSources(ctx)
	if err != nil {
		return nil, err
	}
	existingByName := map[string]*WatchSource{}
	for _, source := range existing {
		existingByName[normalizeWatchSourceNameKey(source.Name)] = source
	}
	preview := &WatchSourceImportPreview{
		Format:  payload.Format,
		Version: payload.Version,
		Count:   len(payload.Sources),
		Items:   make([]WatchSourceImportPreviewItem, 0, len(payload.Sources)),
	}
	seen := map[string]bool{}
	for index, source := range payload.Sources {
		item := WatchSourceImportPreviewItem{
			Index:              index,
			Name:               strings.TrimSpace(source.Name),
			AdapterType:        strings.TrimSpace(source.AdapterType),
			BaseURL:            strings.TrimSpace(source.BaseURL),
			AuthMode:           strings.TrimSpace(source.AuthMode),
			HasCredential:      source.Credential != nil && source.Credential.SecretFor(portableWatchCredentialType(source.CredentialType)) != "",
			HasLoginCredential: source.LoginCredential != nil && strings.TrimSpace(source.LoginCredential.Password) != "",
			DefaultAction:      "create",
		}
		key := normalizeWatchSourceNameKey(source.Name)
		if key == "" {
			item.DefaultAction = "invalid"
			item.Reason = "watch source name is required"
		} else if seen[key] {
			item.DefaultAction = "invalid"
			item.Reason = "duplicate source name in import package"
		} else if existingSource := existingByName[key]; existingSource != nil {
			item.ExistingSourceID = existingSource.ID
			item.DefaultAction = "skip"
			item.Reason = "source name already exists"
		}
		seen[key] = true
		preview.Items = append(preview.Items, item)
	}
	return preview, nil
}

func (s *WatchSourceService) ApplyImportSources(ctx context.Context, req WatchSourceImportApplyRequest, actorID int64) (*WatchSourceImportResult, error) {
	payload, err := decryptWatchSourcePortablePayload(req.Password, req.Package)
	if err != nil {
		return nil, err
	}
	existing, err := s.repo.ListSources(ctx)
	if err != nil {
		return nil, err
	}
	existingByName := map[string]*WatchSource{}
	for _, source := range existing {
		existingByName[normalizeWatchSourceNameKey(source.Name)] = source
	}
	decisions := map[int]WatchSourceImportApplyDecision{}
	for _, decision := range req.Decisions {
		decisions[decision.Index] = decision
	}
	result := &WatchSourceImportResult{Items: make([]WatchSourceImportResultItem, 0, len(payload.Sources))}
	claimedNames := map[string]bool{}
	seenPortableNames := map[string]bool{}
	for index, portable := range payload.Sources {
		decision, hasDecision := decisions[index]
		action := strings.ToLower(strings.TrimSpace(decision.Action))
		if action == "" {
			action = "create"
			if existingByName[normalizeWatchSourceNameKey(portable.Name)] != nil {
				action = "skip"
			}
		}
		name := strings.TrimSpace(portable.Name)
		originalNameKey := normalizeWatchSourceNameKey(name)
		if action == "rename" {
			name = strings.TrimSpace(decision.Name)
		}
		item := WatchSourceImportResultItem{Index: index, Name: name, Action: action}
		if originalNameKey == "" {
			item.Status = "failed"
			item.Reason = "watch source name is invalid"
			result.Failed++
			result.Items = append(result.Items, item)
			continue
		}
		if seenPortableNames[originalNameKey] {
			item.Status = "failed"
			item.Reason = "duplicate source name in import package"
			result.Failed++
			result.Items = append(result.Items, item)
			continue
		}
		seenPortableNames[originalNameKey] = true
		if !hasDecision && action == "skip" {
			item.Status = "skipped"
			item.Reason = "source name already exists"
			result.Skipped++
			result.Items = append(result.Items, item)
			continue
		}
		if action == "skip" {
			item.Status = "skipped"
			result.Skipped++
			result.Items = append(result.Items, item)
			continue
		}
		if action != "create" && action != "overwrite" && action != "rename" {
			item.Status = "failed"
			item.Reason = "unsupported import action"
			result.Failed++
			result.Items = append(result.Items, item)
			continue
		}
		nameKey := normalizeWatchSourceNameKey(name)
		if nameKey == "" || claimedNames[nameKey] {
			item.Status = "failed"
			item.Reason = "watch source name is invalid or duplicated"
			result.Failed++
			result.Items = append(result.Items, item)
			continue
		}
		existingSource := existingByName[normalizeWatchSourceNameKey(portable.Name)]
		if action == "overwrite" {
			if existingSource == nil {
				item.Status = "failed"
				item.Reason = "source to overwrite was not found"
				result.Failed++
				result.Items = append(result.Items, item)
				continue
			}
			name = existingSource.Name
			nameKey = normalizeWatchSourceNameKey(name)
		} else if existingByName[nameKey] != nil {
			item.Status = "failed"
			item.Reason = "source name already exists"
			result.Failed++
			result.Items = append(result.Items, item)
			continue
		}
		mutation, err := s.preparePortableMutation(ctx, portable, actorID, importExistingID(action, existingSource), name)
		if err != nil {
			item.Status = "failed"
			item.Reason = err.Error()
			result.Failed++
			result.Items = append(result.Items, item)
			continue
		}
		var saved *WatchSource
		if action == "overwrite" {
			saved, err = s.repo.UpdateSource(ctx, *mutation)
		} else {
			saved, err = s.repo.CreateSource(ctx, *mutation)
		}
		if err != nil {
			item.Status = "failed"
			item.Reason = "save watch source failed"
			result.Failed++
			result.Items = append(result.Items, item)
			continue
		}
		item.SourceID = saved.ID
		item.Name = saved.Name
		item.Status = "success"
		if action == "overwrite" {
			result.Updated++
		} else {
			result.Created++
			existingByName[normalizeWatchSourceNameKey(saved.Name)] = saved
		}
		claimedNames[nameKey] = true
		result.Items = append(result.Items, item)
	}
	return result, nil
}

func (s *WatchSourceService) attachPortableCredentials(ctx context.Context, source *WatchSource, item *watchSourcePortableSource) error {
	if source == nil || item == nil || (!source.HasCredential && !source.HasLoginCredential) {
		return nil
	}
	bundle, err := s.repo.GetSourceCredentialBundle(ctx, source.ID)
	if err != nil {
		if errors.Is(err, ErrWatchSourceCredentialAbsent) {
			return nil
		}
		return fmt.Errorf("load watch source credential bundle: %w", err)
	}
	item.CredentialType = portableWatchCredentialType(bundle.CredentialType)
	if bundle.EncryptedValue != "" {
		plain, err := s.encryptor.Decrypt(bundle.EncryptedValue)
		if err != nil {
			return ErrWatchSourceCredentialDecryptFailed
		}
		var credential WatchSourceCredential
		if err := json.Unmarshal([]byte(plain), &credential); err != nil {
			return ErrWatchSourceCredentialLoadFailed
		}
		item.Credential = &credential
	}
	if bundle.EncryptedLoginValue != "" {
		plain, err := s.encryptor.Decrypt(bundle.EncryptedLoginValue)
		if err != nil {
			return ErrWatchSourceCredentialDecryptFailed
		}
		var credential WatchSourceLoginCredential
		if err := json.Unmarshal([]byte(plain), &credential); err != nil {
			return ErrWatchSourceCredentialLoadFailed
		}
		item.LoginCredential = &credential
	}
	return nil
}

func (s *WatchSourceService) preparePortableMutation(ctx context.Context, portable watchSourcePortableSource, actorID, existingID int64, forcedName string) (*WatchSourceMutation, error) {
	var existing *WatchSource
	if existingID > 0 {
		var err error
		existing, err = s.repo.GetSource(ctx, existingID)
		if err != nil {
			return nil, err
		}
	}
	name := strings.TrimSpace(forcedName)
	if name == "" {
		name = strings.TrimSpace(portable.Name)
	}
	if name == "" || len([]rune(name)) > 100 {
		return nil, fmt.Errorf("watch source name must contain 1 to 100 characters")
	}
	adapter := strings.ToLower(strings.TrimSpace(portable.AdapterType))
	if adapter != WatchSourceAdapterSub2API && adapter != WatchSourceAdapterNewAPI && adapter != WatchSourceAdapterCustom {
		return nil, fmt.Errorf("unsupported watch source adapter")
	}
	baseURL, err := normalizeWatchSourceURL(portable.BaseURL)
	if err != nil {
		return nil, err
	}
	apiBaseURL, err := normalizeWatchSourcePortableAPIBaseURL(adapter, portable.APIBaseURL, baseURL)
	if err != nil {
		return nil, err
	}
	if portable.RechargeRatio <= 0 || math.IsNaN(portable.RechargeRatio) || math.IsInf(portable.RechargeRatio, 0) || portable.RechargeRatio > 1_000_000 {
		return nil, fmt.Errorf("recharge_ratio must be positive and finite")
	}
	if portable.LowBalanceThreshold < 0 || math.IsNaN(portable.LowBalanceThreshold) || math.IsInf(portable.LowBalanceThreshold, 0) {
		return nil, fmt.Errorf("low_balance_threshold must be non-negative and finite")
	}
	if portable.PollingIntervalSeconds < 30 || portable.PollingIntervalSeconds > 3600 {
		return nil, fmt.Errorf("polling_interval_seconds must be between 30 and 3600")
	}
	if portable.RequestTimeoutSeconds < 3 || portable.RequestTimeoutSeconds > 60 {
		return nil, fmt.Errorf("request_timeout_seconds must be between 3 and 60")
	}
	if portable.KeepaliveIntervalSeconds < 30 || portable.KeepaliveIntervalSeconds > 86400 {
		return nil, fmt.Errorf("keepalive_interval_seconds must be between 30 and 86400")
	}
	input := WatchSourceInput{
		AdapterType: adapter, ProfilePath: portable.ProfilePath, GroupsPath: portable.GroupsPath,
		RatesPath: portable.RatesPath, PricingPath: portable.PricingPath, KeysPath: portable.KeysPath,
		LoginPath: portable.LoginPath, HeartbeatPath: portable.HeartbeatPath,
	}
	paths, err := normalizeWatchSourcePaths(adapter, input, existing)
	if err != nil {
		return nil, err
	}
	readMapping, err := NormalizeWatchSourceReadMapping(portable.ReadMapping, adapter)
	if err != nil {
		return nil, err
	}
	authMode := strings.ToLower(strings.TrimSpace(portable.AuthMode))
	if authMode == "" {
		authMode = WatchSourceAuthModeManual
	}
	if authMode != WatchSourceAuthModeManual && authMode != WatchSourceAuthModePassword {
		return nil, fmt.Errorf("unsupported watch source auth mode")
	}
	source := &WatchSource{
		ID: existingID, Name: name, AdapterType: adapter, BaseURL: baseURL, APIBaseURL: apiBaseURL,
		RechargeRatio: portable.RechargeRatio, LowBalanceThreshold: portable.LowBalanceThreshold,
		PollingIntervalSeconds: portable.PollingIntervalSeconds, RequestTimeoutSeconds: portable.RequestTimeoutSeconds,
		AuthMode: authMode, ProfilePath: paths.ProfilePath, GroupsPath: paths.GroupsPath,
		RatesPath: paths.RatesPath, PricingPath: paths.PricingPath, KeysPath: paths.KeysPath,
		LoginPath: paths.LoginPath, LoginUsernameHint: portable.LoginUsernameHint,
		HeartbeatPath: paths.HeartbeatPath, ReadMapping: readMapping,
		KeepaliveEnabled: portable.KeepaliveEnabled, KeepaliveIntervalSeconds: portable.KeepaliveIntervalSeconds,
		Enabled: portable.Enabled, UpdatedBy: &actorID,
	}
	if portable.LoginCredential != nil && strings.TrimSpace(portable.LoginCredential.Username) != "" {
		source.LoginUsernameHint = maskWatchLoginUsername(portable.LoginCredential.Username)
	}
	if existingID == 0 {
		source.CreatedBy = &actorID
	}
	mutation := &WatchSourceMutation{Source: source, CredentialType: portableWatchCredentialType(portable.CredentialType)}
	if mutation.CredentialType != WatchCredentialBearer && mutation.CredentialType != WatchCredentialAPIKey && mutation.CredentialType != WatchCredentialCookie {
		return nil, fmt.Errorf("unsupported watch source credential type")
	}
	if portable.Credential != nil && portable.Credential.SecretFor(mutation.CredentialType) != "" {
		payload, err := json.Marshal(portable.Credential)
		if err != nil {
			return nil, fmt.Errorf("encode watch source credential: %w", err)
		}
		encrypted, err := s.encryptor.Encrypt(string(payload))
		if err != nil {
			return nil, fmt.Errorf("encrypt watch source credential: %w", err)
		}
		mutation.EncryptedSecret = encrypted
	} else if existingID == 0 {
		mutation.ClearCredential = true
	}
	if authMode == WatchSourceAuthModePassword {
		if portable.LoginCredential != nil && strings.TrimSpace(portable.LoginCredential.Username) != "" && strings.TrimSpace(portable.LoginCredential.Password) != "" {
			payload, err := json.Marshal(portable.LoginCredential)
			if err != nil {
				return nil, fmt.Errorf("encode watch source login credential: %w", err)
			}
			encrypted, err := s.encryptor.Encrypt(string(payload))
			if err != nil {
				return nil, fmt.Errorf("encrypt watch source login credential: %w", err)
			}
			mutation.EncryptedLoginSecret = encrypted
		} else if existingID == 0 {
			mutation.ClearLoginCredential = true
		}
	} else if existingID == 0 {
		mutation.ClearLoginCredential = true
	}
	return mutation, nil
}

func watchSourceToPortableSource(source *WatchSource) watchSourcePortableSource {
	if source == nil {
		return watchSourcePortableSource{}
	}
	return watchSourcePortableSource{
		Name: source.Name, AdapterType: source.AdapterType, BaseURL: source.BaseURL, APIBaseURL: source.APIBaseURL,
		RechargeRatio: source.RechargeRatio, LowBalanceThreshold: source.LowBalanceThreshold,
		PollingIntervalSeconds: source.PollingIntervalSeconds, RequestTimeoutSeconds: source.RequestTimeoutSeconds,
		KeepaliveEnabled: source.KeepaliveEnabled, KeepaliveIntervalSeconds: source.KeepaliveIntervalSeconds,
		ProfilePath: source.ProfilePath, GroupsPath: source.GroupsPath, RatesPath: source.RatesPath,
		PricingPath: source.PricingPath, KeysPath: source.KeysPath, LoginPath: source.LoginPath,
		HeartbeatPath: source.HeartbeatPath, ReadMapping: source.ReadMapping, Enabled: source.Enabled,
		AuthMode: source.AuthMode, LoginUsernameHint: source.LoginUsernameHint,
		CredentialType: portableWatchCredentialType(source.CredentialType),
	}
}

func selectWatchSourcesForExport(sources []*WatchSource, ids []int64) []*WatchSource {
	if len(ids) == 0 {
		return sources
	}
	allowed := map[int64]bool{}
	for _, id := range ids {
		if id > 0 {
			allowed[id] = true
		}
	}
	selected := make([]*WatchSource, 0, len(allowed))
	for _, source := range sources {
		if source != nil && allowed[source.ID] {
			selected = append(selected, source)
		}
	}
	return selected
}

func importExistingID(action string, existing *WatchSource) int64 {
	if action == "overwrite" && existing != nil {
		return existing.ID
	}
	return 0
}

func normalizeWatchSourceNameKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func portableWatchCredentialType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case WatchCredentialAPIKey, WatchCredentialCookie:
		return value
	default:
		return WatchCredentialBearer
	}
}

func normalizeWatchSourcePortableAPIBaseURL(adapter, raw, baseURL string) (string, error) {
	apiBaseInput := strings.TrimSpace(raw)
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
		return "", fmt.Errorf("invalid watch source api base url: %w", err)
	}
	return apiBaseURL, nil
}

func encryptWatchSourcePortablePayload(password string, payload watchSourcePortablePayload, createdAt time.Time) (*WatchSourcePortableEnvelope, error) {
	plain, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode watch source export payload: %w", err)
	}
	salt, err := randomWatchPortableBytes(watchSourcePortableSaltSize)
	if err != nil {
		return nil, err
	}
	nonce, err := randomWatchPortableBytes(watchSourcePortableNonceSize)
	if err != nil {
		return nil, err
	}
	key := deriveWatchSourcePortableKey(password, salt, watchSourcePortableArgonTime, watchSourcePortableArgonMemoryKiB, watchSourcePortableArgonThreads, watchSourcePortableKeySize)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create watch source export cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create watch source export aead: %w", err)
	}
	ciphertext := aead.Seal(nil, nonce, plain, []byte(WatchSourcePortableFormat))
	return &WatchSourcePortableEnvelope{
		Format:    WatchSourcePortableFormat,
		Version:   WatchSourcePortableVersion,
		Encrypted: true,
		CreatedAt: createdAt,
		KDF: WatchSourcePortableKDF{
			Name: "argon2id", Salt: base64.StdEncoding.EncodeToString(salt),
			Time: watchSourcePortableArgonTime, MemoryKiB: watchSourcePortableArgonMemoryKiB,
			Parallelism: watchSourcePortableArgonThreads, KeyLength: watchSourcePortableKeySize,
		},
		Cipher:     WatchSourcePortableCipher{Name: "aes-256-gcm", Nonce: base64.StdEncoding.EncodeToString(nonce)},
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	}, nil
}

func decryptWatchSourcePortablePayload(password string, envelope WatchSourcePortableEnvelope) (*watchSourcePortablePayload, error) {
	if err := validateWatchSourcePortablePassword(password); err != nil {
		return nil, err
	}
	if envelope.Format != WatchSourcePortableFormat || envelope.Version != WatchSourcePortableVersion || !envelope.Encrypted {
		return nil, fmt.Errorf("unsupported watch source import package")
	}
	if envelope.KDF.Name != "argon2id" || envelope.Cipher.Name != "aes-256-gcm" {
		return nil, fmt.Errorf("unsupported watch source import crypto")
	}
	if envelope.KDF.KeyLength != watchSourcePortableKeySize || envelope.KDF.Time == 0 || envelope.KDF.MemoryKiB < 16*1024 || envelope.KDF.Parallelism == 0 {
		return nil, fmt.Errorf("invalid watch source import kdf parameters")
	}
	salt, err := base64.StdEncoding.DecodeString(envelope.KDF.Salt)
	if err != nil || len(salt) < watchSourcePortableSaltSize {
		return nil, fmt.Errorf("invalid watch source import salt")
	}
	nonce, err := base64.StdEncoding.DecodeString(envelope.Cipher.Nonce)
	if err != nil || len(nonce) != watchSourcePortableNonceSize {
		return nil, fmt.Errorf("invalid watch source import nonce")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil || len(ciphertext) == 0 || len(ciphertext) > 5*1024*1024 {
		return nil, fmt.Errorf("invalid watch source import ciphertext")
	}
	key := deriveWatchSourcePortableKey(password, salt, envelope.KDF.Time, envelope.KDF.MemoryKiB, envelope.KDF.Parallelism, envelope.KDF.KeyLength)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create watch source import cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create watch source import aead: %w", err)
	}
	plain, err := aead.Open(nil, nonce, ciphertext, []byte(WatchSourcePortableFormat))
	if err != nil {
		return nil, fmt.Errorf("watch source import password is invalid or package is corrupted")
	}
	var payload watchSourcePortablePayload
	if err := json.Unmarshal(plain, &payload); err != nil {
		return nil, fmt.Errorf("decode watch source import payload: %w", err)
	}
	if payload.Format != WatchSourcePortableFormat || payload.Version != WatchSourcePortableVersion {
		return nil, fmt.Errorf("unsupported watch source import payload")
	}
	if len(payload.Sources) == 0 || len(payload.Sources) > watchSourcePortableMaxSources {
		return nil, fmt.Errorf("watch source import supports 1 to %d sources", watchSourcePortableMaxSources)
	}
	return &payload, nil
}

func validateWatchSourcePortablePassword(password string) error {
	if len([]rune(password)) < watchSourcePortableMinPasswordLen {
		return fmt.Errorf("watch source export password must contain at least %d characters", watchSourcePortableMinPasswordLen)
	}
	return nil
}

func deriveWatchSourcePortableKey(password string, salt []byte, timeCost, memoryKiB uint32, parallelism uint8, keyLength uint32) []byte {
	return argon2.IDKey([]byte(password), salt, timeCost, memoryKiB, parallelism, keyLength)
}

func randomWatchPortableBytes(size int) ([]byte, error) {
	value := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, value); err != nil {
		return nil, fmt.Errorf("generate watch source export random bytes: %w", err)
	}
	return value, nil
}
