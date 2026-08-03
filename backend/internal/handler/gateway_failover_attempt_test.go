package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type gatewayFailoverAttemptRecorderStub struct {
	attempts []*service.GatewayFailoverAttempt
	err      error
}

func (r *gatewayFailoverAttemptRecorderStub) RecordGatewayFailoverAttempt(_ context.Context, attempt *service.GatewayFailoverAttempt) error {
	r.attempts = append(r.attempts, attempt)
	return r.err
}

type gatewayFailoverAttemptObserverStub struct {
	inputs []*service.GatewayFailoverChargeInput
	result *service.GatewayFailoverChargeResult
	err    error
}

func (s *gatewayFailoverAttemptObserverStub) ObserveGatewayFailoverAttempt(_ context.Context, input *service.GatewayFailoverChargeInput) (*service.GatewayFailoverChargeResult, error) {
	s.inputs = append(s.inputs, input)
	return s.result, s.err
}

func TestFailoverStateAppliesConfiguredStatusCodes(t *testing.T) {
	state := NewFailoverState(5, false)
	state.ApplyGatewayFailoverSettings(&service.GatewayFailoverSettings{
		Enabled: true, StatusCodes: "502,524", MaxAccountSwitches: 2,
	})
	require.Equal(t, 2, state.MaxSwitches)
	require.Equal(t, FailoverExhausted, state.HandleFailoverError(
		context.Background(), nil, 1, service.PlatformOpenAI, 0,
		&service.UpstreamFailoverError{StatusCode: http.StatusTooManyRequests},
	))
	require.Equal(t, FailoverContinue, state.HandleFailoverError(
		context.Background(), nil, 2, service.PlatformOpenAI, 0,
		&service.UpstreamFailoverError{StatusCode: http.StatusBadGateway},
	))
}

func TestGatewayFailoverStateFailsClosedWhenSettingsAreUnavailable(t *testing.T) {
	state := (&GatewayHandler{}).newFailoverState(context.Background(), 3, false)
	require.Zero(t, state.MaxSwitches)
	require.Equal(t, FailoverExhausted, state.HandleFailoverError(
		context.Background(), nil, 1, service.PlatformOpenAI, 0,
		&service.UpstreamFailoverError{StatusCode: http.StatusBadGateway},
	))
}

func TestGatewayFailoverAttemptHeadersReflectNonBillableAudit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	ctx := context.WithValue(context.Background(), ctxkey.RequestID, "req-test-failover")
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)

	meta := newGatewayFailoverAttemptMeta(c, 11, 22, nil, "payload-hash")
	require.Equal(t, "local:req-test-failover", meta.RequestID)
	require.Equal(t, meta.RequestID, c.Writer.Header().Get(failoverRequestIDHeader))
	startedAt := beginGatewayFailoverAttempt(c, 2, false)
	require.Equal(t, "2", c.Writer.Header().Get(failoverAttemptsHeader))
	require.Equal(t, service.GatewayFailoverBillingStandardUsage, c.Writer.Header().Get(failoverBillingHeader))

	recordSink := &gatewayFailoverAttemptRecorderStub{}
	pending := recordGatewayFailoverAttempt(recordSink, context.Background(), meta, 33, 2,
		startedAt.Add(-time.Second), &service.UpstreamFailoverError{StatusCode: 524}, false)
	require.False(t, pending)
	require.Len(t, recordSink.attempts, 1)
	require.Equal(t, "failed", recordSink.attempts[0].State)
	require.Equal(t, service.GatewayFailoverBillingNotBillable, recordSink.attempts[0].BillingStatus)
	require.Equal(t, 524, *recordSink.attempts[0].UpstreamStatusCode)
}

func TestRecordGatewayFailoverAttemptWithoutAuditRepositoryNeverSignalsSettlement(t *testing.T) {
	pending := recordGatewayFailoverAttempt(
		nil,
		context.Background(),
		gatewayFailoverAttemptMeta{RequestID: "local:req-no-audit"},
		33,
		1,
		time.Now(),
		&service.UpstreamFailoverError{StatusCode: http.StatusBadGateway},
		true,
	)

	require.False(t, pending)
}

func TestRecordGatewayFailoverAttemptObserves502WithoutCharging(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := gatewayFailoverAttemptMeta{RequestID: "local:req-charge", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22}
	recorder := &gatewayFailoverAttemptRecorderStub{}
	observer := &gatewayFailoverAttemptObserverStub{result: &service.GatewayFailoverChargeResult{
		Applied: false, InputTokens: 42, EstimatedCost: 0, BillingStatus: service.GatewayFailoverBillingNotBillable,
	}}
	statusErr := &service.UpstreamFailoverError{StatusCode: http.StatusBadGateway}
	apiKey := &service.APIKey{ID: 22, User: &service.User{ID: 11}}
	account := &service.Account{ID: 33}

	settled, err := recordGatewayFailoverAttemptBeforeReplay(
		c, recorder, observer, context.Background(), meta, apiKey, account, nil,
		service.GatewayFailoverEndpointResponses, []byte(`{"model":"gpt-4o","input":"hello"}`),
		"gpt-4o", "gpt-4o", "", service.PlatformOpenAI, 1, time.Now(), statusErr, false,
	)

	require.NoError(t, err)
	require.False(t, settled)
	require.Len(t, observer.inputs, 1)
	require.Equal(t, service.GatewayFailoverEndpointResponses, observer.inputs[0].Endpoint)
	require.Equal(t, service.GatewayFailoverBillingNotBillable, c.Writer.Header().Get(failoverBillingHeader))
	require.Empty(t, recorder.attempts, "observer owns the attempt row")
}

func TestRecordGatewayFailoverAttemptDoesNotEstimateAuthenticationFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := gatewayFailoverAttemptMeta{RequestID: "local:req-auth", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22}
	recorder := &gatewayFailoverAttemptRecorderStub{}
	observer := &gatewayFailoverAttemptObserverStub{}
	statusErr := &service.UpstreamFailoverError{StatusCode: http.StatusUnauthorized}

	settled, err := recordGatewayFailoverAttemptBeforeReplay(
		c, recorder, observer, context.Background(), meta,
		&service.APIKey{ID: 22, User: &service.User{ID: 11}}, &service.Account{ID: 33}, nil,
		service.GatewayFailoverEndpointMessages, []byte(`{"model":"claude-sonnet-4","messages":[]}`),
		"claude-sonnet-4", "claude-sonnet-4", "", service.PlatformAnthropic, 1, time.Now(), statusErr, false,
	)

	require.NoError(t, err)
	require.False(t, settled)
	require.Empty(t, observer.inputs)
	require.Len(t, recorder.attempts, 1)
	require.Equal(t, service.GatewayFailoverBillingNotBillable, recorder.attempts[0].BillingStatus)
}

func TestRecordGatewayFailoverAttemptAuditFailureDoesNotStopAuthenticationReplay(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := gatewayFailoverAttemptMeta{RequestID: "local:req-auth-audit-error", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22}
	recorder := &gatewayFailoverAttemptRecorderStub{err: errors.New("audit unavailable")}

	settled, err := recordGatewayFailoverAttemptBeforeReplay(
		c, recorder, nil, context.Background(), meta,
		&service.APIKey{ID: 22, User: &service.User{ID: 11}}, &service.Account{ID: 33}, nil,
		service.GatewayFailoverEndpointMessages, []byte(`{"model":"claude-sonnet-4","messages":[]}`),
		"claude-sonnet-4", "claude-sonnet-4", "", service.PlatformAnthropic, 1, time.Now(),
		&service.UpstreamFailoverError{StatusCode: http.StatusUnauthorized}, false,
	)

	require.NoError(t, err)
	require.False(t, settled)
	require.Len(t, recorder.attempts, 1)
	require.Equal(t, service.GatewayFailoverBillingNotBillable, c.Writer.Header().Get(failoverBillingHeader))
}

func TestRecordGatewayFailoverAttemptAuditFailureDoesNotStopReplay(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := gatewayFailoverAttemptMeta{RequestID: "local:req-billing-error", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22}
	recorder := &gatewayFailoverAttemptRecorderStub{}
	observer := &gatewayFailoverAttemptObserverStub{err: errors.New("transaction failed")}

	settled, err := recordGatewayFailoverAttemptBeforeReplay(
		c, recorder, observer, context.Background(), meta,
		&service.APIKey{ID: 22, User: &service.User{ID: 11}}, &service.Account{ID: 33}, nil,
		service.GatewayFailoverEndpointEmbeddings, []byte(`{"model":"text-embedding-3-small","input":"hello"}`),
		"text-embedding-3-small", "text-embedding-3-small", "", service.PlatformOpenAI, 1, time.Now(),
		&service.UpstreamFailoverError{StatusCode: 524}, false,
	)

	require.NoError(t, err)
	require.False(t, settled)
	require.Empty(t, recorder.attempts)
	require.Equal(t, service.GatewayFailoverBillingNotBillable, c.Writer.Header().Get(failoverBillingHeader))
}

func TestRecordGatewayFailoverAttemptStatusesAreAlwaysNonBillable(t *testing.T) {
	tests := []struct {
		status          int
		expectsEstimate bool
	}{
		{status: http.StatusUnauthorized},
		{status: http.StatusForbidden},
		{status: http.StatusTooManyRequests},
		{status: http.StatusBadGateway, expectsEstimate: true},
		{status: http.StatusServiceUnavailable, expectsEstimate: true},
		{status: 520, expectsEstimate: true},
	}

	for _, tt := range tests {
		t.Run(http.StatusText(tt.status), func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			recorder := &gatewayFailoverAttemptRecorderStub{}
			observer := &gatewayFailoverAttemptObserverStub{result: &service.GatewayFailoverChargeResult{
				BillingStatus: service.GatewayFailoverBillingNotBillable,
			}}

			settled, err := recordGatewayFailoverAttemptBeforeReplay(
				c, recorder, observer, context.Background(),
				gatewayFailoverAttemptMeta{RequestID: "local:req-status", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22},
				&service.APIKey{ID: 22, User: &service.User{ID: 11}}, &service.Account{ID: 33}, nil,
				service.GatewayFailoverEndpointResponses, []byte(`{"model":"gpt-4o","input":"hello"}`),
				"gpt-4o", "gpt-4o", "", service.PlatformOpenAI, 1, time.Now(),
				&service.UpstreamFailoverError{StatusCode: tt.status}, false,
			)

			require.NoError(t, err)
			require.False(t, settled)
			require.Equal(t, service.GatewayFailoverBillingNotBillable, c.Writer.Header().Get(failoverBillingHeader))
			if tt.expectsEstimate {
				require.Len(t, observer.inputs, 1)
				require.Empty(t, recorder.attempts)
			} else {
				require.Empty(t, observer.inputs)
				require.Len(t, recorder.attempts, 1)
				require.Equal(t, service.GatewayFailoverBillingNotBillable, recorder.attempts[0].BillingStatus)
			}
		})
	}
}
