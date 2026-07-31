package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	watchMaxResponseBytes = 2 << 20
	watchMaxGroups        = 500
	watchMaxPrices        = 5000
	watchMaxSourceKeys    = 200

	watchDefaultSub2APIKeyPath = "/keys?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai"
	watchDefaultNewAPIKeyPath  = "/api/token/?p=0&size=100"
)

var blockedWatchPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("ff00::/8"),
}

type watchConnectorError struct {
	code string
	err  error
}

func (e *watchConnectorError) Error() string { return e.err.Error() }
func (e *watchConnectorError) Unwrap() error { return e.err }

func watchConnectorErrorCode(err error) string {
	var connectorErr *watchConnectorError
	if errors.As(err, &connectorErr) {
		return connectorErr.code
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "timeout"
	}
	return "network_error"
}

func fetchWatchSource(ctx context.Context, source *WatchSource, credentialType string, credential WatchSourceCredential, allowPrivate bool) (WatchSourceObservation, error) {
	started := time.Now()
	client := newWatchSourceHTTPClient(time.Duration(source.RequestTimeoutSeconds)*time.Second, allowPrivate)
	paths := resolvedWatchSourcePaths(source)
	profilePath, groupsPath, ratesPath, pricingPath, keysPath := paths.ProfilePath, paths.GroupsPath, paths.RatesPath, paths.PricingPath, paths.KeysPath
	profile, err := requestWatchJSON(ctx, client, joinWatchURL(source.APIBaseURL, profilePath), credentialType, credential, false)
	if err != nil {
		return WatchSourceObservation{}, err
	}
	groupsPayload, err := requestWatchJSON(ctx, client, joinWatchURL(source.APIBaseURL, groupsPath), credentialType, credential, false)
	if err != nil {
		return WatchSourceObservation{}, err
	}
	var ratesPayload any
	if ratesPath != "" {
		ratesPayload, _ = requestWatchJSON(ctx, client, joinWatchURL(source.APIBaseURL, ratesPath), credentialType, credential, true)
	}
	pricingPayload, _ := requestWatchJSON(ctx, client, joinWatchURL(source.APIBaseURL, pricingPath), credentialType, credential, true)
	now := time.Now().UTC()
	var sourceKeys []WatchSourceKeyObservation
	if keysPath != "" {
		if keysPayload, keyErr := requestWatchJSON(ctx, client, joinWatchURL(source.APIBaseURL, keysPath), credentialType, credential, true); keyErr == nil && keysPayload != nil {
			if _, ok := watchReadMappingCapability(source.ReadMapping, watchReadCapabilityKeys); ok {
				sourceKeys = normalizeWatchMappedSourceKeys(keysPayload, source.ReadMapping, now)
			} else {
				sourceKeys = normalizeWatchSourceKeys(keysPayload, now)
			}
		}
	}
	balance := watchBalance(profile)
	if _, ok := watchReadMappingCapability(source.ReadMapping, watchReadCapabilityProfile); ok {
		balance = watchMappedBalance(profile, source.ReadMapping)
	}
	var groups []WatchSourceGroupObservation
	var prices []WatchSourcePriceObservation
	if _, ok := watchReadMappingCapability(source.ReadMapping, watchReadCapabilityGroups); ok {
		groups = normalizeWatchMappedGroups(groupsPayload, source.ReadMapping, now)
		if _, ratesMapped := watchReadMappingCapability(source.ReadMapping, watchReadCapabilityRates); ratesMapped {
			applyWatchUserRates(groups, watchMappedRates(ratesPayload, source.ReadMapping))
		} else if source.AdapterType != WatchSourceAdapterNewAPI {
			applyWatchUserRates(groups, defaultWatchRates(ratesPayload))
		}
	} else if source.AdapterType == WatchSourceAdapterNewAPI {
		groups, prices = normalizeWatchNewAPI(groupsPayload, pricingPayload, now)
	} else {
		groups, prices = normalizeWatchSub2API(groupsPayload, ratesPayload, pricingPayload, now)
	}
	if _, ok := watchReadMappingCapability(source.ReadMapping, watchReadCapabilityChannels); ok {
		prices = normalizeWatchMappedChannels(pricingPayload, source.ReadMapping, now)
		priced := map[string]bool{}
		for _, price := range prices {
			priced[price.GroupExternalID] = true
		}
		for index := range groups {
			groups[index].PricingAvailable = priced[groups[index].ExternalID]
		}
	}
	if len(groups) == 0 {
		return WatchSourceObservation{}, &watchConnectorError{code: "invalid_response", err: fmt.Errorf("upstream returned no readable groups")}
	}
	if err := validateWatchObservationBounds(groups, prices, sourceKeys); err != nil {
		return WatchSourceObservation{}, err
	}
	latency := int(time.Since(started).Milliseconds())
	return WatchSourceObservation{Balance: balance, Groups: groups, Prices: prices, SourceKeys: sourceKeys, LatencyMs: &latency}, nil
}

func fetchWatchSourceHeartbeat(ctx context.Context, source *WatchSource, credentialType string, credential WatchSourceCredential, allowPrivate bool) (WatchSourceObservation, error) {
	started := time.Now()
	client := newWatchSourceHTTPClient(time.Duration(source.RequestTimeoutSeconds)*time.Second, allowPrivate)
	paths := resolvedWatchSourcePaths(source)
	heartbeatPath := firstNonEmptyWatchString(paths.HeartbeatPath, paths.ProfilePath)
	payload, err := requestWatchJSON(ctx, client, joinWatchURL(source.APIBaseURL, heartbeatPath), credentialType, credential, false)
	if err != nil {
		return WatchSourceObservation{}, err
	}
	latency := int(time.Since(started).Milliseconds())
	balance := watchBalance(payload)
	if _, ok := watchReadMappingCapability(source.ReadMapping, watchReadCapabilityProfile); ok {
		balance = watchMappedBalance(payload, source.ReadMapping)
	}
	return WatchSourceObservation{Balance: balance, LatencyMs: &latency}, nil
}

func resolvedWatchSourcePaths(source *WatchSource) watchSourcePathConfig {
	if source == nil {
		return defaultWatchSourcePaths(WatchSourceAdapterSub2API)
	}
	paths := defaultWatchSourcePaths(source.AdapterType)
	if strings.TrimSpace(source.ProfilePath) != "" {
		paths.ProfilePath = strings.TrimSpace(source.ProfilePath)
	}
	if strings.TrimSpace(source.GroupsPath) != "" {
		paths.GroupsPath = strings.TrimSpace(source.GroupsPath)
	}
	if strings.TrimSpace(source.RatesPath) != "" {
		paths.RatesPath = strings.TrimSpace(source.RatesPath)
	}
	if strings.TrimSpace(source.PricingPath) != "" {
		paths.PricingPath = strings.TrimSpace(source.PricingPath)
	}
	if strings.TrimSpace(source.KeysPath) != "" {
		paths.KeysPath = strings.TrimSpace(source.KeysPath)
	}
	if strings.TrimSpace(source.LoginPath) != "" {
		paths.LoginPath = strings.TrimSpace(source.LoginPath)
	}
	if strings.TrimSpace(source.HeartbeatPath) != "" {
		paths.HeartbeatPath = strings.TrimSpace(source.HeartbeatPath)
	}
	return paths
}

func validateWatchObservationBounds(groups []WatchSourceGroupObservation, prices []WatchSourcePriceObservation, sourceKeys []WatchSourceKeyObservation) error {
	if len(groups) > watchMaxGroups || len(prices) > watchMaxPrices || len(sourceKeys) > watchMaxSourceKeys {
		return &watchConnectorError{code: "observation_limit_exceeded", err: fmt.Errorf("upstream observation exceeds item limit")}
	}
	return nil
}

func newWatchSourceHTTPClient(timeout time.Duration, allowPrivate bool) *http.Client {
	dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, &watchConnectorError{code: "invalid_url", err: err}
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil || len(ips) == 0 {
				return nil, &watchConnectorError{code: "dns_error", err: fmt.Errorf("resolve upstream host: %w", err)}
			}
			for _, resolved := range ips {
				if !allowPrivate && !isPublicWatchIP(resolved.IP) {
					return nil, &watchConnectorError{code: "private_network_blocked", err: fmt.Errorf("upstream resolved to a private or reserved address")}
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
		},
		TLSHandshakeTimeout:   timeout,
		ResponseHeaderTimeout: timeout,
		IdleConnTimeout:       30 * time.Second,
		MaxIdleConns:          20,
		MaxIdleConnsPerHost:   2,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return &watchConnectorError{code: "redirect_blocked", err: fmt.Errorf("upstream redirects are not allowed")}
		},
	}
}

func isPublicWatchIP(ip net.IP) bool {
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	address = address.Unmap()
	if !address.IsGlobalUnicast() {
		return false
	}
	for _, prefix := range blockedWatchPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

func joinWatchURL(base, path string) string {
	base = strings.TrimRight(base, "/")
	if strings.HasSuffix(strings.ToLower(base), "/api/v1") && strings.HasPrefix(path, "/api/") {
		if parsed, err := url.Parse(base); err == nil {
			base = parsed.Scheme + "://" + parsed.Host
		}
	}
	return base + "/" + strings.TrimLeft(path, "/")
}

func requestWatchJSON(ctx context.Context, client *http.Client, endpoint, credentialType string, credential WatchSourceCredential, optional bool) (any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, &watchConnectorError{code: "invalid_url", err: err}
	}
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
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if optional && resp.StatusCode == http.StatusNotFound {
			return nil, nil
		}
		code := "api_error"
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			code = "unauthorized"
		case http.StatusTooManyRequests:
			code = "rate_limited"
		default:
			if resp.StatusCode >= 500 {
				code = "upstream_error"
			}
		}
		return nil, &watchConnectorError{code: code, err: fmt.Errorf("upstream returned HTTP %d", resp.StatusCode)}
	}
	reader := io.LimitReader(resp.Body, watchMaxResponseBytes+1)
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, &watchConnectorError{code: "read_error", err: err}
	}
	if len(body) > watchMaxResponseBytes {
		return nil, &watchConnectorError{code: "response_too_large", err: fmt.Errorf("upstream response exceeds size limit")}
	}
	var payload any
	if err = json.Unmarshal(body, &payload); err != nil {
		return nil, &watchConnectorError{code: "invalid_response", err: fmt.Errorf("upstream response is not valid JSON")}
	}
	if record, ok := payload.(map[string]any); ok {
		if code, exists := watchFloat(record["code"]); exists && code != 0 {
			return nil, &watchConnectorError{code: "api_error", err: fmt.Errorf("upstream API rejected request")}
		}
		if success, exists := record["success"].(bool); exists && !success {
			return nil, &watchConnectorError{code: "api_error", err: fmt.Errorf("upstream API rejected request")}
		}
	}
	return payload, nil
}

func unwrapWatchPayload(payload any) any {
	if record, ok := payload.(map[string]any); ok {
		if data, exists := record["data"]; exists {
			return data
		}
	}
	return payload
}

func watchRecords(payload any) []map[string]any {
	payload = unwrapWatchPayload(payload)
	if values, ok := payload.([]any); ok {
		out := make([]map[string]any, 0, len(values))
		for _, value := range values {
			if record, ok := value.(map[string]any); ok {
				out = append(out, record)
			}
		}
		return out
	}
	if record, ok := payload.(map[string]any); ok {
		for _, key := range []string{"items", "groups", "records", "list", "data"} {
			if values, ok := record[key].([]any); ok {
				return watchRecords(values)
			}
		}
		return []map[string]any{record}
	}
	return nil
}

func watchMappedPath(value any, path string) any {
	if strings.TrimSpace(path) == "" {
		return value
	}
	current := value
	for _, segment := range strings.Split(path, ".") {
		record, ok := current.(map[string]any)
		if !ok || record == nil {
			return nil
		}
		current = record[segment]
	}
	return current
}

func watchMappedRecords(payload any, mapping *WatchSourceReadMapping, capability string) []map[string]any {
	config, ok := watchReadMappingCapability(mapping, capability)
	if !ok {
		return watchRecords(payload)
	}
	return watchRecords(watchMappedPath(payload, config.RecordsPath))
}

func watchMappedRecord(record map[string]any, mapping *WatchSourceReadMapping, capability string) map[string]any {
	config, ok := watchReadMappingCapability(mapping, capability)
	if !ok || len(config.Fields) == 0 {
		return record
	}
	out := make(map[string]any, len(record)+len(config.Fields))
	for key, value := range record {
		out[key] = value
	}
	for key, path := range config.Fields {
		out[key] = watchMappedPath(record, path)
	}
	return out
}

func watchFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case json.Number:
		value, err := typed.Float64()
		return value, err == nil
	case string:
		value, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return value, err == nil && !math.IsNaN(value) && !math.IsInf(value, 0)
	default:
		return 0, false
	}
}

func watchFirstFloat(record map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		if value, ok := watchFloat(record[key]); ok {
			return value, true
		}
	}
	return 0, false
}

func watchFirstString(record map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := record[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
		if value, ok := watchFloat(record[key]); ok {
			return strconv.FormatFloat(value, 'f', -1, 64)
		}
	}
	return ""
}

func watchBalance(payload any) *float64 {
	for _, record := range watchRecords(payload) {
		if value, ok := watchFirstFloat(record, "balance", "credit_balance", "credits", "credit", "amount", "total", "remaining", "available", "current_balance"); ok {
			return &value
		}
		for _, key := range []string{"wallet", "balance_info", "credit_info"} {
			if nested, ok := record[key].(map[string]any); ok {
				if value, ok := watchFirstFloat(nested, "balance", "credits", "amount", "remaining", "available"); ok {
					return &value
				}
			}
		}
	}
	return nil
}

func watchMappedBalance(payload any, mapping *WatchSourceReadMapping) *float64 {
	config, ok := watchReadMappingCapability(mapping, watchReadCapabilityProfile)
	if !ok {
		return watchBalance(payload)
	}
	source := watchMappedPath(payload, config.ObjectPath)
	for _, record := range watchRecords(source) {
		mapped := watchMappedRecord(record, mapping, watchReadCapabilityProfile)
		if value, ok := watchFirstFloat(mapped, "balance", "credit_balance", "credits", "credit", "amount", "total", "remaining", "available", "current_balance"); ok {
			return &value
		}
	}
	return nil
}

func defaultWatchRates(ratesPayload any) map[string]float64 {
	rates := map[string]float64{}
	if raw, ok := unwrapWatchPayload(ratesPayload).(map[string]any); ok {
		for key, value := range raw {
			if rate, ok := watchFloat(value); ok {
				rates[key] = rate
			}
		}
	}
	return rates
}

func applyWatchUserRates(groups []WatchSourceGroupObservation, rates map[string]float64) {
	if len(rates) == 0 {
		return
	}
	for index := range groups {
		if value, ok := rates[groups[index].ExternalID]; ok {
			groups[index].UserRateMultiplier = &value
		}
	}
}

func normalizeWatchSub2API(groupsPayload, ratesPayload, channelsPayload any, observedAt time.Time) ([]WatchSourceGroupObservation, []WatchSourcePriceObservation) {
	rates := defaultWatchRates(ratesPayload)
	groups := make([]WatchSourceGroupObservation, 0)
	for index, record := range watchRecords(groupsPayload) {
		externalID := watchFirstString(record, "id", "group_id", "groupId")
		if externalID == "" {
			externalID = strconv.Itoa(index + 1)
		}
		rate, ok := watchFirstFloat(record, "rate_multiplier", "rate", "multiplier", "ratio", "price_ratio")
		if !ok {
			rate = 1
		}
		groups = append(groups, WatchSourceGroupObservation{
			ExternalID: externalID, Name: fallbackWatchString(watchFirstString(record, "name", "title", "channel_name", "display_name"), "Group "+externalID),
			Platform:       fallbackWatchString(watchFirstString(record, "platform", "provider", "type", "model_type"), "unknown"),
			RateMultiplier: rate, ObservedAt: observedAt,
		})
	}
	applyWatchUserRates(groups, rates)
	prices := normalizeWatchSub2APIChannels(channelsPayload, observedAt)
	priced := map[string]bool{}
	for _, price := range prices {
		priced[price.GroupExternalID] = true
	}
	for index := range groups {
		groups[index].PricingAvailable = priced[groups[index].ExternalID]
	}
	return groups, prices
}

func normalizeWatchMappedGroups(groupsPayload any, mapping *WatchSourceReadMapping, observedAt time.Time) []WatchSourceGroupObservation {
	records := watchMappedRecords(groupsPayload, mapping, watchReadCapabilityGroups)
	groups := make([]WatchSourceGroupObservation, 0, len(records))
	for index, record := range records {
		mapped := watchMappedRecord(record, mapping, watchReadCapabilityGroups)
		externalID := watchFirstString(mapped, "id", "group_id", "groupId")
		if externalID == "" {
			externalID = strconv.Itoa(index + 1)
		}
		rate, ok := watchFirstFloat(mapped, "rate_multiplier", "rateMultiplier", "rate", "multiplier", "ratio", "price_ratio")
		if !ok {
			rate = 1
		}
		groups = append(groups, WatchSourceGroupObservation{
			ExternalID:     externalID,
			Name:           fallbackWatchString(watchFirstString(mapped, "name", "title", "channel_name", "display_name"), "Group "+externalID),
			Platform:       fallbackWatchString(watchFirstString(mapped, "platform", "provider", "type", "model_type"), "unknown"),
			RateMultiplier: rate,
			ObservedAt:     observedAt,
		})
	}
	return groups
}

func watchMappedRates(ratesPayload any, mapping *WatchSourceReadMapping) map[string]float64 {
	config, ok := watchReadMappingCapability(mapping, watchReadCapabilityRates)
	if !ok {
		return defaultWatchRates(ratesPayload)
	}
	source := watchMappedPath(ratesPayload, config.RecordsPath)
	rates := map[string]float64{}
	if config.RecordMode == watchReadRecordModeKeyedMap {
		if raw, ok := source.(map[string]any); ok {
			for key, value := range raw {
				if rate, ok := watchFloat(value); ok {
					rates[key] = rate
				}
			}
			return rates
		}
	}
	for _, record := range watchRecords(source) {
		mapped := watchMappedRecord(record, mapping, watchReadCapabilityRates)
		groupID := watchFirstString(mapped, "group_id", "groupId", "id")
		if groupID == "" {
			continue
		}
		if rate, ok := watchFirstFloat(mapped, "rate_multiplier", "rateMultiplier", "rate", "multiplier", "ratio", "price_ratio"); ok {
			rates[groupID] = rate
		}
	}
	return rates
}

func normalizeWatchMappedChannels(payload any, mapping *WatchSourceReadMapping, observedAt time.Time) []WatchSourcePriceObservation {
	records := watchMappedRecords(payload, mapping, watchReadCapabilityChannels)
	out := make([]WatchSourcePriceObservation, 0, len(records))
	for _, record := range records {
		mapped := watchMappedRecord(record, mapping, watchReadCapabilityChannels)
		groupID := watchFirstString(mapped, "group_id", "groupId", "id")
		model := watchFirstString(mapped, "model", "model_name", "modelName", "name")
		platform := fallbackWatchString(watchFirstString(mapped, "platform", "provider"), inferWatchPlatform(model))
		pricing := map[string]any{
			"input_price":       mapped["input_price"],
			"output_price":      mapped["output_price"],
			"per_request_price": mapped["per_request_price"],
		}
		out = appendWatchPriceComponents(out, groupID, platform, model, pricing, observedAt)
	}
	return out
}

func normalizeWatchSub2APIChannels(payload any, observedAt time.Time) []WatchSourcePriceObservation {
	out := make([]WatchSourcePriceObservation, 0)
	for _, channel := range watchRecords(payload) {
		platforms, _ := channel["platforms"].([]any)
		for _, rawPlatform := range platforms {
			platformRecord, ok := rawPlatform.(map[string]any)
			if !ok {
				continue
			}
			platform := watchFirstString(platformRecord, "platform", "name")
			groups, _ := platformRecord["groups"].([]any)
			models, _ := platformRecord["supported_models"].([]any)
			for _, rawGroup := range groups {
				group, ok := rawGroup.(map[string]any)
				if !ok {
					continue
				}
				groupID := watchFirstString(group, "id", "group_id")
				if groupID == "" {
					continue
				}
				for _, rawModel := range models {
					model, ok := rawModel.(map[string]any)
					if !ok {
						continue
					}
					name := watchFirstString(model, "name", "model")
					pricing, _ := model["pricing"].(map[string]any)
					out = appendWatchPriceComponents(out, groupID, platform, name, pricing, observedAt)
				}
			}
		}
	}
	return out
}

func normalizeWatchSourceKeys(payload any, observedAt time.Time) []WatchSourceKeyObservation {
	records := watchRecords(payload)
	out := make([]WatchSourceKeyObservation, 0, len(records))
	for index, record := range records {
		externalID := watchFirstString(record, "id", "key_id", "keyId", "api_key_id", "apiKeyId")
		if externalID == "" {
			externalID = strconv.Itoa(index + 1)
		}
		label := fallbackWatchString(watchFirstString(record, "name", "title", "label", "remark", "description", "note"), "密钥 "+strconv.Itoa(index+1))
		if len([]rune(label)) > 80 {
			label = string([]rune(label)[:80])
		}
		status := watchFirstString(record, "status", "state")
		if status == "" {
			if enabled, ok := watchBooleanLike(record["enabled"]); ok {
				if enabled {
					status = "active"
				} else {
					status = "disabled"
				}
			} else if disabled, ok := watchBooleanLike(record["disabled"]); ok {
				if disabled {
					status = "disabled"
				} else {
					status = "active"
				}
			}
		}
		groupIDs := uniqueWatchStrings(append(append(append(append(append(append([]string{},
			watchStringValues(record["group_id"])...),
			watchStringValues(record["groupId"])...),
			watchStringValues(record["group_ids"])...),
			watchStringValues(record["groupIds"])...),
			watchGroupIDValues(record["groups"])...),
			watchGroupIDValues(record["group"])...,
		))
		groupNames := uniqueWatchStrings(append(append(append([]string{},
			watchStringValues(record["group_name"])...),
			watchStringValues(record["groupName"])...),
			watchGroupNameValues(record["groups"])...,
		))
		groupNames = append(groupNames, watchGroupNameValues(record["group"])...)
		groupNames = uniqueWatchStrings(groupNames)
		if len(groupNames) > 8 {
			groupNames = groupNames[:8]
		}
		var createdAt *time.Time
		for _, key := range []string{"created_at", "createdAt", "created_time", "createdTime"} {
			if parsed := watchTimestamp(record[key]); parsed != nil {
				createdAt = parsed
				break
			}
		}
		summaryParts := make([]string, 0, 3)
		if status != "" {
			summaryParts = append(summaryParts, "状态 "+status)
		}
		if len(groupNames) > 0 {
			summaryParts = append(summaryParts, "分组 "+strings.Join(groupNames, "、"))
		} else if len(groupIDs) > 0 {
			summaryParts = append(summaryParts, "分组 ID "+strings.Join(groupIDs, "、"))
		}
		if createdAt != nil {
			summaryParts = append(summaryParts, "创建 "+createdAt.Format(time.RFC3339))
		}
		key := WatchSourceKeyObservation{
			ExternalID: externalID, Label: label, Status: status, GroupExternalIDs: groupIDs,
			GroupNames: groupNames, ExternalCreatedAt: createdAt, ObservedAt: observedAt,
			Summary: strings.Join(summaryParts, " · "),
		}
		if credential := watchDirectCredential(record); credential != "" {
			sum := sha256.Sum256([]byte(credential))
			key.KeyDigest = fmt.Sprintf("%x", sum)
		}
		out = append(out, key)
		if len(out) == watchMaxSourceKeys {
			break
		}
	}
	return out
}

func normalizeWatchMappedSourceKeys(payload any, mapping *WatchSourceReadMapping, observedAt time.Time) []WatchSourceKeyObservation {
	records := watchMappedRecords(payload, mapping, watchReadCapabilityKeys)
	out := make([]WatchSourceKeyObservation, 0, len(records))
	for index, record := range records {
		mapped := watchMappedRecord(record, mapping, watchReadCapabilityKeys)
		externalID := watchFirstString(mapped, "id", "key_id", "keyId", "api_key_id", "apiKeyId")
		if externalID == "" {
			externalID = strconv.Itoa(index + 1)
		}
		label := fallbackWatchString(watchFirstString(mapped, "name", "title", "label", "remark", "description", "note"), "密钥 "+strconv.Itoa(index+1))
		if len([]rune(label)) > 80 {
			label = string([]rune(label)[:80])
		}
		status := watchFirstString(mapped, "status", "state")
		groupIDs := uniqueWatchStrings(append(append([]string{},
			watchStringValues(mapped["group_ids"])...),
			watchStringValues(mapped["groupIds"])...,
		))
		groupNames := uniqueWatchStrings(append(append([]string{},
			watchStringValues(mapped["group_names"])...),
			watchStringValues(mapped["groupNames"])...,
		))
		if len(groupNames) > 8 {
			groupNames = groupNames[:8]
		}
		key := WatchSourceKeyObservation{
			ExternalID:       externalID,
			Label:            label,
			Status:           status,
			GroupExternalIDs: groupIDs,
			GroupNames:       groupNames,
			ObservedAt:       observedAt,
			Summary:          mappedWatchKeySummary(status, groupIDs, groupNames, nil),
		}
		if credential := watchDirectCredential(mapped); credential != "" {
			sum := sha256.Sum256([]byte(credential))
			key.KeyDigest = fmt.Sprintf("%x", sum)
		}
		out = append(out, key)
		if len(out) == watchMaxSourceKeys {
			break
		}
	}
	return out
}

func mappedWatchKeySummary(status string, groupIDs, groupNames []string, createdAt *time.Time) string {
	summaryParts := make([]string, 0, 3)
	if status != "" {
		summaryParts = append(summaryParts, "状态 "+status)
	}
	if len(groupNames) > 0 {
		summaryParts = append(summaryParts, "分组 "+strings.Join(groupNames, "、"))
	} else if len(groupIDs) > 0 {
		summaryParts = append(summaryParts, "分组 ID "+strings.Join(groupIDs, "、"))
	}
	if createdAt != nil {
		summaryParts = append(summaryParts, "创建 "+createdAt.Format(time.RFC3339))
	}
	return strings.Join(summaryParts, " · ")
}

func normalizeWatchNewAPI(groupsPayload, pricingPayload any, observedAt time.Time) ([]WatchSourceGroupObservation, []WatchSourcePriceObservation) {
	groupRatios := map[string]float64{}
	if record, ok := unwrapWatchPayload(groupsPayload).(map[string]any); ok {
		for name, raw := range record {
			if nested, ok := raw.(map[string]any); ok {
				if ratio, ok := watchFirstFloat(nested, "ratio", "group_ratio", "rate_multiplier"); ok {
					groupRatios[name] = ratio
				}
			} else if ratio, ok := watchFloat(raw); ok {
				groupRatios[name] = ratio
			}
		}
	}
	if envelope, ok := pricingPayload.(map[string]any); ok {
		if ratios, ok := envelope["group_ratio"].(map[string]any); ok {
			for name, raw := range ratios {
				if _, exists := groupRatios[name]; exists {
					if ratio, ok := watchFloat(raw); ok {
						groupRatios[name] = ratio
					}
				}
			}
		}
	}
	prices := make([]WatchSourcePriceObservation, 0)
	for _, record := range watchRecords(pricingPayload) {
		model := watchFirstString(record, "model_name", "modelName", "name")
		if model == "" {
			continue
		}
		enabledGroups := watchStringList(record["enable_groups"])
		if len(enabledGroups) == 0 {
			enabledGroups = watchStringList(record["enableGroups"])
		}
		if len(enabledGroups) == 1 && enabledGroups[0] == "all" {
			enabledGroups = enabledGroups[:0]
			for name := range groupRatios {
				enabledGroups = append(enabledGroups, name)
			}
		}
		pricing := map[string]any{}
		if quotaType, ok := watchFirstFloat(record, "quota_type", "quotaType"); ok && quotaType == 1 {
			pricing["per_request_price"] = record["model_price"]
		} else if ratio, ok := watchFirstFloat(record, "model_ratio", "modelRatio"); ok {
			pricing["input_price"] = ratio * 2
			completion, _ := watchFirstFloat(record, "completion_ratio", "completionRatio")
			if completion == 0 {
				completion = 1
			}
			pricing["output_price"] = ratio * 2 * completion
		}
		for _, groupName := range enabledGroups {
			if _, exists := groupRatios[groupName]; exists {
				prices = appendWatchPriceComponents(prices, groupName, inferWatchPlatform(groupName+" "+model), model, pricing, observedAt)
			}
		}
	}
	priced := map[string]bool{}
	for _, price := range prices {
		priced[price.GroupExternalID] = true
	}
	groups := make([]WatchSourceGroupObservation, 0, len(groupRatios))
	for name, ratio := range groupRatios {
		if name == "auto" || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
			continue
		}
		groups = append(groups, WatchSourceGroupObservation{ExternalID: name, Name: name, Platform: inferWatchPlatform(name), RateMultiplier: ratio, UserRateMultiplier: &ratio, PricingAvailable: priced[name], ObservedAt: observedAt})
	}
	return groups, prices
}

func appendWatchPriceComponents(out []WatchSourcePriceObservation, groupID, platform, model string, pricing map[string]any, observedAt time.Time) []WatchSourcePriceObservation {
	if groupID == "" || model == "" || pricing == nil {
		return out
	}
	for _, component := range []struct{ key, name string }{{"input_price", "input"}, {"output_price", "output"}, {"per_request_price", "per_request"}} {
		if value, ok := watchFloat(pricing[component.key]); ok && value >= 0 {
			out = append(out, WatchSourcePriceObservation{GroupExternalID: groupID, Platform: platform, Model: model, Component: component.name, Value: value, ObservedAt: observedAt})
		}
	}
	return out
}

func watchStringList(value any) []string {
	if values, ok := value.([]any); ok {
		out := make([]string, 0, len(values))
		for _, raw := range values {
			if value, ok := raw.(string); ok && strings.TrimSpace(value) != "" {
				out = append(out, strings.TrimSpace(value))
			}
		}
		return out
	}
	if value, ok := value.(string); ok {
		parts := strings.Split(value, ",")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if strings.TrimSpace(part) != "" {
				out = append(out, strings.TrimSpace(part))
			}
		}
		return out
	}
	return nil
}

func watchStringValues(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			out = append(out, watchStringValues(item)...)
		}
		return out
	case []string:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if strings.TrimSpace(item) != "" {
				out = append(out, strings.TrimSpace(item))
			}
		}
		return out
	case string:
		parts := strings.Split(typed, ",")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if strings.TrimSpace(part) != "" {
				out = append(out, strings.TrimSpace(part))
			}
		}
		return out
	default:
		if number, ok := watchFloat(value); ok {
			return []string{strconv.FormatFloat(number, 'f', -1, 64)}
		}
		return nil
	}
}

func watchGroupIDValues(value any) []string {
	if record, ok := value.(map[string]any); ok {
		return uniqueWatchStrings(append(append(append(append([]string{},
			watchStringValues(record["id"])...),
			watchStringValues(record["group_id"])...),
			watchStringValues(record["groupId"])...),
			watchStringValues(record["external_id"])...,
		))
	}
	if values, ok := value.([]any); ok {
		out := make([]string, 0, len(values))
		for _, item := range values {
			out = append(out, watchGroupIDValues(item)...)
			if _, isRecord := item.(map[string]any); !isRecord {
				out = append(out, watchStringValues(item)...)
			}
		}
		return uniqueWatchStrings(out)
	}
	return watchStringValues(value)
}

func watchGroupNameValues(value any) []string {
	if record, ok := value.(map[string]any); ok {
		return uniqueWatchStrings(append(append(append([]string{},
			watchStringValues(record["name"])...),
			watchStringValues(record["title"])...),
			watchStringValues(record["label"])...,
		))
	}
	if values, ok := value.([]any); ok {
		out := make([]string, 0, len(values))
		for _, item := range values {
			out = append(out, watchGroupNameValues(item)...)
		}
		return uniqueWatchStrings(out)
	}
	return nil
}

func watchBooleanLike(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "on", "enabled", "enable", "active", "running", "normal", "open", "开启", "启用", "正常":
			return true, true
		case "false", "0", "no", "off", "disabled", "disable", "inactive", "paused", "pause", "closed", "stopped", "error", "关闭", "停用", "暂停", "禁用":
			return false, true
		default:
			return false, false
		}
	default:
		if number, ok := watchFloat(value); ok {
			if number == 1 {
				return true, true
			}
			if number == 0 {
				return false, true
			}
		}
		return false, false
	}
}

func watchTimestamp(value any) *time.Time {
	if raw, ok := value.(string); ok {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return nil
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05", "2006-01-02"} {
			if parsed, err := time.Parse(layout, raw); err == nil {
				utc := parsed.UTC()
				return &utc
			}
		}
	}
	if number, ok := watchFloat(value); ok && number > 0 {
		seconds := int64(number)
		if seconds > 10_000_000_000 {
			seconds = seconds / 1000
		}
		utc := time.Unix(seconds, 0).UTC()
		return &utc
	}
	return nil
}

func watchDirectCredential(record map[string]any) string {
	for _, key := range []string{"api_key", "apiKey", "upstream_key", "upstreamKey", "provider_key", "providerKey", "access_key", "accessKey", "key"} {
		if value, ok := record[key].(string); ok {
			trimmed := strings.TrimSpace(value)
			if len(trimmed) >= 8 && len(trimmed) <= 4096 {
				return trimmed
			}
		}
	}
	return ""
}

func uniqueWatchStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func inferWatchPlatform(value string) string {
	lower := strings.ToLower(value)
	switch {
	case strings.Contains(lower, "claude") || strings.Contains(lower, "anthropic"):
		return "anthropic"
	case strings.Contains(lower, "gemini"):
		return "gemini"
	case strings.Contains(lower, "grok"):
		return "grok"
	case strings.Contains(lower, "gpt") || strings.Contains(lower, "openai"):
		return "openai"
	default:
		return "unknown"
	}
}

func fallbackWatchString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
