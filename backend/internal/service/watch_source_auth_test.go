package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type watchSourceAuthRepoStub struct {
	WatchSourceRepository
	mutation *WatchSourceMutation
	source   *WatchSource
}

func (r *watchSourceAuthRepoStub) GetSource(_ context.Context, id int64) (*WatchSource, error) {
	if r.source != nil {
		copy := *r.source
		copy.ID = id
		return &copy, nil
	}
	return &WatchSource{
		ID: id, Name: "Sub2API upstream", AdapterType: WatchSourceAdapterSub2API,
		BaseURL: "https://upstream.example", APIBaseURL: "https://upstream.example/api/v1",
		RechargeRatio: 1, PollingIntervalSeconds: 60, RequestTimeoutSeconds: 3,
		KeepaliveEnabled: true, KeepaliveIntervalSeconds: 300, Enabled: true,
		AuthMode: WatchSourceAuthModeManual, CredentialType: WatchCredentialBearer,
	}, nil
}

func (r *watchSourceAuthRepoStub) CreateSource(_ context.Context, mutation WatchSourceMutation) (*WatchSource, error) {
	r.mutation = &mutation
	source := *mutation.Source
	source.ID = 1
	if mutation.EncryptedSecret != "" {
		source.HasCredential = true
		source.CredentialType = mutation.CredentialType
	}
	if mutation.EncryptedLoginSecret != "" {
		source.HasLoginCredential = true
	}
	return &source, nil
}

func (r *watchSourceAuthRepoStub) UpdateSource(_ context.Context, mutation WatchSourceMutation) (*WatchSource, error) {
	r.mutation = &mutation
	source := *mutation.Source
	if mutation.EncryptedSecret != "" {
		source.HasCredential = true
		source.CredentialType = mutation.CredentialType
	}
	if mutation.EncryptedLoginSecret != "" {
		source.HasLoginCredential = true
	}
	if mutation.ClearLoginCredential {
		source.HasLoginCredential = false
	}
	return &source, nil
}

type watchSourceAuthTestEncryptor struct{}

func (watchSourceAuthTestEncryptor) Encrypt(plaintext string) (string, error) {
	return "enc:" + plaintext, nil
}

func (watchSourceAuthTestEncryptor) Decrypt(ciphertext string) (string, error) {
	return strings.TrimPrefix(ciphertext, "enc:"), nil
}

type watchSourceRunCheckRepoStub struct {
	WatchSourceRepository
	credentialErr error
	saveErr       error
	snapshotErr   error
	saved         []WatchSourceObservation
}

func (r *watchSourceRunCheckRepoStub) GetSource(_ context.Context, id int64) (*WatchSource, error) {
	return &WatchSource{
		ID:                     id,
		Name:                   "Sub2API upstream",
		AdapterType:            WatchSourceAdapterSub2API,
		BaseURL:                "https://upstream.example",
		APIBaseURL:             "https://upstream.example/api/v1",
		RechargeRatio:          1,
		PollingIntervalSeconds: 60,
		RequestTimeoutSeconds:  3,
		Enabled:                true,
	}, nil
}

func (r *watchSourceRunCheckRepoStub) GetSourceCredential(context.Context, int64) (string, string, error) {
	if r.credentialErr != nil {
		return "", "", r.credentialErr
	}
	return WatchCredentialBearer, `enc:{"access_token":"token"}`, nil
}

func (r *watchSourceRunCheckRepoStub) SaveSourceObservation(_ context.Context, _ int64, observation WatchSourceObservation) error {
	if r.saveErr != nil {
		return r.saveErr
	}
	r.saved = append(r.saved, observation)
	return nil
}

func (r *watchSourceRunCheckRepoStub) GetSourceSnapshot(_ context.Context, id int64) (*WatchSourceSnapshot, error) {
	if r.snapshotErr != nil {
		return nil, r.snapshotErr
	}
	source, _ := r.GetSource(context.Background(), id)
	snapshot := &WatchSourceSnapshot{Source: source, Groups: []WatchSourceGroupObservation{}, Prices: []WatchSourcePriceObservation{}}
	if len(r.saved) == 0 {
		return snapshot, nil
	}
	observation := r.saved[len(r.saved)-1]
	source.LastCheckStatus = observation.Status
	source.LastErrorCode = observation.ErrorCode
	source.LastCheckAt = &observation.ObservedAt
	source.LastLatencyMs = observation.LatencyMs
	source.LastBalance = observation.Balance
	snapshot.Check = &WatchSourceCheck{
		SourceID:   id,
		Status:     observation.Status,
		ErrorCode:  observation.ErrorCode,
		LatencyMs:  observation.LatencyMs,
		ObservedAt: observation.ObservedAt,
		ExpiresAt:  observation.ExpiresAt,
	}
	return snapshot, nil
}

func TestLoginWatchSourceWithPasswordExchangesWrappedToken(t *testing.T) {
	var requestPath string
	var requestUA string
	var requestBody map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		requestUA = r.Header.Get("User-Agent")
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"access_token":"wrapped-token"}}`))
	}))
	defer server.Close()

	credential, err := loginWatchSourceWithPassword(context.Background(), &WatchSource{
		AdapterType:            WatchSourceAdapterSub2API,
		APIBaseURL:             server.URL + "/api/v1",
		LoginPath:              "/auth/login",
		RequestTimeoutSeconds:  3,
		PollingIntervalSeconds: 60,
	}, " root@example.com ", "login-password", WatchSourceCredential{UserAgent: "Custom UA"}, true)
	if err != nil {
		t.Fatalf("loginWatchSourceWithPassword() error = %v", err)
	}
	if credential.AccessToken != "wrapped-token" {
		t.Fatalf("AccessToken = %q, want wrapped-token", credential.AccessToken)
	}
	if credential.UserAgent != "Custom UA" {
		t.Fatalf("UserAgent = %q, want Custom UA", credential.UserAgent)
	}
	if requestPath != "/api/v1/auth/login" {
		t.Fatalf("path = %q, want /api/v1/auth/login", requestPath)
	}
	if requestUA != "Custom UA" {
		t.Fatalf("User-Agent = %q, want Custom UA", requestUA)
	}
	if requestBody["email"] != "root@example.com" || requestBody["password"] != "login-password" {
		t.Fatalf("request body = %#v, want trimmed email and original password", requestBody)
	}
}

func TestWatchSourceRunCheckPersistsCredentialMissingAsDiagnosticSnapshot(t *testing.T) {
	repo := &watchSourceRunCheckRepoStub{credentialErr: ErrWatchSourceCredentialAbsent}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }

	snapshot, err := svc.RunCheck(context.Background(), 7)
	if err != nil {
		t.Fatalf("RunCheck() error = %v", err)
	}
	if len(repo.saved) != 1 {
		t.Fatalf("saved observations = %d, want 1", len(repo.saved))
	}
	if repo.saved[0].Status != "error" || repo.saved[0].ErrorCode != "credential_missing" {
		t.Fatalf("saved observation = %#v, want credential_missing error", repo.saved[0])
	}
	if snapshot.Source.LastCheckStatus != "error" || snapshot.Source.LastErrorCode != "credential_missing" {
		t.Fatalf("snapshot source = %#v, want credential_missing error state", snapshot.Source)
	}
}

func TestWatchSourceRunCheckWrapsCredentialLoadFailureWithoutSavingObservation(t *testing.T) {
	repo := &watchSourceRunCheckRepoStub{credentialErr: errors.New("credential store unavailable")}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})

	_, err := svc.RunCheck(context.Background(), 7)
	if !errors.Is(err, ErrWatchSourceCredentialLoadFailed) {
		t.Fatalf("RunCheck() error = %v, want ErrWatchSourceCredentialLoadFailed", err)
	}
	if len(repo.saved) != 0 {
		t.Fatalf("saved observations = %d, want 0", len(repo.saved))
	}
}

func TestWatchSourceRunCheckWrapsObservationPersistenceFailure(t *testing.T) {
	repo := &watchSourceRunCheckRepoStub{
		credentialErr: ErrWatchSourceCredentialAbsent,
		saveErr:       errors.New("insert watch source check failed"),
	}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})

	_, err := svc.RunCheck(context.Background(), 7)
	if !errors.Is(err, ErrWatchSourceObservationPersistFailed) {
		t.Fatalf("RunCheck() error = %v, want ErrWatchSourceObservationPersistFailed", err)
	}
}

func TestWatchSourceRunCheckWrapsSnapshotFailure(t *testing.T) {
	repo := &watchSourceRunCheckRepoStub{
		credentialErr: ErrWatchSourceCredentialAbsent,
		snapshotErr:   errors.New("list watch source checks failed"),
	}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})

	_, err := svc.RunCheck(context.Background(), 7)
	if !errors.Is(err, ErrWatchSourceSnapshotUnavailable) {
		t.Fatalf("RunCheck() error = %v, want ErrWatchSourceSnapshotUnavailable", err)
	}
}

func TestLoginWatchSourceWithPasswordStopsOnInteractiveAuth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"requires_2fa":true,"temp_token":"tmp"}}`))
	}))
	defer server.Close()

	_, err := loginWatchSourceWithPassword(context.Background(), &WatchSource{
		AdapterType:           WatchSourceAdapterSub2API,
		APIBaseURL:            server.URL + "/api/v1",
		LoginPath:             "/auth/login",
		RequestTimeoutSeconds: 3,
	}, "root@example.com", "login-password", WatchSourceCredential{}, true)
	if !errors.Is(err, ErrWatchSourceInteractiveAuthRequired) {
		t.Fatalf("error = %v, want ErrWatchSourceInteractiveAuthRequired", err)
	}
}

func TestLoginWatchSourceWithPasswordRejectsNonJSONLoginResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><title>New API</title></html>`))
	}))
	defer server.Close()

	_, err := loginWatchSourceWithPassword(context.Background(), &WatchSource{
		AdapterType:           WatchSourceAdapterSub2API,
		APIBaseURL:            server.URL + "/api/v1",
		LoginPath:             "/auth/login",
		RequestTimeoutSeconds: 3,
	}, "root@example.com", "login-password", WatchSourceCredential{}, true)
	if !errors.Is(err, ErrWatchSourcePasswordAuthInvalidResponse) {
		t.Fatalf("error = %v, want ErrWatchSourcePasswordAuthInvalidResponse", err)
	}
}

func TestLoginWatchSourceWithPasswordAcceptsTokenEvenWhenCodeIsHTTPStyleSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"data":{"access_token":"token-from-custom-upstream"}}`))
	}))
	defer server.Close()

	credential, err := loginWatchSourceWithPassword(context.Background(), &WatchSource{
		AdapterType:           WatchSourceAdapterCustom,
		APIBaseURL:            server.URL,
		LoginPath:             "/auth/login",
		RequestTimeoutSeconds: 3,
	}, "root@example.com", "login-password", WatchSourceCredential{}, true)
	if err != nil {
		t.Fatalf("loginWatchSourceWithPassword() error = %v", err)
	}
	if credential.AccessToken != "token-from-custom-upstream" {
		t.Fatalf("AccessToken = %q, want token-from-custom-upstream", credential.AccessToken)
	}
}

func TestLoginWatchSourceWithPasswordReportsMissingTokenSeparately(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"access_token":null}}`))
	}))
	defer server.Close()

	_, err := loginWatchSourceWithPassword(context.Background(), &WatchSource{
		AdapterType:           WatchSourceAdapterNewAPI,
		APIBaseURL:            server.URL,
		LoginPath:             "/api/user/login",
		RequestTimeoutSeconds: 3,
	}, "root@example.com", "login-password", WatchSourceCredential{}, true)
	if !errors.Is(err, ErrWatchSourcePasswordAuthMissingToken) {
		t.Fatalf("error = %v, want ErrWatchSourcePasswordAuthMissingToken", err)
	}
}

func TestLoginWatchSourceWithPasswordDetectsChineseInteractiveAuthMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":false,"message":"请先完成人机验证"}`))
	}))
	defer server.Close()

	_, err := loginWatchSourceWithPassword(context.Background(), &WatchSource{
		AdapterType:           WatchSourceAdapterNewAPI,
		APIBaseURL:            server.URL,
		LoginPath:             "/api/user/login",
		RequestTimeoutSeconds: 3,
	}, "root@example.com", "login-password", WatchSourceCredential{}, true)
	if !errors.Is(err, ErrWatchSourceInteractiveAuthRequired) {
		t.Fatalf("error = %v, want ErrWatchSourceInteractiveAuthRequired", err)
	}
}

func TestWatchSourceCreatePasswordAuthStoresBearerTokenAndEncryptedLoginForKeepalive(t *testing.T) {
	repo := &watchSourceAuthRepoStub{}
	encryptor := watchSourceAuthTestEncryptor{}
	svc := NewWatchSourceService(repo, encryptor)
	svc.passwordLogin = func(_ context.Context, source *WatchSource, email, password string, credential WatchSourceCredential, _ bool) (WatchSourceCredential, error) {
		if source.AdapterType != WatchSourceAdapterSub2API {
			t.Fatalf("AdapterType = %q, want sub2api", source.AdapterType)
		}
		if source.APIBaseURL != "https://upstream.example/api/v1" {
			t.Fatalf("APIBaseURL = %q, want https://upstream.example/api/v1", source.APIBaseURL)
		}
		if source.LoginPath != "/auth/login" || source.HeartbeatPath != "/user/profile" {
			t.Fatalf("paths = login:%q heartbeat:%q, want default sub2api paths", source.LoginPath, source.HeartbeatPath)
		}
		if email != "root@example.com" || password != "login-password" {
			t.Fatalf("login details = %q/%q, want supplied credentials", email, password)
		}
		if credential.UserAgent != "Watch Test UA" {
			t.Fatalf("UserAgent = %q, want Watch Test UA", credential.UserAgent)
		}
		return WatchSourceCredential{AccessToken: "upstream-access-token", UserAgent: credential.UserAgent}, nil
	}

	source, err := svc.Create(context.Background(), WatchSourceInput{
		Name:                   "Sub2API upstream",
		AdapterType:            WatchSourceAdapterSub2API,
		BaseURL:                "https://upstream.example",
		RechargeRatio:          1,
		PollingIntervalSeconds: 60,
		RequestTimeoutSeconds:  15,
		Enabled:                true,
		AuthMode:               WatchSourceAuthModePassword,
		LoginEmail:             "root@example.com",
		LoginPassword:          "login-password",
		Credential:             &WatchSourceCredential{UserAgent: "Watch Test UA"},
	}, 7)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if !source.HasCredential || source.CredentialType != WatchCredentialBearer {
		t.Fatalf("created credential state = has:%v type:%q, want bearer credential", source.HasCredential, source.CredentialType)
	}
	if repo.mutation == nil {
		t.Fatal("CreateSource mutation was not captured")
	}
	if repo.mutation.CredentialType != WatchCredentialBearer {
		t.Fatalf("CredentialType = %q, want bearer", repo.mutation.CredentialType)
	}
	plain, err := encryptor.Decrypt(repo.mutation.EncryptedSecret)
	if err != nil {
		t.Fatalf("Decrypt() error = %v", err)
	}
	if strings.Contains(plain, "login-password") || strings.Contains(plain, "root@example.com") {
		t.Fatalf("stored token credential leaked login details: %s", plain)
	}
	var stored WatchSourceCredential
	if err = json.Unmarshal([]byte(plain), &stored); err != nil {
		t.Fatalf("unmarshal stored credential: %v", err)
	}
	if stored.AccessToken != "upstream-access-token" || stored.UserAgent != "Watch Test UA" {
		t.Fatalf("stored credential = %#v, want exchanged token and user agent", stored)
	}
	loginPlain, err := encryptor.Decrypt(repo.mutation.EncryptedLoginSecret)
	if err != nil {
		t.Fatalf("Decrypt login credential error = %v", err)
	}
	var loginStored WatchSourceLoginCredential
	if err = json.Unmarshal([]byte(loginPlain), &loginStored); err != nil {
		t.Fatalf("unmarshal stored login credential: %v", err)
	}
	if loginStored.Username != "root@example.com" || loginStored.Password != "login-password" || loginStored.UserAgent != "Watch Test UA" {
		t.Fatalf("stored login credential = %#v, want encrypted keepalive login details", loginStored)
	}
}

func TestWatchSourceCreatePasswordAuthSupportsNewAPIDefaultLoginPath(t *testing.T) {
	for _, apiBaseURL := range []string{"https://upstream.example/api/v1", "https://upstream.example/api"} {
		t.Run(apiBaseURL, func(t *testing.T) {
			repo := &watchSourceAuthRepoStub{}
			svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
			svc.passwordLogin = func(_ context.Context, source *WatchSource, username, password string, _ WatchSourceCredential, _ bool) (WatchSourceCredential, error) {
				if source.AdapterType != WatchSourceAdapterNewAPI {
					t.Fatalf("AdapterType = %q, want newapi", source.AdapterType)
				}
				if source.APIBaseURL != "https://upstream.example" {
					t.Fatalf("APIBaseURL = %q, want https://upstream.example", source.APIBaseURL)
				}
				if source.LoginPath != "/api/user/login" || source.HeartbeatPath != "/api/user/self" {
					t.Fatalf("paths = login:%q heartbeat:%q, want newapi defaults", source.LoginPath, source.HeartbeatPath)
				}
				if username != "root@example.com" || password != "login-password" {
					t.Fatalf("login details = %q/%q, want supplied credentials", username, password)
				}
				return WatchSourceCredential{AccessToken: "newapi-token"}, nil
			}
			source, err := svc.Create(context.Background(), WatchSourceInput{
				Name:                   "New API upstream",
				AdapterType:            WatchSourceAdapterNewAPI,
				BaseURL:                "https://upstream.example",
				APIBaseURL:             apiBaseURL,
				RechargeRatio:          1,
				PollingIntervalSeconds: 60,
				RequestTimeoutSeconds:  15,
				Enabled:                true,
				AuthMode:               WatchSourceAuthModePassword,
				LoginEmail:             "root@example.com",
				LoginPassword:          "login-password",
			}, 7)
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			if !source.HasCredential || !source.HasLoginCredential {
				t.Fatalf("created source credential flags = token:%v login:%v, want both true", source.HasCredential, source.HasLoginCredential)
			}
		})
	}
}

func TestWatchSourceCreatePropagatesInteractiveAuthWithoutSaving(t *testing.T) {
	repo := &watchSourceAuthRepoStub{}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	svc.passwordLogin = func(context.Context, *WatchSource, string, string, WatchSourceCredential, bool) (WatchSourceCredential, error) {
		return WatchSourceCredential{}, ErrWatchSourceInteractiveAuthRequired
	}

	_, err := svc.Create(context.Background(), WatchSourceInput{
		Name:                   "Sub2API upstream",
		AdapterType:            WatchSourceAdapterSub2API,
		BaseURL:                "https://upstream.example",
		RechargeRatio:          1,
		PollingIntervalSeconds: 60,
		RequestTimeoutSeconds:  15,
		Enabled:                true,
		AuthMode:               WatchSourceAuthModePassword,
		LoginEmail:             "root@example.com",
		LoginPassword:          "login-password",
	}, 7)
	if !errors.Is(err, ErrWatchSourceInteractiveAuthRequired) {
		t.Fatalf("Create() error = %v, want ErrWatchSourceInteractiveAuthRequired", err)
	}
	if repo.mutation != nil {
		t.Fatal("CreateSource must not be called when interactive auth is required")
	}
}

func TestWatchSourceInteractiveAuthCompletesManualCredentialAndClearsPasswordMode(t *testing.T) {
	repo := &watchSourceAuthRepoStub{source: &WatchSource{
		ID: 1, Name: "Sub2API upstream", AdapterType: WatchSourceAdapterSub2API,
		BaseURL: "https://upstream.example", APIBaseURL: "https://upstream.example/api/v1",
		RechargeRatio: 1, PollingIntervalSeconds: 60, RequestTimeoutSeconds: 3,
		KeepaliveEnabled: true, KeepaliveIntervalSeconds: 300, Enabled: true,
		AuthMode: WatchSourceAuthModePassword, LoginPath: "/auth/login", HeartbeatPath: "/user/profile",
		HasLoginCredential: true,
	}}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	svc.now = func() time.Time { return time.Unix(123, 0).UTC() }

	session, err := svc.StartInteractiveAuth(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("StartInteractiveAuth() error = %v", err)
	}
	result, err := svc.CompleteInteractiveAuth(context.Background(), 1, 7, WatchSourceInteractiveAuthCompleteRequest{
		SessionID:      session.SessionID,
		CredentialType: WatchCredentialCookie,
		Credential:     &WatchSourceCredential{Cookie: "session=authorized", UserAgent: "Watch Browser UA"},
	})
	if err != nil {
		t.Fatalf("CompleteInteractiveAuth() error = %v", err)
	}
	if result.Status != "saved" || result.Source == nil {
		t.Fatalf("result = %#v, want saved source", result)
	}
	if repo.mutation == nil {
		t.Fatal("UpdateSource was not called")
	}
	if repo.mutation.Source.AuthMode != WatchSourceAuthModeManual {
		t.Fatalf("auth mode = %q, want manual", repo.mutation.Source.AuthMode)
	}
	if repo.mutation.CredentialType != WatchCredentialCookie || repo.mutation.EncryptedSecret == "" {
		t.Fatalf("credential mutation = %#v, want encrypted cookie credential", repo.mutation)
	}
	if !repo.mutation.ClearLoginCredential {
		t.Fatalf("manual interactive auth must clear password login credential: %#v", repo.mutation)
	}
	plain, err := watchSourceAuthTestEncryptor{}.Decrypt(repo.mutation.EncryptedSecret)
	if err != nil {
		t.Fatalf("Decrypt() error = %v", err)
	}
	var stored WatchSourceCredential
	if err = json.Unmarshal([]byte(plain), &stored); err != nil {
		t.Fatalf("unmarshal stored credential: %v", err)
	}
	if stored.Cookie != "session=authorized" || stored.UserAgent != "Watch Browser UA" {
		t.Fatalf("stored credential = %#v, want submitted cookie and user agent", stored)
	}
}

func TestWatchSourceInteractiveAuthNormalizesBearerCredentialAndRejectsOversizedSecret(t *testing.T) {
	repo := &watchSourceAuthRepoStub{source: &WatchSource{
		ID: 1, Name: "Sub2API upstream", AdapterType: WatchSourceAdapterSub2API,
		BaseURL: "https://upstream.example", APIBaseURL: "https://upstream.example/api/v1",
		RechargeRatio: 1, PollingIntervalSeconds: 60, RequestTimeoutSeconds: 3,
		KeepaliveEnabled: true, KeepaliveIntervalSeconds: 300, Enabled: true,
		AuthMode: WatchSourceAuthModeManual, LoginPath: "/auth/login", HeartbeatPath: "/user/profile",
	}}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})

	session, err := svc.StartInteractiveAuth(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("StartInteractiveAuth() error = %v", err)
	}
	_, err = svc.CompleteInteractiveAuth(context.Background(), 1, 7, WatchSourceInteractiveAuthCompleteRequest{
		SessionID:      session.SessionID,
		CredentialType: WatchCredentialBearer,
		Credential:     &WatchSourceCredential{AccessToken: " Bearer upstream-token ", UserAgent: strings.Repeat("a", 513)},
	})
	if !errors.Is(err, ErrWatchSourceInteractiveAuthCredentialTooLarge) {
		t.Fatalf("oversized user agent error = %v, want ErrWatchSourceInteractiveAuthCredentialTooLarge", err)
	}

	result, err := svc.CompleteInteractiveAuth(context.Background(), 1, 7, WatchSourceInteractiveAuthCompleteRequest{
		SessionID:      session.SessionID,
		CredentialType: WatchCredentialBearer,
		Credential:     &WatchSourceCredential{AccessToken: " Bearer upstream-token ", UserAgent: " Watch Browser UA "},
	})
	if err != nil {
		t.Fatalf("CompleteInteractiveAuth() error = %v", err)
	}
	if result.Status != "saved" {
		t.Fatalf("status = %q, want saved", result.Status)
	}
	plain, err := watchSourceAuthTestEncryptor{}.Decrypt(repo.mutation.EncryptedSecret)
	if err != nil {
		t.Fatalf("Decrypt() error = %v", err)
	}
	var stored WatchSourceCredential
	if err = json.Unmarshal([]byte(plain), &stored); err != nil {
		t.Fatalf("unmarshal stored credential: %v", err)
	}
	if stored.AccessToken != "upstream-token" || stored.UserAgent != "Watch Browser UA" {
		t.Fatalf("stored credential = %#v, want normalized token and user agent", stored)
	}
}

func TestWatchSourceInteractiveAuthRejectsWrongActorExpiredAndMissingCredential(t *testing.T) {
	repo := &watchSourceAuthRepoStub{}
	svc := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	now := time.Unix(123, 0).UTC()
	svc.now = func() time.Time { return now }

	session, err := svc.StartInteractiveAuth(context.Background(), 1, 7)
	if err != nil {
		t.Fatalf("StartInteractiveAuth() error = %v", err)
	}
	if _, err = svc.GetInteractiveAuthSession(context.Background(), 1, 8, session.SessionID); !errors.Is(err, ErrWatchSourceInteractiveAuthSessionNotFound) {
		t.Fatalf("wrong actor error = %v, want ErrWatchSourceInteractiveAuthSessionNotFound", err)
	}
	if _, err = svc.CompleteInteractiveAuth(context.Background(), 1, 7, WatchSourceInteractiveAuthCompleteRequest{
		SessionID: session.SessionID, CredentialType: WatchCredentialBearer, Credential: &WatchSourceCredential{},
	}); !errors.Is(err, ErrWatchSourceInteractiveAuthCredentialMissing) {
		t.Fatalf("missing credential error = %v, want ErrWatchSourceInteractiveAuthCredentialMissing", err)
	}
	now = now.Add(watchSourceInteractiveAuthTTL + time.Second)
	if _, err = svc.GetInteractiveAuthSession(context.Background(), 1, 7, session.SessionID); !errors.Is(err, ErrWatchSourceInteractiveAuthSessionExpired) {
		t.Fatalf("expired session error = %v, want ErrWatchSourceInteractiveAuthSessionExpired", err)
	}
}
