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
}

func (r *gatewayFailoverAttemptRecorderStub) RecordGatewayFailoverAttempt(_ context.Context, attempt *service.GatewayFailoverAttempt) error {
	r.attempts = append(r.attempts, attempt)
	return nil
}

type gatewayFailoverAttemptChargerStub struct {
	inputs []*service.GatewayFailoverChargeInput
	result *service.GatewayFailoverChargeResult
	err    error
}

func (s *gatewayFailoverAttemptChargerStub) ChargeGatewayFailoverAttempt(_ context.Context, input *service.GatewayFailoverChargeInput) (*service.GatewayFailoverChargeResult, error) {
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

func TestGatewayFailoverAttemptHeadersReflectSettledCharge(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	ctx := context.WithValue(context.Background(), ctxkey.RequestID, "req-test-failover")
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)

	meta := newGatewayFailoverAttemptMeta(c, 11, 22, nil, "payload-hash")
	require.Equal(t, "local:req-test-failover", meta.RequestID)
	require.Equal(t, meta.RequestID, c.Writer.Header().Get(failoverRequestIDHeader))
	startedAt := beginGatewayFailoverAttempt(c, 2, true)
	require.Equal(t, "2", c.Writer.Header().Get(failoverAttemptsHeader))
	require.Equal(t, service.GatewayFailoverBillingSettled, c.Writer.Header().Get(failoverBillingHeader))

	recordSink := &gatewayFailoverAttemptRecorderStub{}
	pending := recordGatewayFailoverAttempt(recordSink, context.Background(), meta, 33, 2,
		startedAt.Add(-time.Second), &service.UpstreamFailoverError{StatusCode: 524}, false)
	require.True(t, pending)
	require.Len(t, recordSink.attempts, 1)
	require.Equal(t, "failed", recordSink.attempts[0].State)
	require.Equal(t, service.GatewayFailoverBillingPendingReconciliation, recordSink.attempts[0].BillingStatus)
	require.Equal(t, 524, *recordSink.attempts[0].UpstreamStatusCode)
}

func TestFailoverAttemptAfterStreamStartRequiresReconciliation(t *testing.T) {
	require.True(t, failoverAttemptNeedsReconciliation(http.StatusForbidden, true))
	require.False(t, failoverAttemptNeedsReconciliation(http.StatusTooManyRequests, false))
}

func TestSettleGatewayFailoverAttemptCharges502BeforeReplay(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := gatewayFailoverAttemptMeta{RequestID: "local:req-charge", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22}
	recorder := &gatewayFailoverAttemptRecorderStub{}
	charger := &gatewayFailoverAttemptChargerStub{result: &service.GatewayFailoverChargeResult{
		Applied: true, InputTokens: 42, EstimatedCost: 0.01, BillingStatus: service.GatewayFailoverBillingSettled,
	}}
	statusErr := &service.UpstreamFailoverError{StatusCode: http.StatusBadGateway}
	apiKey := &service.APIKey{ID: 22, User: &service.User{ID: 11}}
	account := &service.Account{ID: 33}

	settled, err := settleGatewayFailoverAttemptBeforeReplay(
		c, recorder, charger, context.Background(), meta, apiKey, account, nil,
		service.GatewayFailoverEndpointResponses, []byte(`{"model":"gpt-4o","input":"hello"}`),
		"gpt-4o", "gpt-4o", "", service.PlatformOpenAI, 1, time.Now(), statusErr, false,
	)

	require.NoError(t, err)
	require.True(t, settled)
	require.Len(t, charger.inputs, 1)
	require.Equal(t, service.GatewayFailoverEndpointResponses, charger.inputs[0].Endpoint)
	require.Equal(t, service.GatewayFailoverBillingSettled, c.Writer.Header().Get(failoverBillingHeader))
	require.Empty(t, recorder.attempts, "atomic settlement owns the attempt row")
}

func TestSettleGatewayFailoverAttemptDoesNotChargeAuthenticationFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := gatewayFailoverAttemptMeta{RequestID: "local:req-auth", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22}
	recorder := &gatewayFailoverAttemptRecorderStub{}
	charger := &gatewayFailoverAttemptChargerStub{}
	statusErr := &service.UpstreamFailoverError{StatusCode: http.StatusUnauthorized}

	settled, err := settleGatewayFailoverAttemptBeforeReplay(
		c, recorder, charger, context.Background(), meta,
		&service.APIKey{ID: 22, User: &service.User{ID: 11}}, &service.Account{ID: 33}, nil,
		service.GatewayFailoverEndpointMessages, []byte(`{"model":"claude-sonnet-4","messages":[]}`),
		"claude-sonnet-4", "claude-sonnet-4", "", service.PlatformAnthropic, 1, time.Now(), statusErr, false,
	)

	require.NoError(t, err)
	require.False(t, settled)
	require.Empty(t, charger.inputs)
	require.Len(t, recorder.attempts, 1)
	require.Equal(t, service.GatewayFailoverBillingNotBillable, recorder.attempts[0].BillingStatus)
}

func TestSettleGatewayFailoverAttemptStopsReplayWhenBillingFails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	meta := gatewayFailoverAttemptMeta{RequestID: "local:req-billing-error", RequestFingerprint: "hash", UserID: 11, APIKeyID: 22}
	recorder := &gatewayFailoverAttemptRecorderStub{}
	charger := &gatewayFailoverAttemptChargerStub{err: errors.New("transaction failed")}

	settled, err := settleGatewayFailoverAttemptBeforeReplay(
		c, recorder, charger, context.Background(), meta,
		&service.APIKey{ID: 22, User: &service.User{ID: 11}}, &service.Account{ID: 33}, nil,
		service.GatewayFailoverEndpointEmbeddings, []byte(`{"model":"text-embedding-3-small","input":"hello"}`),
		"text-embedding-3-small", "text-embedding-3-small", "", service.PlatformOpenAI, 1, time.Now(),
		&service.UpstreamFailoverError{StatusCode: 524}, false,
	)

	require.ErrorContains(t, err, "transaction failed")
	require.False(t, settled)
	require.Len(t, recorder.attempts, 1)
	require.Equal(t, service.GatewayFailoverBillingReleased, recorder.attempts[0].BillingStatus)
	require.Equal(t, service.GatewayFailoverBillingReleased, c.Writer.Header().Get(failoverBillingHeader))
}
