package orders_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/cart"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/discovery"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/menu"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/orders"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/telemetry"
)

func TestPhase3DiscoveryInventoryIdempotencyRacesAndTimeoutIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping Phase 3 live DB/Redis concurrency tests in -short mode")
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	rdb, err := platformredis.NewClient(ctx, redisAddr, "")
	require.NoError(t, err)
	defer rdb.Close()

	// Seed isolated test zone, users, outlet, and finite-stock menu item (available_quantity = 1)
	zoneID := uuid.NewString()
	ownerID := uuid.NewString()
	cust1ID := uuid.NewString()
	cust2ID := uuid.NewString()
	addr1ID := uuid.NewString()
	addr2ID := uuid.NewString()
	outletID := uuid.NewString()
	catID := uuid.NewString()
	limitedItemID := uuid.NewString()
	outletSlug := "phase3-kitchen-" + outletID[:6]

	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active, base_delivery_fee_minor, min_cart_threshold_minor, small_cart_fee_minor)
		VALUES ($1, $2, 'Bengaluru, KA', 'Asia/Kolkata', 'INR',
		        ST_GeogFromText('POLYGON((77.5700 12.9000, 77.7000 12.9000, 77.7000 13.0200, 77.5700 13.0200, 77.5700 12.9000))'),
		        TRUE, 2900, 29900, 2900)
	`, zoneID, "Phase3-Zone-"+zoneID[:8])
	require.NoError(t, err)

	pwHash, _ := auth.HashPassword("Password#123")
	for _, u := range []struct {
		id, email, phone, role string
	}{
		{ownerID, "owner-" + ownerID[:6] + "@test.local", "+91-80001-" + ownerID[:5], "OUTLET_OWNER"},
		{cust1ID, "c1-" + cust1ID[:6] + "@test.local", "+91-80002-" + cust1ID[:5], "CUSTOMER"},
		{cust2ID, "c2-" + cust2ID[:6] + "@test.local", "+91-80003-" + cust2ID[:5], "CUSTOMER"},
	} {
		_, err = pool.Exec(ctx, `
			INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
			VALUES ($1, $2, $3, $4, 'Test User', TRUE, TRUE, 'ACTIVE')
		`, u.id, u.email, u.phone, pwHash)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2
		`, u.id, u.role)
		require.NoError(t, err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO customer_addresses (id, user_id, label, recipient_name, recipient_phone, address_line1, city, state, postal_code, country_code, location, is_default)
		VALUES
		($1, $2, 'Home', 'Cust 1', '+91-80002', '100 Ft Rd Indiranagar', 'Bengaluru', 'KA', '560038', 'IN', ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography, TRUE),
		($3, $4, 'Home', 'Cust 2', '+91-80003', '12th Main Indiranagar', 'Bengaluru', 'KA', '560038', 'IN', ST_SetSRID(ST_MakePoint(77.6412, 12.9779), 4326)::geography, TRUE)
	`, addr1ID, cust1ID, addr2ID, cust2ID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `
		INSERT INTO restaurants (id, owner_user_id, service_zone_id, slug, name, cuisines, phone, email, address_line1, city, state, postal_code, location, verification_status, is_active, is_accepting_orders, max_concurrent_orders, packaging_fee_minor, commission_rate_bps)
		VALUES ($1, $2, $3, $4, 'Phase 3 Kitchen', ARRAY['Italian'], '+91-80001', 'k@test.local', '241 Indiranagar', 'Bengaluru', 'KA', '560038',
		        ST_SetSRID(ST_MakePoint(77.6400, 12.9780), 4326)::geography, 'APPROVED', TRUE, TRUE, 10, 2000, 2000)
	`, outletID, ownerID, zoneID, outletSlug)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `INSERT INTO menu_categories (id, restaurant_id, name, display_order) VALUES ($1, $2, 'Main', 1)`, catID, outletID)
	require.NoError(t, err)

	// Finite stock = 1
	_, err = pool.Exec(ctx, `
		INSERT INTO menu_items (id, restaurant_id, category_id, name, description, base_price_minor, currency)
		VALUES ($1, $2, $3, 'Limited Truffle Pasta', 'Last portion tonight', 45000, 'INR')
	`, limitedItemID, outletID, catID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO menu_item_inventory (menu_item_id, track_inventory, available_quantity) VALUES ($1, TRUE, 1)
	`, limitedItemID)
	require.NoError(t, err)

	// Build router
	gin.SetMode(gin.TestMode)
	tokens := auth.NewTokenManager("phase3-integration-secret-32-chars", 15*time.Minute, 7*24*time.Hour)
	restRepo := restaurants.NewRepository(pool)
	menuRepo := menu.NewRepository(pool, rdb)
	discRepo := discovery.NewRepository(pool, menuRepo, rdb)
	cartRepo := cart.NewRepository(pool, "phase3-quote-secret")
	orderRepo := orders.NewRepository(pool, cartRepo, "phase3-otp-secret")

	r := gin.New()
	r.Use(middleware.CorrelationID())
	v1 := r.Group("/api/v1")
	restaurants.NewHandler(restRepo, tokens, rdb).RegisterRoutes(v1)
	menu.NewHandler(menuRepo, restRepo, tokens, rdb).RegisterRoutes(v1)
	discovery.NewHandler(discRepo).RegisterRoutes(v1)
	cart.NewHandler(cartRepo, tokens, rdb).RegisterRoutes(v1)
	orders.NewHandler(orderRepo, restRepo, tokens, rdb).RegisterRoutes(v1)

	tokCust1, _, _, _ := tokens.IssueAccessToken(cust1ID, []string{"CUSTOMER"}, nil)
	tokCust2, _, _, _ := tokens.IssueAccessToken(cust2ID, []string{"CUSTOMER"}, nil)
	tokOwner, _, _, _ := tokens.IssueAccessToken(ownerID, []string{"OUTLET_OWNER"}, nil)

	// 1. PostGIS Serviceability check (Inside Indiranagar vs Outside Mysuru Rd)
	wIn := httptest.NewRecorder()
	r.ServeHTTP(wIn, httptest.NewRequest(http.MethodGet, "/api/v1/discovery/serviceability?lat=12.9784&lng=77.6408", nil))
	assert.Equal(t, http.StatusOK, wIn.Code)
	assert.Contains(t, wIn.Body.String(), `"serviceable":true`)

	wOut := httptest.NewRecorder()
	r.ServeHTTP(wOut, httptest.NewRequest(http.MethodGet, "/api/v1/discovery/serviceability?lat=12.7200&lng=77.2800", nil))
	assert.Equal(t, http.StatusOK, wOut.Code)
	assert.Contains(t, wOut.Body.String(), `"serviceable":false`)

	// 2. Redis Menu Cache population & instant invalidation on availability toggle
	wMenu1 := httptest.NewRecorder()
	r.ServeHTTP(wMenu1, httptest.NewRequest(http.MethodGet, "/api/v1/restaurants/"+outletSlug, nil))
	require.Equal(t, http.StatusOK, wMenu1.Code)
	cachedBefore, err := rdb.Raw().Exists(ctx, "menu:slug:"+outletSlug).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(1), cachedBefore)

	toggleBody, _ := json.Marshal(map[string]any{"is_available": false})
	reqToggle := httptest.NewRequest(http.MethodPatch, "/api/v1/menu/items/"+limitedItemID+"/availability?outlet_id="+outletID, bytes.NewReader(toggleBody))
	reqToggle.Header.Set("Authorization", "Bearer "+tokOwner)
	wToggle := httptest.NewRecorder()
	r.ServeHTTP(wToggle, reqToggle)
	require.Equal(t, http.StatusOK, wToggle.Code)

	cachedAfterToggle, _ := rdb.Raw().Exists(ctx, "menu:slug:"+outletSlug).Result()
	assert.Equal(t, int64(0), cachedAfterToggle)

	// Restore item availability for checkout concurrency test
	toggleBack, _ := json.Marshal(map[string]any{"is_available": true, "available_quantity": 1})
	reqToggleBack := httptest.NewRequest(http.MethodPatch, "/api/v1/menu/items/"+limitedItemID+"/availability?outlet_id="+outletID, bytes.NewReader(toggleBack))
	reqToggleBack.Header.Set("Authorization", "Bearer "+tokOwner)
	r.ServeHTTP(httptest.NewRecorder(), reqToggleBack)

	// 3. Both Customer 1 and Customer 2 add the limited (qty=1) dish to their carts
	for _, tc := range []struct{ tok string }{
		{tokCust1},
		{tokCust2},
	} {
		addBody, _ := json.Marshal(map[string]any{
			"restaurant_id": outletID,
			"menu_item_id":  limitedItemID,
			"quantity":      1,
		})
		reqAdd := httptest.NewRequest(http.MethodPost, "/api/v1/cart/items", bytes.NewReader(addBody))
		reqAdd.Header.Set("Authorization", "Bearer "+tc.tok)
		wAdd := httptest.NewRecorder()
		r.ServeHTTP(wAdd, reqAdd)
		require.Equal(t, http.StatusOK, wAdd.Code)
	}

	// 4. Concurrency Race: 2 customers checkout simultaneously for available_quantity = 1
	// Expect EXACTLY ONE 201 Created and ONE 409 ITEM_OUT_OF_STOCK!
	var wg sync.WaitGroup
	var codes [2]int
	var winnerOrderID string
	var winnerTok, winnerAddr string
	var mu sync.Mutex

	clients := []struct {
		tok  string
		addr string
		key  string
	}{
		{tokCust1, addr1ID, "race-key-1-" + uuid.NewString()},
		{tokCust2, addr2ID, "race-key-2-" + uuid.NewString()},
	}

	for idx, cl := range clients {
		wg.Add(1)
		go func(i int, tok, addr, key string) {
			defer wg.Done()
			body, _ := json.Marshal(map[string]any{
				"delivery_address_id": addr,
				"payment_method":      "COD",
			})
			req := httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+tok)
			req.Header.Set("Idempotency-Key", key)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			mu.Lock()
			codes[i] = w.Code
			if w.Code == http.StatusCreated {
				var resp struct {
					Data struct {
						Order struct {
							ID string `json:"id"`
						} `json:"order"`
					} `json:"data"`
				}
				_ = json.Unmarshal(w.Body.Bytes(), &resp)
				winnerOrderID = resp.Data.Order.ID
				winnerTok = tok
				winnerAddr = addr
			}
			mu.Unlock()
		}(idx, cl.tok, cl.addr, cl.key)
	}
	wg.Wait()

	createdCount := 0
	conflictCount := 0
	for _, c := range codes {
		if c == http.StatusCreated {
			createdCount++
		} else if c == http.StatusConflict {
			conflictCount++
		}
	}
	assert.Equal(t, 1, createdCount, "exactly 1 concurrent order must claim the last portion")
	assert.Equal(t, 1, conflictCount, "second concurrent order must receive 409 ITEM_OUT_OF_STOCK")
	require.NotEmpty(t, winnerOrderID)

	// 5. Idempotency replay check for winning customer using a second item
	idempItemID := uuid.NewString()
	_, err = pool.Exec(ctx, `INSERT INTO menu_items (id, restaurant_id, category_id, name, base_price_minor, currency) VALUES ($1, $2, $3, 'Tiramisu', 32000, 'INR')`, idempItemID, outletID, catID)
	require.NoError(t, err)
	addSecond, _ := json.Marshal(map[string]any{"restaurant_id": outletID, "menu_item_id": idempItemID, "quantity": 1})
	reqAdd2 := httptest.NewRequest(http.MethodPost, "/api/v1/cart/items", bytes.NewReader(addSecond))
	reqAdd2.Header.Set("Authorization", "Bearer "+winnerTok)
	r.ServeHTTP(httptest.NewRecorder(), reqAdd2)

	idempKey := "idemp-test-" + uuid.NewString()
	ordBody2, _ := json.Marshal(map[string]any{"delivery_address_id": winnerAddr, "payment_method": "COD"})
	reqOrd1 := httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewReader(ordBody2))
	reqOrd1.Header.Set("Authorization", "Bearer "+winnerTok)
	reqOrd1.Header.Set("Idempotency-Key", idempKey)
	wOrd1 := httptest.NewRecorder()
	r.ServeHTTP(wOrd1, reqOrd1)
	require.Equal(t, http.StatusCreated, wOrd1.Code)

	reqOrdDup := httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewReader(ordBody2))
	reqOrdDup.Header.Set("Authorization", "Bearer "+winnerTok)
	reqOrdDup.Header.Set("Idempotency-Key", idempKey)
	wOrdDup := httptest.NewRecorder()
	r.ServeHTTP(wOrdDup, reqOrdDup)
	require.Equal(t, http.StatusOK, wOrdDup.Code)
	assert.Contains(t, wOrdDup.Body.String(), `"idempotent_replay":true`)

	// 6. Concurrent Restaurant Accept vs Reject race on winnerOrderID
	var acceptCode, rejectCode int
	var wg2 sync.WaitGroup
	wg2.Add(2)
	go func() {
		defer wg2.Done()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/restaurants/me/orders/"+winnerOrderID+"/accept?outlet_id="+outletID, bytes.NewReader([]byte(`{"estimated_prep_minutes":20}`)))
		req.Header.Set("Authorization", "Bearer "+tokOwner)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		acceptCode = w.Code
	}()
	go func() {
		defer wg2.Done()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/restaurants/me/orders/"+winnerOrderID+"/reject?outlet_id="+outletID, bytes.NewReader([]byte(`{"reason_code":"KITCHEN_BUSY"}`)))
		req.Header.Set("Authorization", "Bearer "+tokOwner)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		rejectCode = w.Code
	}()
	wg2.Wait()
	assert.True(t,
		(acceptCode == http.StatusOK && rejectCode == http.StatusConflict) ||
			(rejectCode == http.StatusOK && acceptCode == http.StatusConflict),
		"accept vs reject race must allow exactly one 200 and one 409, got accept=%d reject=%d", acceptCode, rejectCode,
	)

	// 7. 5-Minute Acceptance Timeout Escalation -> Grace Period Expiry -> Outlet Penalty Worker Test
	var order2ID string
	err = pool.QueryRow(ctx, `SELECT id FROM orders WHERE customer_id = $1 AND id <> $2 LIMIT 1`, func() string {
		if winnerTok == tokCust1 {
			return cust1ID
		}
		return cust2ID
	}(), winnerOrderID).Scan(&order2ID)
	require.NoError(t, err)

	// Force accept_deadline_at into the past -> Stage 1 should alert Customer Care
	_, err = pool.Exec(ctx, `UPDATE orders SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, order2ID)
	require.NoError(t, err)

	tw := orders.NewTimeoutWorker(pool, telemetry.NewLogger("test-worker", "test"))
	alerted, penalized, err := tw.ProcessAcceptanceTimeouts(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, alerted, 1)
	assert.Equal(t, 0, penalized)

	// Force grace_deadline_at into the past -> Stage 2 should apply penalty row & cancel order
	_, err = pool.Exec(ctx, `UPDATE orders SET grace_deadline_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`, order2ID)
	require.NoError(t, err)

	_, penalized2, err := tw.ProcessAcceptanceTimeouts(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, penalized2, 1)

	var penCount int
	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM outlet_penalties WHERE order_id = $1 AND status = 'APPLIED'`, order2ID).Scan(&penCount)
	require.NoError(t, err)
	assert.Equal(t, 1, penCount)
}
