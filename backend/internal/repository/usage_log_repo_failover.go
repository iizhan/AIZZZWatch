package repository

import (
	"context"
	"database/sql"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
)

func (r *usageLogRepository) ListGatewayFailoverAttemptsByRequests(
	ctx context.Context,
	userID int64,
	requestIDs []string,
) ([]service.GatewayFailoverRequestSummary, error) {
	if r == nil || r.db == nil || userID <= 0 || len(requestIDs) == 0 {
		return []service.GatewayFailoverRequestSummary{}, nil
	}
	if len(requestIDs) > 100 {
		requestIDs = requestIDs[:100]
	}
	rows, err := r.db.QueryContext(ctx, `
			SELECT request_id, attempt_no, state, billing_status, upstream_status_code,
			       duration_ms, input_tokens, output_tokens, reserved_cost, settled_cost
		FROM gateway_failover_attempts
		WHERE user_id = $1 AND request_id = ANY($2)
		ORDER BY request_id, attempt_no
	`, userID, pq.Array(requestIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byRequest := make(map[string]*service.GatewayFailoverRequestSummary)
	order := make([]string, 0, len(requestIDs))
	for rows.Next() {
		var requestID, state, billingStatus string
		var attemptNo int
		var statusCode, durationMS sql.NullInt64
		var inputTokens, outputTokens int
		var reservedCost, settledCost float64
		if err := rows.Scan(&requestID, &attemptNo, &state, &billingStatus, &statusCode, &durationMS, &inputTokens, &outputTokens, &reservedCost, &settledCost); err != nil {
			return nil, err
		}
		requestID = strings.TrimSpace(requestID)
		summary := byRequest[requestID]
		if summary == nil {
			summary = &service.GatewayFailoverRequestSummary{RequestID: requestID, BillingStatus: billingStatus}
			byRequest[requestID] = summary
			order = append(order, requestID)
		}
		item := service.GatewayFailoverAttemptPublic{
			AttemptNo: attemptNo, State: state, BillingStatus: billingStatus,
			InputTokens: inputTokens, OutputTokens: outputTokens,
			ReservedCost: reservedCost, SettledCost: settledCost,
		}
		if statusCode.Valid {
			value := int(statusCode.Int64)
			item.UpstreamStatusCode = &value
		}
		if durationMS.Valid {
			value := int(durationMS.Int64)
			item.DurationMS = &value
		}
		summary.Attempts = append(summary.Attempts, item)
		summary.AttemptCount++
		if gatewayFailoverBillingPriority(billingStatus) > gatewayFailoverBillingPriority(summary.BillingStatus) {
			summary.BillingStatus = billingStatus
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := make([]service.GatewayFailoverRequestSummary, 0, len(order))
	for _, requestID := range order {
		result = append(result, *byRequest[requestID])
	}
	return result, nil
}

func gatewayFailoverBillingPriority(status string) int {
	switch status {
	case service.GatewayFailoverBillingPendingReconciliation:
		return 6
	case service.GatewayFailoverBillingReserved:
		return 5
	case service.GatewayFailoverBillingSettled:
		return 4
	case service.GatewayFailoverBillingStandardUsage:
		return 3
	case service.GatewayFailoverBillingReleased:
		return 2
	default:
		return 1
	}
}
