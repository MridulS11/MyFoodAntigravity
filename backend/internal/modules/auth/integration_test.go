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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/users"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
)

func TestAuthAndPostGISAddressIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping database integration test in -short mode")
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err, "PostgreSQL + PostGIS must be running for integration tests")
	defer pool.Close()

	require.NoError(t, database.RunMigrations(ctx, pool, "../../../migrations"))

	// Ensure Bengaluru zone exists for PostGIS ST_Covers check
	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active, base_delivery_fee_minor, min_cart_threshold_minor, small_cart_fee_minor)
		VALUES (
			'01900000-0000-7000-8000-000000000001',
			'Bengaluru Central (Indiranagar · Koramangala · HSR)',
			'Bengaluru, KA',
			'Asia/Kolkata',
			'INR',
			ST_GeogFromText('POLYGON((77.5700 12.9000, 77.7000 12.9000, 77.7000 13.0200, 77.5700 13.0200, 77.5700 12.9000))'),
			TRUE, 2900, 29900, 2900
		) ON CONFLICT (id) DO NOTHING
	`)
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	tokens := auth.NewTokenManager("integration-test-secret-32-characters-min", 15*time.Minute, 7*24*time.Hour)
	authRepo := auth.NewRepository(pool)
	authSvc := auth.NewService(authRepo, tokens, nil, "test")
	authHandler := auth.NewHandler(authSvc, tokens, nil, false)
	usersRepo := users.NewRepository(pool)
	usersHandler := users.NewHandler(usersRepo, tokens, nil)

	r := gin.New()
	r.Use(middleware.CorrelationID())
	v1 := r.Group("/api/v1")
	authHandler.RegisterRoutes(v1)
	usersHandler.RegisterRoutes(v1)

	// 1. Register User A & User B
	suffix := time.Now().UnixNano() % 100000000
	emailA := "intA" + string(rune('a'+(suffix%26))) + os.Getenv("USER") + time.Now().Format("150405.000") + "@goodly.test"
	phoneA := "+91-99000-" + time.Now().Format("150405")
	emailB := "intB" + time.Now().Format("150405.000") + "@goodly.test"
	phoneB := "+91-99111-" + time.Now().Format("150405")

	regPayloadA, _ := json.Marshal(map[string]any{
		"full_name": "Integration User A",
		"email":     emailA,
		"phone":     phoneA,
		"password":  "Password#123",
		"role":      "CUSTOMER",
	})
	wReg := httptest.NewRecorder()
	r.ServeHTTP(wReg, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(regPayloadA)))
	require.Equal(t, http.StatusCreated, wReg.Code)

	// Verify OTP
	otpPayload, _ := json.Marshal(map[string]any{"target": phoneA, "purpose": "REGISTER", "code": "123456"})
	wOtp := httptest.NewRecorder()
	r.ServeHTTP(wOtp, httptest.NewRequest(http.MethodPost, "/api/v1/auth/otp/verify", bytes.NewReader(otpPayload)))
	require.Equal(t, http.StatusOK, wOtp.Code)

	// Login User A -> capture access token & refresh cookie
	loginPayloadA, _ := json.Marshal(map[string]any{"email_or_phone": emailA, "password": "Password#123"})
	wLoginA := httptest.NewRecorder()
	r.ServeHTTP(wLoginA, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginPayloadA)))
	require.Equal(t, http.StatusOK, wLoginA.Code)

	var loginRespA struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(wLoginA.Body.Bytes(), &loginRespA))
	tokenA := loginRespA.Data.AccessToken
	cookiesA := wLoginA.Result().Cookies()

	// Rotate refresh token once
	reqRef1 := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	for _, c := range cookiesA {
		reqRef1.AddCookie(c)
	}
	wRef1 := httptest.NewRecorder()
	r.ServeHTTP(wRef1, reqRef1)
	require.Equal(t, http.StatusOK, wRef1.Code)

	// Reusing old refresh token MUST fail with 401 TOKEN_REUSE_DETECTED and revoke family
	reqReuse := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	for _, c := range cookiesA {
		reqReuse.AddCookie(c)
	}
	wReuse := httptest.NewRecorder()
	r.ServeHTTP(wReuse, reqReuse)
	assert.Equal(t, http.StatusUnauthorized, wReuse.Code)

	// Create serviceable PostGIS address in Indiranagar for User A
	addrBody, _ := json.Marshal(map[string]any{
		"label":           "Home",
		"recipient_name":  "User A",
		"recipient_phone": phoneA,
		"address_line1":   "100 Feet Road, Indiranagar",
		"city":            "Bengaluru",
		"state":           "KA",
		"postal_code":     "560038",
		"country_code":    "IN",
		"lat":             12.9784,
		"lng":             77.6408,
		"is_default":      true,
	})
	reqAddr := httptest.NewRequest(http.MethodPost, "/api/v1/customers/me/addresses", bytes.NewReader(addrBody))
	reqAddr.Header.Set("Authorization", "Bearer "+tokenA)
	wAddr := httptest.NewRecorder()
	r.ServeHTTP(wAddr, reqAddr)
	require.Equal(t, http.StatusCreated, wAddr.Code)

	var addrResp struct {
		Data struct {
			ID            string `json:"id"`
			IsServiceable bool   `json:"is_serviceable"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(wAddr.Body.Bytes(), &addrResp))
	assert.True(t, addrResp.Data.IsServiceable)

	// Register & Login User B and verify User B gets 403 when mutating User A's address
	regPayloadB, _ := json.Marshal(map[string]any{
		"full_name": "Integration User B",
		"email":     emailB,
		"phone":     phoneB,
		"password":  "Password#123",
		"role":      "CUSTOMER",
	})
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(regPayloadB)))

	// Unverified User B must NOT be stored or allowed to log in before OTP verification
	loginPayloadB, _ := json.Marshal(map[string]any{"email_or_phone": emailB, "password": "Password#123"})
	wLoginBPre := httptest.NewRecorder()
	r.ServeHTTP(wLoginBPre, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginPayloadB)))
	assert.Equal(t, http.StatusUnauthorized, wLoginBPre.Code, "credentials must NOT be stored or valid before OTP verification")

	otpPayloadB, _ := json.Marshal(map[string]any{"target": phoneB, "purpose": "REGISTER", "code": "123456"})
	wOtpB := httptest.NewRecorder()
	r.ServeHTTP(wOtpB, httptest.NewRequest(http.MethodPost, "/api/v1/auth/otp/verify", bytes.NewReader(otpPayloadB)))
	require.Equal(t, http.StatusOK, wOtpB.Code)

	wLoginB := httptest.NewRecorder()
	r.ServeHTTP(wLoginB, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginPayloadB)))
	require.Equal(t, http.StatusOK, wLoginB.Code)
	var loginRespB struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(wLoginB.Body.Bytes(), &loginRespB))

	reqCrossDel := httptest.NewRequest(http.MethodDelete, "/api/v1/customers/me/addresses/"+addrResp.Data.ID, nil)
	reqCrossDel.Header.Set("Authorization", "Bearer "+loginRespB.Data.AccessToken)
	wCrossDel := httptest.NewRecorder()
	r.ServeHTTP(wCrossDel, reqCrossDel)
	assert.Equal(t, http.StatusForbidden, wCrossDel.Code)
}
