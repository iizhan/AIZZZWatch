package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

func TestWriteWatchSourceErrorMapsObservationPersistFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	writeWatchSourceError(c, fmt.Errorf("%w: insert watch source check failed", service.ErrWatchSourceObservationPersistFailed))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	var body struct {
		Message string `json:"message"`
		Reason  string `json:"reason"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if body.Message == "Watch source operation failed" {
		t.Fatal("watch source errors must not collapse back to the generic message")
	}
	if !strings.Contains(body.Message, "检测记录写入失败") {
		t.Fatalf("message = %q, want concrete diagnostic persistence failure", body.Message)
	}
	if body.Reason != "watch_source_observation_persist_failed" {
		t.Fatalf("reason = %q, want watch_source_observation_persist_failed", body.Reason)
	}
}

func TestWriteWatchSourceMutationErrorMapsMissingLoginToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	writeWatchSourceMutationError(c, service.ErrWatchSourcePasswordAuthMissingToken)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if !strings.Contains(body.Message, "未返回可用于 API 的 access_token") {
		t.Fatalf("message = %q, want missing access token guidance", body.Message)
	}
}

func TestWriteWatchPricingRuleErrorMapsInvalidAdjustmentStep(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	writeWatchPricingRuleError(c, fmt.Errorf("adjustment_step must be positive"))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	var body struct {
		Message string `json:"message"`
		Reason  string `json:"reason"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if !strings.Contains(body.Message, "单次调价步长") {
		t.Fatalf("message = %q, want adjustment step guidance", body.Message)
	}
	if body.Reason != "adjustment_step must be positive" {
		t.Fatalf("reason = %q, want adjustment_step must be positive", body.Reason)
	}
}

func TestListAccountMappingsRejectsInvalidPagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/watch/account-mappings?page=1&page_size=101", nil)

	h := &WatchHandler{watchService: &service.WatchService{}}
	h.ListAccountMappings(c)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}
