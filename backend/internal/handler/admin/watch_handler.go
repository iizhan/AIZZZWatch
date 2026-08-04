package admin

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/Wei-Shaw/sub2api/internal/util/logredact"
	"github.com/gin-gonic/gin"
)

type WatchHandler struct {
	watchService       *service.WatchService
	watchSourceService *service.WatchSourceService
}

func NewWatchHandler(watchService *service.WatchService, watchSourceService *service.WatchSourceService) *WatchHandler {
	return &WatchHandler{watchService: watchService, watchSourceService: watchSourceService}
}

func (h *WatchHandler) GetOverview(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	overview, err := h.watchService.GetOverview(c.Request.Context())
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch overview unavailable")
		return
	}
	response.Success(c, overview)
}

func (h *WatchHandler) GetOperations(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	days, err := strconv.Atoi(c.DefaultQuery("days", "7"))
	if err != nil {
		response.BadRequest(c, "invalid watch operations window")
		return
	}
	report, err := h.watchService.GetOperationsReport(c.Request.Context(), days)
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch operations report unavailable")
		return
	}
	response.Success(c, report)
}

func (h *WatchHandler) ListIntegrationAccountHealth(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	sourceID, err := strconv.ParseInt(c.DefaultQuery("source_id", "0"), 10, 64)
	if err != nil || sourceID < 0 {
		response.BadRequest(c, "invalid watch source id")
		return
	}
	windowSeconds, err := strconv.Atoi(c.DefaultQuery("window_seconds", "1800"))
	if err != nil || windowSeconds < 0 {
		response.BadRequest(c, "invalid watch integration window")
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "500"))
	if err != nil || limit < 0 {
		response.BadRequest(c, "invalid watch integration limit")
		return
	}
	view, err := h.watchService.ListIntegrationAccountHealth(c.Request.Context(), service.WatchIntegrationAccountHealthFilter{
		Status:        c.Query("status"),
		Platform:      c.Query("platform"),
		SourceID:      sourceID,
		Search:        c.Query("search"),
		WindowSeconds: windowSeconds,
		Limit:         limit,
	})
	if err != nil {
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "接入诊断运行健康暂不可用，请稍后重试", "watch integration account health unavailable", nil)
		return
	}
	response.Success(c, view)
}

type watchSourceRequest struct {
	Name                     string                          `json:"name" binding:"required,max=100"`
	AdapterType              string                          `json:"adapter_type" binding:"required,oneof=sub2api newapi custom"`
	BaseURL                  string                          `json:"base_url" binding:"required,max=1000"`
	APIBaseURL               string                          `json:"api_base_url" binding:"omitempty,max=1000"`
	RechargeRatio            float64                         `json:"recharge_ratio"`
	LowBalanceThreshold      float64                         `json:"low_balance_threshold"`
	PollingIntervalSeconds   int                             `json:"polling_interval_seconds"`
	RequestTimeoutSeconds    int                             `json:"request_timeout_seconds"`
	KeepaliveEnabled         *bool                           `json:"keepalive_enabled"`
	KeepaliveIntervalSeconds int                             `json:"keepalive_interval_seconds"`
	AutoFollowKeyGroup       *bool                           `json:"auto_follow_key_group"`
	ProfilePath              string                          `json:"profile_path" binding:"omitempty,max=1000"`
	GroupsPath               string                          `json:"groups_path" binding:"omitempty,max=1000"`
	RatesPath                string                          `json:"rates_path" binding:"omitempty,max=1000"`
	PricingPath              string                          `json:"pricing_path" binding:"omitempty,max=1000"`
	KeysPath                 string                          `json:"keys_path" binding:"omitempty,max=1000"`
	LoginPath                string                          `json:"login_path" binding:"omitempty,max=1000"`
	HeartbeatPath            string                          `json:"heartbeat_path" binding:"omitempty,max=1000"`
	ReadMapping              *service.WatchSourceReadMapping `json:"read_mapping"`
	Enabled                  *bool                           `json:"enabled"`
	AuthMode                 string                          `json:"auth_mode" binding:"omitempty,oneof=manual password"`
	LoginUsername            string                          `json:"login_username" binding:"omitempty,max=320"`
	LoginEmail               string                          `json:"login_email" binding:"omitempty,max=320"`
	LoginPassword            string                          `json:"login_password" binding:"omitempty,max=1024"`
	CredentialType           string                          `json:"credential_type" binding:"omitempty,oneof=bearer api_key cookie"`
	Credential               *service.WatchSourceCredential  `json:"credential"`
	ClearCredential          bool                            `json:"clear_credential"`
}

type watchSourceExportRequest struct {
	SourceIDs          []int64 `json:"source_ids"`
	Password           string  `json:"password" binding:"required"`
	IncludeCredentials *bool   `json:"include_credentials"`
}

type watchSourceImportPreviewRequest struct {
	Package  service.WatchSourcePortableEnvelope `json:"package" binding:"required"`
	Password string                              `json:"password" binding:"required"`
}

type watchSourceImportApplyRequest struct {
	Package   service.WatchSourcePortableEnvelope      `json:"package" binding:"required"`
	Password  string                                   `json:"password" binding:"required"`
	Decisions []service.WatchSourceImportApplyDecision `json:"decisions"`
}

type watchSourceInteractiveAuthCompleteRequest struct {
	SessionID      string                         `json:"session_id" binding:"required"`
	CredentialType string                         `json:"credential_type" binding:"required,oneof=bearer api_key cookie"`
	Credential     *service.WatchSourceCredential `json:"credential" binding:"required"`
	Validate       bool                           `json:"validate"`
}

type watchPricingRuleRequest struct {
	Name            string                      `json:"name" binding:"required,max=100"`
	TargetGroupID   int64                       `json:"target_group_id" binding:"required"`
	Mode            service.WatchPriceMode      `json:"mode" binding:"required,oneof=group_multiplier model_price"`
	Platform        string                      `json:"platform" binding:"omitempty,max=64"`
	Model           string                      `json:"model" binding:"omitempty,max=255"`
	Component       service.WatchPriceComponent `json:"component" binding:"omitempty,oneof=input output per_request"`
	Enabled         bool                        `json:"enabled"`
	IntervalSeconds int                         `json:"interval_seconds"`
	AdjustmentStep  float64                     `json:"adjustment_step"`
}

type watchRateCompensationApplyRequest struct {
	UserIDs        []int64 `json:"user_ids"`
	Confirmed      bool    `json:"confirmed"`
	IdempotencyKey string  `json:"idempotency_key" binding:"required,max=128"`
	Reason         string  `json:"reason" binding:"required,max=500"`
}

type watchRateExternalCompensationRequest struct {
	TargetGroupID  int64   `json:"target_group_id" binding:"required"`
	UserID         int64   `json:"user_id" binding:"required"`
	WindowStart    string  `json:"window_start" binding:"required"`
	WindowEnd      string  `json:"window_end" binding:"required"`
	Amount         float64 `json:"amount" binding:"required"`
	IdempotencyKey string  `json:"idempotency_key" binding:"required,max=128"`
	Reason         string  `json:"reason" binding:"required,max=500"`
}

func (r watchPricingRuleRequest) serviceInput() service.WatchPricingRuleInput {
	return service.WatchPricingRuleInput{
		Name: r.Name, TargetGroupID: r.TargetGroupID, Mode: r.Mode, Platform: r.Platform, Model: r.Model,
		Component: r.Component, Enabled: r.Enabled, IntervalSeconds: r.IntervalSeconds, AdjustmentStep: r.AdjustmentStep,
	}
}

func (r watchSourceRequest) serviceInput() service.WatchSourceInput {
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	return service.WatchSourceInput{
		Name: r.Name, AdapterType: r.AdapterType, BaseURL: r.BaseURL, APIBaseURL: r.APIBaseURL,
		RechargeRatio: r.RechargeRatio, LowBalanceThreshold: r.LowBalanceThreshold,
		PollingIntervalSeconds: r.PollingIntervalSeconds, RequestTimeoutSeconds: r.RequestTimeoutSeconds,
		KeepaliveEnabled: r.KeepaliveEnabled, KeepaliveIntervalSeconds: r.KeepaliveIntervalSeconds,
		AutoFollowKeyGroup: r.AutoFollowKeyGroup,
		ProfilePath:        r.ProfilePath, GroupsPath: r.GroupsPath, RatesPath: r.RatesPath,
		PricingPath: r.PricingPath, KeysPath: r.KeysPath, LoginPath: r.LoginPath,
		HeartbeatPath: r.HeartbeatPath, ReadMapping: r.ReadMapping,
		Enabled: enabled, AuthMode: r.AuthMode, LoginUsername: r.LoginUsername,
		LoginEmail: r.LoginEmail, LoginPassword: r.LoginPassword,
		CredentialType: r.CredentialType, Credential: r.Credential, ClearCredential: r.ClearCredential,
	}
}

func (h *WatchHandler) ListSources(c *gin.Context) {
	sources, err := h.watchSourceService.List(c.Request.Context())
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch sources unavailable")
		return
	}
	response.Success(c, sources)
}

func (h *WatchHandler) ExportSources(c *gin.Context) {
	var req watchSourceExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "导出参数无效")
		return
	}
	includeCredentials := true
	if req.IncludeCredentials != nil {
		includeCredentials = *req.IncludeCredentials
	}
	envelope, err := h.watchSourceService.ExportSources(c.Request.Context(), service.WatchSourceExportRequest{
		SourceIDs: req.SourceIDs, Password: req.Password, IncludeCredentials: includeCredentials,
	})
	if err != nil {
		writeWatchSourcePortableError(c, err)
		return
	}
	response.Success(c, envelope)
}

func (h *WatchHandler) DiagnoseSourcePreview(c *gin.Context) {
	var req watchSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "上游站点检测参数无效")
		return
	}
	report, err := h.watchSourceService.DiagnoseInput(c.Request.Context(), service.WatchSourceDiagnosticRequest{Input: req.serviceInput()})
	if err != nil {
		response.BadRequest(c, "上游站点检测配置无效，请检查站点地址、接口路径和凭据。")
		return
	}
	response.Success(c, report)
}

func (h *WatchHandler) PreviewImportSources(c *gin.Context) {
	var req watchSourceImportPreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "导入包格式无效")
		return
	}
	preview, err := h.watchSourceService.PreviewImportSources(c.Request.Context(), service.WatchSourceImportPreviewRequest{
		Package: req.Package, Password: req.Password,
	})
	if err != nil {
		writeWatchSourcePortableError(c, err)
		return
	}
	response.Success(c, preview)
}

func (h *WatchHandler) ApplyImportSources(c *gin.Context) {
	var req watchSourceImportApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "导入确认参数无效")
		return
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	result, err := h.watchSourceService.ApplyImportSources(c.Request.Context(), service.WatchSourceImportApplyRequest{
		Package: req.Package, Password: req.Password, Decisions: req.Decisions,
	}, subject.UserID)
	if err != nil {
		writeWatchSourcePortableError(c, err)
		return
	}
	response.Success(c, result)
}

func (h *WatchHandler) GetSource(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	snapshot, err := h.watchSourceService.Get(c.Request.Context(), id)
	if err != nil {
		writeWatchSourceError(c, err)
		return
	}
	response.Success(c, snapshot)
}

func (h *WatchHandler) CreateSource(c *gin.Context) {
	var req watchSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch source request")
		return
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	source, err := h.watchSourceService.Create(c.Request.Context(), req.serviceInput(), subject.UserID)
	if err != nil {
		writeWatchSourceMutationError(c, err)
		return
	}
	response.Created(c, source)
}

func (h *WatchHandler) UpdateSource(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	var req watchSourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch source request")
		return
	}
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	source, err := h.watchSourceService.Update(c.Request.Context(), id, req.serviceInput(), subject.UserID)
	if err != nil {
		writeWatchSourceMutationError(c, err)
		return
	}
	response.Success(c, source)
}

func (h *WatchHandler) StartSourceInteractiveAuth(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	session, err := h.watchSourceService.StartInteractiveAuth(c.Request.Context(), id, subject.UserID)
	if err != nil {
		writeWatchSourceInteractiveAuthError(c, err)
		return
	}
	response.Success(c, session)
}

func (h *WatchHandler) GetSourceInteractiveAuth(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	sessionID := c.Query("session_id")
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	session, err := h.watchSourceService.GetInteractiveAuthSession(c.Request.Context(), id, subject.UserID, sessionID)
	if err != nil {
		writeWatchSourceInteractiveAuthError(c, err)
		return
	}
	response.Success(c, session)
}

func (h *WatchHandler) CompleteSourceInteractiveAuth(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	var req watchSourceInteractiveAuthCompleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "授权登录确认参数无效")
		return
	}
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	result, err := h.watchSourceService.CompleteInteractiveAuth(c.Request.Context(), id, subject.UserID, service.WatchSourceInteractiveAuthCompleteRequest{
		SessionID: req.SessionID, CredentialType: req.CredentialType, Credential: req.Credential, Validate: req.Validate,
	})
	if err != nil {
		writeWatchSourceInteractiveAuthError(c, err)
		return
	}
	response.Success(c, result)
}

func (h *WatchHandler) DeleteSource(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	if err := h.watchSourceService.Delete(c.Request.Context(), id); err != nil {
		writeWatchSourceError(c, err)
		return
	}
	response.Success(c, gin.H{"deleted": true})
}

func (h *WatchHandler) CheckSource(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	snapshot, err := h.watchSourceService.RunCheck(c.Request.Context(), id)
	if err != nil {
		writeWatchSourceError(c, err)
		return
	}
	response.Success(c, snapshot)
}

func (h *WatchHandler) KeepaliveSource(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	snapshot, err := h.watchSourceService.RunKeepalive(c.Request.Context(), id)
	if err != nil {
		writeWatchSourceError(c, err)
		return
	}
	response.Success(c, snapshot)
}

func (h *WatchHandler) ListSourceChecks(c *gin.Context) {
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	var checks []service.WatchSourceCheck
	var err error
	if c.Query("kind") == "keepalive" {
		checks, err = h.watchSourceService.ListKeepaliveChecks(c.Request.Context(), id, limit)
	} else {
		checks, err = h.watchSourceService.ListChecks(c.Request.Context(), id, limit)
	}
	if err != nil {
		writeWatchSourceError(c, err)
		return
	}
	response.Success(c, checks)
}

func (h *WatchHandler) ListPriceChanges(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	sourceID, _ := strconv.ParseInt(c.DefaultQuery("source_id", "0"), 10, 64)
	afterID, _ := strconv.ParseInt(c.DefaultQuery("after_id", "0"), 10, 64)
	filter := service.WatchPriceChangeFilter{
		SourceID:        sourceID,
		AfterID:         afterID,
		GroupExternalID: c.Query("group_external_id"),
		Platform:        c.Query("platform"),
		Model:           c.Query("model"),
		Component:       c.Query("component"),
		ChangeKind:      c.Query("change_kind"),
		Limit:           limit,
	}
	changes, err := h.watchSourceService.ListPriceChanges(c.Request.Context(), filter)
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch price changes unavailable")
		return
	}
	response.Success(c, changes)
}

func (h *WatchHandler) ListPricingBoard(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	sourceID, _ := strconv.ParseInt(c.DefaultQuery("source_id", "0"), 10, 64)
	board, err := h.watchService.ListPricingBoard(c.Request.Context(), service.WatchPricingBoardFilter{
		SourceID:   sourceID,
		Platform:   c.Query("platform"),
		Tag:        c.Query("tag"),
		Search:     c.Query("search"),
		ChangeKind: c.Query("change_kind"),
		InUse:      c.Query("in_use"),
		Sort:       c.Query("sort"),
		Order:      c.Query("order"),
	})
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch pricing board unavailable")
		return
	}
	response.Success(c, board)
}

func (h *WatchHandler) GetPricingHistory(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	sourceID, _ := strconv.ParseInt(c.DefaultQuery("source_id", "0"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	history, err := h.watchService.GetPricingHistory(c.Request.Context(), service.WatchPricingHistoryFilter{
		SourceID:        sourceID,
		GroupExternalID: c.Query("group_external_id"),
		Platform:        c.Query("platform"),
		Model:           c.Query("model"),
		Component:       c.Query("component"),
		ChangeKind:      c.Query("change_kind"),
		Limit:           limit,
	})
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch pricing history unavailable")
		return
	}
	response.Success(c, history)
}

func (h *WatchHandler) ListAccountMappings(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	targetGroupID, _ := strconv.ParseInt(c.DefaultQuery("target_group_id", "0"), 10, 64)
	sourceID, sourceIDErr := strconv.ParseInt(c.DefaultQuery("source_id", "0"), 10, 64)
	page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, pageSizeErr := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	mappingStatus := strings.TrimSpace(c.Query("mapping_status"))
	mappingMethod := strings.TrimSpace(c.Query("mapping_method"))
	if pageErr != nil || pageSizeErr != nil || sourceIDErr != nil || sourceID < 0 || page < 1 || pageSize < 1 || pageSize > 100 || !validWatchAccountMappingStatus(mappingStatus) || !validWatchAccountMappingMethod(mappingMethod) {
		response.BadRequest(c, "invalid watch account mapping pagination")
		return
	}
	search := strings.TrimSpace(c.Query("search"))
	if len(search) > 200 {
		response.BadRequest(c, "invalid watch account mapping search")
		return
	}
	view, err := h.watchService.ListAccountMappings(c.Request.Context(), service.WatchAccountMappingListRequest{
		TargetGroupID: targetGroupID,
		Platform:      c.Query("platform"),
		Search:        search,
		MappingStatus: mappingStatus,
		MappingMethod: mappingMethod,
		SourceID:      sourceID,
		Page:          page,
		PageSize:      pageSize,
	})
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch account mappings unavailable")
		return
	}
	response.Success(c, view)
}

func (h *WatchHandler) ScanAccountMappings(c *gin.Context) {
	if h.watchService == nil || h.watchSourceService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	var req service.WatchAccountMappingScanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch account mapping scan request")
		return
	}
	req.Search = strings.TrimSpace(req.Search)
	req.MappingStatus = strings.TrimSpace(req.MappingStatus)
	if req.SourceID < 0 || len(req.Search) > 200 || !validWatchAccountMappingStatus(req.MappingStatus) {
		response.BadRequest(c, "invalid watch account mapping scan filter")
		return
	}
	result, err := h.watchService.ScanAccountMappings(c.Request.Context(), req, h.watchSourceService.FetchMappingSnapshot)
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch account mapping scan unavailable")
		return
	}
	response.Success(c, result)
}

func validWatchAccountMappingStatus(status string) bool {
	switch status {
	case "", "mapped", "unmapped", "needs_confirmation":
		return true
	default:
		return false
	}
}

func validWatchAccountMappingMethod(method string) bool {
	switch method {
	case "", "auto", "manual":
		return true
	default:
		return false
	}
}

func (h *WatchHandler) ConfirmAccountMappingBatch(c *gin.Context) {
	if h.watchService == nil || h.watchSourceService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	var req service.WatchAccountMappingBatchConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch account mapping batch request")
		return
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	result, err := h.watchService.ConfirmAccountMappingBatch(c.Request.Context(), req, subject.UserID, h.watchSourceService.FetchMappingSnapshot)
	if err != nil {
		response.BadRequest(c, "invalid watch account mapping batch request")
		return
	}
	response.Success(c, result)
}

func (h *WatchHandler) SaveAccountMapping(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	accountID, err := strconv.ParseInt(c.Param("account_id"), 10, 64)
	if err != nil || accountID <= 0 {
		response.BadRequest(c, "invalid watch account id")
		return
	}
	var req service.WatchAccountMappingInput
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch account mapping request")
		return
	}
	req.AccountID = accountID
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	mapping, err := h.watchService.SaveAccountMapping(c.Request.Context(), req, subject.UserID)
	if err != nil {
		response.BadRequest(c, "invalid watch account mapping")
		return
	}
	response.Success(c, mapping)
}

func (h *WatchHandler) DeleteAccountMapping(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	accountID, err := strconv.ParseInt(c.Param("account_id"), 10, 64)
	if err != nil || accountID <= 0 {
		response.BadRequest(c, "invalid watch account id")
		return
	}
	if err := h.watchService.DeleteAccountMapping(c.Request.Context(), accountID); err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch account mapping operation failed")
		return
	}
	response.Success(c, gin.H{"deleted": true})
}

func parseWatchSourceID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid watch source id")
		return 0, false
	}
	return id, true
}

func writeWatchSourceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrWatchSourceNotFound):
		response.NotFound(c, "Watch source not found")
	case errors.Is(err, service.ErrWatchSourceCredentialAbsent):
		response.ErrorWithDetails(c, http.StatusBadRequest, "上游站点未配置凭据，请先配置 Token/API Key/Cookie，或使用 Sub2API 账号密码授权。", "watch_source_credential_missing", nil)
	case errors.Is(err, service.ErrWatchSourceCredentialLoadFailed):
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "读取上游站点凭据失败，请检查数据库状态后重试。", "watch_source_credential_load_failed", nil)
	case errors.Is(err, service.ErrWatchSourceStableEncryptionRequired):
		response.ErrorWithDetails(c, http.StatusBadRequest, "当前服务未配置固定 TOTP_ENCRYPTION_KEY，保存后重启会导致凭据无法解密。请先配置固定密钥并重启服务。", "watch_source_stable_encryption_required", nil)
	case errors.Is(err, service.ErrWatchSourceObservationPersistFailed):
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "上游诊断已执行，但检测记录写入失败，请确认 Watch 数据表迁移已完成。", "watch_source_observation_persist_failed", nil)
	case errors.Is(err, service.ErrWatchSourceSnapshotUnavailable):
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "上游诊断记录已更新，但读取诊断快照失败，请刷新后重试。", "watch_source_snapshot_unavailable", nil)
	default:
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "上游站点诊断暂不可用，请稍后重试。", "watch_source_operation_failed", nil)
	}
}

func writeWatchSourceMutationError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrWatchSourceNotFound) {
		response.NotFound(c, "Watch source not found")
		return
	}
	switch {
	case errors.Is(err, service.ErrWatchSourceStableEncryptionRequired):
		response.ErrorWithDetails(c, http.StatusBadRequest, "当前服务未配置固定 TOTP_ENCRYPTION_KEY，不能保存上游凭据。请先配置固定密钥并重启服务。", "watch_source_stable_encryption_required", nil)
	case errors.Is(err, service.ErrWatchSourcePasswordAuthUnsupported):
		response.BadRequest(c, "当前站点类型暂不支持账号密码授权，请使用手动 Token/API Key/Cookie。")
	case errors.Is(err, service.ErrWatchSourceInteractiveAuthRequired):
		response.BadRequest(c, "上游登录需要 2FA/TOTP/Turnstile 或验证码验证，请改用手动 Token/Cookie。")
	case errors.Is(err, service.ErrWatchSourcePasswordAuthMissingDetails):
		response.BadRequest(c, "请填写上游登录邮箱和密码。")
	case errors.Is(err, service.ErrWatchSourcePasswordAuthFailed):
		response.BadRequest(c, "上游账号密码登录失败，请检查账号、密码或改用手动凭据。")
	case errors.Is(err, service.ErrWatchSourcePasswordAuthInvalidResponse):
		response.BadRequest(c, "上游登录路径返回了网页或非 JSON 响应，请检查站点类型、API 地址和登录路径。New API 站点通常 API 地址填写站点根地址。")
	case errors.Is(err, service.ErrWatchSourcePasswordAuthMissingToken):
		response.BadRequest(c, "上游登录成功但未返回可用于 API 的 access_token，请确认该站点支持密码换 Token；否则请改用手动 Token/Cookie。")
	case errors.Is(err, service.ErrWatchSourcePasswordAuthUnavailable):
		response.BadRequest(c, "上游登录接口暂不可用或返回异常，请稍后重试或改用手动凭据。")
	default:
		response.BadRequest(c, "invalid watch source configuration")
	}
}

func writeWatchSourceInteractiveAuthError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrWatchSourceNotFound) {
		response.NotFound(c, "Watch source not found")
		return
	}
	switch {
	case errors.Is(err, service.ErrWatchSourceInteractiveAuthSessionNotFound):
		response.ErrorWithDetails(c, http.StatusBadRequest, "授权登录会话不存在，请重新打开授权窗口。", "watch_source_interactive_auth_session_not_found", nil)
	case errors.Is(err, service.ErrWatchSourceInteractiveAuthSessionExpired):
		response.ErrorWithDetails(c, http.StatusBadRequest, "授权登录会话已过期，请重新打开授权窗口。", "watch_source_interactive_auth_session_expired", nil)
	case errors.Is(err, service.ErrWatchSourceInteractiveAuthCredentialMissing):
		response.ErrorWithDetails(c, http.StatusBadRequest, "请填写授权后获得的 Token 或 Cookie。", "watch_source_interactive_auth_credential_missing", nil)
	case errors.Is(err, service.ErrWatchSourceInteractiveAuthCredentialInvalid):
		response.ErrorWithDetails(c, http.StatusBadRequest, "授权凭据包含不支持的请求头，请只保留 Token、Cookie 或系统支持的兼容头。", "watch_source_interactive_auth_credential_invalid", nil)
	case errors.Is(err, service.ErrWatchSourceInteractiveAuthCredentialTooLarge):
		response.ErrorWithDetails(c, http.StatusBadRequest, "授权凭据过长，请确认只粘贴必要的 Token 或 Cookie。", "watch_source_interactive_auth_credential_too_large", nil)
	case errors.Is(err, service.ErrWatchSourceStableEncryptionRequired):
		response.ErrorWithDetails(c, http.StatusBadRequest, "当前服务未配置固定 TOTP_ENCRYPTION_KEY，不能保存授权凭据。请先配置固定密钥并重启服务。", "watch_source_stable_encryption_required", nil)
	case strings.Contains(err.Error(), "unsupported watch source credential type"):
		response.ErrorWithDetails(c, http.StatusBadRequest, "请选择 Bearer Token、API Key 或 Cookie。", "watch_source_credential_type_invalid", nil)
	case errors.Is(err, service.ErrWatchSourceCredentialAbsent):
		response.ErrorWithDetails(c, http.StatusBadRequest, "授权凭据未保存，请重新填写 Token 或 Cookie。", "watch_source_credential_missing", nil)
	case errors.Is(err, service.ErrWatchSourceCredentialDecryptFailed), errors.Is(err, service.ErrWatchSourceCredentialLoadFailed):
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "读取授权凭据失败，请重新保存凭据。", "watch_source_credential_load_failed", nil)
	case errors.Is(err, service.ErrWatchSourceObservationPersistFailed):
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "授权凭据已验证，但检测记录写入失败，请确认 Watch 数据表迁移已完成。", "watch_source_observation_persist_failed", nil)
	case errors.Is(err, service.ErrWatchSourceSnapshotUnavailable):
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "授权凭据已保存，但读取诊断快照失败，请刷新后重试。", "watch_source_snapshot_unavailable", nil)
	default:
		response.ErrorWithDetails(c, http.StatusBadRequest, "授权登录保存失败，请检查 Token/Cookie 后重试。", "watch_source_interactive_auth_failed", nil)
	}
}

func writeWatchSourcePortableError(c *gin.Context, err error) {
	if err == nil {
		response.BadRequest(c, "上游站点导入/导出失败")
		return
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "password"):
		response.BadRequest(c, "导入/导出密码无效或长度不足")
	case strings.Contains(message, "unsupported watch source import"),
		strings.Contains(message, "invalid watch source import"),
		strings.Contains(message, "watch source import supports"),
		strings.Contains(message, "watch source export has no selected sources"):
		response.BadRequest(c, "上游站点导入包格式无效或内容不完整")
	case strings.Contains(message, "credential decrypt"),
		errors.Is(err, service.ErrWatchSourceCredentialDecryptFailed),
		errors.Is(err, service.ErrWatchSourceCredentialLoadFailed):
		response.BadRequest(c, "上游站点凭据无法解密，请检查当前服务密钥或重新导出")
	case errors.Is(err, service.ErrWatchSourceStableEncryptionRequired):
		response.BadRequest(c, "当前服务未配置固定 TOTP_ENCRYPTION_KEY，不能导入带凭据的上游站点包")
	default:
		response.BadRequest(c, "上游站点导入/导出失败，请检查配置后重试")
	}
}

func (h *WatchHandler) PreviewPricing(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	var req service.WatchPricingPreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch pricing preview request")
		return
	}
	preview, err := h.watchService.PreviewPricing(c.Request.Context(), req)
	if err != nil {
		response.BadRequest(c, "invalid watch pricing preview parameters")
		return
	}
	response.Success(c, preview)
}

func (h *WatchHandler) ApplyPricing(c *gin.Context) {
	var req service.WatchPricingApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch pricing apply request")
		return
	}
	if key := c.GetHeader("Idempotency-Key"); key != "" {
		req.IdempotencyKey = key
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	audit, err := h.watchService.ApplyPricing(c.Request.Context(), req, subject.UserID)
	if err != nil {
		writeWatchPricingError(c, err)
		return
	}
	response.Success(c, audit)
}

func (h *WatchHandler) RollbackPricing(c *gin.Context) {
	auditID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || auditID <= 0 {
		response.BadRequest(c, "invalid watch price audit id")
		return
	}
	var req service.WatchPricingRollbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch pricing rollback request")
		return
	}
	if key := c.GetHeader("Idempotency-Key"); key != "" {
		req.IdempotencyKey = key
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	audit, err := h.watchService.RollbackPricing(c.Request.Context(), auditID, req, subject.UserID)
	if err != nil {
		writeWatchPricingError(c, err)
		return
	}
	response.Success(c, audit)
}

func (h *WatchHandler) ListPriceAudits(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	audits, err := h.watchService.ListPriceAudits(c.Request.Context(), limit)
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch price audits unavailable")
		return
	}
	response.Success(c, audits)
}

func (h *WatchHandler) ListPricingRules(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	rules, err := h.watchService.ListPricingRules(c.Request.Context())
	if err != nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch pricing rules unavailable")
		return
	}
	response.Success(c, rules)
}

func (h *WatchHandler) CreatePricingRule(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	var req watchPricingRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch pricing rule request")
		return
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	rule, err := h.watchService.CreatePricingRule(c.Request.Context(), req.serviceInput(), subject.UserID)
	if err != nil {
		writeWatchPricingRuleError(c, err)
		return
	}
	response.Created(c, rule)
}

func (h *WatchHandler) UpdatePricingRule(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	var req watchPricingRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "invalid watch pricing rule request")
		return
	}
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	rule, err := h.watchService.UpdatePricingRule(c.Request.Context(), id, req.serviceInput(), subject.UserID)
	if err != nil {
		writeWatchPricingRuleError(c, err)
		return
	}
	response.Success(c, rule)
}

func (h *WatchHandler) DeletePricingRule(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	if err := h.watchService.DeletePricingRule(c.Request.Context(), id); err != nil {
		writeWatchPricingRuleError(c, err)
		return
	}
	response.Success(c, gin.H{"deleted": true})
}

func (h *WatchHandler) RunPricingRule(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	id, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	result, err := h.watchService.RunPricingRule(c.Request.Context(), id, subject.UserID)
	if err != nil {
		writeWatchPricingRuleError(c, err)
		return
	}
	response.Success(c, result)
}

func (h *WatchHandler) ListRateAnomalies(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if err != nil || limit < 1 || limit > 200 {
		response.BadRequest(c, "倍率异常查询数量必须在 1 到 200 之间")
		return
	}
	items, err := h.watchService.ListRateAnomalies(c.Request.Context(), service.WatchRateAnomalyFilter{
		Status: c.DefaultQuery("status", "all"),
		Limit:  limit,
	})
	if err != nil {
		logWatchRateCompensationFailure(c, err)
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "倍率异常记录暂不可用，请稍后重试", "watch_rate_anomaly_unavailable", nil)
		return
	}
	response.Success(c, items)
}

func (h *WatchHandler) PreviewRateCompensation(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	anomalyID, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	preview, err := h.watchService.PreviewRateCompensation(c.Request.Context(), anomalyID)
	if err != nil {
		writeWatchRateCompensationError(c, err)
		return
	}
	response.Success(c, preview)
}

func (h *WatchHandler) ApplyRateCompensation(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	anomalyID, ok := parseWatchSourceID(c)
	if !ok {
		return
	}
	var req watchRateCompensationApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "补偿确认参数无效")
		return
	}
	if key := strings.TrimSpace(c.GetHeader("Idempotency-Key")); key != "" {
		req.IdempotencyKey = key
	}
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	result, err := h.watchService.ApplyRateCompensation(c.Request.Context(), anomalyID, service.WatchRateCompensationApplyInput{
		UserIDs: req.UserIDs, Confirmed: req.Confirmed, IdempotencyKey: req.IdempotencyKey, Reason: req.Reason,
	}, subject.UserID)
	if err != nil {
		writeWatchRateCompensationError(c, err)
		return
	}
	response.Success(c, result)
}

func (h *WatchHandler) RecordExternalRateCompensation(c *gin.Context) {
	if h.watchService == nil {
		response.Error(c, http.StatusServiceUnavailable, "Watch service not available")
		return
	}
	var req watchRateExternalCompensationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "外部补偿登记参数无效")
		return
	}
	windowStart, startErr := time.Parse(time.RFC3339, req.WindowStart)
	windowEnd, endErr := time.Parse(time.RFC3339, req.WindowEnd)
	if startErr != nil || endErr != nil {
		response.BadRequest(c, "外部补偿时间范围无效")
		return
	}
	subject, authenticated := middleware2.GetAuthSubjectFromContext(c)
	if !authenticated || subject.UserID <= 0 {
		response.Unauthorized(c, "administrator identity unavailable")
		return
	}
	err := h.watchService.RecordExternalRateCompensation(c.Request.Context(), service.WatchRateExternalCompensationInput{
		TargetGroupID: req.TargetGroupID, UserID: req.UserID, WindowStart: windowStart, WindowEnd: windowEnd,
		Amount: req.Amount, IdempotencyKey: req.IdempotencyKey, Reason: req.Reason,
	}, subject.UserID)
	if err != nil {
		writeWatchRateCompensationError(c, err)
		return
	}
	response.Success(c, gin.H{"recorded": true})
}

func writeWatchPricingError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrWatchPricingFrozen):
		response.ErrorWithDetails(c, http.StatusConflict, "Watch pricing is frozen", "WATCH_PRICING_FROZEN", nil)
	case errors.Is(err, service.ErrWatchPricingConflict):
		response.ErrorWithDetails(c, http.StatusConflict, "Watch pricing preview is stale", "WATCH_PRICING_CONFLICT", nil)
	case errors.Is(err, service.ErrWatchPricingNotFound):
		response.NotFound(c, "Watch price audit not found")
	case errors.Is(err, service.ErrWatchIdempotencyMismatch):
		response.ErrorWithDetails(c, http.StatusConflict, "Idempotency key was already used", "WATCH_IDEMPOTENCY_MISMATCH", nil)
	default:
		response.Error(c, http.StatusServiceUnavailable, "Watch pricing operation failed")
	}
}

func writeWatchPricingRuleError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrWatchPricingRuleNotFound):
		response.NotFound(c, "Watch pricing rule not found")
	case errors.Is(err, service.ErrWatchPricingFrozen):
		response.ErrorWithDetails(c, http.StatusConflict, "Watch pricing is frozen", "WATCH_PRICING_FROZEN", nil)
	case errors.Is(err, service.ErrWatchPricingConflict):
		response.ErrorWithDetails(c, http.StatusConflict, "Watch pricing preview is stale", "WATCH_PRICING_CONFLICT", nil)
	case strings.Contains(err.Error(), "adjustment_step"):
		response.ErrorWithDetails(c, http.StatusBadRequest, "单次调价步长必须大于 0", "adjustment_step must be positive", nil)
	default:
		logWatchPricingRuleFailure(c, err)
		response.Error(c, http.StatusServiceUnavailable, "Watch pricing rule operation failed")
	}
}

func logWatchPricingRuleFailure(c *gin.Context, err error) {
	if err == nil {
		return
	}
	var requestID string
	if c != nil && c.Request != nil {
		requestID, _ = c.Request.Context().Value(ctxkey.RequestID).(string)
		if requestID == "" {
			requestID = c.GetHeader("X-Request-Id")
		}
	}
	ruleID := ""
	if c != nil {
		ruleID = c.Param("id")
	}
	slog.Error("watch pricing rule operation failed",
		"rule_id", ruleID,
		"request_id", requestID,
		"error", logredact.RedactText(err.Error()),
	)
}

func writeWatchRateCompensationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrWatchRateAnomalyNotFound):
		response.NotFound(c, "倍率异常记录不存在")
	case errors.Is(err, service.ErrWatchRateCompensationConfirmationRequired):
		response.ErrorWithDetails(c, http.StatusBadRequest, "请先核对金额并明确确认补偿", "watch_rate_compensation_confirmation_required", nil)
	case errors.Is(err, service.ErrWatchRateCompensationSelectionRequired):
		response.ErrorWithDetails(c, http.StatusBadRequest, "请至少选择一位可补偿用户", "watch_rate_compensation_selection_required", nil)
	case errors.Is(err, service.ErrWatchRateCompensationIdempotencyMismatch):
		response.ErrorWithDetails(c, http.StatusConflict, "该补偿幂等键已用于其他记录，请刷新后重试", "watch_rate_compensation_idempotency_mismatch", nil)
	case strings.Contains(err.Error(), "idempotency key"), strings.Contains(err.Error(), "compensation reason"), strings.Contains(err.Error(), "selection exceeds"):
		response.ErrorWithDetails(c, http.StatusBadRequest, "补偿参数无效，请检查确认项、原因和操作标识", "watch_rate_compensation_invalid", nil)
	default:
		logWatchRateCompensationFailure(c, err)
		response.ErrorWithDetails(c, http.StatusServiceUnavailable, "倍率差额补偿暂未执行，请稍后重试", "watch_rate_compensation_failed", nil)
	}
}

func logWatchRateCompensationFailure(c *gin.Context, err error) {
	if err == nil {
		return
	}
	requestID := ""
	if c != nil && c.Request != nil {
		requestID, _ = c.Request.Context().Value(ctxkey.RequestID).(string)
		if requestID == "" {
			requestID = c.GetHeader("X-Request-Id")
		}
	}
	slog.Error("watch rate compensation operation failed",
		"anomaly_id", c.Param("id"),
		"request_id", requestID,
		"error", logredact.RedactText(err.Error()),
	)
}
