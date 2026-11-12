package payments_test

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
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/cart"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/orders"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/payments"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/paymentgw"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/telemetry"
)

func TestCommissionCalculationBasesAndPartnerEarnings(t *testing.T) {
	// 20% commission across all 3 Admin-configurable bases
	base1, comm1 := payments.ComputeCommission("GROSS_FOOD_SUBTOTAL", 100000, 10000, 5000, 2000)
	assert.Equal(t, int64(100000), base1)
	assert.Equal(t, int64(20000), comm1) // 20% of ₹1000 = ₹200

	base2, comm2 := payments.ComputeCommission("NET_AFTER_OUTLET_DISCOUNT", 100000, 10000, 5000, 2000)
	assert.Equal(t, int64(90000), base2)
	assert.Equal(t, int64(18000), comm2)

	base3, comm3 := payments.ComputeCommission("SUBTOTAL_PLUS_PACKAGING", 100000, 10000, 5000, 2000)
	assert.Equal(t, int64(105000), base3)
	assert.Equal(t, int64(21000), comm3)

	// Base ₹35 + ₹10/km for 2.5km = ₹60 + ₹20 tip = ₹80
	distPay, gross, net := payments.ComputePartnerDistanceEarning(3500, 1000, 2500, 2000, 0)
	assert.Equal(t, int64(2500), distPay)
	assert.Equal(t, int64(8000), gross)
	assert.Equal(t, int64(8000), net)
}

func TestPhase4WebhooksReconciliationRefundsAndLedgersIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping Phase 4 live DB integration tests in -short mode")
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	// Setup isolated test data
	zoneID := uuid.NewString()
	ownerID := uuid.NewString()
	custID := uuid.NewString()
	adminID := uuid.NewString()
	addrID := uuid.NewString()
	outletID := uuid.NewString()
	catID := uuid.NewString()
	itemID := uuid.NewString()

	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active, base_delivery_fee_minor, min_cart_threshold_minor, small_cart_fee_minor)
		VALUES ($1, $2, 'Bengaluru, KA', 'Asia/Kolkata', 'INR',
		        ST_GeogFromText('POLYGON((77.5700 12.9000, 77.7000 12.9000, 77.7000 13.0200, 77.5700 13.0200, 77.5700 12.9000))'),
		        TRUE, 2900, 29900, 2900)
	`, zoneID, "Phase4-Zone-"+zoneID[:8])
	require.NoError(t, err)

	pwHash, _ := auth.HashPassword("Password#123")
	for _, u := range []struct{ id, email, phone, role string }{
		{ownerID, "p4owner-" + ownerID[:6] + "@test.local", "+91-70001-" + ownerID[:5], "OUTLET_OWNER"},
		{custID, "p4cust-" + custID[:6] + "@test.local", "+91-70002-" + custID[:5], "CUSTOMER"},
		{adminID, "p4admin-" + adminID[:6] + "@test.local", "+91-70003-" + adminID[:5], "PLATFORM_ADMIN"},
	} {
		_, err = pool.Exec(ctx, `
			INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
			VALUES ($1, $2, $3, $4, 'Phase 4 User', TRUE, TRUE, 'ACTIVE')
		`, u.id, u.email, u.phone, pwHash)
		require.NoError(t, err)
		_, _ = pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, u.id, u.role)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO customer_addresses (id, user_id, label, recipient_name, recipient_phone, address_line1, city, state, postal_code, country_code, location, is_default)
		VALUES ($1, $2, 'Home', 'Phase 4 Cust', '+91-70002', '100 Ft Rd Indiranagar', 'Bengaluru', 'KA', '560038', 'IN', ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography, TRUE)
	`, addrID, custID)
	require.NoError(t, err)

	_, err = pool.Exec(ctx, `
		INSERT INTO restaurants (id, owner_user_id, service_zone_id, slug, name, cuisines, phone, email, address_line1, city, state, postal_code, location, verification_status, is_active, is_accepting_orders, packaging_fee_minor, commission_rate_bps)
		VALUES ($1, $2, $3, $4, 'Phase 4 Kitchen', ARRAY['Italian'], '+91-70001', 'p4@test.local', '241 Indiranagar', 'Bengaluru', 'KA', '560038',
		        ST_SetSRID(ST_MakePoint(77.6400, 12.9780), 4326)::geography, 'APPROVED', TRUE, TRUE, 2000, 2000)
	`, outletID, ownerID, zoneID, "p4-kitchen-"+outletID[:6])
	require.NoError(t, err)

	_, _ = pool.Exec(ctx, `INSERT INTO menu_categories (id, restaurant_id, name, display_order) VALUES ($1, $2, 'Main', 1)`, catID, outletID)
	_, err = pool.Exec(ctx, `INSERT INTO menu_items (id, restaurant_id, category_id, name, base_price_minor, currency) VALUES ($1, $2, $3, 'Rigatoni', 45000, 'INR')`, itemID, outletID, catID)
	require.NoError(t, err)

	gw := paymentgw.NewMockProvider("p4_test_key_secret", "p4_test_webhook_secret")
	tokens := auth.NewTokenManager("phase4-integration-secret-32-chars", 15*time.Minute, 7*24*time.Hour)
	cartRepo := cart.NewRepository(pool, "phase4-quote-secret")
	orderRepo := orders.NewRepository(pool, cartRepo, "phase4-otp-secret")
	payRepo := payments.NewRepository(pool, gw)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.CorrelationID())
	v1 := r.Group("/api/v1")
	payHandler := payments.NewHandler(payRepo, gw, tokens, nil)
	payHandler.SetSandboxEnabled(true)
	payHandler.SetReconciler(payments.NewReconciler(pool, payRepo, gw, telemetry.NewLogger("test-handler", "test")))
	payHandler.RegisterRoutes(v1)

	tokCust, _, _, _ := tokens.IssueAccessToken(custID, []string{"CUSTOMER"}, nil)
	tokAdmin, _, _, _ := tokens.IssueAccessToken(adminID, []string{"PLATFORM_ADMIN"}, []string{"refunds:approve"})
	tokCare, _, _, _ := tokens.IssueAccessToken(uuid.NewString(), []string{"CUSTOMER_CARE"}, []string{"complaints:resolve"})

	// Helper to create an ONLINE PENDING_PAYMENT order + payment session
	createOnlineOrder := func() (orderID string, providerOrderID string, totalMinor int64) {
		_, aErr := cartRepo.AddItem(ctx, custID, outletID, itemID, 1, nil, true)
		require.NoError(t, aErr)
		ord, _, cErr := orderRepo.CreateOrder(ctx, custID, "p4-key-"+uuid.NewString(), addrID, "ONLINE", 0, "")
		require.NoError(t, cErr)
		assert.Equal(t, "PENDING_PAYMENT", ord.OrderStatus)

		sess, sErr := payRepo.InitiatePaymentSession(ctx, custID, ord.ID)
		require.NoError(t, sErr)
		return ord.ID, sess.ProviderOrderID, ord.Breakdown.TotalPayableMinor
	}

	// 1. Tampered Webhook Signature MUST return 401
	order1ID, provOrder1ID, total1 := createOnlineOrder()
	evtBody, _ := json.Marshal(map[string]any{
		"event":    "payment.captured",
		"event_id": "evt_concurrent_" + uuid.NewString()[:8],
		"payload": map[string]any{
			"payment": map[string]any{
				"entity": map[string]any{
					"id":       "pay_mock_" + uuid.NewString()[:8],
					"order_id": provOrder1ID,
					"amount":   total1,
					"method":   "upi",
				},
			},
		},
	})

	reqTamper := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhooks/razorpay", bytes.NewReader(evtBody))
	reqTamper.Header.Set("X-Razorpay-Signature", "tampered_bad_hmac_signature")
	wTamper := httptest.NewRecorder()
	r.ServeHTTP(wTamper, reqTamper)
	assert.Equal(t, http.StatusUnauthorized, wTamper.Code)

	// 2. Replay exact same payment.captured webhook 10 times concurrently -> single state transition, single ledger entry, single outbox event
	validSig := gw.SignWebhook(evtBody)
	var wg sync.WaitGroup
	var okCount int
	var mu sync.Mutex
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhooks/razorpay", bytes.NewReader(evtBody))
			req.Header.Set("X-Razorpay-Signature", validSig)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code == http.StatusOK {
				mu.Lock()
				okCount++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	assert.Equal(t, 10, okCount)

	var payTxCount, ledgerCount, outboxConfirmedCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM payment_transactions pt JOIN payments p ON p.id = pt.payment_id WHERE p.order_id = $1`, order1ID).Scan(&payTxCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM financial_ledger_entries WHERE order_id = $1 AND reference_type = 'PAYMENT_CAPTURE'`, order1ID).Scan(&ledgerCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'order.confirmed'`, order1ID).Scan(&outboxConfirmedCount)
	assert.Equal(t, 1, payTxCount, "webhook deduplication must insert strictly 1 transaction row")
	assert.Equal(t, 1, ledgerCount, "must record strictly 1 PAYMENT_CAPTURE ledger row")
	assert.Equal(t, 1, outboxConfirmedCount, "must emit strictly 1 order.confirmed outbox event")

	var ord1Status, pay1Status string
	_ = pool.QueryRow(ctx, `SELECT order_status, payment_status FROM orders WHERE id = $1`, order1ID).Scan(&ord1Status, &pay1Status)
	assert.Equal(t, "CONFIRMED", ord1Status)
	assert.Equal(t, "CAPTURED", pay1Status)

	// 3. Refund RBAC & Double-Refund Prevention
	// CUSTOMER_CARE without refunds:approve gets 403
	refBody, _ := json.Marshal(map[string]any{"order_id": order1ID, "amount_minor": 10000, "reason_code": "MISSING_ITEM", "notes": "Partial refund"})
	reqCareRef := httptest.NewRequest(http.MethodPost, "/api/v1/admin/refunds", bytes.NewReader(refBody))
	reqCareRef.Header.Set("Authorization", "Bearer "+tokCare)
	reqCareRef.Header.Set("Idempotency-Key", "ref-care-"+uuid.NewString())
	wCareRef := httptest.NewRecorder()
	r.ServeHTTP(wCareRef, reqCareRef)
	assert.Equal(t, http.StatusForbidden, wCareRef.Code)

	// PLATFORM_ADMIN refunds remaining minus 100 -> partial refund succeeds
	reqAdminRef1 := httptest.NewRequest(http.MethodPost, "/api/v1/admin/refunds", bytes.NewReader(refBody))
	reqAdminRef1.Header.Set("Authorization", "Bearer "+tokAdmin)
	reqAdminRef1.Header.Set("Idempotency-Key", "ref-adm-1-"+uuid.NewString())
	wAdminRef1 := httptest.NewRecorder()
	r.ServeHTTP(wAdminRef1, reqAdminRef1)
	require.Equal(t, http.StatusCreated, wAdminRef1.Code)

	// Attempt to refund full amount again (double-refund exceeds remaining balance) -> 400 REFUND_EXCEEDS_BALANCE
	overRefBody, _ := json.Marshal(map[string]any{"order_id": order1ID, "amount_minor": total1, "reason_code": "DUPLICATE_ATTEMPT"})
	reqAdminRefOver := httptest.NewRequest(http.MethodPost, "/api/v1/admin/refunds", bytes.NewReader(overRefBody))
	reqAdminRefOver.Header.Set("Authorization", "Bearer "+tokAdmin)
	reqAdminRefOver.Header.Set("Idempotency-Key", "ref-adm-over-"+uuid.NewString())
	wAdminRefOver := httptest.NewRecorder()
	r.ServeHTTP(wAdminRefOver, reqAdminRefOver)
	assert.Equal(t, http.StatusBadRequest, wAdminRefOver.Code)

	// 4. Simulated Lost Webhook -> Active Background Reconciler Recovers Payment
	order2ID, provOrder2ID, total2 := createOnlineOrder()
	gw.SeedUpstreamPayment(paymentgw.GatewayPaymentSnapshot{
		ProviderOrderID:   provOrder2ID,
		ProviderPaymentID: "pay_lost_webhook_" + uuid.NewString()[:8],
		Status:            "captured",
		Method:            "upi",
		AmountMinor:       total2,
	})
	rec := payments.NewReconciler(pool, payRepo, gw, telemetry.NewLogger("test-reconciler", "test"))
	recovered, err := rec.ReconcileOnce(ctx, 0)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, recovered, 1)

	var ord2Status, pay2Status string
	var recAt *time.Time
	_ = pool.QueryRow(ctx, `SELECT o.order_status, p.status, p.reconciled_at FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`, order2ID).Scan(&ord2Status, &pay2Status, &recAt)
	assert.Equal(t, "CONFIRMED", ord2Status)
	assert.Equal(t, "CAPTURED", pay2Status)
	assert.NotNil(t, recAt)

	// 5. Late Webhook arriving AFTER Order Cancellation -> Automatically queues FULL Refund
	order3ID, provOrder3ID, total3 := createOnlineOrder()
	reqCancel := httptest.NewRequest(http.MethodPost, "/api/v1/orders/"+order3ID+"/cancel", nil)
	reqCancel.Header.Set("Authorization", "Bearer "+tokCust)
	_, cErr := orderRepo.CancelOrder(ctx, custID, order3ID, "Customer timed out")
	require.NoError(t, cErr)
	_ = reqCancel

	lateEvt, _ := json.Marshal(map[string]any{
		"event":    "payment.captured",
		"event_id": "evt_late_" + uuid.NewString()[:8],
		"payload": map[string]any{
			"payment": map[string]any{
				"entity": map[string]any{
					"id":       "pay_late_" + uuid.NewString()[:8],
					"order_id": provOrder3ID,
					"amount":   total3,
					"method":   "card",
				},
			},
		},
	})
	reqLate := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhooks/razorpay", bytes.NewReader(lateEvt))
	reqLate.Header.Set("X-Razorpay-Signature", gw.SignWebhook(lateEvt))
	wLate := httptest.NewRecorder()
	r.ServeHTTP(wLate, reqLate)
	require.Equal(t, http.StatusOK, wLate.Code)

	var lateReason, ord3Status string
	_ = pool.QueryRow(ctx, `SELECT o.order_status, rf.reason_code FROM orders o JOIN refunds rf ON rf.order_id = o.id WHERE o.id = $1`, order3ID).Scan(&ord3Status, &lateReason)
	assert.Equal(t, "CANCELLED", ord3Status)
	assert.Equal(t, "LATE_PAYMENT_AFTER_CANCEL", lateReason)

	// 6. Settlement Accrual & 20% Commission Ledger Verification
	require.NoError(t, database.WithTx(ctx, pool, func(tx pgx.Tx) error {
		return payments.AccrueDeliveryFinancials(ctx, tx, order1ID, "", "")
	}))
	var commBps int
	var commMinor, settleAmt int64
	_ = pool.QueryRow(ctx, `SELECT platform_commission_bps, platform_commission_minor, net_payout_minor FROM restaurant_settlements WHERE order_id = $1`, order1ID).Scan(&commBps, &commMinor, &settleAmt)
	assert.Equal(t, 2000, commBps)
	assert.Equal(t, int64(9000), commMinor)  // 20% of ₹450 (45000 paise)
	assert.Equal(t, int64(38000), settleAmt) // 45000 + 2000 packaging - 9000 commission

	// 7. Automated PENDING Refund Settlement via ProcessPendingRefunds / POST /admin/payments/reconcile
	processedRefunds, err := rec.ProcessPendingRefunds(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, processedRefunds, 1)

	var ord3PayStatus, ref3Status string
	var provRef3ID *string
	_ = pool.QueryRow(ctx, `SELECT o.payment_status, rf.status, rf.provider_refund_id FROM orders o JOIN refunds rf ON rf.order_id = o.id WHERE o.id = $1`, order3ID).Scan(&ord3PayStatus, &ref3Status, &provRef3ID)
	assert.Equal(t, "REFUNDED", ord3PayStatus)
	assert.Equal(t, "PROCESSED", ref3Status)
	assert.NotNil(t, provRef3ID)

	// 8. Sandbox Decline -> Retry Capture flow & PublicKey on Retry Initiate
	order4ID, _, _ := createOnlineOrder()
	sessRetry, rErr := payRepo.InitiatePaymentSession(ctx, custID, order4ID)
	require.NoError(t, rErr)
	assert.NotEmpty(t, sessRetry.PublicKey)

	failBody, _ := json.Marshal(map[string]any{"order_id": order4ID, "reason": "Insufficient balance"})
	reqFail := httptest.NewRequest(http.MethodPost, "/api/v1/customer/payments/sandbox-fail", bytes.NewReader(failBody))
	reqFail.Header.Set("Authorization", "Bearer "+tokCust)
	reqFail.Header.Set("Content-Type", "application/json")
	wFail := httptest.NewRecorder()
	r.ServeHTTP(wFail, reqFail)
	require.Equal(t, http.StatusOK, wFail.Code)

	var pay4Status, ord4Status string
	var failMsg *string
	_ = pool.QueryRow(ctx, `SELECT p.status, p.failure_message, o.order_status FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.id = $1`, order4ID).Scan(&pay4Status, &failMsg, &ord4Status)
	assert.Equal(t, "FAILED", pay4Status)
	assert.Equal(t, "PENDING_PAYMENT", ord4Status)
	require.NotNil(t, failMsg)
	assert.Equal(t, "Insufficient balance", *failMsg)

	capBody, _ := json.Marshal(map[string]any{"order_id": order4ID})
	reqCap := httptest.NewRequest(http.MethodPost, "/api/v1/customer/payments/sandbox-capture", bytes.NewReader(capBody))
	reqCap.Header.Set("Authorization", "Bearer "+tokCust)
	reqCap.Header.Set("Content-Type", "application/json")
	wCap := httptest.NewRecorder()
	r.ServeHTTP(wCap, reqCap)
	require.Equal(t, http.StatusOK, wCap.Code)

	_ = pool.QueryRow(ctx, `SELECT p.status, p.failure_message, o.order_status FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.id = $1`, order4ID).Scan(&pay4Status, &failMsg, &ord4Status)
	assert.Equal(t, "CAPTURED", pay4Status)
	assert.Equal(t, "CONFIRMED", ord4Status)
	assert.Nil(t, failMsg)

	// 9. Admin GET /admin/payments + POST /admin/payments/reconcile RBAC & Payload
	reqAdminListUnauth := httptest.NewRequest(http.MethodGet, "/api/v1/admin/payments", nil)
	reqAdminListUnauth.Header.Set("Authorization", "Bearer "+tokCare)
	wAdminListUnauth := httptest.NewRecorder()
	r.ServeHTTP(wAdminListUnauth, reqAdminListUnauth)
	assert.Equal(t, http.StatusForbidden, wAdminListUnauth.Code)

	reqAdminList := httptest.NewRequest(http.MethodGet, "/api/v1/admin/payments", nil)
	reqAdminList.Header.Set("Authorization", "Bearer "+tokAdmin)
	wAdminList := httptest.NewRecorder()
	r.ServeHTTP(wAdminList, reqAdminList)
	require.Equal(t, http.StatusOK, wAdminList.Code)

	var listResp struct {
		Data struct {
			Payments []map[string]any `json:"payments"`
			Refunds  []map[string]any `json:"refunds"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(wAdminList.Body.Bytes(), &listResp))
	assert.GreaterOrEqual(t, len(listResp.Data.Payments), 4)
	assert.GreaterOrEqual(t, len(listResp.Data.Refunds), 2)

	reqAdminRec := httptest.NewRequest(http.MethodPost, "/api/v1/admin/payments/reconcile", nil)
	reqAdminRec.Header.Set("Authorization", "Bearer "+tokAdmin)
	wAdminRec := httptest.NewRecorder()
	r.ServeHTTP(wAdminRec, reqAdminRec)
	require.Equal(t, http.StatusOK, wAdminRec.Code)

	// 10. Delivery OTP MUST NOT be generated at payment capture or restaurant accept
	// (it is generated when the delivery partner marks ARRIVED_AT_CUSTOMER for ONLINE Paid orders).
	onlineOrd, gErr := orderRepo.GetOrderByID(ctx, order4ID)
	require.NoError(t, gErr)
	assert.Empty(t, onlineOrd.DeliveryOTPHint)

	acceptedOnline, otpAccepted, aErr := orderRepo.AcceptOrder(ctx, outletID, order4ID, ownerID, 20)
	require.NoError(t, aErr)
	assert.Empty(t, otpAccepted)
	assert.Empty(t, acceptedOnline.DeliveryOTPHint)

	var earlyOtpCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM delivery_otps WHERE order_id = $1`, order4ID).Scan(&earlyOtpCount)
	assert.Equal(t, 0, earlyOtpCount)
}
