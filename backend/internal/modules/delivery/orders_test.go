package delivery_test

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
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/cart"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/delivery"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/orders"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/payments"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/paymentgw"
)

func TestDeliveryArrivalOTPAndKDSSmokeIntegration(t *testing.T) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, dbURL)
	if err != nil {
		t.Skipf("postgres unavailable for delivery test: %v", err)
	}
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../migrations"))

	zoneID := uuid.NewString()
	ownerID := uuid.NewString()
	custID := uuid.NewString()
	partnerUserID := uuid.NewString()
	partnerID := uuid.NewString()
	addrID := uuid.NewString()
	outletID := uuid.NewString()
	catID := uuid.NewString()
	itemID := uuid.NewString()

	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active, base_delivery_fee_minor, min_cart_threshold_minor, small_cart_fee_minor)
		VALUES ($1, $2, 'Bengaluru, KA', 'Asia/Kolkata', 'INR',
		        ST_GeogFromText('POLYGON((77.5700 12.9000, 77.7000 12.9000, 77.7000 13.0200, 77.5700 13.0200, 77.5700 12.9000))'),
		        TRUE, 2900, 29900, 2900)
	`, zoneID, "Deliv-Zone-"+zoneID[:8])
	require.NoError(t, err)

	pwHash, _ := auth.HashPassword("Password#123")
	for _, u := range []struct{ id, email, phone, role string }{
		{ownerID, "delivowner-" + ownerID[:6] + "@test.local", "+91-71001-" + ownerID[:5], "OUTLET_OWNER"},
		{custID, "delivcust-" + custID[:6] + "@test.local", "+91-71002-" + custID[:5], "CUSTOMER"},
		{partnerUserID, "delivrider-" + partnerUserID[:6] + "@test.local", "+91-71003-" + partnerUserID[:5], "DELIVERY_PARTNER"},
	} {
		_, err = pool.Exec(ctx, `
			INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
			VALUES ($1, $2, $3, $4, 'Delivery Flow User', TRUE, TRUE, 'ACTIVE')
		`, u.id, u.email, u.phone, pwHash)
		require.NoError(t, err)
		_, _ = pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, u.id, u.role)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO delivery_partners (id, user_id, service_zone_id, vehicle_type, verification_status, availability_status)
		VALUES ($1, $2, $3, 'SCOOTER', 'APPROVED', 'ONLINE_AVAILABLE')
	`, partnerID, partnerUserID, zoneID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `
		INSERT INTO customer_addresses (id, user_id, label, recipient_name, recipient_phone, address_line1, city, state, postal_code, country_code, location, is_default)
		VALUES ($1, $2, 'Home', 'Deliv Cust', '+91-71002', '100 Ft Rd Indiranagar', 'Bengaluru', 'KA', '560038', 'IN', ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography, TRUE)
	`, addrID, custID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `
		INSERT INTO restaurants (id, owner_user_id, service_zone_id, slug, name, cuisines, phone, email, address_line1, city, state, postal_code, location, verification_status, is_active, is_accepting_orders, packaging_fee_minor, commission_rate_bps)
		VALUES ($1, $2, $3, $4, 'Deliv Kitchen', ARRAY['Italian'], '+91-71001', 'deliv@test.local', '241 Indiranagar', 'Bengaluru', 'KA', '560038',
		        ST_SetSRID(ST_MakePoint(77.6400, 12.9780), 4326)::geography, 'APPROVED', TRUE, TRUE, 2000, 2000)
	`, outletID, ownerID, zoneID, "deliv-kitchen-"+outletID[:6])
	require.NoError(t, err)

	_, _ = pool.Exec(ctx, `INSERT INTO menu_categories (id, restaurant_id, name, display_order) VALUES ($1, $2, 'Main', 1)`, catID, outletID)
	_, err = pool.Exec(ctx, `INSERT INTO menu_items (id, restaurant_id, category_id, name, base_price_minor, currency) VALUES ($1, $2, $3, 'Penne', 45000, 'INR')`, itemID, outletID, catID)
	require.NoError(t, err)

	gw := paymentgw.NewMockProvider("deliv_key_sec", "deliv_wh_sec")
	tokens := auth.NewTokenManager("delivery-test-secret-32-chars!!", 15*time.Minute, 7*24*time.Hour)
	cartRepo := cart.NewRepository(pool, "delivery-quote-sec")
	orderRepo := orders.NewRepository(pool, cartRepo, "delivery-otp-secret")
	restRepo := restaurants.NewRepository(pool)
	payRepo := payments.NewRepository(pool, gw)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.CorrelationID())
	v1 := r.Group("/api/v1")
	orders.NewHandler(orderRepo, restRepo, tokens, nil).RegisterRoutes(v1)
	delivH := delivery.NewHandler(pool, tokens, nil)
	delivH.SetOTPSecret("delivery-otp-secret")
	delivH.RegisterRoutes(v1)

	tokOwner, _, _, _ := tokens.IssueAccessToken(ownerID, []string{"OUTLET_OWNER"}, nil)
	tokPartner, _, _, _ := tokens.IssueAccessToken(partnerUserID, []string{"DELIVERY_PARTNER"}, nil)

	// 1. Create & pay ONLINE order -> KDS Accept + Start preparing (both POST & PATCH) + Mark ready
	_, err = cartRepo.AddItem(ctx, custID, outletID, itemID, 1, nil, true)
	require.NoError(t, err)
	onlineOrd, _, err := orderRepo.CreateOrder(ctx, custID, "deliv-online-"+uuid.NewString(), addrID, "ONLINE", 0, "")
	require.NoError(t, err)
	_, err = payRepo.SandboxCapturePayment(ctx, custID, onlineOrd.ID)
	require.NoError(t, err)

	reqAcc := httptest.NewRequest(http.MethodPost, "/api/v1/restaurant/orders/"+onlineOrd.ID+"/accept", bytes.NewReader([]byte(`{"estimated_prep_minutes":15}`)))
	reqAcc.Header.Set("Authorization", "Bearer "+tokOwner)
	wAcc := httptest.NewRecorder()
	r.ServeHTTP(wAcc, reqAcc)
	require.Equal(t, http.StatusOK, wAcc.Code)

	reqPrep := httptest.NewRequest(http.MethodPatch, "/api/v1/restaurant/orders/"+onlineOrd.ID+"/status", bytes.NewReader([]byte(`{"next_status":"PREPARING"}`)))
	reqPrep.Header.Set("Authorization", "Bearer "+tokOwner)
	wPrep := httptest.NewRecorder()
	r.ServeHTTP(wPrep, reqPrep)
	require.Equal(t, http.StatusOK, wPrep.Code)

	reqReady := httptest.NewRequest(http.MethodPost, "/api/v1/restaurant/orders/"+onlineOrd.ID+"/status", bytes.NewReader([]byte(`{"next_status":"READY_FOR_PICKUP"}`)))
	reqReady.Header.Set("Authorization", "Bearer "+tokOwner)
	wReady := httptest.NewRecorder()
	r.ServeHTTP(wReady, reqReady)
	require.Equal(t, http.StatusOK, wReady.Code)

	// 2. Partner sees offer, accepts, progresses -> OTP is empty until ARRIVED_AT_CUSTOMER!
	reqOffers := httptest.NewRequest(http.MethodGet, "/api/v1/delivery/offers", nil)
	reqOffers.Header.Set("Authorization", "Bearer "+tokPartner)
	wOffers := httptest.NewRecorder()
	r.ServeHTTP(wOffers, reqOffers)
	require.Equal(t, http.StatusOK, wOffers.Code)
	assert.Contains(t, wOffers.Body.String(), onlineOrd.ID)

	reqTake := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/offers/"+onlineOrd.ID+"/accept", nil)
	reqTake.Header.Set("Authorization", "Bearer "+tokPartner)
	wTake := httptest.NewRecorder()
	r.ServeHTTP(wTake, reqTake)
	require.Equal(t, http.StatusOK, wTake.Code)

	for _, st := range []string{"ARRIVED_AT_RESTAURANT", "PICKED_UP", "OUT_FOR_DELIVERY"} {
		body, _ := json.Marshal(map[string]any{"stage": st})
		rq := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/orders/"+onlineOrd.ID+"/stage", bytes.NewReader(body))
		rq.Header.Set("Authorization", "Bearer "+tokPartner)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, rq)
		require.Equal(t, http.StatusOK, w.Code)
	}
	beforeArrival, err := orderRepo.GetOrderByID(ctx, onlineOrd.ID)
	require.NoError(t, err)
	assert.Empty(t, beforeArrival.DeliveryOTPHint)

	// Mark ARRIVED_AT_CUSTOMER -> OTP generated now!
	arrBody, _ := json.Marshal(map[string]any{"stage": "ARRIVED_AT_CUSTOMER"})
	reqArr := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/orders/"+onlineOrd.ID+"/stage", bytes.NewReader(arrBody))
	reqArr.Header.Set("Authorization", "Bearer "+tokPartner)
	wArr := httptest.NewRecorder()
	r.ServeHTTP(wArr, reqArr)
	require.Equal(t, http.StatusOK, wArr.Code)

	atLocation, err := orderRepo.GetOrderByID(ctx, onlineOrd.ID)
	require.NoError(t, err)
	assert.Regexp(t, `^[1-9]\d{3}$`, atLocation.DeliveryOTPHint)

	// Wrong OTP fails; right OTP completes delivery!
	badDeliv, _ := json.Marshal(map[string]any{"stage": "DELIVERED", "otp": "0000"})
	reqBad := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/orders/"+onlineOrd.ID+"/stage", bytes.NewReader(badDeliv))
	reqBad.Header.Set("Authorization", "Bearer "+tokPartner)
	wBad := httptest.NewRecorder()
	r.ServeHTTP(wBad, reqBad)
	assert.Equal(t, http.StatusBadRequest, wBad.Code)

	goodDeliv, _ := json.Marshal(map[string]any{"stage": "DELIVERED", "otp": atLocation.DeliveryOTPHint})
	reqGood := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/orders/"+onlineOrd.ID+"/stage", bytes.NewReader(goodDeliv))
	reqGood.Header.Set("Authorization", "Bearer "+tokPartner)
	wGood := httptest.NewRecorder()
	r.ServeHTTP(wGood, reqGood)
	require.Equal(t, http.StatusOK, wGood.Code)

	// 3. COD order: NO OTP even on ARRIVED_AT_CUSTOMER, completes directly!
	_, err = cartRepo.AddItem(ctx, custID, outletID, itemID, 1, nil, true)
	require.NoError(t, err)
	codOrd, _, err := orderRepo.CreateOrder(ctx, custID, "deliv-cod-"+uuid.NewString(), addrID, "COD", 0, "")
	require.NoError(t, err)

	reqCodAcc := httptest.NewRequest(http.MethodPost, "/api/v1/restaurant/orders/"+codOrd.ID+"/accept", bytes.NewReader([]byte(`{"estimated_prep_minutes":15}`)))
	reqCodAcc.Header.Set("Authorization", "Bearer "+tokOwner)
	r.ServeHTTP(httptest.NewRecorder(), reqCodAcc)

	reqCodTake := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/offers/"+codOrd.ID+"/accept", nil)
	reqCodTake.Header.Set("Authorization", "Bearer "+tokPartner)
	r.ServeHTTP(httptest.NewRecorder(), reqCodTake)

	for _, st := range []string{"PICKED_UP", "ARRIVED_AT_CUSTOMER"} {
		body, _ := json.Marshal(map[string]any{"stage": st})
		rq := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/orders/"+codOrd.ID+"/stage", bytes.NewReader(body))
		rq.Header.Set("Authorization", "Bearer "+tokPartner)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, rq)
		require.Equal(t, http.StatusOK, w.Code)
	}
	codAtLoc, err := orderRepo.GetOrderByID(ctx, codOrd.ID)
	require.NoError(t, err)
	assert.Empty(t, codAtLoc.DeliveryOTPHint)

	codDelivBody, _ := json.Marshal(map[string]any{"stage": "DELIVERED"})
	reqCodDone := httptest.NewRequest(http.MethodPost, "/api/v1/delivery/orders/"+codOrd.ID+"/stage", bytes.NewReader(codDelivBody))
	reqCodDone.Header.Set("Authorization", "Bearer "+tokPartner)
	wCodDone := httptest.NewRecorder()
	r.ServeHTTP(wCodDone, reqCodDone)
	require.Equal(t, http.StatusOK, wCodDone.Code)
}
