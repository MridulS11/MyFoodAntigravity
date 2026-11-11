package auth

import (
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

const (
	AccessCookieName  = "goodly_access_token"
	RefreshCookieName = "goodly_refresh_token"

	ctxUserIDKey      = "auth_user_id"
	ctxPortalKey      = "auth_portal"
	ctxRolesKey       = "auth_roles"
	ctxPermissionsKey = "auth_permissions"
	ctxJTIKey         = "auth_jti"
	ctxExpKey         = "auth_exp"
)

// PortalCookieNames returns isolated access cookie, refresh cookie, and refresh path for each portal.
func PortalCookieNames(portal string) (accessCookie, refreshCookie, refreshPath string) {
	switch strings.ToLower(strings.TrimSpace(portal)) {
	case "customer", "restaurant", "delivery", "admin":
		p := strings.ToLower(strings.TrimSpace(portal))
		return "goodly_" + p + "_access_token", "goodly_" + p + "_refresh_token", "/api/v1/" + p + "/auth"
	default:
		return AccessCookieName, RefreshCookieName, "/api/v1/auth"
	}
}

// RequireAuth extracts JWT from Authorization header or legacy cookie, checks Redis revocation, and binds identity claims.
func RequireAuth(tm *TokenManager, rdb *platformredis.Client) gin.HandlerFunc {
	return RequirePortalAuth(tm, rdb, "")
}

// RequirePortalAuth isolates session authentication strictly per portal ("customer" | "restaurant" | "delivery" | "admin").
func RequirePortalAuth(tm *TokenManager, rdb *platformredis.Client, portal string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractBearerOrPortalCookie(c, portal)
		if token == "" {
			httputil.Fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required. Please sign in.", nil)
			c.Abort()
			return
		}

		claims, err := tm.ParseAccessToken(token)
		if err != nil {
			httputil.Fail(c, http.StatusUnauthorized, "UNAUTHORIZED", "Session expired or invalid. Please sign in again.", nil)
			c.Abort()
			return
		}

		if portal != "" && claims.Portal != "" && claims.Portal != portal {
			httputil.Fail(c, http.StatusUnauthorized, "PORTAL_SESSION_MISMATCH", "Active session belongs to another portal. Please sign in here.", nil)
			c.Abort()
			return
		}

		if rdb != nil && claims.ID != "" {
			revoked, err := rdb.IsSessionRevoked(c.Request.Context(), claims.ID)
			if err == nil && revoked {
				httputil.Fail(c, http.StatusUnauthorized, "SESSION_REVOKED", "Session has ended. Please sign in again.", nil)
				c.Abort()
				return
			}
		}

		c.Set(ctxUserIDKey, claims.Subject)
		c.Set(ctxPortalKey, claims.Portal)
		c.Set(ctxRolesKey, claims.Roles)
		c.Set(ctxPermissionsKey, claims.Permissions)
		c.Set(ctxJTIKey, claims.ID)
		if claims.ExpiresAt != nil {
			c.Set(ctxExpKey, claims.ExpiresAt.Time)
		}
		c.Next()
	}
}

// RequireRoles rejects callers lacking any of the allowed roles with 403 Forbidden.
func RequireRoles(allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roles := CurrentUserRoles(c)
		for _, r := range roles {
			if slices.Contains(allowedRoles, r) {
				c.Next()
				return
			}
		}
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Insufficient role privileges for this action.", nil)
		c.Abort()
	}
}

// RequirePermission enforces granular RBAC permission checks for Platform Admin & Customer Care actions.
func RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		perms := CurrentUserPermissions(c)
		if slices.Contains(perms, permission) {
			c.Next()
			return
		}
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Missing required permission: "+permission, nil)
		c.Abort()
	}
}

// RequireLivePermission enforces RBAC against current DB permissions when repo is provided, falling back to JWT claims.
func RequireLivePermission(repo *Repository, permission string) gin.HandlerFunc {
	return RequireLiveAnyPermission(repo, permission)
}

// RequireLiveAnyPermission grants access if the active user holds at least one of the specified permissions.
func RequireLiveAnyPermission(repo *Repository, permissions ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if repo != nil {
			u, err := repo.GetUserByID(c.Request.Context(), CurrentUserID(c))
			if err == nil && u.Status == "ACTIVE" {
				for _, p := range permissions {
					if slices.Contains(u.Permissions, p) {
						c.Set(ctxRolesKey, u.Roles)
						c.Set(ctxPermissionsKey, u.Permissions)
						c.Next()
						return
					}
				}
			}
			httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Missing required permission: "+strings.Join(permissions, " or "), nil)
			c.Abort()
			return
		}
		if permsAny, ok := c.Get(ctxPermissionsKey); ok {
			if list, ok := permsAny.([]string); ok {
				for _, p := range permissions {
					if slices.Contains(list, p) {
						c.Next()
						return
					}
				}
			}
		}
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Missing required permission: "+strings.Join(permissions, " or "), nil)
		c.Abort()
	}
}

// CurrentUserID returns the authenticated user's UUID from Gin context.
func CurrentUserID(c *gin.Context) string {
	if v, ok := c.Get(ctxUserIDKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// CurrentUserRoles returns the authenticated user's role codes.
func CurrentUserRoles(c *gin.Context) []string {
	if v, ok := c.Get(ctxRolesKey); ok {
		if r, ok := v.([]string); ok {
			return r
		}
	}
	return nil
}

// CurrentUserPermissions returns the authenticated user's permission slugs.
func CurrentUserPermissions(c *gin.Context) []string {
	if v, ok := c.Get(ctxPermissionsKey); ok {
		if p, ok := v.([]string); ok {
			return p
		}
	}
	return nil
}

func extractBearerOrPortalCookie(c *gin.Context, portal string) string {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return strings.TrimSpace(authHeader[7:])
	}
	if portal != "" {
		accessCookie, _, _ := PortalCookieNames(portal)
		if cookieVal, err := c.Cookie(accessCookie); err == nil && cookieVal != "" {
			return cookieVal
		}
		return ""
	}
	if cookieVal, err := c.Cookie(AccessCookieName); err == nil && cookieVal != "" {
		return cookieVal
	}
	return ""
}
