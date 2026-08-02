package admin

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type gatewayFailoverHandlerSettingRepo struct{ values map[string]string }

func (r *gatewayFailoverHandlerSettingRepo) Get(_ context.Context, key string) (*service.Setting, error) {
	value := r.values[key]
	if value == "" {
		return nil, service.ErrSettingNotFound
	}
	return &service.Setting{Key: key, Value: value}, nil
}
func (r *gatewayFailoverHandlerSettingRepo) GetValue(_ context.Context, key string) (string, error) {
	return r.values[key], nil
}
func (r *gatewayFailoverHandlerSettingRepo) Set(_ context.Context, key, value string) error {
	r.values[key] = value
	return nil
}
func (r *gatewayFailoverHandlerSettingRepo) GetMultiple(_ context.Context, _ []string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (r *gatewayFailoverHandlerSettingRepo) SetMultiple(_ context.Context, _ map[string]string) error {
	return nil
}
func (r *gatewayFailoverHandlerSettingRepo) GetAll(_ context.Context) (map[string]string, error) {
	return r.values, nil
}
func (r *gatewayFailoverHandlerSettingRepo) Delete(_ context.Context, key string) error {
	delete(r.values, key)
	return nil
}

func TestGatewayFailoverSettingsHandlerRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &gatewayFailoverHandlerSettingRepo{values: map[string]string{}}
	handler := NewSettingHandler(service.NewSettingService(repo, &config.Config{}), nil, nil, nil, nil, nil, nil)
	router := gin.New()
	router.GET("/settings/gateway-failover", handler.GetGatewayFailoverSettings)
	router.PUT("/settings/gateway-failover", handler.UpdateGatewayFailoverSettings)

	getRecorder := httptest.NewRecorder()
	router.ServeHTTP(getRecorder, httptest.NewRequest(http.MethodGet, "/settings/gateway-failover", nil))
	require.Equal(t, http.StatusOK, getRecorder.Code)
	require.Contains(t, getRecorder.Body.String(), `"max_account_switches":2`)

	putRecorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/settings/gateway-failover", bytes.NewBufferString(`{
		"enabled":true,"status_codes":"524, 502-503","max_account_switches":3
	}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(putRecorder, request)
	require.Equal(t, http.StatusOK, putRecorder.Code)
	require.Contains(t, putRecorder.Body.String(), `"status_codes":"502-503,524"`)
	require.Contains(t, repo.values[service.SettingKeyGatewayFailoverSettings], `"max_account_switches":3`)
}

func TestGatewayFailoverSettingsHandlerRejectsInvalidPolicy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &gatewayFailoverHandlerSettingRepo{values: map[string]string{}}
	handler := NewSettingHandler(service.NewSettingService(repo, &config.Config{}), nil, nil, nil, nil, nil, nil)
	router := gin.New()
	router.PUT("/settings/gateway-failover", handler.UpdateGatewayFailoverSettings)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/settings/gateway-failover", bytes.NewBufferString(`{
		"enabled":true,"status_codes":"700","max_account_switches":11
	}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Empty(t, repo.values)
}
