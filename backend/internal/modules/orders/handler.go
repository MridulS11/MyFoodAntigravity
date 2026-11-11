package orders

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/cart"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// Handler exposes customer order endpoints and restaurant KDS order endpoints.
type Handler struct {
	repo     *Repository
	restRepo *restaurants.Repository
	tokens   *auth.TokenManager
	rdb      *platformredis.Client
}

// NewHandler creates an orders Handler.
func NewHandler(repo *Repository, restRepo *restaurants.Repository, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{repo: repo, restRepo: restRepo, tokens: tokens, rdb: rdb}
}

// RegisterRoutes attaches customer and restaurant order endpoints under isolated portal auth.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	mountCust := func(prefix string) {
		cust := v1.Group(prefix)
		cust.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "customer"))
		{
			cust.POST("", h.createOrder)
			cust.GET("", h.listMyOrders)
			cust.GET("/pending-rating-prompt", h.pendingRatingPrompt)
			cust.POST("/:id/dismiss-rating-prompt", h.dismissRatingPrompt)
			cust.GET("/:id", h.getOrderByID)
			cust.POST("/:id/cancel", h.cancelOrder)
			cust.POST("/:id/review", h.submitReview)
		}
	}
	mountCust("/orders")
	mountCust("/customer/orders")

	mountKDS := func(prefix string) {
		kds := v1.Group(prefix)
		kds.Use(
			auth.RequirePortalAuth(h.tokens, h.rdb, "restaurant"),
			auth.RequireRoles("OUTLET_OWNER", "BRANCH_MANAGER", "OUTLET_STAFF", "RESTAURANT_OWNER", "CUSTOMER"),
		)
		{
			kds.GET("", h.listOutletOrders)
			kds.POST("/:id/accept", h.acceptOrder)
			kds.POST("/:id/reject", h.rejectOrder)
			kds.PATCH("/:id/status", h.advanceStatus)
			kds.POST("/:id/status", h.advanceStatus)
		}
	}
	mountKDS("/restaurants/me/orders")
	mountKDS("/restaurant/orders")
}

func (h *Handler) createOrder(c *gin.Context) {
	idempKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if idempKey == "" {
		httputil.Fail(c, http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required.", nil)
		return
	}

	var req struct {
		DeliveryAddressID   string `json:"delivery_address_id" binding:"required"`
		PaymentMethod       string `json:"payment_method" binding:"required,oneof=ONLINE COD"`
		TipAmountMinor      int64  `json:"tip_amount_minor"`
		SpecialInstructions string `json:"special_instructions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	orderView, replayed, err := h.repo.CreateOrder(
		c.Request.Context(),
		auth.CurrentUserID(c),
		idempKey,
		req.DeliveryAddressID,
		req.PaymentMethod,
		req.TipAmountMinor,
		req.SpecialInstructions,
	)
	if err != nil {
		switch {
		case errors.Is(err, ErrItemOutOfStock), errors.Is(err, cart.ErrItemOutOfStock):
			httputil.Fail(c, http.StatusConflict, "ITEM_OUT_OF_STOCK", err.Error(), nil)
		case errors.Is(err, ErrOutletAtCapacity):
			httputil.Fail(c, http.StatusConflict, "OUTLET_AT_MAX_CAPACITY", err.Error(), nil)
		case errors.Is(err, ErrOutletNotAccepting), errors.Is(err, cart.ErrRestaurantClosed):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		case errors.Is(err, cart.ErrOutOfServiceArea):
			httputil.Fail(c, http.StatusBadRequest, "OUT_OF_SERVICE_AREA", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		}
		return
	}

	if replayed {
		httputil.OK(c, gin.H{"order": orderView, "idempotent_replay": true})
		return
	}
	httputil.Created(c, gin.H{"order": orderView, "idempotent_replay": false})
}

func (h *Handler) listMyOrders(c *gin.Context) {
	list, err := h.repo.ListCustomerOrders(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch orders.", nil)
		return
	}
	httputil.OK(c, list)
}

func (h *Handler) getOrderByID(c *gin.Context) {
	ov, err := h.repo.GetOrderByID(c.Request.Context(), c.Param("id"))
	if errors.Is(err, ErrOrderNotFound) {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch order.", nil)
		return
	}

	// Verify caller owns the order, manages the outlet, or holds ops/admin monitor permission
	uid := auth.CurrentUserID(c)
	allowed := ov.CustomerID == uid
	if !allowed {
		if h.restRepo.AuthorizeOutletAction(c.Request.Context(), uid, ov.RestaurantID, "") == nil {
			allowed = true
		}
	}
	if !allowed {
		for _, p := range auth.CurrentUserPermissions(c) {
			if p == "orders:monitor" {
				allowed = true
				break
			}
		}
	}
	if !allowed {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Access denied to this order.", nil)
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) cancelOrder(c *gin.Context) {
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	if req.Reason == "" {
		req.Reason = "Customer requested cancellation"
	}

	ov, err := h.repo.CancelOrder(c.Request.Context(), auth.CurrentUserID(c), c.Param("id"), req.Reason)
	if err != nil {
		switch {
		case errors.Is(err, ErrOrderNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		case errors.Is(err, ErrCancellationNotAllowed):
			httputil.Fail(c, http.StatusConflict, "CANCELLATION_NOT_ALLOWED", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not cancel order.", nil)
		}
		return
	}
	httputil.OK(c, ov)
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
		return "", ErrOrderNotFound
	}
	return list[0].ID, nil
}

func (h *Handler) resolveOutletForOrder(c *gin.Context, orderID string) (string, error) {
	if id := c.Query("outlet_id"); id != "" {
		return id, nil
	}
	if id := c.GetHeader("X-Outlet-ID"); id != "" {
		return id, nil
	}
	ov, err := h.repo.GetOrderByID(c.Request.Context(), orderID)
	if err != nil {
		return "", err
	}
	return ov.RestaurantID, nil
}

func (h *Handler) listOutletOrders(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:orders:manage"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	list, err := h.repo.ListOutletOrders(c.Request.Context(), outletID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list outlet orders.", nil)
		return
	}
	httputil.OK(c, list)
}

func (h *Handler) acceptOrder(c *gin.Context) {
	orderID := c.Param("id")
	outletID, err := h.resolveOutletForOrder(c, orderID)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:orders:manage"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		EstimatedPrepMinutes int `json:"estimated_prep_minutes"`
	}
	_ = c.ShouldBindJSON(&req)
	ov, _, err := h.repo.AcceptOrder(c.Request.Context(), outletID, orderID, auth.CurrentUserID(c), req.EstimatedPrepMinutes)
	if err != nil {
		switch {
		case errors.Is(err, ErrOrderNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		case errors.Is(err, ErrOptimisticConflict):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) rejectOrder(c *gin.Context) {
	orderID := c.Param("id")
	outletID, err := h.resolveOutletForOrder(c, orderID)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:orders:manage"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		ReasonCode string `json:"reason_code"`
	}
	_ = c.ShouldBindJSON(&req)
	if req.ReasonCode == "" {
		req.ReasonCode = "RESTAURANT_REJECTED"
	}
	ov, err := h.repo.RejectOrder(c.Request.Context(), outletID, orderID, auth.CurrentUserID(c), req.ReasonCode)
	if err != nil {
		switch {
		case errors.Is(err, ErrOrderNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		case errors.Is(err, ErrOptimisticConflict):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) advanceStatus(c *gin.Context) {
	orderID := c.Param("id")
	outletID, err := h.resolveOutletForOrder(c, orderID)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		return
	}
	if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:orders:manage"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		NextStatus string `json:"next_status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	ov, err := h.repo.AdvanceKitchenStatus(c.Request.Context(), outletID, orderID, auth.CurrentUserID(c), req.NextStatus)
	if err != nil {
		switch {
		case errors.Is(err, ErrOrderNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		case errors.Is(err, ErrInvalidTransition):
			httputil.Fail(c, http.StatusConflict, "INVALID_STATE_TRANSITION", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) submitReview(c *gin.Context) {
	var req struct {
		RestaurantRating      int16             `json:"restaurant_rating" binding:"required,min=1,max=5"`
		DeliveryPartnerRating *int16            `json:"delivery_partner_rating"`
		RestaurantComment     *string           `json:"restaurant_comment"`
		DeliveryComment       *string           `json:"delivery_partner_comment"`
		ItemRatings           []ItemRatingInput `json:"item_ratings"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	rev, err := h.repo.SubmitThreeCategoryReview(
		c.Request.Context(), auth.CurrentUserID(c), c.Param("id"),
		req.RestaurantRating, req.DeliveryPartnerRating, req.RestaurantComment, req.DeliveryComment, req.ItemRatings,
	)
	if err != nil {
		switch {
		case errors.Is(err, ErrOrderNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Order not found.", nil)
		case errors.Is(err, ErrDuplicateReview):
			httputil.Fail(c, http.StatusConflict, "DUPLICATE_REVIEW", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.Created(c, rev)
}

func (h *Handler) pendingRatingPrompt(c *gin.Context) {
	ov, err := h.repo.GetPendingRatingPrompt(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not check pending rating prompt.", nil)
		return
	}
	httputil.OK(c, gin.H{"order": ov})
}

func (h *Handler) dismissRatingPrompt(c *gin.Context) {
	if err := h.repo.DismissRatingPrompt(c.Request.Context(), auth.CurrentUserID(c), c.Param("id")); err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not dismiss prompt.", nil)
		return
	}
	httputil.OK(c, gin.H{"dismissed": true})
}
