package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

type watchSourcePortableRepoStub struct {
	WatchSourceRepository
	sources []*WatchSource
	bundles map[int64]*WatchSourceCredentialBundle
	created *WatchSourceMutation
	updated *WatchSourceMutation
}

func (r *watchSourcePortableRepoStub) ListSources(context.Context) ([]*WatchSource, error) {
	return r.sources, nil
}

func (r *watchSourcePortableRepoStub) GetSource(_ context.Context, id int64) (*WatchSource, error) {
	for _, source := range r.sources {
		if source.ID == id {
			copy := *source
			return &copy, nil
		}
	}
	return nil, ErrWatchSourceNotFound
}

func (r *watchSourcePortableRepoStub) GetSourceCredentialBundle(_ context.Context, id int64) (*WatchSourceCredentialBundle, error) {
	if bundle := r.bundles[id]; bundle != nil {
		copy := *bundle
		return &copy, nil
	}
	return nil, ErrWatchSourceCredentialAbsent
}

func (r *watchSourcePortableRepoStub) CreateSource(_ context.Context, mutation WatchSourceMutation) (*WatchSource, error) {
	r.created = &mutation
	source := *mutation.Source
	source.ID = 2
	return &source, nil
}

func (r *watchSourcePortableRepoStub) UpdateSource(_ context.Context, mutation WatchSourceMutation) (*WatchSource, error) {
	r.updated = &mutation
	source := *mutation.Source
	return &source, nil
}

func TestWatchSourcePortableRoundTripAndWrongPassword(t *testing.T) {
	payload := watchSourcePortablePayload{
		Format:     WatchSourcePortableFormat,
		Version:    WatchSourcePortableVersion,
		ExportedAt: time.Unix(123, 0).UTC(),
		Sources: []watchSourcePortableSource{{
			Name:           "QA source",
			AdapterType:    WatchSourceAdapterSub2API,
			BaseURL:        "https://upstream.example",
			APIBaseURL:     "https://upstream.example/api/v1",
			RechargeRatio:  1,
			AuthMode:       WatchSourceAuthModeManual,
			CredentialType: WatchCredentialBearer,
			Credential:     &WatchSourceCredential{AccessToken: "portable-secret"},
		}},
	}

	envelope, err := encryptWatchSourcePortablePayload("a-strong-portable-password", payload, payload.ExportedAt)
	if err != nil {
		t.Fatalf("encryptWatchSourcePortablePayload() error = %v", err)
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	if strings.Contains(string(encoded), "portable-secret") {
		t.Fatal("portable secret leaked into the outer envelope")
	}

	decoded, err := decryptWatchSourcePortablePayload("a-strong-portable-password", *envelope)
	if err != nil {
		t.Fatalf("decryptWatchSourcePortablePayload() error = %v", err)
	}
	if got := decoded.Sources[0].Credential.AccessToken; got != "portable-secret" {
		t.Fatalf("decoded credential = %q, want portable-secret", got)
	}

	if _, err := decryptWatchSourcePortablePayload("wrong-portable-password", *envelope); err == nil {
		t.Fatal("wrong password should fail")
	}

	envelope.Ciphertext = envelope.Ciphertext[:len(envelope.Ciphertext)-2] + "aa"
	if _, err := decryptWatchSourcePortablePayload("a-strong-portable-password", *envelope); err == nil {
		t.Fatal("tampered ciphertext should fail")
	}
}

func TestWatchSourcePortableExportPreviewAndApply(t *testing.T) {
	source := &WatchSource{
		ID: 1, Name: "QA source", AdapterType: WatchSourceAdapterSub2API,
		BaseURL: "https://upstream.example", APIBaseURL: "https://upstream.example/api/v1",
		RechargeRatio: 1, PollingIntervalSeconds: 60, RequestTimeoutSeconds: 15,
		KeepaliveEnabled: true, KeepaliveIntervalSeconds: 300, Enabled: true,
		AuthMode: WatchSourceAuthModeManual, CredentialType: WatchCredentialBearer,
		HasCredential: true,
	}
	repo := &watchSourcePortableRepoStub{
		sources: []*WatchSource{source},
		bundles: map[int64]*WatchSourceCredentialBundle{
			1: {CredentialType: WatchCredentialBearer, EncryptedValue: `enc:{"access_token":"portable-secret"}`},
		},
	}
	service := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})
	service.now = func() time.Time { return time.Unix(123, 0).UTC() }

	envelope, err := service.ExportSources(context.Background(), WatchSourceExportRequest{
		Password: "a-strong-portable-password", IncludeCredentials: true,
	})
	if err != nil {
		t.Fatalf("ExportSources() error = %v", err)
	}
	preview, err := service.PreviewImportSources(context.Background(), WatchSourceImportPreviewRequest{
		Package: *envelope, Password: "a-strong-portable-password",
	})
	if err != nil {
		t.Fatalf("PreviewImportSources() error = %v", err)
	}
	if preview.Items[0].DefaultAction != "skip" || preview.Items[0].ExistingSourceID != 1 {
		t.Fatalf("preview conflict = %#v", preview.Items[0])
	}

	result, err := service.ApplyImportSources(context.Background(), WatchSourceImportApplyRequest{
		Package: *envelope, Password: "a-strong-portable-password",
		Decisions: []WatchSourceImportApplyDecision{{Index: 0, Action: "rename", Name: "QA source copy"}},
	}, 7)
	if err != nil {
		t.Fatalf("ApplyImportSources() error = %v", err)
	}
	if result.Created != 1 || result.Failed != 0 || repo.created == nil {
		t.Fatalf("import result = %#v, created = %#v", result, repo.created)
	}
	if repo.created.EncryptedSecret == "" || repo.created.Source.Name != "QA source copy" {
		t.Fatalf("import mutation did not preserve encrypted credential/config: %#v", repo.created)
	}
}

func TestWatchSourcePortableOverwriteWithoutCredentialsPreservesExistingSecrets(t *testing.T) {
	source := &WatchSource{
		ID: 1, Name: "QA source", AdapterType: WatchSourceAdapterSub2API,
		BaseURL: "https://upstream.example", APIBaseURL: "https://upstream.example/api/v1",
		RechargeRatio: 1, PollingIntervalSeconds: 60, RequestTimeoutSeconds: 15,
		KeepaliveEnabled: true, KeepaliveIntervalSeconds: 300, Enabled: true,
		AuthMode: WatchSourceAuthModeManual, CredentialType: WatchCredentialBearer,
		HasCredential: true, HasLoginCredential: true,
	}
	repo := &watchSourcePortableRepoStub{
		sources: []*WatchSource{source},
	}
	service := NewWatchSourceService(repo, watchSourceAuthTestEncryptor{})

	envelope, err := encryptWatchSourcePortablePayload("a-strong-portable-password", watchSourcePortablePayload{
		Format: WatchSourcePortableFormat, Version: WatchSourcePortableVersion,
		ExportedAt: time.Unix(123, 0).UTC(),
		Sources: []watchSourcePortableSource{{
			Name: "QA source", AdapterType: WatchSourceAdapterSub2API,
			BaseURL: "https://upstream.example", APIBaseURL: "https://upstream.example/api/v1",
			RechargeRatio: 1, PollingIntervalSeconds: 60, RequestTimeoutSeconds: 15,
			KeepaliveEnabled: true, KeepaliveIntervalSeconds: 300, Enabled: true,
			AuthMode: WatchSourceAuthModeManual, CredentialType: WatchCredentialBearer,
		}},
	}, time.Unix(123, 0).UTC())
	if err != nil {
		t.Fatalf("encryptWatchSourcePortablePayload() error = %v", err)
	}

	result, err := service.ApplyImportSources(context.Background(), WatchSourceImportApplyRequest{
		Package: *envelope, Password: "a-strong-portable-password",
		Decisions: []WatchSourceImportApplyDecision{{Index: 0, Action: "overwrite"}},
	}, 7)
	if err != nil {
		t.Fatalf("ApplyImportSources() error = %v", err)
	}
	if result.Updated != 1 || repo.updated == nil {
		t.Fatalf("import result = %#v, updated = %#v", result, repo.updated)
	}
	if repo.updated.ClearCredential || repo.updated.ClearLoginCredential {
		t.Fatalf("overwrite without credentials should preserve existing secrets: %#v", repo.updated)
	}
}

func TestValidateWatchSourcePortablePassword(t *testing.T) {
	if err := validateWatchSourcePortablePassword("short"); err == nil {
		t.Fatal("short password should fail")
	}
	if err := validateWatchSourcePortablePassword("123456789012"); err != nil {
		t.Fatalf("valid password rejected: %v", err)
	}
}
