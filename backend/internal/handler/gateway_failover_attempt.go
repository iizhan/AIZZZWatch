package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const (
	failoverAttemptsHeader  = "X-Sub2API-Failover-Attempts"
	failoverBillingHeader   = "X-Sub2API-Billing-Status"
	failoverRequestIDHeader = "X-Sub2API-Billing-Request-Id"
)

func enableGatewayFailoverPolicy(c *gin.Context) {
	if c == nil || c.Request == nil {
		return
	}
	c.Request = c.Request.WithContext(service.WithGatewayFailoverPolicy(c.Request.Context()))
}

type gatewayFailoverAttemptRecorder interface {
	RecordGatewayFailoverAttempt(context.Context, *service.GatewayFailoverAttempt) error
}

type gatewayFailoverAttemptObserver interface {
	ObserveGatewayFailoverAttempt(context.Context, *service.GatewayFailoverChargeInput) (*service.GatewayFailoverChargeResult, error)
}

type gatewayFailoverAttemptMeta struct {
	RequestID          string
	RequestFingerprint string
	UserID             int64
	APIKeyID           int64
	GroupID            *int64
}

func newGatewayFailoverAttemptMeta(c *gin.Context, userID, apiKeyID int64, groupID *int64, requestFingerprint string) gatewayFailoverAttemptMeta {
	requestID := ""
	if c != nil && c.Request != nil {
		requestID = service.ResolveGatewayFailoverRequestID(c.Request.Context())
	}
	if c != nil && requestID != "" {
		c.Header(failoverRequestIDHeader, requestID)
	}
	return gatewayFailoverAttemptMeta{
		RequestID: requestID, RequestFingerprint: strings.TrimSpace(requestFingerprint),
		UserID: userID, APIKeyID: apiKeyID, GroupID: groupID,
	}
}

func beginGatewayFailoverAttempt(c *gin.Context, attemptNo int, hasSettledFailoverCharge bool) time.Time {
	if c != nil {
		c.Header(failoverAttemptsHeader, strconv.Itoa(attemptNo))
		if hasSettledFailoverCharge {
			c.Header(failoverBillingHeader, service.GatewayFailoverBillingSettled)
		} else {
			c.Header(failoverBillingHeader, service.GatewayFailoverBillingStandardUsage)
		}
	}
	return time.Now()
}

func recordGatewayFailoverAttemptBeforeReplay(
	c *gin.Context,
	recorder gatewayFailoverAttemptRecorder,
	observer gatewayFailoverAttemptObserver,
	ctx context.Context,
	meta gatewayFailoverAttemptMeta,
	apiKey *service.APIKey,
	account *service.Account,
	subscription *service.UserSubscription,
	endpoint service.GatewayFailoverEndpoint,
	requestBody []byte,
	model string,
	billingModel string,
	serviceTier string,
	quotaPlatform string,
	attemptNo int,
	startedAt time.Time,
	failoverErr *service.UpstreamFailoverError,
	responseStarted bool,
) (bool, error) {
	if failoverErr == nil || apiKey == nil || account == nil {
		return false, nil
	}
	attempt := buildGatewayFailoverAttempt(meta, account.ID, attemptNo, startedAt, failoverErr, responseStarted)
	if !failoverAttemptNeedsEstimatedCharge(failoverErr) {
		if recorder != nil {
			if err := recorder.RecordGatewayFailoverAttempt(ctx, attempt); err != nil {
				logger.L().With(
					zap.String("component", "handler.gateway_failover_attempt"),
					zap.String("request_id", meta.RequestID),
					zap.Int64("user_id", meta.UserID),
					zap.Int("attempt_no", attemptNo),
				).Error("gateway_failover_attempt.persist_failed", zap.Error(err))
			}
		}
		if c != nil {
			c.Header(failoverBillingHeader, service.GatewayFailoverBillingNotBillable)
		}
		return false, nil
	}
	if observer == nil {
		if recorder != nil {
			if err := recorder.RecordGatewayFailoverAttempt(ctx, attempt); err != nil {
				logger.L().With(
					zap.String("component", "handler.gateway_failover_attempt"),
					zap.String("request_id", meta.RequestID),
					zap.Int64("user_id", meta.UserID),
					zap.Int("attempt_no", attemptNo),
				).Error("gateway_failover_attempt.persist_failed", zap.Error(err))
			}
		}
		if c != nil {
			c.Header(failoverBillingHeader, service.GatewayFailoverBillingNotBillable)
		}
		return false, nil
	}
	_, err := observer.ObserveGatewayFailoverAttempt(ctx, &service.GatewayFailoverChargeInput{
		Attempt: attempt, Endpoint: endpoint, RequestBody: requestBody,
		Model: model, BillingModel: billingModel, ServiceTier: serviceTier,
		APIKey: apiKey, Account: account, Subscription: subscription, QuotaPlatform: quotaPlatform,
	})
	if err != nil {
		logger.L().With(
			zap.String("component", "handler.gateway_failover_attempt"),
			zap.String("request_id", meta.RequestID),
			zap.Int64("user_id", meta.UserID),
			zap.Int("attempt_no", attemptNo),
		).Error("gateway_failover_attempt.observe_failed", zap.Error(err))
		if c != nil {
			c.Header(failoverBillingHeader, service.GatewayFailoverBillingNotBillable)
		}
		return false, nil
	}
	if c != nil {
		c.Header(failoverBillingHeader, service.GatewayFailoverBillingNotBillable)
	}
	return false, nil
}

func buildGatewayFailoverAttempt(
	meta gatewayFailoverAttemptMeta,
	accountID int64,
	attemptNo int,
	startedAt time.Time,
	failoverErr *service.UpstreamFailoverError,
	responseStarted bool,
) *service.GatewayFailoverAttempt {
	attempt := &service.GatewayFailoverAttempt{
		RequestID: meta.RequestID, RequestFingerprint: meta.RequestFingerprint,
		UserID: meta.UserID, APIKeyID: meta.APIKeyID, GroupID: meta.GroupID,
		AccountID: accountID, AttemptNo: attemptNo,
		FailureKind: "none", State: "succeeded", BillingStatus: service.GatewayFailoverBillingStandardUsage,
		DurationMS: int(time.Since(startedAt).Milliseconds()), ResponseStarted: responseStarted,
	}
	if failoverErr == nil {
		return attempt
	}
	statusCode := failoverErr.StatusCode
	attempt.UpstreamStatusCode = &statusCode
	attempt.FailureKind = "http_status"
	attempt.State = "failed"
	attempt.BillingStatus = service.GatewayFailoverBillingNotBillable
	if failoverErr.ResponseHeaders != nil {
		attempt.UpstreamRequestID = firstNonEmptyHeader(failoverErr.ResponseHeaders, "x-request-id", "request-id")
	}
	return attempt
}

func recordGatewayFailoverAttempt(
	recorder gatewayFailoverAttemptRecorder,
	ctx context.Context,
	meta gatewayFailoverAttemptMeta,
	accountID int64,
	attemptNo int,
	startedAt time.Time,
	failoverErr *service.UpstreamFailoverError,
	responseStarted bool,
) bool {
	if recorder == nil || meta.RequestID == "" || attemptNo <= 0 {
		return false
	}
	attempt := buildGatewayFailoverAttempt(meta, accountID, attemptNo, startedAt, failoverErr, responseStarted)
	if err := recorder.RecordGatewayFailoverAttempt(ctx, attempt); err != nil {
		logger.L().With(
			zap.String("component", "handler.gateway_failover_attempt"),
			zap.String("request_id", meta.RequestID),
			zap.Int64("user_id", meta.UserID),
			zap.Int("attempt_no", attemptNo),
		).Error("gateway_failover_attempt.persist_failed", zap.Error(err))
	}
	return false
}

func failoverAttemptNeedsEstimatedCharge(failoverErr *service.UpstreamFailoverError) bool {
	if failoverErr == nil || failoverErr.IsCredentialFailure() {
		return false
	}
	statusCode := failoverErr.StatusCode
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden || statusCode == http.StatusTooManyRequests || statusCode == http.StatusRequestEntityTooLarge {
		return false
	}
	return statusCode == http.StatusBadGateway || statusCode == 524 || statusCode >= 500
}

func firstNonEmptyHeader(header http.Header, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(header.Get(name)); value != "" {
			return value
		}
	}
	return ""
}
