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
	payload, status, err := requestWatchLoginJSON(ctx, client, joinWatchURL(source.APIBaseURL, loginPath), source.AdapterType, credential, username, password)
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
	if watchLoginRejected(payload) && accessToken == "" {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthFailed
	}
	if accessToken == "" {
		return WatchSourceCredential{}, ErrWatchSourcePasswordAuthMissingToken
	}
	return WatchSourceCredential{AccessToken: accessToken, UserAgent: strings.TrimSpace(credential.UserAgent)}, nil
}

func requestWatchLoginJSON(ctx context.Context, client *http.Client, endpoint, adapterType string, credential WatchSourceCredential, username, password string) (any, int, error) {
	loginPayload := map[string]string{"password": password}
	if adapterType == WatchSourceAdapterSub2API {
		loginPayload["email"] = username
	} else {
		loginPayload["username"] = username
	}
	body, err := json.Marshal(loginPayload)
	if err != nil {
		return nil, 0, ErrWatchSourcePasswordAuthUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("%w: invalid login endpoint", ErrWatchSourcePasswordAuthUnavailable)
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
		return nil, 0, fmt.Errorf("%w: upstream login request failed", ErrWatchSourcePasswordAuthUnavailable)
	}
	defer resp.Body.Close()

	reader := io.LimitReader(resp.Body, watchMaxResponseBytes+1)
	responseBody, err := io.ReadAll(reader)
	if err != nil {
		return nil, resp.StatusCode, ErrWatchSourcePasswordAuthUnavailable
	}
	if len(responseBody) > watchMaxResponseBytes {
		return nil, resp.StatusCode, ErrWatchSourcePasswordAuthUnavailable
	}
	if len(strings.TrimSpace(string(responseBody))) == 0 {
		return nil, resp.StatusCode, nil
	}
	var payload any
	if err = json.Unmarshal(responseBody, &payload); err != nil {
		return nil, resp.StatusCode, ErrWatchSourcePasswordAuthInvalidResponse
	}
	return payload, resp.StatusCode, nil
}

func watchLoginAccessToken(payload any) string {
	if record, ok := payload.(map[string]any); ok {
		for _, key := range []string{"access_token", "accessToken", "token"} {
			if value, ok := record[key].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
		for _, key := range []string{"data", "result"} {
			if token := watchLoginAccessToken(record[key]); token != "" {
				return token
			}
		}
	}
	return ""
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
