package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
	"github.com/shopspring/decimal"
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

func (r *usageLogRepository) DryRunGatewayFailoverRefunds(
	ctx context.Context,
	filter service.GatewayFailoverRefundFilter,
) (*service.GatewayFailoverRefundDryRun, error) {
	if err := filter.Validate(); err != nil {
		return nil, err
	}
	if r == nil || r.db == nil {
		return nil, sql.ErrConnDone
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT a.id, a.user_id, a.request_id, a.attempt_no, a.upstream_status_code,
		       a.billing_status, a.settled_cost, a.created_at,
		       COALESCE(c.refund_key, ''), COALESCE(c.status, 'untracked'),
		       COALESCE(c.refunded_cost, 0), c.refunded_at
		FROM gateway_failover_attempts a
		LEFT JOIN gateway_failover_refund_candidates c ON c.attempt_id = a.id
		WHERE a.billing_status = 'settled'
		  AND a.settled_cost > 0
		  AND a.created_at >= $1
		  AND a.created_at < $2
		  AND ($3::bigint = 0 OR a.user_id = $3)
		ORDER BY a.created_at, a.request_id, a.attempt_no
	`, filter.StartAt, filter.EndAt, filter.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	report := &service.GatewayFailoverRefundDryRun{
		GeneratedAt: time.Now().UTC(), StartAt: filter.StartAt.UTC(), EndAt: filter.EndAt.UTC(), UserID: filter.UserID,
		Candidates: []service.GatewayFailoverRefundCandidate{},
	}
	users := make(map[int64]struct{})
	requests := make(map[string]struct{})
	candidateCost := decimal.Zero
	refundedCost := decimal.Zero
	outstandingCost := decimal.Zero
	for rows.Next() {
		var item service.GatewayFailoverRefundCandidate
		var statusCode sql.NullInt64
		var refundedAt sql.NullTime
		var originalSettledCost decimal.Decimal
		var itemRefundedCost decimal.Decimal
		if err := rows.Scan(
			&item.AttemptID, &item.UserID, &item.RequestID, &item.AttemptNo, &statusCode,
			&item.BillingStatus, &originalSettledCost, &item.AttemptedAt,
			&item.RefundKey, &item.CandidateStatus, &itemRefundedCost, &refundedAt,
		); err != nil {
			return nil, err
		}
		item.OriginalSettledCost, _ = originalSettledCost.Float64()
		item.RefundedCost, _ = itemRefundedCost.Float64()
		if item.RefundKey == "" {
			item.RefundKey = fmt.Sprintf("gateway-failover-attempt:%d", item.AttemptID)
		}
		if statusCode.Valid {
			value := int(statusCode.Int64)
			item.UpstreamStatusCode = &value
		}
		if refundedAt.Valid {
			value := refundedAt.Time.UTC()
			item.RefundedAt = &value
		}
		itemOutstandingCost := originalSettledCost.Sub(itemRefundedCost)
		if itemOutstandingCost.IsNegative() {
			itemOutstandingCost = decimal.Zero
		}
		item.OutstandingCost, _ = itemOutstandingCost.Float64()
		report.Candidates = append(report.Candidates, item)
		candidateCost = candidateCost.Add(originalSettledCost)
		refundedCost = refundedCost.Add(itemRefundedCost)
		outstandingCost = outstandingCost.Add(itemOutstandingCost)
		users[item.UserID] = struct{}{}
		requests[item.RequestID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	report.UserCount = len(users)
	report.RequestCount = len(requests)
	report.AttemptCount = len(report.Candidates)
	report.CandidateCost, _ = candidateCost.Float64()
	report.RefundedCost, _ = refundedCost.Float64()
	report.OutstandingCost, _ = outstandingCost.Float64()
	return report, nil
}

func (r *usageLogRepository) StageGatewayFailoverRefundCandidates(
	ctx context.Context,
	filter service.GatewayFailoverRefundFilter,
) (int, error) {
	if err := filter.Validate(); err != nil {
		return 0, err
	}
	if r == nil || r.db == nil {
		return 0, sql.ErrConnDone
	}
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO gateway_failover_refund_candidates (
			attempt_id, refund_key, user_id, request_id, attempt_no,
			original_settled_cost, candidate_cost, status
		)
		SELECT a.id, 'gateway-failover-attempt:' || a.id::text, a.user_id, a.request_id, a.attempt_no,
		       a.settled_cost, a.settled_cost, 'candidate'
		FROM gateway_failover_attempts a
		WHERE a.billing_status = 'settled'
		  AND a.settled_cost > 0
		  AND a.created_at >= $1
		  AND a.created_at < $2
		  AND ($3::bigint = 0 OR a.user_id = $3)
		ON CONFLICT (attempt_id) DO NOTHING
	`, filter.StartAt, filter.EndAt, filter.UserID)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
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
