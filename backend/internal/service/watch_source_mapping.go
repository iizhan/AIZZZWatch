package service

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	watchReadCapabilityProfile  = "profile"
	watchReadCapabilityGroups   = "groups"
	watchReadCapabilityRates    = "rates"
	watchReadCapabilityChannels = "channels"
	watchReadCapabilityKeys     = "keys"

	watchReadRecordModeList     = "list"
	watchReadRecordModeKeyedMap = "keyed_map"
)

var (
	watchMappingDotPathPattern = regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*){0,11}$`)
	watchMappingUnsafeSegments = map[string]struct{}{
		"__proto__":   {},
		"constructor": {},
		"prototype":   {},
	}
	watchReadCapabilities = []string{
		watchReadCapabilityProfile,
		watchReadCapabilityGroups,
		watchReadCapabilityRates,
		watchReadCapabilityChannels,
		watchReadCapabilityKeys,
	}
	watchReadMappingAllowedFields = map[string]map[string]string{
		watchReadCapabilityProfile: {
			"balance": "balance",
		},
		watchReadCapabilityGroups: {
			"id":              "id",
			"group_id":        "id",
			"groupId":         "id",
			"name":            "name",
			"title":           "name",
			"label":           "name",
			"platform":        "platform",
			"provider":        "platform",
			"rate_multiplier": "rate_multiplier",
			"rateMultiplier":  "rate_multiplier",
			"ratio":           "rate_multiplier",
			"multiplier":      "rate_multiplier",
		},
		watchReadCapabilityRates: {
			"id":              "group_id",
			"group_id":        "group_id",
			"groupId":         "group_id",
			"rate_multiplier": "rate_multiplier",
			"rateMultiplier":  "rate_multiplier",
			"ratio":           "rate_multiplier",
			"multiplier":      "rate_multiplier",
		},
		watchReadCapabilityChannels: {
			"group_id":          "group_id",
			"groupId":           "group_id",
			"id":                "group_id",
			"platform":          "platform",
			"provider":          "platform",
			"model":             "model",
			"model_name":        "model",
			"modelName":         "model",
			"name":              "model",
			"input_price":       "input_price",
			"inputPrice":        "input_price",
			"output_price":      "output_price",
			"outputPrice":       "output_price",
			"per_request_price": "per_request_price",
			"perRequestPrice":   "per_request_price",
		},
		watchReadCapabilityKeys: {
			"id":           "id",
			"key_id":       "id",
			"keyId":        "id",
			"name":         "name",
			"title":        "name",
			"label":        "name",
			"status":       "status",
			"state":        "status",
			"group_ids":    "group_ids",
			"groupIds":     "group_ids",
			"group_names":  "group_names",
			"groupNames":   "group_names",
			"key_value":    "key_value",
			"keyValue":     "key_value",
			"api_key":      "key_value",
			"apiKey":       "key_value",
			"upstream_key": "key_value",
			"upstreamKey":  "key_value",
			"provider_key": "key_value",
			"providerKey":  "key_value",
			"access_key":   "key_value",
			"accessKey":    "key_value",
			"key":          "key_value",
		},
	}
)

func NormalizeWatchSourceReadMapping(input *WatchSourceReadMapping, adapter string) (*WatchSourceReadMapping, error) {
	if input == nil {
		return nil, nil
	}
	template := strings.ToLower(strings.TrimSpace(input.Template))
	if template == "" {
		switch adapter {
		case WatchSourceAdapterNewAPI, WatchSourceAdapterCustom:
			template = adapter
		default:
			template = WatchSourceAdapterSub2API
		}
	}
	switch template {
	case WatchSourceAdapterSub2API, WatchSourceAdapterNewAPI, WatchSourceAdapterCustom:
	default:
		return nil, fmt.Errorf("unsupported watch source read mapping template")
	}
	capabilities := map[string]WatchSourceReadCapabilityMapping{}
	for _, capability := range watchReadCapabilities {
		raw, ok := input.Capabilities[capability]
		if !ok {
			continue
		}
		normalized, hasValue, err := normalizeWatchReadCapabilityMapping(capability, raw)
		if err != nil {
			return nil, err
		}
		if hasValue {
			capabilities[capability] = normalized
		}
	}
	if len(capabilities) == 0 && strings.TrimSpace(input.Template) == "" {
		return nil, nil
	}
	return &WatchSourceReadMapping{Version: 1, Template: template, Capabilities: capabilities}, nil
}

func normalizeWatchReadCapabilityMapping(capability string, input WatchSourceReadCapabilityMapping) (WatchSourceReadCapabilityMapping, bool, error) {
	out := WatchSourceReadCapabilityMapping{}
	var hasValue bool
	var err error
	if out.ObjectPath, err = cleanWatchMappingPath(input.ObjectPath); err != nil {
		return out, false, fmt.Errorf("%s.object_path is invalid", capability)
	}
	if out.ObjectPath != "" {
		hasValue = true
	}
	if out.RecordsPath, err = cleanWatchMappingPath(input.RecordsPath); err != nil {
		return out, false, fmt.Errorf("%s.records_path is invalid", capability)
	}
	if out.RecordsPath != "" {
		hasValue = true
	}
	mode := strings.ToLower(strings.TrimSpace(input.RecordMode))
	switch mode {
	case "":
	case watchReadRecordModeList, watchReadRecordModeKeyedMap:
		out.RecordMode = mode
		hasValue = true
	default:
		return out, false, fmt.Errorf("%s.record_mode is invalid", capability)
	}
	fields := map[string]string{}
	allowed := watchReadMappingAllowedFields[capability]
	for key, value := range input.Fields {
		canonical, ok := allowed[key]
		if !ok {
			continue
		}
		path, err := cleanWatchMappingPath(value)
		if err != nil {
			return out, false, fmt.Errorf("%s.fields.%s is invalid", capability, key)
		}
		if path != "" {
			fields[canonical] = path
		}
	}
	if len(fields) > 0 {
		out.Fields = fields
		hasValue = true
	}
	return out, hasValue, nil
}

func cleanWatchMappingPath(value string) (string, error) {
	path := strings.TrimSpace(value)
	if path == "" {
		return "", nil
	}
	if len(path) > 240 || !watchMappingDotPathPattern.MatchString(path) {
		return "", fmt.Errorf("path must be a safe dot path")
	}
	for _, segment := range strings.Split(path, ".") {
		if _, unsafe := watchMappingUnsafeSegments[segment]; unsafe {
			return "", fmt.Errorf("path contains unsafe segment")
		}
	}
	return path, nil
}

func watchReadMappingCapability(mapping *WatchSourceReadMapping, capability string) (WatchSourceReadCapabilityMapping, bool) {
	if mapping == nil || len(mapping.Capabilities) == 0 {
		return WatchSourceReadCapabilityMapping{}, false
	}
	value, ok := mapping.Capabilities[capability]
	return value, ok
}
