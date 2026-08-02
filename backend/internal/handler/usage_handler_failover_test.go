package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type failoverAttemptQueryRepoStub struct {
	service.UsageLogRepository
	userID     int64
	requestIDs []string
}

func (r *failoverAttemptQueryRepoStub) ListGatewayFailoverAttemptsByRequests(_ context.Context, userID int64, requestIDs []string) ([]service.GatewayFailoverRequestSummary, error) {
	r.userID = userID
	r.requestIDs = append([]string(nil), requestIDs...)
	return []service.GatewayFailoverRequestSummary{{
		RequestID: "local:req-1", AttemptCount: 2,
		BillingStatus: service.GatewayFailoverBillingPendingReconciliation,
	}}, nil
}

func TestListFailoverAttemptsUsesAuthenticatedUserAndBoundsIDs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &failoverAttemptQueryRepoStub{}
	handler := NewUsageHandler(service.NewUsageService(repo, nil, nil, nil), nil, nil, nil)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 42})
		c.Next()
	})
	router.GET("/usage/failover-attempts", handler.ListFailoverAttempts)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/usage/failover-attempts?request_ids=local:req-1,local:req-1,%20local:req-2%20", nil)
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, int64(42), repo.userID)
	require.Equal(t, []string{"local:req-1", "local:req-2"}, repo.requestIDs)
	require.Contains(t, recorder.Body.String(), `"request_id":"local:req-1"`)
	require.NotContains(t, recorder.Body.String(), "account_id")
}

func TestListFailoverAttemptsRejectsOverlongRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewUsageHandler(service.NewUsageService(&failoverAttemptQueryRepoStub{}, nil, nil, nil), nil, nil, nil)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 42})
		c.Next()
	})
	router.GET("/usage/failover-attempts", handler.ListFailoverAttempts)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/usage/failover-attempts?request_ids="+strings.Repeat("x", 129), nil)
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusBadRequest, recorder.Code)
}
