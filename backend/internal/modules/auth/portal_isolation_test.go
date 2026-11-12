package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/users"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
)

func TestIsolatedPortalAuthenticationCookiesAndOnboardingFlags(t *testing.T) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}
	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	tm := auth.NewTokenManager("portal-isolation-secret-32-chars", 15*time.Minute, 7*24*time.Hour)
	repo := auth.NewRepository(pool)
	svc := auth.NewService(repo, tm, nil, "test")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	auth.NewHandler(svc, tm, nil, false).RegisterRoutes(v1)
	users.NewHandler(users.NewRepository(pool), tm, nil).RegisterRoutes(v1)
	restaurants.NewHandler(restaurants.NewRepository(pool), tm, nil).RegisterRoutes(v1)
	v1.GET("/delivery/ping", auth.RequirePortalAuth(tm, nil, "delivery"), func(c *gin.Context) {
		httputil.OK(c, gin.H{"portal": "delivery"})
	})
	v1.GET("/admin/ping", auth.RequirePortalAuth(tm, nil, "admin"), func(c *gin.Context) {
		httputil.OK(c, gin.H{"portal": "admin"})
	})
	v1.GET("/admin/protected-ping", auth.RequirePortalAuth(tm, nil, "admin"), auth.RequireLivePermission(repo, "orders:monitor"), func(c *gin.Context) {
		httputil.OK(c, gin.H{"portal": "admin_ops"})
	})

	// Create two users with same account privileges to verify cross-portal isolation
	sfx := uuid.NewString()[:6]
	custEmail := "iso-cust-" + sfx + "@test.local"
	ownerEmail := "iso-owner-" + sfx + "@test.local"

	reqReg := func(path string, body any) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	require.Equal(t, http.StatusCreated, reqReg("/api/v1/customer/auth/register", map[string]any{
		"full_name": "Iso Customer", "email": custEmail, "phone": "+91-76001-" + sfx[:5], "password": "Password#123", "role": "CUSTOMER",
	}).Code)
	// Cannot log in before OTP verification succeeds
	require.Equal(t, http.StatusUnauthorized, reqReg("/api/v1/customer/auth/login", map[string]any{"email_or_phone": custEmail, "password": "Password#123"}).Code)
	require.Equal(t, http.StatusOK, reqReg("/api/v1/customer/auth/otp/verify", map[string]any{"target": custEmail, "purpose": "REGISTER", "code": "123456"}).Code)

	require.Equal(t, http.StatusCreated, reqReg("/api/v1/restaurant/auth/register", map[string]any{
		"full_name": "Iso Owner", "email": ownerEmail, "phone": "+91-76002-" + sfx[:5], "password": "Password#123", "role": "OUTLET_OWNER",
	}).Code)
	require.Equal(t, http.StatusOK, reqReg("/api/v1/restaurant/auth/otp/verify", map[string]any{"target": ownerEmail, "purpose": "REGISTER", "code": "123456"}).Code)

	// 1. Check unique email prompt flag
	wUnique := reqReg("/api/v1/restaurant/auth/check-email", map[string]any{"email_or_phone": "brandnew-" + sfx + "@test.local"})
	require.Equal(t, http.StatusOK, wUnique.Code)
	assert.Contains(t, wUnique.Body.String(), `"onboarding_recommended":true`)

	// 2. Customer portal login issues ONLY goodly_customer_* cookies and onboarding_required=true
	wCustLogin := reqReg("/api/v1/customer/auth/login", map[string]any{"email_or_phone": custEmail, "password": "Password#123"})
	require.Equal(t, http.StatusOK, wCustLogin.Code)
	assert.Contains(t, wCustLogin.Body.String(), `"onboarding_required":true`)
	var custCookie *http.Cookie
	for _, c := range wCustLogin.Result().Cookies() {
		if c.Name == "goodly_customer_access_token" {
			custCookie = c
		}
		assert.NotEqual(t, "goodly_restaurant_access_token", c.Name)
	}
	require.NotNil(t, custCookie)

	// 3. Customer cookie works on /customer/me, REJECTED on /restaurant/outlets & /delivery/ping & /admin/ping
	reqWithCookie := func(method, path string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		for _, ck := range cookies {
			req.AddCookie(ck)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	assert.Equal(t, http.StatusOK, reqWithCookie(http.MethodGet, "/api/v1/customer/me", custCookie).Code)
	assert.Equal(t, http.StatusUnauthorized, reqWithCookie(http.MethodGet, "/api/v1/restaurant/outlets", custCookie).Code)
	assert.Equal(t, http.StatusUnauthorized, reqWithCookie(http.MethodGet, "/api/v1/delivery/ping", custCookie).Code)
	assert.Equal(t, http.StatusUnauthorized, reqWithCookie(http.MethodGet, "/api/v1/admin/ping", custCookie).Code)

	// 4. Open Admin portal registration & pre-invite login: plain user CAN register & log in to /admin/auth/*,
	//    receives goodly_admin_* cookie & 0 admin permissions (403 on protected admin ops until invited + accepted).
	adminCandEmail := "iso-admin-cand-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, reqReg("/api/v1/admin/auth/register", map[string]any{
		"full_name": "Iso Admin Candidate", "email": adminCandEmail, "phone": "+91-76003-" + sfx[:5], "password": "Password#123",
	}).Code)
	require.Equal(t, http.StatusUnauthorized, reqReg("/api/v1/admin/auth/login", map[string]any{"email_or_phone": adminCandEmail, "password": "Password#123"}).Code)
	require.Equal(t, http.StatusOK, reqReg("/api/v1/admin/auth/otp/verify", map[string]any{"target": adminCandEmail, "purpose": "REGISTER", "code": "123456"}).Code)
	wAdminCandLogin := reqReg("/api/v1/admin/auth/login", map[string]any{"email_or_phone": adminCandEmail, "password": "Password#123"})
	require.Equal(t, http.StatusOK, wAdminCandLogin.Code)
	assert.Contains(t, wAdminCandLogin.Body.String(), `"onboarding_required":true`)
	var adminCandCookie *http.Cookie
	for _, c := range wAdminCandLogin.Result().Cookies() {
		if c.Name == "goodly_admin_access_token" {
			adminCandCookie = c
		}
	}
	require.NotNil(t, adminCandCookie)
	assert.Equal(t, http.StatusOK, reqWithCookie(http.MethodGet, "/api/v1/admin/auth/invitations", adminCandCookie).Code)
	assert.Equal(t, http.StatusForbidden, reqWithCookie(http.MethodGet, "/api/v1/admin/protected-ping", adminCandCookie).Code)

	// 5. Restaurant owner logs into /restaurant/auth/login -> coexists alongside customer cookie!
	wOwnerLogin := reqReg("/api/v1/restaurant/auth/login", map[string]any{"email_or_phone": ownerEmail, "password": "Password#123"})
	require.Equal(t, http.StatusOK, wOwnerLogin.Code)
	assert.Contains(t, wOwnerLogin.Body.String(), `"onboarding_required":true`)
	var restCookie *http.Cookie
	for _, c := range wOwnerLogin.Result().Cookies() {
		if c.Name == "goodly_restaurant_access_token" {
			restCookie = c
		}
	}
	require.NotNil(t, restCookie)

	assert.Equal(t, http.StatusOK, reqWithCookie(http.MethodGet, "/api/v1/restaurant/outlets", custCookie, restCookie).Code)
	assert.Equal(t, http.StatusOK, reqWithCookie(http.MethodGet, "/api/v1/customer/me", custCookie, restCookie).Code)

	// 6. Logout of restaurant clears goodly_restaurant_* cookie cleanly without disturbing customer session
	wRestLogout := reqWithCookie(http.MethodPost, "/api/v1/restaurant/auth/logout", restCookie)
	require.Equal(t, http.StatusOK, wRestLogout.Code)
	var clearedRest bool
	for _, c := range wRestLogout.Result().Cookies() {
		if c.Name == "goodly_restaurant_access_token" && c.MaxAge < 0 {
			clearedRest = true
		}
	}
	assert.True(t, clearedRest)
	assert.Equal(t, http.StatusOK, reqWithCookie(http.MethodGet, "/api/v1/customer/me", custCookie).Code)
}
