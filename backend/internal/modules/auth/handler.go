package auth

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// Handler exposes HTTP REST endpoints under /api/v1/auth.
type Handler struct {
	service      *Service
	tokens       *TokenManager
	rdb          *platformredis.Client
	cookieSecure bool
}

// NewHandler creates an auth Handler.
func NewHandler(service *Service, tokens *TokenManager, rdb *platformredis.Client, cookieSecure bool) *Handler {
	return &Handler{
		service:      service,
		tokens:       tokens,
		rdb:          rdb,
		cookieSecure: cookieSecure,
	}
}

// RegisterRoutes attaches legacy /api/v1/auth routes plus all isolated per-portal auth routes.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	h.registerAuthGroup(v1.Group("/auth"), "")
	h.RegisterPortalRoutes(v1)
}

// RegisterPortalRoutes mounts separate isolated authentication endpoints & cookies for customer, restaurant, delivery, and admin portals.
func (h *Handler) RegisterPortalRoutes(v1 *gin.RouterGroup) {
	for _, portal := range []string{"customer", "restaurant", "delivery", "admin"} {
		h.registerAuthGroup(v1.Group("/"+portal+"/auth"), portal)
	}
}

func (h *Handler) registerAuthGroup(authGrp *gin.RouterGroup, portal string) {
	authGrp.POST("/check-email", h.checkEmail(portal))
	authGrp.POST("/register", middleware.RateLimiter(h.rdb, "auth_reg_"+portal, 20, 15*time.Minute), h.registerForPortal(portal))
	authGrp.POST("/login", middleware.RateLimiter(h.rdb, "auth_login_"+portal, 20, 15*time.Minute), h.loginForPortal(portal))
	authGrp.POST("/otp/send", middleware.RateLimiter(h.rdb, "auth_otp_"+portal, 10, 10*time.Minute), h.sendOTP)
	authGrp.POST("/otp/verify", middleware.RateLimiter(h.rdb, "auth_otp_v_"+portal, 15, 10*time.Minute), h.verifyOTP)
	authGrp.POST("/refresh", h.refreshForPortal(portal))
	authGrp.POST("/password/forgot", middleware.RateLimiter(h.rdb, "auth_pwd_"+portal, 10, 15*time.Minute), h.forgotPassword)
	authGrp.POST("/password/reset", middleware.RateLimiter(h.rdb, "auth_pwd_r_"+portal, 10, 15*time.Minute), h.resetPassword)
	authGrp.POST("/logout", h.logoutForPortal(portal))
	authGrp.POST("/ws-ticket", RequirePortalAuth(h.tokens, h.rdb, portal), h.wsTicket)
	authGrp.GET("/me", RequirePortalAuth(h.tokens, h.rdb, portal), h.meForPortal(portal))
	authGrp.GET("/invitations", RequirePortalAuth(h.tokens, h.rdb, portal), h.listInvitations)
	authGrp.POST("/invitations/:kind/:id/respond", RequirePortalAuth(h.tokens, h.rdb, portal), h.respondInvitation)
}

type registerReq struct {
	FullName string `json:"full_name" binding:"required,min=2"`
	Email    string `json:"email" binding:"required,email"`
	Phone    string `json:"phone" binding:"required,min=8"`
	Password string `json:"password" binding:"required,min=8"`
	Role     string `json:"role"`
}

func (h *Handler) checkEmail(portal string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			EmailOrPhone string `json:"email_or_phone" binding:"required,min=3"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
			return
		}
		exists := h.service.CheckEmailExists(c.Request.Context(), req.EmailOrPhone)
		httputil.OK(c, gin.H{
			"exists":                 exists,
			"portal":                 portal,
			"onboarding_recommended": !exists && portal != "admin",
		})
	}
}

func (h *Handler) registerForPortal(portal string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req registerReq
		if err := c.ShouldBindJSON(&req); err != nil {
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
			return
		}
		role := req.Role
		switch portal {
		case "customer", "admin":
			// Both customer accounts and newly self-registered admin-portal candidates start with base CUSTOMER role (0 admin permissions).
			// Admin permissions are only granted after an eligible Admin sends an invitation and the user accepts (plus approval if required).
			role = "CUSTOMER"
		case "delivery":
			role = "DELIVERY_PARTNER"
		case "restaurant":
			if role != "OUTLET_OWNER" && role != "OUTLET_STAFF" && role != "BRANCH_MANAGER" && role != "RESTAURANT_OWNER" {
				role = "OUTLET_OWNER"
			}
		}
		user, devOTP, err := h.service.Register(c.Request.Context(), req.FullName, req.Email, req.Phone, req.Password, role)
		if err != nil {
			switch {
			case errors.Is(err, ErrDisallowedRegistrationRole):
				httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
			case errors.Is(err, ErrDuplicateUser):
				httputil.Fail(c, http.StatusConflict, "DUPLICATE_ACCOUNT", err.Error(), nil)
			default:
				httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not register account.", nil)
			}
			return
		}
		resp := gin.H{"user": user, "otp_required": true, "portal": portal, "onboarding_required": true}
		if devOTP != "" {
			resp["dev_otp_hint"] = devOTP
		}
		httputil.Created(c, resp)
	}
}

type loginReq struct {
	EmailOrPhone string `json:"email_or_phone" binding:"required,min=3"`
	Password     string `json:"password" binding:"required,min=6"`
}

func (h *Handler) loginForPortal(portal string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req loginReq
		if err := c.ShouldBindJSON(&req); err != nil {
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
			return
		}
		pair, err := h.service.LoginForPortal(c.Request.Context(), portal, req.EmailOrPhone, req.Password, c.Request.UserAgent(), c.ClientIP())
		if err != nil {
			switch {
			case errors.Is(err, ErrAccountSuspended):
				httputil.Fail(c, http.StatusForbidden, "ACCOUNT_SUSPENDED", err.Error(), nil)
			default:
				exists := h.service.CheckEmailExists(c.Request.Context(), req.EmailOrPhone)
				details := gin.H{"unique_email": !exists, "onboarding_recommended": !exists && portal != "admin"}
				httputil.Fail(c, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Invalid email/phone or password.", details)
			}
			return
		}
		h.setPortalTokenCookies(c, portal, pair)
		httputil.OK(c, pair)
	}
}

type otpSendReq struct {
	Target  string `json:"target" binding:"required"`
	Purpose string `json:"purpose" binding:"required,oneof=REGISTER LOGIN PASSWORD_RESET SENSITIVE_ACTION"`
}

func (h *Handler) sendOTP(c *gin.Context) {
	var req otpSendReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.SendOTP(c.Request.Context(), req.Target, req.Purpose); err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to send OTP.", nil)
		return
	}
	httputil.OK(c, gin.H{"sent": true})
}

type otpVerifyReq struct {
	Target  string `json:"target" binding:"required"`
	Purpose string `json:"purpose"`
	Code    string `json:"code" binding:"required,len=6"`
}

func (h *Handler) verifyOTP(c *gin.Context) {
	var req otpVerifyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	purpose := req.Purpose
	if purpose == "" {
		purpose = "REGISTER"
	}
	user, err := h.service.VerifyOTP(c.Request.Context(), req.Target, purpose, req.Code)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_OTP", err.Error(), nil)
		return
	}
	httputil.OK(c, gin.H{"user": user, "verified": true})
}

func (h *Handler) refreshForPortal(portal string) gin.HandlerFunc {
	return func(c *gin.Context) {
		_, refreshCookie, _ := PortalCookieNames(portal)
		rawRefresh, err := c.Cookie(refreshCookie)
		if err != nil || rawRefresh == "" {
			var body struct {
				RefreshToken string `json:"refresh_token"`
			}
			_ = c.ShouldBindJSON(&body)
			rawRefresh = body.RefreshToken
		}

		pair, err := h.service.RefreshForPortal(c.Request.Context(), portal, rawRefresh, c.Request.UserAgent(), c.ClientIP())
		if err != nil {
			h.clearPortalTokenCookies(c, portal)
			if errors.Is(err, ErrTokenReuseDetected) {
				httputil.Fail(c, http.StatusUnauthorized, "TOKEN_REUSE_DETECTED", err.Error(), nil)
				return
			}
			httputil.Fail(c, http.StatusUnauthorized, "INVALID_REFRESH_TOKEN", "Session expired. Please sign in again.", nil)
			return
		}
		h.setPortalTokenCookies(c, portal, pair)
		httputil.OK(c, pair)
	}
}

func (h *Handler) logoutForPortal(portal string) gin.HandlerFunc {
	return func(c *gin.Context) {
		_, refreshCookie, _ := PortalCookieNames(portal)
		rawRefresh, _ := c.Cookie(refreshCookie)

		token := extractBearerOrPortalCookie(c, portal)
		jtiStr := ""
		remaining := 15 * time.Minute
		if token != "" {
			if claims, err := h.tokens.ParseAccessToken(token); err == nil {
				jtiStr = claims.ID
				if claims.ExpiresAt != nil {
					remaining = time.Until(claims.ExpiresAt.Time)
				}
			}
		}

		_ = h.service.Logout(c.Request.Context(), jtiStr, rawRefresh, remaining)
		h.clearPortalTokenCookies(c, portal)
		httputil.OK(c, gin.H{"logged_out": true, "portal": portal})
	}
}

func (h *Handler) forgotPassword(c *gin.Context) {
	var req struct {
		Target string `json:"target" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	_ = h.service.SendOTP(c.Request.Context(), req.Target, "PASSWORD_RESET")
	httputil.OK(c, gin.H{"message": "If an account exists for that target, a recovery OTP has been sent."})
}

func (h *Handler) resetPassword(c *gin.Context) {
	var req struct {
		Target      string `json:"target" binding:"required"`
		Code        string `json:"code" binding:"required,len=6"`
		NewPassword string `json:"new_password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.ResetPassword(c.Request.Context(), req.Target, req.Code, req.NewPassword); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_OTP", err.Error(), nil)
		return
	}
	httputil.OK(c, gin.H{"reset": true})
}

func (h *Handler) wsTicket(c *gin.Context) {
	ticket, err := h.service.CreateWSTicket(c.Request.Context(), CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not allocate WebSocket ticket.", nil)
		return
	}
	httputil.OK(c, gin.H{"ticket": ticket, "expires_in_seconds": 30})
}

func (h *Handler) meForPortal(portal string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, err := h.service.repo.GetUserByID(c.Request.Context(), CurrentUserID(c))
		if err != nil {
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "User account not found.", nil)
			return
		}
		if portal == "" {
			httputil.OK(c, u)
			return
		}
		onbReq, onbHint := h.service.repo.CheckPortalOnboardingStatus(c.Request.Context(), portal, u.ID)
		httputil.OK(c, gin.H{
			"user":                u,
			"portal":              portal,
			"onboarding_required": onbReq,
			"onboarding_hint":     onbHint,
		})
	}
}

func (h *Handler) listInvitations(c *gin.Context) {
	list, err := h.service.repo.ListUserInvitations(c.Request.Context(), CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load invitations.", nil)
		return
	}
	httputil.OK(c, list)
}

func (h *Handler) respondInvitation(c *gin.Context) {
	var req struct {
		Action string `json:"action" binding:"required,oneof=ACCEPT DECLINE"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.repo.RespondToInvitation(c.Request.Context(), CurrentUserID(c), c.Param("kind"), c.Param("id"), req.Action); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "INVALID_INVITATION", err.Error(), nil)
		return
	}
	httputil.OK(c, gin.H{"responded": true, "action": req.Action})
}

func (h *Handler) setPortalTokenCookies(c *gin.Context, portal string, pair *TokenPair) {
	accessCookie, refreshCookie, refreshPath := PortalCookieNames(portal)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(accessCookie, pair.AccessToken, int(h.tokens.accessTTL.Seconds()), "/", "", h.cookieSecure, true)
	c.SetCookie(refreshCookie, pair.RefreshToken, int(h.tokens.refreshTTL.Seconds()), refreshPath, "", h.cookieSecure, true)
}

func (h *Handler) clearPortalTokenCookies(c *gin.Context, portal string) {
	accessCookie, refreshCookie, refreshPath := PortalCookieNames(portal)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(accessCookie, "", -1, "/", "", h.cookieSecure, true)
	c.SetCookie(refreshCookie, "", -1, refreshPath, "", h.cookieSecure, true)
}
