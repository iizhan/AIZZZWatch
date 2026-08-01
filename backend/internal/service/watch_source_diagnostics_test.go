package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDiagnoseWatchSourceRedactsSensitiveJSONAndUsesSafeEndpointURLs(t *testing.T) {
	jsonOK, keys, preview := summarizeWatchDiagnosticBody(
		[]byte(`{"token":"fake-token","session":"fake-session","nested":{"password":"fake-password","sessionToken":"nested-session","ok":"visible"},"items":[{"api_key":"fake-key","refresh_token":"fake-refresh"}]}`),
		"application/json",
	)
	if !jsonOK {
		t.Fatal("summarizeWatchDiagnosticBody() JSON = false, want true")
	}
	for _, secret := range []string{"fake-token", "fake-session", "nested-session", "fake-password", "fake-key", "fake-refresh"} {
		if strings.Contains(preview, secret) {
			t.Fatalf("sensitive value %q leaked in response preview: %q", secret, preview)
		}
	}
	if !strings.Contains(preview, "[已脱敏]") {
		t.Fatalf("response preview = %q, want redaction marker", preview)
	}
	if len(keys) != 4 || keys[0] != "items" || keys[1] != "nested" || keys[2] != "session" || keys[3] != "token" {
		t.Fatalf("response keys = %#v, want sorted top-level keys", keys)
	}
	if got := safeWatchDiagnosticURL("https://upstream.example", "/profile?token=fake-token#fragment"); got != "https://upstream.example/profile" {
		t.Fatalf("safe diagnostic URL = %q, want query and fragment removed", got)
	}
	if textPreview := redactWatchDiagnosticText("upstream rejected session=fake-session"); strings.Contains(textPreview, "fake-session") {
		t.Fatalf("plain-text diagnostic leaked session: %q", textPreview)
	}
}

func TestDiagnoseWatchSourceClassifiesHTMLAndUnauthorizedResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/profile":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><body>login page</body></html>`))
		case "/groups":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"message":"please login","token":"fake-token"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	profile := probeWatchEndpoint(context.Background(), http.DefaultClient, "profile", "/profile", false, server.URL, WatchCredentialBearer, WatchSourceCredential{AccessToken: "fake-token"})
	if profile.Status != "error" || profile.ErrorCode != "invalid_response" {
		t.Fatalf("profile diagnostic = %#v, want invalid_response", profile)
	}
	if !strings.Contains(profile.ResponsePreview, "HTML 页面") {
		t.Fatalf("profile response preview = %q, want HTML marker", profile.ResponsePreview)
	}
	groups := probeWatchEndpoint(context.Background(), http.DefaultClient, "groups", "/groups", false, server.URL, WatchCredentialBearer, WatchSourceCredential{AccessToken: "fake-token"})
	if groups.Status != "needs_auth" || groups.ErrorCode != "unauthorized" || groups.StatusCode != http.StatusUnauthorized {
		t.Fatalf("groups diagnostic = %#v, want unauthorized needs_auth", groups)
	}
	if strings.Contains(groups.ResponsePreview, "fake-token") {
		t.Fatalf("unauthorized response leaked token: %q", groups.ResponsePreview)
	}
}

func TestDiagnoseWatchSourceMarksMissingCredentialWithoutPersisting(t *testing.T) {
	svc := newWatchSourceServiceForTest(nil, nil, true)
	report, err := svc.DiagnoseInput(context.Background(), WatchSourceDiagnosticRequest{Input: WatchSourceInput{
		AdapterType:           WatchSourceAdapterCustom,
		BaseURL:               "https://upstream.example",
		ProfilePath:           "/profile",
		GroupsPath:            "/groups",
		HeartbeatPath:         "/heartbeat",
		CredentialType:        WatchCredentialBearer,
		RequestTimeoutSeconds: 2,
	}})
	if err != nil {
		t.Fatalf("DiagnoseInput() error = %v", err)
	}
	for _, endpoint := range report.Endpoints {
		if endpoint.Name == "profile" || endpoint.Name == "groups" || endpoint.Name == "heartbeat" {
			if endpoint.Status != "needs_auth" || endpoint.ErrorCode != "credential_missing" {
				t.Fatalf("%s diagnostic = %#v, want credential_missing", endpoint.Name, endpoint)
			}
		}
	}
}
