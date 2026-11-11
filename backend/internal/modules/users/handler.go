package users

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// Handler exposes /api/v1/customers/me endpoints.
type Handler struct {
	repo   *Repository
	tokens *auth.TokenManager
	rdb    *platformredis.Client
}

// NewHandler creates a users Handler.
func NewHandler(repo *Repository, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{repo: repo, tokens: tokens, rdb: rdb}
}

// RegisterRoutes attaches customer profile, address, and favorites endpoints under isolated customer portal auth.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	mount := func(prefix string) {
		cust := v1.Group(prefix)
		cust.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "customer"))
		{
			cust.GET("", h.getMe)
			cust.PATCH("", h.updateMe)
			cust.GET("/addresses", h.listAddresses)
			cust.POST("/addresses", h.createAddress)
			cust.PATCH("/addresses/:id", h.setDefaultAddress)
			cust.DELETE("/addresses/:id", h.deleteAddress)
			cust.GET("/favorites", h.listFavorites)
			cust.POST("/favorites/:restaurantId", h.addFavorite)
			cust.DELETE("/favorites/:restaurantId", h.removeFavorite)
		}
	}
	mount("/customers/me")
	mount("/customer/me")
}

func (h *Handler) getMe(c *gin.Context) {
	prof, err := h.repo.GetCustomerProfile(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "User profile not found.", nil)
		return
	}
	prof.Permissions = auth.CurrentUserPermissions(c)
	httputil.OK(c, prof)
}

func (h *Handler) updateMe(c *gin.Context) {
	var req struct {
		FullName           string   `json:"full_name"`
		DietaryPreferences []string `json:"dietary_preferences"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	prof, err := h.repo.UpdateCustomerProfile(c.Request.Context(), auth.CurrentUserID(c), req.FullName, req.DietaryPreferences)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update profile.", nil)
		return
	}
	httputil.OK(c, prof)
}

func (h *Handler) listAddresses(c *gin.Context) {
	list, err := h.repo.ListAddresses(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch addresses.", nil)
		return
	}
	httputil.OK(c, list)
}

type createAddressReq struct {
	Label                string  `json:"label" binding:"required,oneof=Home Work Other"`
	RecipientName        string  `json:"recipient_name" binding:"required,min=2"`
	RecipientPhone       string  `json:"recipient_phone" binding:"required,min=8"`
	AddressLine1         string  `json:"address_line1" binding:"required,min=4"`
	AddressLine2         *string `json:"address_line2"`
	Landmark             *string `json:"landmark"`
	City                 string  `json:"city" binding:"required,min=2"`
	State                string  `json:"state" binding:"required,min=2"`
	PostalCode           string  `json:"postal_code" binding:"required,min=3"`
	CountryCode          string  `json:"country_code"`
	DeliveryInstructions *string `json:"delivery_instructions"`
	Lat                  float64 `json:"lat" binding:"required"`
	Lng                  float64 `json:"lng" binding:"required"`
	IsDefault            bool    `json:"is_default"`
}

func (h *Handler) createAddress(c *gin.Context) {
	var req createAddressReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	created, err := h.repo.CreateAddress(c.Request.Context(), auth.CurrentUserID(c), CreateAddressInput{
		Label:                req.Label,
		RecipientName:        req.RecipientName,
		RecipientPhone:       req.RecipientPhone,
		AddressLine1:         req.AddressLine1,
		AddressLine2:         req.AddressLine2,
		Landmark:             req.Landmark,
		City:                 req.City,
		State:                req.State,
		PostalCode:           req.PostalCode,
		CountryCode:          req.CountryCode,
		DeliveryInstructions: req.DeliveryInstructions,
		Lat:                  req.Lat,
		Lng:                  req.Lng,
		IsDefault:            req.IsDefault,
	})
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not save address.", nil)
		return
	}
	httputil.Created(c, created)
}

func (h *Handler) setDefaultAddress(c *gin.Context) {
	err := h.repo.SetDefaultAddress(c.Request.Context(), auth.CurrentUserID(c), c.Param("id"))
	if errors.Is(err, ErrAddressNotFoundOrForbidden) {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update default address.", nil)
		return
	}
	httputil.OK(c, gin.H{"updated": true})
}

func (h *Handler) deleteAddress(c *gin.Context) {
	err := h.repo.ArchiveAddress(c.Request.Context(), auth.CurrentUserID(c), c.Param("id"))
	if errors.Is(err, ErrAddressNotFoundOrForbidden) {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not delete address.", nil)
		return
	}
	httputil.OK(c, gin.H{"deleted": true})
}

func (h *Handler) listFavorites(c *gin.Context) {
	ids, err := h.repo.ListFavoriteIDs(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list favorites.", nil)
		return
	}
	httputil.OK(c, ids)
}

func (h *Handler) addFavorite(c *gin.Context) {
	if err := h.repo.AddFavorite(c.Request.Context(), auth.CurrentUserID(c), c.Param("restaurantId")); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Could not add favorite.", nil)
		return
	}
	httputil.OK(c, gin.H{"favorited": true})
}

func (h *Handler) removeFavorite(c *gin.Context) {
	if err := h.repo.RemoveFavorite(c.Request.Context(), auth.CurrentUserID(c), c.Param("restaurantId")); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Could not remove favorite.", nil)
		return
	}
	httputil.OK(c, gin.H{"favorited": false})
}
