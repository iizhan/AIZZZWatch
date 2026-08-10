package admin

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type balanceBonusAdminServiceStub struct {
	*stubAdminService
	inputs []service.AdminBalanceUpdateInput
}

func (s *balanceBonusAdminServiceStub) UpdateUserBalance(_ context.Context, userID int64, input service.AdminBalanceUpdateInput) (*service.User, error) {
	s.inputs = append(s.inputs, input)
	return &service.User{ID: userID, Balance: input.Balance + input.BonusAmount, Status: service.StatusActive}, nil
}

func setupBalanceBonusRouter(serviceStub service.AdminService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 77})
		c.Next()
	})
	handler := NewUserHandler(serviceStub, nil, nil, nil, nil, nil, nil)
	router.POST("/api/v1/admin/users/:id/balance", handler.UpdateBalance)
	return router
}

func postBalanceBonus(t *testing.T, router *gin.Engine, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/42/balance", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "admin-recharge-test-key")
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestUserHandlerUpdateBalanceForwardsRechargeBonusAndAuditIdentity(t *testing.T) {
	service.SetDefaultIdempotencyCoordinator(nil)
	stub := &balanceBonusAdminServiceStub{stubAdminService: newStubAdminService()}
	recorder := postBalanceBonus(t, setupBalanceBonusRouter(stub), `{
		"balance":100,"bonus_amount":20,"operation":"add","notes":"campaign"
	}`)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Len(t, stub.inputs, 1)
	require.Equal(t, service.AdminBalanceUpdateInput{
		Balance:            100,
		BonusAmount:        20,
		Operation:          "add",
		Notes:              "campaign",
		ActorAdminID:       77,
		IdempotencyKeyHash: service.HashIdempotencyKey("admin-recharge-test-key"),
	}, stub.inputs[0])
}

func TestUserHandlerUpdateBalanceRejectsInvalidBonus(t *testing.T) {
	service.SetDefaultIdempotencyCoordinator(nil)
	tests := []struct {
		name string
		body string
	}{
		{name: "negative bonus", body: `{"balance":100,"bonus_amount":-1,"operation":"add"}`},
		{name: "bonus on subtract", body: `{"balance":100,"bonus_amount":1,"operation":"subtract"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stub := &balanceBonusAdminServiceStub{stubAdminService: newStubAdminService()}
			recorder := postBalanceBonus(t, setupBalanceBonusRouter(stub), test.body)
			require.Equal(t, http.StatusBadRequest, recorder.Code)
			require.Empty(t, stub.inputs)
		})
	}
}
