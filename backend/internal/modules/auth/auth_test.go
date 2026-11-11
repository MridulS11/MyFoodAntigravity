package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("StrongPass#123")
	require.NoError(t, err)
	assert.Contains(t, hash, "$argon2id$")

	ok, err := VerifyPassword("StrongPass#123", hash)
	require.NoError(t, err)
	assert.True(t, ok)

	wrong, err := VerifyPassword("WrongPass#123", hash)
	require.NoError(t, err)
	assert.False(t, wrong)
}

func TestJWTAccessTokenAndRBACMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tm := NewTokenManager("unit-test-secret-must-be-32-chars-minimum", 15*time.Minute, 7*24*time.Hour)

	adminToken, jti, _, err := tm.IssueAccessToken(
		"user-platform-admin",
		[]string{"PLATFORM_ADMIN"},
		[]string{"orders:monitor", "commissions:configure"},
	)
	require.NoError(t, err)
	require.NotEmpty(t, jti)

	careToken, _, _, err := tm.IssueAccessToken(
		"user-customer-care",
		[]string{"CUSTOMER_CARE"},
		[]string{"orders:monitor", "orders:timeout_escalate", "complaints:resolve"},
	)
	require.NoError(t, err)

	r := gin.New()
	r.GET("/commissions", RequireAuth(tm, nil), RequirePermission("commissions:configure"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// PLATFORM_ADMIN permitted
	reqAdmin := httptest.NewRequest(http.MethodGet, "/commissions", nil)
	reqAdmin.Header.Set("Authorization", "Bearer "+adminToken)
	wAdmin := httptest.NewRecorder()
	r.ServeHTTP(wAdmin, reqAdmin)
	assert.Equal(t, http.StatusOK, wAdmin.Code)

	// CUSTOMER_CARE strictly blocked (403)
	reqCare := httptest.NewRequest(http.MethodGet, "/commissions", nil)
	reqCare.Header.Set("Authorization", "Bearer "+careToken)
	wCare := httptest.NewRecorder()
	r.ServeHTTP(wCare, reqCare)
	assert.Equal(t, http.StatusForbidden, wCare.Code)

	// Unauthenticated blocked (401)
	reqAnon := httptest.NewRequest(http.MethodGet, "/commissions", nil)
	wAnon := httptest.NewRecorder()
	r.ServeHTTP(wAnon, reqAnon)
	assert.Equal(t, http.StatusUnauthorized, wAnon.Code)
}

func TestRefreshTokenEntropyAndHashing(t *testing.T) {
	raw1, hash1, err := GenerateRefreshToken()
	require.NoError(t, err)
	raw2, hash2, err := GenerateRefreshToken()
	require.NoError(t, err)

	assert.NotEqual(t, raw1, raw2)
	assert.NotEqual(t, hash1, hash2)
	assert.Len(t, hash1, 64)
	assert.Equal(t, HashSHA256(raw1), hash1)
}
