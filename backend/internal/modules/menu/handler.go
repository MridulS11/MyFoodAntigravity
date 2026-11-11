package menu

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// Handler exposes /api/v1/menu endpoints for outlet owners and authorized branch staff.
type Handler struct {
	repo     *Repository
	restRepo *restaurants.Repository
	tokens   *auth.TokenManager
	rdb      *platformredis.Client
}

// NewHandler creates a menu Handler.
func NewHandler(repo *Repository, restRepo *restaurants.Repository, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{repo: repo, restRepo: restRepo, tokens: tokens, rdb: rdb}
}

// RegisterRoutes attaches outlet menu management endpoints under isolated restaurant portal auth.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	mount := func(prefix string) {
		grp := v1.Group(prefix)
		grp.Use(
			auth.RequirePortalAuth(h.tokens, h.rdb, "restaurant"),
			auth.RequireRoles("OUTLET_OWNER", "BRANCH_MANAGER", "OUTLET_STAFF", "RESTAURANT_OWNER", "CUSTOMER"),
		)
		{
			grp.GET("", h.getMyMenu)
			grp.POST("/categories", h.createCategory)
			grp.POST("/items", h.createMenuItem)
			grp.PUT("/items/:id", h.updateMenuItem)
			grp.PATCH("/items/:id/availability", h.toggleItemAvailability)
			grp.GET("/schedules", h.listSchedules)
		}
	}
	mount("/menu")
	mount("/restaurant/menu")
}

func (h *Handler) resolveOutletID(c *gin.Context) (string, error) {
	if id := c.Query("outlet_id"); id != "" {
		return id, nil
	}
	if id := c.GetHeader("X-Outlet-ID"); id != "" {
		return id, nil
	}
	list, err := h.restRepo.ListMyOutlets(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil || len(list) == 0 {
		return "", ErrNotFound
	}
	return list[0].ID, nil
}

func (h *Handler) getMyMenu(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, ""); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	cats, err := h.repo.GetRestaurantMenuTree(c.Request.Context(), outletID, false, "")
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load menu.", nil)
		return
	}
	httputil.OK(c, cats)
}

func (h *Handler) createCategory(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:menu:edit"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		Name     string  `json:"name" binding:"required,min=2"`
		Subtitle *string `json:"subtitle"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	created, err := h.repo.CreateCategory(c.Request.Context(), outletID, req.Name, req.Subtitle)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not create category.", nil)
		return
	}
	httputil.Created(c, created)
}

type menuItemWriteReq struct {
	CategoryID          string                `json:"category_id" binding:"required"`
	Name                string                `json:"name" binding:"required,min=2"`
	Description         string                `json:"description"`
	BadgeLabel          *string               `json:"badge_label"`
	BasePriceMinor      int64                 `json:"base_price_minor" binding:"min=0"`
	TrackInventory      bool                  `json:"track_inventory"`
	AvailableQuantity   int                   `json:"available_quantity"`
	ImageURL            *string               `json:"image_url"`
	VegClassification   string                `json:"veg_classification"`
	DietaryTags         []string              `json:"dietary_tags"`
	CuisineType         *string               `json:"cuisine_type"`
	SpiceLevel          string                `json:"spice_level"`
	CaloriesKcal        *int                  `json:"calories_kcal"`
	ServingSize         *string               `json:"serving_size"`
	PrepTimeMinutes     *int                  `json:"prep_time_minutes"`
	Ingredients         []string              `json:"ingredients"`
	Allergens           []string              `json:"allergens"`
	SearchKeywords      []string              `json:"search_keywords"`
	IsRecommended       bool                  `json:"is_recommended"`
	CustomizationGroups *[]CustomizationGroup `json:"customization_groups"`
}

func (req menuItemWriteReq) toRichInput() RichMenuItemInput {
	in := RichMenuItemInput{
		CategoryID:        req.CategoryID,
		Name:              req.Name,
		Description:       req.Description,
		BadgeLabel:        req.BadgeLabel,
		BasePriceMinor:    req.BasePriceMinor,
		TrackInventory:    req.TrackInventory,
		AvailableQuantity: req.AvailableQuantity,
		ImageURL:          req.ImageURL,
		VegClassification: req.VegClassification,
		DietaryTags:       req.DietaryTags,
		CuisineType:       req.CuisineType,
		SpiceLevel:        req.SpiceLevel,
		CaloriesKcal:      req.CaloriesKcal,
		ServingSize:       req.ServingSize,
		PrepTimeMinutes:   req.PrepTimeMinutes,
		Ingredients:       req.Ingredients,
		Allergens:         req.Allergens,
		SearchKeywords:    req.SearchKeywords,
		IsRecommended:     req.IsRecommended,
	}
	if req.CustomizationGroups != nil {
		in.HasCustomizations = true
		in.CustomizationGroups = *req.CustomizationGroups
	}
	return in
}

func (h *Handler) createMenuItem(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:menu:edit"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req menuItemWriteReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	created, err := h.repo.CreateRichMenuItem(c.Request.Context(), outletID, req.toRichInput())
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not create menu item.", nil)
		return
	}
	httputil.Created(c, created)
}

func (h *Handler) updateMenuItem(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:menu:edit"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req menuItemWriteReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	updated, err := h.repo.UpdateRichMenuItem(c.Request.Context(), outletID, c.Param("id"), req.toRichInput())
	if errors.Is(err, ErrNotFound) {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Menu item not found.", nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update menu item.", nil)
		return
	}
	httputil.OK(c, updated)
}

func (h *Handler) toggleItemAvailability(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:inventory:toggle"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		IsAvailable       bool `json:"is_available"`
		AvailableQuantity *int `json:"available_quantity"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	updated, err := h.repo.ToggleAvailability(c.Request.Context(), outletID, c.Param("id"), req.IsAvailable, req.AvailableQuantity)
	if errors.Is(err, ErrNotFound) {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Menu item not found.", nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update item availability.", nil)
		return
	}
	httputil.OK(c, updated)
}

func (h *Handler) listSchedules(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, ""); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	list, err := h.repo.ListSchedules(c.Request.Context(), outletID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load schedules.", nil)
		return
	}
	httputil.OK(c, list)
}
