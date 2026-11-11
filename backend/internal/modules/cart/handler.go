package cart

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// Handler exposes /api/v1/cart endpoints.
type Handler struct {
	repo   *Repository
	tokens *auth.TokenManager
	rdb    *platformredis.Client
}

// NewHandler creates a cart Handler.
func NewHandler(repo *Repository, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{repo: repo, tokens: tokens, rdb: rdb}
}

// RegisterRoutes attaches customer cart routes under isolated customer portal auth.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	mount := func(prefix string) {
		grp := v1.Group(prefix)
		grp.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "customer"))
		{
			grp.GET("", h.getCart)
			grp.POST("/items", h.addItem)
			grp.PATCH("/items/:cartItemId", h.updateItem)
			grp.DELETE("/items/:cartItemId", h.removeItem)
			grp.DELETE("", h.clearCart)
			grp.POST("/coupon", h.applyCoupon)
			grp.DELETE("/coupon", h.removeCoupon)
			grp.POST("/validate-checkout", h.validateCheckout)
		}
	}
	mount("/cart")
	mount("/customer/cart")
}

func (h *Handler) getCart(c *gin.Context) {
	addrID := c.Query("address_id")
	var addrPtr *string
	if addrID != "" {
		addrPtr = &addrID
	}
	dto, err := h.repo.GetCart(c.Request.Context(), auth.CurrentUserID(c), addrPtr, 0)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch cart.", nil)
		return
	}
	httputil.OK(c, dto)
}

func (h *Handler) addItem(c *gin.Context) {
	var req struct {
		RestaurantID      string   `json:"restaurant_id" binding:"required"`
		MenuItemID        string   `json:"menu_item_id" binding:"required"`
		Quantity          int      `json:"quantity" binding:"required,min=1,max=50"`
		SelectedOptionIDs []string `json:"selected_option_ids"`
		ReplaceCart       bool     `json:"replace_cart"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	dto, err := h.repo.AddItem(c.Request.Context(), auth.CurrentUserID(c), req.RestaurantID, req.MenuItemID, req.Quantity, req.SelectedOptionIDs, req.ReplaceCart)
	if err != nil {
		switch {
		case errors.Is(err, ErrMultiRestaurantConflict):
			httputil.Fail(c, http.StatusConflict, "MULTI_RESTAURANT_CART_CONFLICT", err.Error(), nil)
		case errors.Is(err, ErrItemOutOfStock):
			httputil.Fail(c, http.StatusConflict, "ITEM_OUT_OF_STOCK", err.Error(), nil)
		case errors.Is(err, ErrRestaurantClosed):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, dto)
}

func (h *Handler) updateItem(c *gin.Context) {
	var req struct {
		Quantity int `json:"quantity" binding:"min=0,max=50"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	dto, err := h.repo.UpdateItemQuantity(c.Request.Context(), auth.CurrentUserID(c), c.Param("cartItemId"), req.Quantity)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	httputil.OK(c, dto)
}

func (h *Handler) removeItem(c *gin.Context) {
	dto, err := h.repo.UpdateItemQuantity(c.Request.Context(), auth.CurrentUserID(c), c.Param("cartItemId"), 0)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	httputil.OK(c, dto)
}

func (h *Handler) clearCart(c *gin.Context) {
	dto, err := h.repo.ClearCart(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not clear cart.", nil)
		return
	}
	httputil.OK(c, dto)
}

func (h *Handler) applyCoupon(c *gin.Context) {
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	dto, err := h.repo.ApplyCoupon(c.Request.Context(), auth.CurrentUserID(c), req.Code)
	if errors.Is(err, ErrInvalidCoupon) {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_COUPON", err.Error(), nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not apply coupon.", nil)
		return
	}
	httputil.OK(c, dto)
}

func (h *Handler) removeCoupon(c *gin.Context) {
	dto, err := h.repo.RemoveCoupon(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not remove coupon.", nil)
		return
	}
	httputil.OK(c, dto)
}

func (h *Handler) validateCheckout(c *gin.Context) {
	var req struct {
		DeliveryAddressID string `json:"delivery_address_id" binding:"required"`
		TipAmountMinor    int64  `json:"tip_amount_minor"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	res, err := h.repo.ValidateCheckout(c.Request.Context(), auth.CurrentUserID(c), req.DeliveryAddressID, req.TipAmountMinor)
	if err != nil {
		switch {
		case errors.Is(err, ErrOutOfServiceArea):
			httputil.Fail(c, http.StatusBadRequest, "OUT_OF_SERVICE_AREA", err.Error(), nil)
		case errors.Is(err, ErrItemOutOfStock):
			httputil.Fail(c, http.StatusConflict, "CART_PRICE_OR_AVAILABILITY_CHANGED", err.Error(), nil)
		case errors.Is(err, ErrRestaurantClosed):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, res)
}
