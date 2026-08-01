package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const watchDiagnosticPreviewLimit = 480

type WatchSourceDiagnosticRequest struct {
	Input WatchSourceInput
}

type WatchSourceEndpointDiagnostic struct {
	Name            string   `json:"name"`
	Method          string   `json:"method"`
	Path            string   `json:"path"`
	URL             string   `json:"url"`
	Status          string   `json:"status"`
	ErrorCode       string   `json:"error_code,omitempty"`
	StatusCode      int      `json:"status_code,omitempty"`
	ContentType     string   `json:"content_type,omitempty"`
	LatencyMs       int      `json:"latency_ms"`
	Optional        bool     `json:"optional"`
	JSON            bool     `json:"json"`
	ResponseKeys    []string `json:"response_keys,omitempty"`
	ResponsePreview string   `json:"response_preview,omitempty"`
	Reason          string   `json:"reason,omitempty"`
}

type WatchSourceDiagnosticReport struct {
	AdapterType string                          `json:"adapter_type"`
	BaseURL     string                          `json:"base_url"`
	APIBaseURL  string                          `json:"api_base_url"`
	AuthMode    string                          `json:"auth_mode"`
	GeneratedAt time.Time                       `json:"generated_at"`
	Endpoints   []WatchSourceEndpointDiagnostic `json:"endpoints"`
}

func (s *WatchSourceService) DiagnoseInput(ctx context.Context, request WatchSourceDiagnosticRequest) (*WatchSourceDiagnosticReport, error) {
	input := request.Input
	adapter := strings.ToLower(strings.TrimSpace(input.AdapterType))
	if adapter != WatchSourceAdapterSub2API && adapter != WatchSourceAdapterNewAPI && adapter != WatchSourceAdapterCustom {
		return nil, fmt.Errorf("unsupported watch source adapter")
	}
	baseURL, err := normalizeWatchSourceURL(input.BaseURL)
	if err != nil {
		return nil, err
	}
	apiBaseURL := baseURL
	if strings.TrimSpace(input.APIBaseURL) != "" {
		apiBaseURL, err = normalizeWatchSourceURL(input.APIBaseURL)
		if err != nil {
			return nil, err
		}
	}
	paths, err := normalizeWatchSourcePaths(adapter, input, nil)
	if err != nil {
		return nil, err
	}
	readMapping, err := NormalizeWatchSourceReadMapping(input.ReadMapping, adapter)
	if err != nil {
		return nil, err
	}
	source := &WatchSource{
		Name: input.Name, AdapterType: adapter, BaseURL: baseURL, APIBaseURL: apiBaseURL,
		RequestTimeoutSeconds: input.RequestTimeoutSeconds, ProfilePath: paths.ProfilePath,
		GroupsPath: paths.GroupsPath, RatesPath: paths.RatesPath, PricingPath: paths.PricingPath,
		KeysPath: paths.KeysPath, LoginPath: paths.LoginPath, HeartbeatPath: paths.HeartbeatPath,
		ReadMapping: readMapping,
	}
	if source.RequestTimeoutSeconds <= 0 {
		source.RequestTimeoutSeconds = 15
	}
	client := newWatchSourceHTTPClient(time.Duration(source.RequestTimeoutSeconds)*time.Second, s.allowPrivateNetwork)
	report := &WatchSourceDiagnosticReport{
		AdapterType: adapter, BaseURL: baseURL, APIBaseURL: apiBaseURL,
		AuthMode:    strings.ToLower(strings.TrimSpace(input.AuthMode)),
		GeneratedAt: s.now().UTC(), Endpoints: make([]WatchSourceEndpointDiagnostic, 0, 8),
	}
	if report.AuthMode == "" {
		report.AuthMode = WatchSourceAuthModeManual
	}

	credentialType := strings.ToLower(strings.TrimSpace(input.CredentialType))
	credential := WatchSourceCredential{}
	if input.Credential != nil {
		credential = *input.Credential
	}
	if report.AuthMode == WatchSourceAuthModePassword {
		loginUsername := firstNonEmptyWatchString(input.LoginUsername, input.LoginEmail)
		loginEndpoint := watchDiagnosticEndpoint("login", http.MethodPost, paths.LoginPath, false, apiBaseURL)
		if loginUsername == "" || strings.TrimSpace(input.LoginPassword) == "" {
			loginEndpoint.Status = "needs_auth"
			loginEndpoint.ErrorCode = "login_credential_missing"
			loginEndpoint.Reason = "请填写登录账号和密码"
			report.Endpoints = append(report.Endpoints, loginEndpoint)
		} else {
			loginResponse := requestWatchLoginResponse(ctx, client, joinWatchURL(apiBaseURL, paths.LoginPath), adapter, credential, loginUsername, input.LoginPassword)
			loginEndpoint = loginResponse.diagnostic
			if loginResponse.err == nil && watchLoginRequiresInteractiveAuth(loginResponse.payload) {
				loginEndpoint.Status = "interactive_auth"
				loginEndpoint.ErrorCode = "interactive_auth_required"
				loginEndpoint.Reason = "上游要求 2FA/TOTP/Turnstile/验证码"
			} else if loginResponse.err == nil && (loginResponse.status == http.StatusUnauthorized || loginResponse.status == http.StatusForbidden) {
				loginEndpoint.Status = "needs_auth"
				loginEndpoint.ErrorCode = "unauthorized"
				loginEndpoint.Reason = "账号密码未通过上游认证"
			} else if loginResponse.err == nil && (loginResponse.status < 200 || loginResponse.status >= 300) {
				loginEndpoint.Status = "error"
				loginEndpoint.ErrorCode = watchHTTPStatusCode(loginResponse.status)
				loginEndpoint.Reason = fmt.Sprintf("上游返回 HTTP %d", loginResponse.status)
			}
			report.Endpoints = append(report.Endpoints, loginEndpoint)
			if loginResponse.err == nil {
				if token := watchLoginAccessToken(loginResponse.payload); token != "" {
					credential = WatchSourceCredential{AccessToken: token, UserAgent: strings.TrimSpace(credential.UserAgent)}
				} else if loginResponse.cookie != "" {
					credential = WatchSourceCredential{Cookie: loginResponse.cookie, UserAgent: strings.TrimSpace(credential.UserAgent)}
				}
				credentialType = credentialTypeForWatchCredential(credential)
			}
		}
	} else {
		if credentialType == "" {
			credentialType = WatchCredentialBearer
		}
		if credential.SecretFor(credentialType) == "" {
			credentialType = ""
		}
	}

	probe := func(name, path string, optional bool) {
		if strings.TrimSpace(path) == "" {
			report.Endpoints = append(report.Endpoints, watchDiagnosticEndpoint(name, http.MethodGet, path, optional, apiBaseURL))
			report.Endpoints[len(report.Endpoints)-1].Status = "skipped"
			report.Endpoints[len(report.Endpoints)-1].Reason = "未配置接口路径"
			return
		}
		endpoint := probeWatchEndpoint(ctx, client, name, path, optional, apiBaseURL, credentialType, credential)
		report.Endpoints = append(report.Endpoints, endpoint)
	}
	probe("profile", paths.ProfilePath, false)
	probe("groups", paths.GroupsPath, false)
	probe("rates", paths.RatesPath, true)
	probe("pricing", paths.PricingPath, true)
	probe("keys", paths.KeysPath, true)
	probe("heartbeat", paths.HeartbeatPath, false)
	return report, nil
}

type watchEndpointProbeResponse struct {
	diagnostic WatchSourceEndpointDiagnostic
	credential WatchSourceCredential
	err        error
}

func watchDiagnosticEndpoint(name, method, path string, optional bool, baseURL string) WatchSourceEndpointDiagnostic {
	return WatchSourceEndpointDiagnostic{
		Name: name, Method: method, Path: path, URL: safeWatchDiagnosticURL(baseURL, path),
		Status: "pending", Optional: optional,
	}
}

func watchDiagnosticEndpointFromURL(name, method, endpoint string, optional bool) WatchSourceEndpointDiagnostic {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return watchDiagnosticEndpoint(name, method, endpoint, optional, endpoint)
	}
	base := parsed.Scheme + "://" + parsed.Host
	path := parsed.EscapedPath()
	if path == "" {
		path = "/"
	}
	return watchDiagnosticEndpoint(name, method, path, optional, base)
}

func probeWatchEndpoint(ctx context.Context, client *http.Client, name, path string, optional bool, baseURL, credentialType string, credential WatchSourceCredential) WatchSourceEndpointDiagnostic {
	diagnostic := watchDiagnosticEndpoint(name, http.MethodGet, path, optional, baseURL)
	if credentialType == "" {
		diagnostic.Status = "needs_auth"
		diagnostic.ErrorCode = "credential_missing"
		diagnostic.Reason = "请先配置 Token、API Key、Cookie 或账号密码"
		return diagnostic
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, joinWatchURL(baseURL, path), nil)
	if err != nil {
		diagnostic.Status = "error"
		diagnostic.ErrorCode = "invalid_url"
		diagnostic.Reason = "接口地址无效"
		return diagnostic
	}
	applyWatchCredentialHeaders(req, credentialType, credential)
	started := time.Now()
	resp, err := client.Do(req)
	diagnostic.LatencyMs = int(time.Since(started).Milliseconds())
	if err != nil {
		diagnostic.Status = "error"
		diagnostic.ErrorCode = watchConnectorErrorCode(err)
		diagnostic.Reason = safeWatchDiagnosticError(err)
		return diagnostic
	}
	defer resp.Body.Close()
	diagnostic.StatusCode = resp.StatusCode
	diagnostic.ContentType = strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, watchMaxResponseBytes+1))
	if readErr != nil {
		diagnostic.Status = "error"
		diagnostic.ErrorCode = "read_error"
		diagnostic.Reason = "读取响应失败"
		return diagnostic
	}
	if len(body) > watchMaxResponseBytes {
		diagnostic.Status = "error"
		diagnostic.ErrorCode = "response_too_large"
		diagnostic.Reason = "响应超过安全大小限制"
		return diagnostic
	}
	diagnostic.JSON, diagnostic.ResponseKeys, diagnostic.ResponsePreview = summarizeWatchDiagnosticBody(body, diagnostic.ContentType)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		diagnostic.Status = "needs_auth"
		if resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden {
			diagnostic.Status = "error"
		}
		diagnostic.ErrorCode = watchHTTPStatusCode(resp.StatusCode)
		diagnostic.Reason = fmt.Sprintf("上游返回 HTTP %d", resp.StatusCode)
		return diagnostic
	}
	if !diagnostic.JSON {
		diagnostic.Status = "error"
		diagnostic.ErrorCode = "invalid_response"
		diagnostic.Reason = "响应不是 JSON，可能访问到了网页地址"
		return diagnostic
	}
	diagnostic.Status = "success"
	diagnostic.Reason = "接口响应正常"
	return diagnostic
}

func applyWatchCredentialHeaders(req *http.Request, credentialType string, credential WatchSourceCredential) {
	secret := credential.SecretFor(credentialType)
	switch credentialType {
	case WatchCredentialAPIKey:
		req.Header.Set("x-api-key", secret)
	case WatchCredentialCookie:
		req.Header.Set("Cookie", secret)
	default:
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	if strings.TrimSpace(credential.UserAgent) != "" {
		req.Header.Set("User-Agent", strings.TrimSpace(credential.UserAgent))
	} else {
		req.Header.Set("User-Agent", "Sub2API-Watch/1")
	}
	applyWatchSourceExtraHeaders(req, credential)
	req.Header.Set("Accept", "application/json")
}

func summarizeWatchDiagnosticBody(body []byte, contentType string) (bool, []string, string) {
	trimmed := bytes.TrimSpace(body)
	var payload any
	if len(trimmed) > 0 && json.Unmarshal(trimmed, &payload) == nil {
		keys := watchDiagnosticKeys(payload)
		encoded, _ := json.Marshal(redactWatchDiagnosticValue(payload))
		return true, keys, truncateWatchDiagnosticPreview(string(encoded))
	}
	preview := redactWatchDiagnosticText(string(trimmed))
	if strings.Contains(strings.ToLower(contentType), "html") {
		preview = "HTML 页面：" + preview
	}
	return false, nil, truncateWatchDiagnosticPreview(preview)
}

func watchDiagnosticKeys(payload any) []string {
	record, ok := payload.(map[string]any)
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(record))
	for key := range record {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func redactWatchDiagnosticValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if isWatchDiagnosticSensitiveKey(key) {
				out[key] = "[已脱敏]"
				continue
			}
			out[key] = redactWatchDiagnosticValue(item)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for index, item := range typed {
			out[index] = redactWatchDiagnosticValue(item)
		}
		return out
	default:
		if text, ok := typed.(string); ok {
			return redactWatchDiagnosticText(text)
		}
		return value
	}
}

func isWatchDiagnosticSensitiveKey(key string) bool {
	normalized := strings.NewReplacer("-", "_", " ", "_").Replace(strings.ToLower(strings.TrimSpace(key)))
	if strings.Contains(normalized, "token") || strings.Contains(normalized, "cookie") ||
		strings.Contains(normalized, "password") || strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "credential") || strings.Contains(normalized, "authorization") ||
		strings.Contains(normalized, "apikey") {
		return true
	}
	return normalized == "session" || strings.HasPrefix(normalized, "session_") || strings.HasSuffix(normalized, "_session") ||
		normalized == "jwt" || strings.HasPrefix(normalized, "jwt_") || strings.HasSuffix(normalized, "_jwt") ||
		normalized == "key" || strings.HasPrefix(normalized, "key_") || strings.HasSuffix(normalized, "_key")
}

func redactWatchDiagnosticText(value string) string {
	for _, marker := range []string{
		"Bearer ", "bearer ", "Cookie:", "cookie:", "Authorization:", "authorization:",
		"x-api-key:", "X-API-Key:", "session=", "Session=", "session:", "Session:",
		"token=", "Token=", "token:", "Token:",
	} {
		if index := strings.Index(value, marker); index >= 0 {
			value = value[:index] + marker + "[已脱敏]"
		}
	}
	return value
}

func truncateWatchDiagnosticPreview(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= watchDiagnosticPreviewLimit {
		return value
	}
	return value[:watchDiagnosticPreviewLimit] + "…"
}

func safeWatchDiagnosticURL(baseURL, path string) string {
	joined := joinWatchURL(baseURL, path)
	parsed, err := url.Parse(joined)
	if err != nil {
		return joined
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func safeWatchDiagnosticError(err error) string {
	if err == nil {
		return ""
	}
	return truncateWatchDiagnosticPreview(redactWatchDiagnosticText(err.Error()))
}

func watchHTTPStatusCode(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return "unauthorized"
	case http.StatusForbidden:
		return "forbidden"
	case http.StatusNotFound:
		return "not_found"
	case http.StatusTooManyRequests:
		return "rate_limited"
	default:
		if status >= 500 {
			return "upstream_error"
		}
		return "http_error"
	}
}
