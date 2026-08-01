package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func loginWatchSourceWithPassword(ctx context.Context, source *WatchSource, username, password string, credential WatchSourceCredential, allowPrivate bool) (WatchSourceCredential, error) {
	if source == nil {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthUnavailable
	}
	loginPath := strings.TrimSpace(source.LoginPath)
	if loginPath == "" {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthUnsupported
	}
	username = strings.TrimSpace(username)
	if username == "" || strings.TrimSpace(password) == "" {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthMissingDetails
	}
	timeout := source.RequestTimeoutSeconds
	if timeout <= 0 {
		timeout = 15
	}
	client := newWatchSourceHTTPClient(time.Duration(timeout)*time.Second, allowPrivate)
	response := requestWatchLoginResponse(ctx, client, joinWatchURL(source.APIBaseURL, loginPath), source.AdapterType, credential, username, password)
	payload, status, err := response.payload, response.status, response.err
	if err != nil {
		return WatchSourceCredential{}, err
	}
	if watchLoginRequiresInteractiveAuth(payload) {
		return WatchSourceCredential{}, ErrWatchSourceInteractiveAuthRequired
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthFailed
	}
	if status < 200 || status >= 300 {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthUnavailable
	}
	accessToken := watchLoginAccessToken(payload)
	if watchLoginRejected(payload) && accessToken == "" && response.cookie == "" {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthFailed
	}
	if accessToken == "" && response.cookie != "" {
		return WatchSourceCredential{Cookie: response.cookie, UserAgent: strings.TrimSpace(credential.UserAgent)}, nil
	}
	if accessToken == "" {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthMissingToken
	}
	return WatchSourceCredential{AccessToken: accessToken, UserAgent: strings.TrimSpace(credential.UserAgent)}, nil
}

func requestWatchLoginJSON(ctx context.Context, client *http.Client, endpoint, adapterType string, credential WatchSourceCredential, username, password string) (any, int, error) {
	response := requestWatchLoginResponse(ctx, client, endpoint, adapterType, credential, username, password)
	return response.payload, response.status, response.err
}

type watchLoginResponse struct {
	payload     any
	status      int
	contentType string
	cookie      string
	body        []byte
	diagnostic  WatchSourceEndpointDiagnostic
	err         error
}

func requestWatchLoginResponse(ctx context.Context, client *http.Client, endpoint, adapterType string, credential WatchSourceCredential, username, password string) watchLoginResponse {
	loginPayload := map[string]string{"password": password}
	if adapterType == WatchSourceAdapterSub2API {
		loginPayload["email"] = username
	} else {
		loginPayload["username"] = username
	}
	body, err := json.Marshal(loginPayload)
	if err != nil {
		return watchLoginResponse{err: ErrWatchSourcePasswordAuthUnavailable}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return watchLoginResponse{err: fmt.Errorf("%w: invalid login endpoint", ErrWatchSourcePasswordAuthUnavailable)}
	}
	if strings.TrimSpace(credential.UserAgent) != "" {
		req.Header.Set("User-Agent", strings.TrimSpace(credential.UserAgent))
	} else {
		req.Header.Set("User-Agent", "Sub2API-Watch/1")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return watchLoginResponse{err: fmt.Errorf("%w: upstream login request failed", ErrWatchSourcePasswordAuthUnavailable)}
	}
	defer resp.Body.Close()

	reader := io.LimitReader(resp.Body, watchMaxResponseBytes+1)
	responseBody, err := io.ReadAll(reader)
	if err != nil {
		return watchLoginResponse{status: resp.StatusCode, err: ErrWatchSourcePasswordAuthUnavailable}
	}
	if len(responseBody) > watchMaxResponseBytes {
		return watchLoginResponse{status: resp.StatusCode, err: ErrWatchSourcePasswordAuthUnavailable}
	}
	contentType := strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	cookieParts := make([]string, 0, len(resp.Cookies()))
	for _, cookie := range resp.Cookies() {
		cookieParts = append(cookieParts, cookie.Name+"="+cookie.Value)
	}
	response := watchLoginResponse{
		status:      resp.StatusCode,
		contentType: contentType,
		cookie:      strings.Join(cookieParts, "; "),
		body:        responseBody,
	}
	if len(strings.TrimSpace(string(responseBody))) == 0 {
		response.diagnostic = watchDiagnosticEndpointFromURL("login", http.MethodPost, endpoint, false)
		response.diagnostic.StatusCode = resp.StatusCode
		response.diagnostic.ContentType = contentType
		response.diagnostic.Status = "error"
		response.diagnostic.ErrorCode = "empty_response"
		response.diagnostic.Reason = "登录接口返回空响应"
		return response
	}
	var payload any
	if err = json.Unmarshal(responseBody, &payload); err != nil {
		response.err = ErrWatchSourcePasswordAuthInvalidResponse
		response.diagnostic = watchDiagnosticEndpointFromURL("login", http.MethodPost, endpoint, false)
		response.diagnostic.StatusCode = resp.StatusCode
		response.diagnostic.ContentType = contentType
		response.diagnostic.Status = "error"
		response.diagnostic.ErrorCode = "invalid_response"
		response.diagnostic.Reason = "登录接口返回网页或非 JSON"
		return response
	}
	response.payload = payload
	response.diagnostic = watchDiagnosticEndpointFromURL("login", http.MethodPost, endpoint, false)
	response.diagnostic.StatusCode = resp.StatusCode
	response.diagnostic.ContentType = contentType
	response.diagnostic.JSON = true
	response.diagnostic.Status = "success"
	response.diagnostic.Reason = "登录接口返回 JSON"
	response.diagnostic.ResponseKeys = watchDiagnosticKeys(payload)
	encoded, _ := json.Marshal(redactWatchDiagnosticValue(payload))
	response.diagnostic.ResponsePreview = truncateWatchDiagnosticPreview(string(encoded))
	return response
}

func watchLoginAccessToken(payload any) string {
	if record, ok := payload.(map[string]any); ok {
		for _, key := range []string{"access_token", "accessToken", "token", "session", "session_token", "sessionToken"} {
			if value, ok := record[key].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
		for _, key := range []string{"data", "result", "user", "auth", "login"} {
			if token := watchLoginAccessToken(record[key]); token != "" {
				return token
			}
		}
	}
	return ""
}

func credentialTypeForWatchCredential(credential WatchSourceCredential) string {
	if strings.TrimSpace(credential.Cookie) != "" && strings.TrimSpace(credential.AccessToken) == "" && strings.TrimSpace(credential.APIKey) == "" {
		return WatchCredentialCookie
	}
	if strings.TrimSpace(credential.APIKey) != "" && strings.TrimSpace(credential.AccessToken) == "" && strings.TrimSpace(credential.Cookie) == "" {
		return WatchCredentialAPIKey
	}
	return WatchCredentialBearer
}

func watchLoginRejected(payload any) bool {
	if record, ok := payload.(map[string]any); ok {
		if code, exists := watchFloat(record["code"]); exists && code != 0 {
			return true
		}
		if success, exists := record["success"].(bool); exists && !success {
			return true
		}
		if okValue, exists := record["ok"].(bool); exists && !okValue {
			return true
		}
	}
	return false
}

func watchLoginRequiresInteractiveAuth(payload any) bool {
	if record, ok := payload.(map[string]any); ok {
		for _, key := range []string{"requires_2fa", "requires2fa", "require_2fa", "need_2fa", "totp_required", "turnstile_required", "captcha_required"} {
			if value, ok := record[key].(bool); ok && value {
				return true
			}
		}
		for _, key := range []string{"temp_token", "user_email_masked"} {
			if value, ok := record[key].(string); ok && strings.TrimSpace(value) != "" {
				return true
			}
		}
		for _, key := range []string{"message", "reason", "error"} {
			if value, ok := record[key].(string); ok && watchLoginMessageMentionsInteractiveAuth(value) {
				return true
			}
		}
		for _, key := range []string{"data", "result"} {
			if watchLoginRequiresInteractiveAuth(record[key]) {
				return true
			}
		}
	}
	return false
}

func watchLoginMessageMentionsInteractiveAuth(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, "2fa") ||
		strings.Contains(lower, "two-factor") ||
		strings.Contains(lower, "totp") ||
		strings.Contains(lower, "turnstile") ||
		strings.Contains(lower, "captcha") ||
		strings.Contains(lower, "verification") ||
		strings.Contains(value, "验证码") ||
		strings.Contains(value, "人机验证") ||
		strings.Contains(value, "二次验证") ||
		strings.Contains(value, "两步验证")
}
