package service

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

const gatewayFailoverSettingsCacheTTL = 60 * time.Second

type gatewayFailoverPolicyContextKey struct{}

// WithGatewayFailoverPolicy marks the supported HTTP text endpoints whose
// account-switch behavior is governed by the administrator runtime policy.
func WithGatewayFailoverPolicy(ctx context.Context) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, gatewayFailoverPolicyContextKey{}, true)
}

func gatewayFailoverPolicyEnabledFromContext(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	enabled, _ := ctx.Value(gatewayFailoverPolicyContextKey{}).(bool)
	return enabled
}

type cachedGatewayFailoverSettings struct {
	settings  GatewayFailoverSettings
	expiresAt int64
}

type GatewayFailoverStatusRange struct {
	Start int
	End   int
}

type GatewayFailoverStatusCodes []GatewayFailoverStatusRange

func ParseGatewayFailoverStatusCodes(raw string) (GatewayFailoverStatusCodes, error) {
	parts := strings.Split(raw, ",")
	ranges := make(GatewayFailoverStatusCodes, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		bounds := strings.Split(part, "-")
		if len(bounds) > 2 {
			return nil, fmt.Errorf("invalid gateway failover status code range %q", part)
		}
		start, err := strconv.Atoi(strings.TrimSpace(bounds[0]))
		if err != nil || start < 100 || start > 599 {
			return nil, fmt.Errorf("gateway failover status codes must be between 100-599")
		}
		end := start
		if len(bounds) == 2 {
			end, err = strconv.Atoi(strings.TrimSpace(bounds[1]))
			if err != nil || end < start || end > 599 {
				return nil, fmt.Errorf("invalid gateway failover status code range %q", part)
			}
		}
		ranges = append(ranges, GatewayFailoverStatusRange{Start: start, End: end})
	}
	if len(ranges) == 0 {
		return nil, fmt.Errorf("gateway failover status codes cannot be empty")
	}
	sort.Slice(ranges, func(i, j int) bool {
		if ranges[i].Start == ranges[j].Start {
			return ranges[i].End < ranges[j].End
		}
		return ranges[i].Start < ranges[j].Start
	})
	merged := ranges[:0]
	for _, current := range ranges {
		if len(merged) == 0 || current.Start > merged[len(merged)-1].End+1 {
			merged = append(merged, current)
			continue
		}
		if current.End > merged[len(merged)-1].End {
			merged[len(merged)-1].End = current.End
		}
	}
	return merged, nil
}

func (codes GatewayFailoverStatusCodes) Contains(statusCode int) bool {
	for _, item := range codes {
		if statusCode >= item.Start && statusCode <= item.End {
			return true
		}
	}
	return false
}

func (codes GatewayFailoverStatusCodes) String() string {
	parts := make([]string, 0, len(codes))
	for _, item := range codes {
		if item.Start == item.End {
			parts = append(parts, strconv.Itoa(item.Start))
		} else {
			parts = append(parts, fmt.Sprintf("%d-%d", item.Start, item.End))
		}
	}
	return strings.Join(parts, ",")
}

func (s *GatewayFailoverSettings) AllowsStatus(statusCode int) bool {
	if s == nil || !s.Enabled || s.MaxAccountSwitches <= 0 {
		return false
	}
	codes, err := ParseGatewayFailoverStatusCodes(s.StatusCodes)
	return err == nil && codes.Contains(statusCode)
}
