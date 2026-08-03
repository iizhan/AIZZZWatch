package admin

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type failoverRefundRepoStub struct {
	service.UsageLogRepository
	filter     service.GatewayFailoverRefundFilter
	stageCalls int
}

func (r *failoverRefundRepoStub) DryRunGatewayFailoverRefunds(_ context.Context, filter service.GatewayFailoverRefundFilter) (*service.GatewayFailoverRefundDryRun, error) {
	r.filter = filter
	return &service.GatewayFailoverRefundDryRun{
		StartAt: filter.StartAt, EndAt: filter.EndAt, UserID: filter.UserID,
		AttemptCount: 2, CandidateCost: 1.25, OutstandingCost: 1.25,
	}, nil
}

func (r *failoverRefundRepoStub) StageGatewayFailoverRefundCandidates(_ context.Context, filter service.GatewayFailoverRefundFilter) (int, error) {
	r.filter = filter
	r.stageCalls++
	return 2, nil
}

func newFailoverRefundTestRouter(repo *failoverRefundRepoStub) *gin.Engine {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(service.NewUsageService(repo, nil, nil, nil), nil, nil, nil)
	router := gin.New()
	router.GET("/admin/usage/failover-refunds/dry-run", handler.DryRunGatewayFailoverRefunds)
	router.POST("/admin/usage/failover-refunds/candidates", handler.StageGatewayFailoverRefundCandidates)
	return router
}

func TestDryRunGatewayFailoverRefundsUsesBoundedRangeAndOptionalUser(t *testing.T) {
	repo := &failoverRefundRepoStub{}
	router := newFailoverRefundTestRouter(repo)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"/admin/usage/failover-refunds/dry-run?start_at=2026-08-02T09:48:30Z&end_at=2026-08-03T03:36:54Z&user_id=42", nil)
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, int64(42), repo.filter.UserID)
	require.Equal(t, time.Date(2026, 8, 2, 9, 48, 30, 0, time.UTC), repo.filter.StartAt)
	require.Contains(t, recorder.Body.String(), `"candidate_cost":1.25`)
}

func TestStageGatewayFailoverRefundCandidatesRequiresExplicitConfirmation(t *testing.T) {
	repo := &failoverRefundRepoStub{}
	router := newFailoverRefundTestRouter(repo)

	for _, body := range []string{
		`{"start_at":"2026-08-02T09:48:30Z","end_at":"2026-08-03T03:36:54Z"}`,
		`{"start_at":"2026-08-02T09:48:30Z","end_at":"2026-08-03T03:36:54Z","confirm":false}`,
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/admin/usage/failover-refunds/candidates", bytes.NewBufferString(body))
		request.Header.Set("content-type", "application/json")
		router.ServeHTTP(recorder, request)
		require.Equal(t, http.StatusBadRequest, recorder.Code)
	}
	require.Zero(t, repo.stageCalls)
}

func TestStageGatewayFailoverRefundCandidatesOnlyStagesLedgerRows(t *testing.T) {
	repo := &failoverRefundRepoStub{}
	router := newFailoverRefundTestRouter(repo)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/admin/usage/failover-refunds/candidates", bytes.NewBufferString(
		`{"start_at":"2026-08-02T09:48:30Z","end_at":"2026-08-03T03:36:54Z","user_id":42,"confirm":true}`,
	))
	request.Header.Set("content-type", "application/json")
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, 1, repo.stageCalls)
	require.Contains(t, recorder.Body.String(), `"staged_count":2`)
}
