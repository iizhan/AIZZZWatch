package handler

import (
	"strconv"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type RecommendationHandler struct {
	service *service.RecommendationService
}

func NewRecommendationHandler(svc *service.RecommendationService) *RecommendationHandler {
	return &RecommendationHandler{service: svc}
}

func (h *RecommendationHandler) ListModels(c *gin.Context) {
	items, err := h.service.ListModels(c.Request.Context())
	if err != nil {
		response.Error(c, 503, "推荐模型暂不可用")
		return
	}
	response.Success(c, items)
}

func (h *RecommendationHandler) ListMine(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	items, err := h.service.ListMine(c.Request.Context(), subject.UserID)
	if err != nil {
		response.Error(c, 503, "推荐记录暂不可用")
		return
	}
	response.Success(c, items)
}

type createRecommendationRequest struct {
	SiteURL    string  `json:"site_url" binding:"required"`
	ModelKey   string  `json:"model_key" binding:"required"`
	Multiplier float64 `json:"multiplier" binding:"required"`
	RewardType string  `json:"reward_type" binding:"required"`
	Note       string  `json:"note"`
}

func (h *RecommendationHandler) Create(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	var req createRecommendationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "推荐信息不完整")
		return
	}
	item, err := h.service.Create(c.Request.Context(), subject.UserID, req.SiteURL, req.ModelKey, req.Multiplier, req.RewardType, req.Note)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, item)
}

func (h *RecommendationHandler) Transfer(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "User not authenticated")
		return
	}
	amount, err := h.service.Transfer(c.Request.Context(), subject.UserID)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{"transferred_amount": amount})
}

func (h *RecommendationHandler) PublicPricing(c *gin.Context) {
	items, err := h.service.ListPublicPricing(c.Request.Context())
	if err != nil {
		response.Error(c, 503, "公开倍率暂不可用")
		return
	}
	response.Success(c, items)
}

func (h *RecommendationHandler) AdminList(c *gin.Context) {
	items, err := h.service.ListAdmin(c.Request.Context(), c.Query("status"))
	if err != nil {
		response.Error(c, 503, "推荐列表暂不可用")
		return
	}
	response.Success(c, items)
}

func (h *RecommendationHandler) AdminListPublicPricing(c *gin.Context) {
	items, err := h.service.ListPublicPricingAdmin(c.Request.Context())
	if err != nil {
		response.Error(c, 503, "公示倍率配置暂不可用")
		return
	}
	response.Success(c, items)
}

func (h *RecommendationHandler) AdminListModels(c *gin.Context) {
	items, err := h.service.ListModelsAdmin(c.Request.Context())
	if err != nil {
		response.Error(c, 503, "推荐模型配置暂不可用")
		return
	}
	response.Success(c, items)
}

type saveRecommendationModelRequest struct {
	Key       string `json:"key" binding:"required"`
	Name      string `json:"name" binding:"required"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sort_order"`
}

func (h *RecommendationHandler) AdminSaveModel(c *gin.Context) {
	var req saveRecommendationModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "推荐模型配置不完整")
		return
	}
	if err := h.service.SaveModelOption(c.Request.Context(), req.Key, req.Name, req.Enabled, req.SortOrder); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{"saved": true})
}

type savePublicPricingRequest struct {
	SourceID        int64  `json:"source_id" binding:"required"`
	GroupExternalID string `json:"group_external_id" binding:"required"`
	PublicName      string `json:"public_name" binding:"required"`
	Enabled         bool   `json:"enabled"`
}

func (h *RecommendationHandler) AdminSavePublicPricing(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "Admin not authenticated")
		return
	}
	var req savePublicPricingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "公示倍率配置不完整")
		return
	}
	if err := h.service.SavePublicPricing(c.Request.Context(), subject.UserID, req.SourceID, req.GroupExternalID, req.PublicName, req.Enabled); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, gin.H{"saved": true})
}

type decideRecommendationRequest struct {
	Adopted      bool    `json:"adopted"`
	Reason       string  `json:"reason" binding:"required"`
	RewardType   string  `json:"reward_type"`
	Amount       float64 `json:"amount"`
	SharePercent float64 `json:"share_percent"`
	CapAmount    float64 `json:"cap_amount"`
	AdminNote    string  `json:"admin_note"`
}

func (h *RecommendationHandler) AdminDecide(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "Admin not authenticated")
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, "推荐 ID 无效")
		return
	}
	var req decideRecommendationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "审核信息不完整")
		return
	}
	item, err := h.service.Decide(c.Request.Context(), subject.UserID, id, req.Adopted, req.Reason, req.RewardType, req.Amount, req.SharePercent, req.CapAmount, nil, req.AdminNote)
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, item)
}
