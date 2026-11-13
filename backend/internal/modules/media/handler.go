package media

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/storage"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

const maxUploadBytes int64 = 10 * 1024 * 1024 // 10 MB

var allowedMenuTypes = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/webp": true,
	"image/avif": true,
}

var allowedVerificationTypes = map[string]bool{
	"image/jpeg":      true,
	"image/jpg":       true,
	"image/png":       true,
	"image/webp":      true,
	"application/pdf": true,
}

// Handler exposes presigned upload and view endpoints for R2 Menu and Verification (Outlet & Rider) keys.
type Handler struct {
	r2       *storage.R2Client
	restRepo *restaurants.Repository
	tokens   *auth.TokenManager
	rdb      *platformredis.Client
}

// NewHandler creates a media Handler.
func NewHandler(r2 *storage.R2Client, restRepo *restaurants.Repository, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{r2: r2, restRepo: restRepo, tokens: tokens, rdb: rdb}
}

// RegisterRoutes attaches restaurant, delivery, and admin media presigning routes.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	rest := v1.Group("/media")
	rest.Use(
		auth.RequirePortalAuth(h.tokens, h.rdb, "restaurant"),
		auth.RequireRoles("OUTLET_OWNER", "BRANCH_MANAGER", "OUTLET_STAFF", "RESTAURANT_OWNER", "CUSTOMER"),
	)
	{
		rest.POST("/presign-upload", h.presignRestaurantUpload)
		rest.GET("/presign-view", h.presignRestaurantView)
	}

	deliv := v1.Group("/delivery/media")
	deliv.Use(
		auth.RequirePortalAuth(h.tokens, h.rdb, "delivery"),
		auth.RequireRoles("DELIVERY_PARTNER", "CUSTOMER"),
	)
	{
		deliv.POST("/presign-upload", h.presignDeliveryUpload)
		deliv.GET("/presign-view", h.presignDeliveryView)
	}

	adm := v1.Group("/admin/media")
	adm.Use(
		auth.RequirePortalAuth(h.tokens, h.rdb, "admin"),
		auth.RequireRoles("ADMIN", "SUPER_ADMIN"),
	)
	{
		adm.GET("/presign-view", h.presignAdminView)
	}
}

type presignUploadRequest struct {
	Category    string `json:"category" binding:"required"`
	OutletID    string `json:"outlet_id"`
	Filename    string `json:"filename" binding:"required"`
	ContentType string `json:"content_type" binding:"required"`
	SizeBytes   int64  `json:"size_bytes"`
}

func (h *Handler) presignRestaurantUpload(c *gin.Context) {
	if h.r2 == nil {
		httputil.Fail(c, http.StatusServiceUnavailable, "MEDIA_STORAGE_NOT_CONFIGURED", "Cloudflare R2 storage is not configured on this server.", nil)
		return
	}

	var req presignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	cat, err := storage.ParseCategory(req.Category)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_CATEGORY", "category must be Menu or Verification.", nil)
		return
	}

	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	if cat == storage.CategoryMenu && !allowedMenuTypes[ct] {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_CONTENT_TYPE", "Menu uploads support JPEG, PNG, WebP, or AVIF images.", nil)
		return
	}
	if cat == storage.CategoryVerification && !allowedVerificationTypes[ct] {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_CONTENT_TYPE", "Verification uploads support JPEG, PNG, WebP, or PDF files.", nil)
		return
	}
	if req.SizeBytes > maxUploadBytes {
		httputil.Fail(c, http.StatusBadRequest, "FILE_TOO_LARGE", "Maximum file size is 10 MB.", nil)
		return
	}

	userID := auth.CurrentUserID(c)
	outletScope := strings.TrimSpace(req.OutletID)
	if outletScope == "" {
		outletScope = strings.TrimSpace(c.GetHeader("X-Outlet-ID"))
	}

	if outletScope != "" {
		perm := ""
		if cat == storage.CategoryMenu {
			perm = "outlet:menu:edit"
		}
		if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), userID, outletScope, perm); err != nil {
			httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
			return
		}
	} else {
		list, err := h.restRepo.ListMyOutlets(c.Request.Context(), userID)
		if err == nil && len(list) > 0 {
			outletScope = list[0].ID
			if cat == storage.CategoryMenu {
				if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), userID, outletScope, "outlet:menu:edit"); err != nil {
					httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
					return
				}
			}
		} else if cat == storage.CategoryVerification {
			outletScope = "owner-" + userID
		} else {
			httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership for menu upload.", nil)
			return
		}
	}

	var key string
	if cat == storage.CategoryMenu {
		key, err = storage.BuildMenuObjectKey(outletScope, req.Filename)
	} else {
		key, err = storage.BuildVerificationObjectKey(storage.VerificationOutlet, outletScope, req.Filename)
	}
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_KEY", err.Error(), nil)
		return
	}

	h.respondWithPresignedUpload(c, key, cat, outletScope, ct)
}

func (h *Handler) presignDeliveryUpload(c *gin.Context) {
	if h.r2 == nil {
		httputil.Fail(c, http.StatusServiceUnavailable, "MEDIA_STORAGE_NOT_CONFIGURED", "Cloudflare R2 storage is not configured on this server.", nil)
		return
	}

	var req presignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	cat, err := storage.ParseCategory(req.Category)
	if err != nil || cat != storage.CategoryVerification {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_CATEGORY", "Delivery uploads only support Verification documents.", nil)
		return
	}

	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	if !allowedVerificationTypes[ct] {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_CONTENT_TYPE", "Verification uploads support JPEG, PNG, WebP, or PDF files.", nil)
		return
	}
	if req.SizeBytes > maxUploadBytes {
		httputil.Fail(c, http.StatusBadRequest, "FILE_TOO_LARGE", "Maximum file size is 10 MB.", nil)
		return
	}

	userID := auth.CurrentUserID(c)
	key, err := storage.BuildVerificationObjectKey(storage.VerificationRider, userID, req.Filename)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_KEY", err.Error(), nil)
		return
	}

	h.respondWithPresignedUpload(c, key, storage.CategoryVerification, userID, ct)
}

func (h *Handler) respondWithPresignedUpload(c *gin.Context, key string, cat storage.Category, entityScope, contentType string) {
	uploadTTL := 10 * time.Minute
	uploadURL, err := h.r2.PresignUpload(c.Request.Context(), key, contentType, uploadTTL)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "PRESIGN_ERROR", "Could not generate upload URL.", nil)
		return
	}

	viewTTL := time.Hour
	if cat == storage.CategoryVerification {
		viewTTL = 15 * time.Minute
	}
	viewURL, err := h.r2.PresignView(c.Request.Context(), key, viewTTL)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "PRESIGN_ERROR", "Could not generate view URL.", nil)
		return
	}

	httputil.OK(c, gin.H{
		"bucket":             h.r2.Bucket(),
		"category":           string(cat),
		"outlet_id":          entityScope,
		"key":                key,
		"upload_url":         uploadURL,
		"view_url":           viewURL,
		"expires_in_seconds": int(uploadTTL.Seconds()),
	})
}

func (h *Handler) presignRestaurantView(c *gin.Context) {
	if h.r2 == nil {
		httputil.Fail(c, http.StatusServiceUnavailable, "MEDIA_STORAGE_NOT_CONFIGURED", "Cloudflare R2 storage is not configured on this server.", nil)
		return
	}

	key := strings.TrimSpace(c.Query("key"))
	cat, subScope, entityScope, err := storage.ParseObjectKey(key)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_KEY", "Invalid media key.", nil)
		return
	}

	userID := auth.CurrentUserID(c)
	if cat == storage.CategoryVerification {
		if subScope != storage.VerificationOutlet {
			httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Restaurant portal cannot access Rider verification documents.", nil)
			return
		}
		if entityScope != "owner-"+userID {
			if err := h.restRepo.AuthorizeOutletAction(c.Request.Context(), userID, entityScope, ""); err != nil {
				httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "You do not have access to this verification document.", nil)
				return
			}
		}
	}

	h.respondWithPresignedView(c, key, cat, entityScope)
}

func (h *Handler) presignDeliveryView(c *gin.Context) {
	if h.r2 == nil {
		httputil.Fail(c, http.StatusServiceUnavailable, "MEDIA_STORAGE_NOT_CONFIGURED", "Cloudflare R2 storage is not configured on this server.", nil)
		return
	}

	key := strings.TrimSpace(c.Query("key"))
	cat, subScope, entityScope, err := storage.ParseObjectKey(key)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_KEY", "Invalid media key.", nil)
		return
	}

	userID := auth.CurrentUserID(c)
	if cat != storage.CategoryVerification || subScope != storage.VerificationRider || entityScope != userID {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "You do not have access to this verification document.", nil)
		return
	}

	h.respondWithPresignedView(c, key, cat, entityScope)
}

func (h *Handler) presignAdminView(c *gin.Context) {
	if h.r2 == nil {
		httputil.Fail(c, http.StatusServiceUnavailable, "MEDIA_STORAGE_NOT_CONFIGURED", "Cloudflare R2 storage is not configured on this server.", nil)
		return
	}

	key := strings.TrimSpace(c.Query("key"))
	cat, _, entityScope, err := storage.ParseObjectKey(key)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_KEY", "Invalid media key.", nil)
		return
	}

	h.respondWithPresignedView(c, key, cat, entityScope)
}

func (h *Handler) respondWithPresignedView(c *gin.Context, key string, cat storage.Category, entityScope string) {
	ttl := time.Hour
	if cat == storage.CategoryVerification {
		ttl = 15 * time.Minute
	}
	viewURL, err := h.r2.PresignView(c.Request.Context(), key, ttl)
	if err != nil {
		if errors.Is(err, storage.ErrInvalidKey) {
			httputil.Fail(c, http.StatusBadRequest, "INVALID_KEY", err.Error(), nil)
			return
		}
		httputil.Fail(c, http.StatusInternalServerError, "PRESIGN_ERROR", "Could not generate view URL.", nil)
		return
	}

	httputil.OK(c, gin.H{
		"key":                key,
		"category":           string(cat),
		"outlet_id":          entityScope,
		"view_url":           viewURL,
		"expires_in_seconds": int(ttl.Seconds()),
	})
}
