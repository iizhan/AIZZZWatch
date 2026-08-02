package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

type gatewayFailoverSettingRepoStub struct {
	mu     sync.Mutex
	values map[string]string
	reads  int
	err    error
}

func (r *gatewayFailoverSettingRepoStub) Get(_ context.Context, key string) (*Setting, error) {
	value, err := r.GetValue(context.Background(), key)
	if err != nil || value == "" {
		return nil, ErrSettingNotFound
	}
	return &Setting{Key: key, Value: value}, nil
}

func (r *gatewayFailoverSettingRepoStub) GetValue(_ context.Context, key string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reads++
	if r.err != nil {
		return "", r.err
	}
	return r.values[key], nil
}

func (r *gatewayFailoverSettingRepoStub) Set(_ context.Context, key, value string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.values[key] = value
	return nil
}

func (r *gatewayFailoverSettingRepoStub) GetMultiple(_ context.Context, _ []string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (r *gatewayFailoverSettingRepoStub) SetMultiple(_ context.Context, _ map[string]string) error {
	return nil
}
func (r *gatewayFailoverSettingRepoStub) GetAll(_ context.Context) (map[string]string, error) {
	return map[string]string{}, nil
}
func (r *gatewayFailoverSettingRepoStub) Delete(_ context.Context, key string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.values, key)
	return nil
}

func TestParseGatewayFailoverStatusCodesNormalizesRanges(t *testing.T) {
	codes, err := ParseGatewayFailoverStatusCodes(" 524,500-503,502-505,401 ")
	require.NoError(t, err)
	require.Equal(t, "401,500-505,524", codes.String())
	require.True(t, codes.Contains(401))
	require.True(t, codes.Contains(503))
	require.False(t, codes.Contains(429))
}

func TestParseGatewayFailoverStatusCodesRejectsInvalidValues(t *testing.T) {
	for _, raw := range []string{"", "99", "600", "500-499", "abc", "500-501-502"} {
		_, err := ParseGatewayFailoverStatusCodes(raw)
		require.Error(t, err, raw)
	}
}

func TestGatewayFailoverSettingsDefaultCacheAndImmediateUpdate(t *testing.T) {
	repo := &gatewayFailoverSettingRepoStub{values: map[string]string{}}
	svc := NewSettingService(repo, &config.Config{})

	first, err := svc.GetGatewayFailoverSettings(context.Background())
	require.NoError(t, err)
	require.Equal(t, DefaultGatewayFailoverSettings(), first)
	second, err := svc.GetGatewayFailoverSettings(context.Background())
	require.NoError(t, err)
	require.Equal(t, first, second)
	require.Equal(t, 1, repo.reads, "fresh cache must avoid one DB read per request")

	err = svc.SetGatewayFailoverSettings(context.Background(), &GatewayFailoverSettings{
		Enabled: false, StatusCodes: "524,502", MaxAccountSwitches: 1,
	})
	require.NoError(t, err)
	updated, err := svc.GetGatewayFailoverSettings(context.Background())
	require.NoError(t, err)
	require.False(t, updated.Enabled)
	require.Equal(t, "502,524", updated.StatusCodes)
	require.Equal(t, 1, updated.MaxAccountSwitches)
	require.Equal(t, 1, repo.reads, "saving must refresh the cache immediately")
}

func TestGatewayFailoverSettingsValidation(t *testing.T) {
	svc := NewSettingService(&gatewayFailoverSettingRepoStub{values: map[string]string{}}, &config.Config{})
	require.Error(t, svc.SetGatewayFailoverSettings(context.Background(), nil))
	require.Error(t, svc.SetGatewayFailoverSettings(context.Background(), &GatewayFailoverSettings{
		Enabled: true, StatusCodes: "700", MaxAccountSwitches: 1,
	}))
	require.Error(t, svc.SetGatewayFailoverSettings(context.Background(), &GatewayFailoverSettings{
		Enabled: true, StatusCodes: "502", MaxAccountSwitches: 11,
	}))
	require.False(t, (&GatewayFailoverSettings{Enabled: false, StatusCodes: "502", MaxAccountSwitches: 2}).AllowsStatus(502))
	require.False(t, (&GatewayFailoverSettings{Enabled: true, StatusCodes: "502", MaxAccountSwitches: 0}).AllowsStatus(502))
}

func TestGatewayFailoverPolicyKeepsLegacyServiceBehaviorWithoutRequestMarker(t *testing.T) {
	repo := &gatewayFailoverSettingRepoStub{values: map[string]string{}}
	settingService := NewSettingService(repo, &config.Config{})
	openAIService := &OpenAIGatewayService{settingService: settingService}
	gatewayService := &GatewayService{settingService: settingService}
	antigravityService := &AntigravityGatewayService{settingService: settingService}

	require.True(t, openAIService.shouldFailoverOpenAIUpstreamResponseWithContext(context.Background(), 502, "", nil))
	require.True(t, gatewayService.shouldFailoverUpstreamErrorWithContext(context.Background(), 502))
	require.True(t, antigravityService.shouldFailoverUpstreamErrorWithContext(context.Background(), 502))

	require.True(t, openAIService.shouldFailoverOpenAIUpstreamResponse(502, "", nil), "legacy non-text endpoints keep their existing policy")
	require.True(t, openAIService.shouldFailoverGrokUpstreamError(502, nil), "legacy media endpoints keep their existing policy")
}

func TestGatewayFailoverPolicyDefaultsToDisabledForMarkedRequests(t *testing.T) {
	repo := &gatewayFailoverSettingRepoStub{values: map[string]string{}}
	settingService := NewSettingService(repo, &config.Config{})
	openAIService := &OpenAIGatewayService{settingService: settingService}
	gatewayService := &GatewayService{settingService: settingService}
	antigravityService := &AntigravityGatewayService{settingService: settingService}
	ctx := WithGatewayFailoverPolicy(context.Background())

	require.False(t, openAIService.shouldFailoverOpenAIUpstreamResponseWithContext(ctx, 502, "", nil))
	require.False(t, gatewayService.shouldFailoverUpstreamErrorWithContext(ctx, 502))
	require.False(t, antigravityService.shouldFailoverUpstreamErrorWithContext(ctx, 502))
}

func TestGatewayFailoverPolicyMarkedRequestsDoNotBypassStatusAllowlist(t *testing.T) {
	repo := &gatewayFailoverSettingRepoStub{values: map[string]string{}}
	settingService := NewSettingService(repo, &config.Config{})
	require.NoError(t, settingService.SetGatewayFailoverSettings(context.Background(), &GatewayFailoverSettings{
		Enabled: true, StatusCodes: "502,524", MaxAccountSwitches: 2,
	}))
	openAIService := &OpenAIGatewayService{settingService: settingService}
	ctx := WithGatewayFailoverPolicy(context.Background())
	body := []byte(`{"error":{"message":"Selected model is at capacity. Please try a different model."}}`)

	require.False(t, openAIService.shouldFailoverOpenAIUpstreamResponseWithContext(ctx, 400, "Selected model is at capacity", body))
	require.True(t, openAIService.shouldFailoverOpenAIUpstreamResponseWithContext(ctx, 502, "", nil))
}

func TestGatewayFailoverPolicyFailsClosedWhenSettingsCannotBeRead(t *testing.T) {
	repo := &gatewayFailoverSettingRepoStub{values: map[string]string{}, err: errors.New("settings unavailable")}
	settingService := NewSettingService(repo, &config.Config{})
	openAIService := &OpenAIGatewayService{settingService: settingService}
	gatewayService := &GatewayService{settingService: settingService}
	antigravityService := &AntigravityGatewayService{settingService: settingService}

	ctx := WithGatewayFailoverPolicy(context.Background())
	require.False(t, openAIService.shouldFailoverOpenAIUpstreamResponseWithContext(ctx, 502, "", nil))
	require.False(t, gatewayService.shouldFailoverUpstreamErrorWithContext(ctx, 502))
	require.False(t, antigravityService.shouldFailoverUpstreamErrorWithContext(ctx, 502))
}

func TestGatewayFailoverSettingsReachGeminiCompatAndOpenAIPassthrough(t *testing.T) {
	repo := &gatewayFailoverSettingRepoStub{values: map[string]string{}}
	settingService := NewSettingService(repo, &config.Config{})
	require.NoError(t, settingService.SetGatewayFailoverSettings(context.Background(), &GatewayFailoverSettings{
		Enabled: true, StatusCodes: "418", MaxAccountSwitches: 2,
	}))

	antigravityService := &AntigravityGatewayService{settingService: settingService}
	geminiService := &GeminiMessagesCompatService{antigravityGatewayService: antigravityService}
	openAIService := &OpenAIGatewayService{settingService: settingService}
	account := &Account{Type: AccountTypeAPIKey}
	ctx := WithGatewayFailoverPolicy(context.Background())

	require.True(t, geminiService.shouldFailoverGeminiUpstreamErrorWithContext(ctx, 418))
	require.False(t, geminiService.shouldFailoverGeminiUpstreamErrorWithContext(ctx, 502))
	require.True(t, openAIService.shouldFailoverOpenAIPassthroughResponse(ctx, account, 418, nil))
	require.False(t, openAIService.shouldFailoverOpenAIPassthroughResponse(ctx, account, 502, nil))
}
