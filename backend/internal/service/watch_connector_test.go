package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIsRetryableWatchConnectorError(t *testing.T) {
	for _, code := range []string{"network_error", "dns_error", "upstream_error", "read_error"} {
		if !isRetryableWatchConnectorError(&watchConnectorError{code: code, err: errors.New("temporary")}) {
			t.Fatalf("error code %q should be retryable", code)
		}
	}
	for _, code := range []string{"unauthorized", "rate_limited", "invalid_response", "private_network_blocked"} {
		if isRetryableWatchConnectorError(&watchConnectorError{code: code, err: errors.New("permanent")}) {
			t.Fatalf("error code %q must not be retried", code)
		}
	}
}

func TestNewWatchSourceHTTPClientDisablesEnvironmentProxy(t *testing.T) {
	client := newWatchSourceHTTPClient(time.Second, false)
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("client transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("watch source transport must not use environment proxies")
	}
}

func TestIsPublicWatchIPRejectsPrivateAndSpecialUseRanges(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{value: "8.8.8.8", want: true},
		{value: "2001:4860:4860::8888", want: true},
		{value: "127.0.0.1", want: false},
		{value: "10.0.0.1", want: false},
		{value: "100.64.0.1", want: false},
		{value: "169.254.169.254", want: false},
		{value: "192.0.2.1", want: false},
		{value: "198.18.0.1", want: false},
		{value: "203.0.113.1", want: false},
		{value: "::1", want: false},
		{value: "fc00::1", want: false},
		{value: "2001:db8::1", want: false},
	}
	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			if got := isPublicWatchIP(net.ParseIP(test.value)); got != test.want {
				t.Fatalf("isPublicWatchIP(%q) = %v, want %v", test.value, got, test.want)
			}
		})
	}
}

func TestValidateWatchObservationBoundsRejectsExcessiveItems(t *testing.T) {
	groups := make([]WatchSourceGroupObservation, watchMaxGroups+1)
	err := validateWatchObservationBounds(groups, nil, nil)
	if err == nil || watchConnectorErrorCode(err) != "observation_limit_exceeded" {
		t.Fatalf("validateWatchObservationBounds() error = %v", err)
	}

	prices := make([]WatchSourcePriceObservation, watchMaxPrices+1)
	err = validateWatchObservationBounds(nil, prices, nil)
	if err == nil || watchConnectorErrorCode(err) != "observation_limit_exceeded" {
		t.Fatalf("validateWatchObservationBounds() price error = %v", err)
	}

	keys := make([]WatchSourceKeyObservation, watchMaxSourceKeys+1)
	err = validateWatchObservationBounds(nil, nil, keys)
	if err == nil || watchConnectorErrorCode(err) != "observation_limit_exceeded" {
		t.Fatalf("validateWatchObservationBounds() key error = %v", err)
	}
}

func TestNormalizeWatchSourceReadMappingRejectsUnsafePath(t *testing.T) {
	_, err := NormalizeWatchSourceReadMapping(&WatchSourceReadMapping{
		Capabilities: map[string]WatchSourceReadCapabilityMapping{
			watchReadCapabilityGroups: {
				RecordsPath: "data.__proto__",
			},
		},
	}, WatchSourceAdapterCustom)
	if err == nil {
		t.Fatal("NormalizeWatchSourceReadMapping() error = nil, want unsafe path rejection")
	}
}

func TestFetchWatchSourceUsesCustomReadMapping(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/profile":
			_, _ = w.Write([]byte(`{"payload":{"wallet":{"remain":"12.5"}}}`))
		case "/group-list":
			_, _ = w.Write([]byte(`{"payload":{"items":[{"gid":"team-a","display":"Team A","provider":"openai","meta":{"ratio":"0.20"}}]}}`))
		case "/rate-map":
			_, _ = w.Write([]byte(`{"payload":{"rates":{"team-a":"0.15"}}}`))
		case "/model-prices":
			_, _ = w.Write([]byte(`{"payload":{"models":[{"gid":"team-a","provider":"openai","model":"gpt-test","prices":{"input":"0.01","output":"0.02"}}]}}`))
		case "/tokens":
			_, _ = w.Write([]byte(`{"payload":{"tokens":[{"tokenId":"key-a","label":"Key A","groups":["team-a"]}]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	source := &WatchSource{
		ID:                    1,
		Name:                  "Custom upstream",
		AdapterType:           WatchSourceAdapterCustom,
		APIBaseURL:            server.URL,
		RechargeRatio:         1,
		RequestTimeoutSeconds: 3,
		ProfilePath:           "/profile",
		GroupsPath:            "/group-list",
		RatesPath:             "/rate-map",
		PricingPath:           "/model-prices",
		KeysPath:              "/tokens",
		ReadMapping: &WatchSourceReadMapping{
			Version:  1,
			Template: WatchSourceAdapterCustom,
			Capabilities: map[string]WatchSourceReadCapabilityMapping{
				watchReadCapabilityProfile: {
					ObjectPath: "payload.wallet",
					Fields:     map[string]string{"balance": "remain"},
				},
				watchReadCapabilityGroups: {
					RecordsPath: "payload.items",
					Fields: map[string]string{
						"id":              "gid",
						"name":            "display",
						"platform":        "provider",
						"rate_multiplier": "meta.ratio",
					},
				},
				watchReadCapabilityRates: {
					RecordsPath: "payload.rates",
					RecordMode:  watchReadRecordModeKeyedMap,
				},
				watchReadCapabilityChannels: {
					RecordsPath: "payload.models",
					Fields: map[string]string{
						"group_id":     "gid",
						"platform":     "provider",
						"model":        "model",
						"input_price":  "prices.input",
						"output_price": "prices.output",
					},
				},
				watchReadCapabilityKeys: {
					RecordsPath: "payload.tokens",
					Fields: map[string]string{
						"id":        "tokenId",
						"name":      "label",
						"group_ids": "groups",
					},
				},
			},
		},
	}

	observation, err := fetchWatchSource(context.Background(), source, WatchCredentialBearer, WatchSourceCredential{AccessToken: "token"}, true)
	if err != nil {
		t.Fatalf("fetchWatchSource() error = %v", err)
	}
	if observation.Balance == nil || *observation.Balance != 12.5 {
		t.Fatalf("Balance = %v, want 12.5", observation.Balance)
	}
	if len(observation.Groups) != 1 {
		t.Fatalf("Groups len = %d, want 1", len(observation.Groups))
	}
	group := observation.Groups[0]
	if group.ExternalID != "team-a" || group.Name != "Team A" || group.Platform != "openai" || group.RateMultiplier != 0.20 {
		t.Fatalf("Group = %#v, want mapped group", group)
	}
	if group.UserRateMultiplier == nil || *group.UserRateMultiplier != 0.15 {
		t.Fatalf("UserRateMultiplier = %v, want 0.15", group.UserRateMultiplier)
	}
	if len(observation.Prices) != 2 {
		t.Fatalf("Prices len = %d, want input/output", len(observation.Prices))
	}
	if len(observation.SourceKeys) != 1 || observation.SourceKeys[0].ExternalID != "key-a" || len(observation.SourceKeys[0].GroupExternalIDs) != 1 {
		t.Fatalf("SourceKeys = %#v, want mapped key with group", observation.SourceKeys)
	}
}

func TestNormalizeWatchSourceKeysRedactsCredentialAndKeepsDigest(t *testing.T) {
	now := time.Now().UTC()
	keys := normalizeWatchSourceKeys([]any{
		map[string]any{
			"id": "101", "name": "Team Key", "api_key": "source-key-not-rendered",
			"status": "active", "group_ids": []any{float64(3)}, "created_at": "2026-07-20T00:00:00Z",
		},
	}, now)
	if len(keys) != 1 {
		t.Fatalf("keys len = %d, want 1", len(keys))
	}
	if keys[0].ExternalID != "101" || keys[0].Label != "Team Key" {
		t.Fatalf("key = %#v, want normalized identity", keys[0])
	}
	if len(keys[0].GroupExternalIDs) != 1 || keys[0].GroupExternalIDs[0] != "3" {
		t.Fatalf("group ids = %#v, want [3]", keys[0].GroupExternalIDs)
	}
	if keys[0].KeyDigest == "" || keys[0].KeyDigest == "source-key-not-rendered" {
		t.Fatalf("key digest = %q, want non-empty digest without raw credential", keys[0].KeyDigest)
	}
}
