package admin_test

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

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/admin"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/delivery"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/discovery"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/menu"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/mailer"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/search"
)

func doJSONReq(r *gin.Engine, method, path, token string, body any) *httptest.ResponseRecorder {
	var buf *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		buf = bytes.NewReader(b)
	} else {
		buf = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestOnboardingInvitationsCustomRolesAndApprovalGatesIntegration(t *testing.T) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}
	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	// Isolated service zone & super admin user
	zoneID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active)
		VALUES ($1, $2, 'Bengaluru, KA', 'Asia/Kolkata', 'INR',
		        ST_GeogFromText('POLYGON((77.5700 12.9000, 77.7000 12.9000, 77.7000 13.0200, 77.5700 13.0200, 77.5700 12.9000))'), TRUE)
	`, zoneID, "GovTestZone-"+zoneID[:8])
	require.NoError(t, err)

	superAdminID := uuid.NewString()
	pwHash, _ := auth.HashPassword("Password#123")
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
		VALUES ($1, $2, $3, $4, 'Test Super Admin', TRUE, TRUE, 'ACTIVE')
	`, superAdminID, "gov-sa-"+superAdminID[:6]+"@test.local", "+91-71111-"+superAdminID[:5], pwHash)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'PLATFORM_ADMIN'`, superAdminID)
	require.NoError(t, err)

	tokens := auth.NewTokenManager("governance-integration-secret-32c", 15*time.Minute, 7*24*time.Hour)
	authRepo := auth.NewRepository(pool)
	authSvc := auth.NewService(authRepo, tokens, nil, "test")
	restRepo := restaurants.NewRepository(pool)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.CorrelationID())
	v1 := r.Group("/api/v1")
	auth.NewHandler(authSvc, tokens, nil, false).RegisterRoutes(v1)
	restaurants.NewHandler(restRepo, tokens, nil).RegisterRoutes(v1)
	delivery.NewHandler(pool, tokens, nil).RegisterRoutes(v1)
	admin.NewHandler(pool, authRepo, tokens, nil).RegisterRoutes(v1)

	saTok, _, _, err := tokens.IssueAccessToken(superAdminID, []string{"PLATFORM_ADMIN"}, []string{"users:manage", "restaurants:verify", "partners:verify", "orders:monitor"})
	require.NoError(t, err)

	// === 1. RESTAURANT OWNER: Multiple Locations + Custom Outlet Role + Phone-Mapped Staff Invite -> Accept -> Approve ===
	ownerSuffix := uuid.NewString()[:6]
	ownerEmail := "owner-" + ownerSuffix + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"full_name": "Chef Vikram",
		"email":     ownerEmail,
		"phone":     "+91-72000-" + ownerSuffix[:5],
		"password":  "Password#123",
		"role":      "OUTLET_OWNER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/otp/verify", "", map[string]any{
		"target": ownerEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wOwnerLogin := doJSONReq(r, http.MethodPost, "/api/v1/auth/login", "", map[string]any{
		"email_or_phone": ownerEmail, "password": "Password#123",
	})
	require.Equal(t, http.StatusOK, wOwnerLogin.Code)
	var ownerLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(wOwnerLogin.Body.Bytes(), &ownerLoginResp))
	ownerTok := ownerLoginResp.Data.AccessToken

	// Owner cannot add outlets before Owner Profile + ID KYC is approved by Admin
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodPost, "/api/v1/restaurants/onboarding", ownerTok, map[string]any{
		"name": "Bistro " + ownerSuffix, "service_zone_id": zoneID, "cuisines": []string{"Indian"},
		"phone": "+91-80-4000-0000", "email": ownerEmail, "address_line1": "100 Ft Rd", "city": "Bengaluru", "state": "KA", "postal_code": "560038", "license_number": "FSSAI-01",
	}).Code, "unverified owner must not be allowed to add outlets")

	wProf := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/owner-profile", ownerTok, map[string]any{
		"organization_name": "Vikram Culinary Group", "id_document_type": "PAN_CARD", "id_document_number": "ABCDE1234F", "id_document_filename": "demo-pan.pdf",
	})
	require.Equal(t, http.StatusCreated, wProf.Code, wProf.Body.String())
	// Still blocked while PENDING_REVIEW
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodPost, "/api/v1/restaurants/onboarding", ownerTok, map[string]any{
		"name": "Bistro " + ownerSuffix, "service_zone_id": zoneID, "cuisines": []string{"Indian"},
		"phone": "+91-80-4000-0000", "email": ownerEmail, "address_line1": "100 Ft Rd", "city": "Bengaluru", "state": "KA", "postal_code": "560038", "license_number": "FSSAI-01",
	}).Code)
	// Admin approves Owner KYC -> Owner can now add outlets!
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/restaurant-owners/"+ownerLoginResp.Data.User.ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)

	// Owner adds Location 1 (NEW_OUTLET), verifies duplicate NEW_OUTLET name is blocked 409, and adds Location 2 as ADD_BRANCH
	var outlet1ID string
	for i, branch := range []string{"Indiranagar Branch", "Koramangala Branch"} {
		setupType := "NEW_OUTLET"
		if i > 0 {
			// Trying NEW_OUTLET with same name must be rejected 409 DUPLICATE_OUTLET_NAME
			assert.Equal(t, http.StatusConflict, doJSONReq(r, http.MethodPost, "/api/v1/restaurants/onboarding", ownerTok, map[string]any{
				"setup_type": "NEW_OUTLET", "name": "Bistro " + ownerSuffix, "brand_name": "Bistro " + ownerSuffix,
				"service_zone_id": zoneID, "cuisines": []string{"Indian"}, "phone": "+91-80-4000-" + ownerSuffix[:4],
				"email": ownerEmail, "address_line1": "100 Ft Rd", "city": "Bengaluru", "state": "KA", "postal_code": "560038", "license_number": "FSSAI-" + ownerSuffix,
			}).Code)
			setupType = "ADD_BRANCH"
		}
		wOnb := doJSONReq(r, http.MethodPost, "/api/v1/restaurants/onboarding", ownerTok, map[string]any{
			"setup_type":      setupType,
			"name":            "Bistro " + ownerSuffix + " " + branch,
			"brand_name":      "Bistro " + ownerSuffix,
			"branch_name":     branch,
			"service_zone_id": zoneID,
			"cuisines":        []string{"Indian", "Cafe"},
			"phone":           "+91-80-4000-" + ownerSuffix[:4],
			"email":           ownerEmail,
			"address_line1":   "100 Ft Rd " + branch,
			"city":            "Bengaluru",
			"state":           "KA",
			"postal_code":     "560038",
			"license_number":  "FSSAI-" + ownerSuffix,
		})
		require.Equal(t, http.StatusCreated, wOnb.Code, wOnb.Body.String())
		if i == 0 {
			var ob struct {
				Data struct {
					ID string `json:"id"`
				} `json:"data"`
			}
			_ = json.Unmarshal(wOnb.Body.Bytes(), &ob)
			outlet1ID = ob.Data.ID
		}
	}
	wOutlets := doJSONReq(r, http.MethodGet, "/api/v1/outlets", ownerTok, nil)
	var outletsResp struct {
		Data []any `json:"data"`
	}
	_ = json.Unmarshal(wOutlets.Body.Bytes(), &outletsResp)
	assert.Len(t, outletsResp.Data, 2, "owner must be allowed to add and view multiple outlet locations")

	// Owner creates a custom outlet role
	wORole := doJSONReq(r, http.MethodPost, "/api/v1/outlets/roles", ownerTok, map[string]any{
		"name":        "Kitchen Lead",
		"description": "Hours and menu stock toggles only",
		"permissions": []string{"outlet:hours:manage", "outlet:inventory:toggle"},
	})
	require.Equal(t, http.StatusCreated, wORole.Code)
	var oRoleResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wORole.Body.Bytes(), &oRoleResp)

	// Staff member logs in beforehand BEFORE accepting invitation
	staffPhone := "+91-73000-" + ownerSuffix[:5]
	staffEmail := "staff-" + ownerSuffix + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"full_name": "Staff Maya",
		"email":     staffEmail,
		"phone":     staffPhone,
		"password":  "Password#123",
		"role":      "OUTLET_STAFF",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/otp/verify", "", map[string]any{
		"target": staffPhone, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wStaffLogin := doJSONReq(r, http.MethodPost, "/api/v1/auth/login", "", map[string]any{
		"email_or_phone": staffPhone, "password": "Password#123",
	})
	var staffLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wStaffLogin.Body.Bytes(), &staffLoginResp)
	staffTok := staffLoginResp.Data.AccessToken

	// Owner invites staff mapped ONLY by phone number
	wInviteStaff := doJSONReq(r, http.MethodPost, "/api/v1/outlets/"+outlet1ID+"/staff", ownerTok, map[string]any{
		"phone":          staffPhone,
		"outlet_role_id": oRoleResp.Data.ID,
	})
	require.Equal(t, http.StatusCreated, wInviteStaff.Code)
	var sInvResp struct {
		Data struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wInviteStaff.Body.Bytes(), &sInvResp)
	assert.Equal(t, "PENDING_ACCEPTANCE", sInvResp.Data.Status)

	// Before accepting: staff is LOCKED OUT (403) from all restaurant portal APIs AND owner cannot prematurely approve
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/restaurants/me", staffTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/restaurants/me?outlet_id="+outlet1ID, staffTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/outlets/roles", staffTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodPost, "/api/v1/outlets/roles", staffTok, map[string]any{"name": "Rogue Role", "permissions": []string{"outlet:orders:manage"}}).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/restaurants/me/settlements", staffTok, nil).Code)
	assert.Equal(t, http.StatusBadRequest, doJSONReq(r, http.MethodPost, "/api/v1/outlets/"+outlet1ID+"/staff/"+sInvResp.Data.ID+"/approve", ownerTok, nil).Code)

	// Staff checks invitations & accepts -> moves to PENDING_APPROVAL (still LOCKED OUT 403 until approved!)
	wMyInvs := doJSONReq(r, http.MethodGet, "/api/v1/auth/invitations", staffTok, nil)
	require.Equal(t, http.StatusOK, wMyInvs.Code)
	assert.Contains(t, wMyInvs.Body.String(), sInvResp.Data.ID)
	wRespond := doJSONReq(r, http.MethodPost, "/api/v1/auth/invitations/OUTLET/"+sInvResp.Data.ID+"/respond", staffTok, map[string]any{"action": "ACCEPT"})
	require.Equal(t, http.StatusOK, wRespond.Code, wRespond.Body.String())
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/restaurants/me", staffTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/restaurants/me?outlet_id="+outlet1ID, staffTok, nil).Code)

	// Owner approves -> staff now gets access ONLY to granted permissions!
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/outlets/"+outlet1ID+"/staff/"+sInvResp.Data.ID+"/approve", ownerTok, nil).Code)
	assert.Equal(t, http.StatusOK, doJSONReq(r, http.MethodGet, "/api/v1/restaurants/me?outlet_id="+outlet1ID, staffTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodPatch, "/api/v1/restaurants/me?outlet_id="+outlet1ID, staffTok, map[string]any{"avg_prep_time_minutes": 15}).Code, "ungranted outlet:capacity:configure must remain blocked")

	// === 2. DELIVERY PARTNER: Skipped Onboarding -> Pending Warning + Blocked Online -> Approved ===
	riderEmail := "rider-" + ownerSuffix + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"full_name": "Courier Dev",
		"email":     riderEmail,
		"phone":     "+91-74000-" + ownerSuffix[:5],
		"password":  "Password#123",
		"role":      "DELIVERY_PARTNER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/otp/verify", "", map[string]any{
		"target": riderEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wRiderLogin := doJSONReq(r, http.MethodPost, "/api/v1/auth/login", "", map[string]any{"email_or_phone": riderEmail, "password": "Password#123"})
	var riderLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wRiderLogin.Body.Bytes(), &riderLoginResp)
	riderTok := riderLoginResp.Data.AccessToken

	wDelivMe := doJSONReq(r, http.MethodGet, "/api/v1/delivery/me", riderTok, nil)
	require.Equal(t, http.StatusOK, wDelivMe.Code)
	assert.Contains(t, wDelivMe.Body.String(), delivery.PendingOnboardingWarning)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodPatch, "/api/v1/delivery/me/availability", riderTok, map[string]any{"status": "ONLINE_AVAILABLE"}).Code)

	wDelivOnb := doJSONReq(r, http.MethodPost, "/api/v1/delivery/onboarding", riderTok, map[string]any{
		"service_zone_id": zoneID, "vehicle_type": "SCOOTER", "vehicle_make_model": "Ather 450S", "license_plate": "KA-01-9988",
	})
	require.Equal(t, http.StatusCreated, wDelivOnb.Code)
	var dpResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wDelivOnb.Body.Bytes(), &dpResp)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodPatch, "/api/v1/delivery/me/availability", riderTok, map[string]any{"status": "ONLINE_AVAILABLE"}).Code, "PENDING_REVIEW still blocked until Admin approves")

	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/delivery-partners/"+dpResp.Data.ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPatch, "/api/v1/delivery/me/availability", riderTok, map[string]any{"status": "ONLINE_AVAILABLE"}).Code)

	// === 3. ADMIN GOVERNANCE: Super Admin Custom Role + Invitation by Email/Phone -> Login Beforehand -> Accept -> Admin Approve ===
	wAdmRole := doJSONReq(r, http.MethodPost, "/api/v1/admin/roles", saTok, map[string]any{
		"name":        "Ops Watcher " + ownerSuffix,
		"description": "Can monitor orders only",
		"permissions": []string{"orders:monitor"},
	})
	require.Equal(t, http.StatusCreated, wAdmRole.Code)
	var admRoleResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wAdmRole.Body.Bytes(), &admRoleResp)

	admCandidateEmail := "adm-cand-" + ownerSuffix + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"full_name": "Candidate Neha",
		"email":     admCandidateEmail,
		"phone":     "+91-75000-" + ownerSuffix[:5],
		"password":  "Password#123",
		"role":      "CUSTOMER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/otp/verify", "", map[string]any{
		"target": admCandidateEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wCandLogin := doJSONReq(r, http.MethodPost, "/api/v1/auth/login", "", map[string]any{"email_or_phone": admCandidateEmail, "password": "Password#123"})
	var candLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wCandLogin.Body.Bytes(), &candLoginResp)
	candTok := candLoginResp.Data.AccessToken

	wAdmInv := doJSONReq(r, http.MethodPost, "/api/v1/admin/invitations", saTok, map[string]any{
		"email":   admCandidateEmail,
		"role_id": admRoleResp.Data.ID,
	})
	require.Equal(t, http.StatusCreated, wAdmInv.Code)
	var admInvResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wAdmInv.Body.Bytes(), &admInvResp)

	// Candidate blocked before accepting; Super Admin blocked from approving before acceptance
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/orders/monitor", candTok, nil).Code)
	assert.Equal(t, http.StatusBadRequest, doJSONReq(r, http.MethodPost, "/api/v1/admin/invitations/"+admInvResp.Data.ID+"/approve", saTok, nil).Code)

	// Candidate accepts -> still blocked until Super Admin approves!
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/invitations/PLATFORM/"+admInvResp.Data.ID+"/respond", candTok, map[string]any{"action": "ACCEPT"}).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/orders/monitor", candTok, nil).Code)

	// Super Admin approves -> candidate immediately accesses orders:monitor, still denied on users:manage!
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/invitations/"+admInvResp.Data.ID+"/approve", saTok, nil).Code)
	assert.Equal(t, http.StatusOK, doJSONReq(r, http.MethodGet, "/api/v1/admin/orders/monitor", candTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/users", candTok, nil).Code)
}

func TestBrevoMailerAndOpenAdminRegistrationIntegration(t *testing.T) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}
	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	zoneID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active)
		VALUES ($1, $2, 'Bengaluru, KA', 'Asia/Kolkata', 'INR',
		        ST_GeogFromText('POLYGON((77.5700 12.9000, 77.7000 12.9000, 77.7000 13.0200, 77.5700 13.0200, 77.5700 12.9000))'), TRUE)
	`, zoneID, "MailZone-"+zoneID[:8])
	require.NoError(t, err)

	superAdminID := uuid.NewString()
	pwHash, _ := auth.HashPassword("Password#123")
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
		VALUES ($1, $2, $3, $4, 'Mailer Super Admin', TRUE, TRUE, 'ACTIVE')
	`, superAdminID, "mail-sa-"+superAdminID[:6]+"@test.local", "+91-71999-"+superAdminID[:5], pwHash)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'PLATFORM_ADMIN'`, superAdminID)
	require.NoError(t, err)

	mockMail := mailer.NewMockMailer(nil)
	tokens := auth.NewTokenManager("mailer-open-admin-secret-32chars", 15*time.Minute, 7*24*time.Hour)
	authRepo := auth.NewRepository(pool)
	authSvc := auth.NewService(authRepo, tokens, nil, "test")
	authSvc.SetMailer(mockMail)
	restRepo := restaurants.NewRepository(pool)
	restHandler := restaurants.NewHandler(restRepo, tokens, nil)
	restHandler.SetMailer(mockMail)
	delivHandler := delivery.NewHandler(pool, tokens, nil)
	delivHandler.SetMailer(mockMail)
	admHandler := admin.NewHandler(pool, authRepo, tokens, nil)
	admHandler.SetMailer(mockMail)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	auth.NewHandler(authSvc, tokens, nil, false).RegisterRoutes(v1)
	restHandler.RegisterRoutes(v1)
	delivHandler.RegisterRoutes(v1)
	admHandler.RegisterRoutes(v1)

	sfx := uuid.NewString()[:6]

	// 1. Open Admin Portal Self-Registration + OTP Email Verification by email + Zero Permissions Pre-Invite
	admUserEmail := "open-adm-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/admin/auth/register", "", map[string]any{
		"full_name": "Open Admin User", "email": admUserEmail, "phone": "+91-78100-" + sfx[:5], "password": "Password#123",
	}).Code)
	require.GreaterOrEqual(t, len(mockMail.SentEmails), 1)
	assert.Equal(t, admUserEmail, mockMail.SentEmails[0].ToEmail)
	assert.Contains(t, mockMail.SentEmails[0].Subject, "verification code")

	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/auth/otp/verify", "", map[string]any{
		"target": admUserEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)

	wAdmLogin := doJSONReq(r, http.MethodPost, "/api/v1/admin/auth/login", "", map[string]any{
		"email_or_phone": admUserEmail, "password": "Password#123",
	})
	require.Equal(t, http.StatusOK, wAdmLogin.Code)
	var loginData struct {
		Data struct {
			AccessToken        string `json:"access_token"`
			OnboardingRequired bool   `json:"onboarding_required"`
			User               struct {
				Permissions []string `json:"permissions"`
			} `json:"user"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wAdmLogin.Body.Bytes(), &loginData)
	assert.True(t, loginData.Data.OnboardingRequired)
	assert.Empty(t, loginData.Data.User.Permissions)
	candTok := loginData.Data.AccessToken

	// Cannot access any admin operations until invited + accepted
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/orders/monitor", candTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/roles", candTok, nil).Code)

	// Eligible Admin invites candidate with pre_approved=true -> accepting IMMEDIATELY unlocks access
	saTok, _, _, err := tokens.IssuePortalAccessToken(superAdminID, "admin", []string{"PLATFORM_ADMIN"}, []string{"users:manage", "restaurants:verify", "partners:verify", "orders:monitor"})
	require.NoError(t, err)

	wRole := doJSONReq(r, http.MethodPost, "/api/v1/admin/roles", saTok, map[string]any{
		"name": "Support Monitor " + sfx, "permissions": []string{"orders:monitor"},
	})
	require.Equal(t, http.StatusCreated, wRole.Code)
	var roleResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wRole.Body.Bytes(), &roleResp)

	wPreInv := doJSONReq(r, http.MethodPost, "/api/v1/admin/invitations", saTok, map[string]any{
		"email": admUserEmail, "role_id": roleResp.Data.ID, "pre_approved": true,
	})
	require.Equal(t, http.StatusCreated, wPreInv.Code)
	var preInvResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wPreInv.Body.Bytes(), &preInvResp)

	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/auth/invitations/PLATFORM/"+preInvResp.Data.ID+"/respond", candTok, map[string]any{"action": "ACCEPT"}).Code)
	assert.Equal(t, http.StatusOK, doJSONReq(r, http.MethodGet, "/api/v1/admin/orders/monitor", candTok, nil).Code, "pre-approved invite must immediately unlock orders:monitor on accept")

	// 2. Onboarding & KYC Verification Email Triggers (Restaurant Outlet + Delivery Partner)
	mockMail.SentEmails = nil
	restEmail := "kyc-rest-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/register", "", map[string]any{
		"full_name": "KYC Owner", "email": restEmail, "phone": "+91-78200-" + sfx[:5], "password": "Password#123", "role": "OUTLET_OWNER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/otp/verify", "", map[string]any{
		"target": restEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wRestLogin := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/login", "", map[string]any{"email_or_phone": restEmail, "password": "Password#123"})
	var restLoginData struct {
		Data struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wRestLogin.Body.Bytes(), &restLoginData)

	// Submit Owner Profile + ID KYC (optional org left empty as independent owner) & Admin approve
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/owner-profile", restLoginData.Data.AccessToken, map[string]any{
		"id_document_type": "AADHAAR", "id_document_number": "1234-5678-9012", "id_document_filename": "demo-aadhaar.jpg",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/restaurant-owners/"+restLoginData.Data.User.ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)

	outletContactEmail := "outlet-desk-" + sfx + "@test.local"
	wOnb := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/onboarding", restLoginData.Data.AccessToken, map[string]any{
		"name": "Deccan Spice " + sfx, "service_zone_id": zoneID, "cuisines": []string{"South Indian"},
		"phone": "+91-80-12345678", "email": outletContactEmail, "address_line1": "12 MG Road", "city": "Bengaluru", "state": "KA", "postal_code": "560001", "license_number": "FSSAI-" + sfx,
	})
	require.Equal(t, http.StatusCreated, wOnb.Code)
	var onbResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wOnb.Body.Bytes(), &onbResp)

	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/outlets/"+onbResp.Data.ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)

	riderEmail := "kyc-rider-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/delivery/auth/register", "", map[string]any{
		"full_name": "KYC Rider", "email": riderEmail, "phone": "+91-78300-" + sfx[:5], "password": "Password#123",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/delivery/auth/otp/verify", "", map[string]any{
		"target": riderEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wRiderLogin := doJSONReq(r, http.MethodPost, "/api/v1/delivery/auth/login", "", map[string]any{"email_or_phone": riderEmail, "password": "Password#123"})
	var riderLoginData struct {
		Data struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wRiderLogin.Body.Bytes(), &riderLoginData)
	wDpOnb := doJSONReq(r, http.MethodPost, "/api/v1/delivery/onboarding", riderLoginData.Data.AccessToken, map[string]any{
		"service_zone_id": zoneID, "vehicle_type": "SCOOTER", "vehicle_make_model": "TVS iQube", "license_plate": "KA-05-1234",
	})
	require.Equal(t, http.StatusCreated, wDpOnb.Code)
	var dpOnbResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wDpOnb.Body.Bytes(), &dpOnbResp)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/delivery-partners/"+dpOnbResp.Data.ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)

	sent := mockMail.SentEmails
	// Expect: 1) Rest Reg OTP, 2) Outlet PENDING_REVIEW KYC, 3) Outlet APPROVED KYC, 4) Rider Reg OTP, 5) Rider PENDING_REVIEW KYC, 6) Rider APPROVED KYC
	require.GreaterOrEqual(t, len(sent), 6)
	var sawOutletPending, sawOutletApproved, sawRiderPending, sawRiderApproved bool
	for _, msg := range sent {
		if msg.ToEmail == outletContactEmail && containsAll(msg.Subject+msg.TextContent, "PENDING_REVIEW") {
			sawOutletPending = true
		}
		if msg.ToEmail == outletContactEmail && containsAll(msg.Subject+msg.TextContent, "APPROVED") {
			sawOutletApproved = true
		}
		if msg.ToEmail == riderEmail && containsAll(msg.Subject+msg.TextContent, "PENDING_REVIEW") {
			sawRiderPending = true
		}
		if msg.ToEmail == riderEmail && containsAll(msg.Subject+msg.TextContent, "APPROVED") {
			sawRiderApproved = true
		}
	}
	assert.True(t, sawOutletPending, "expected outlet KYC pending email")
	assert.True(t, sawOutletApproved, "expected outlet KYC approved email")
	assert.True(t, sawRiderPending, "expected delivery partner KYC pending email")
	assert.True(t, sawRiderApproved, "expected delivery partner KYC approved email")

	// 3. Admin User Deletion (cannot delete self 400; deleting unreferenced user hard-deletes; deleting outlet owner soft-deletes cleanly!)
	assert.Equal(t, http.StatusBadRequest, doJSONReq(r, http.MethodDelete, "/api/v1/admin/users/"+superAdminID, saTok, nil).Code)
	riderUserID := riderLoginData.Data.User.ID
	require.NotEmpty(t, riderUserID)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodDelete, "/api/v1/admin/users/"+riderUserID, saTok, nil).Code)
	assert.Equal(t, http.StatusUnauthorized, doJSONReq(r, http.MethodPost, "/api/v1/delivery/auth/login", "", map[string]any{
		"email_or_phone": riderEmail, "password": "Password#123",
	}).Code, "deleted user must no longer be able to sign in")

	// Soft-delete an outlet owner who owns an outlet (hits 23503 FK -> scrubs email & 20-char phone cleanly)
	restOwnerID := restLoginData.Data.User.ID
	require.NotEmpty(t, restOwnerID)
	wSoftDel := doJSONReq(r, http.MethodDelete, "/api/v1/admin/users/"+restOwnerID, saTok, nil)
	require.Equal(t, http.StatusOK, wSoftDel.Code, wSoftDel.Body.String())
	assert.Contains(t, wSoftDel.Body.String(), `"SOFT_DELETE"`)
	assert.Equal(t, http.StatusUnauthorized, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/login", "", map[string]any{
		"email_or_phone": restEmail, "password": "Password#123",
	}).Code, "soft-deleted owner must no longer be able to sign in")

	wUsers := doJSONReq(r, http.MethodGet, "/api/v1/admin/users", saTok, nil)
	require.Equal(t, http.StatusOK, wUsers.Code)
	assert.NotContains(t, wUsers.Body.String(), riderEmail)
	assert.NotContains(t, wUsers.Body.String(), restEmail)
}

func containsAll(s string, sub string) bool {
	return len(sub) > 0 && bytes.Contains([]byte(s), []byte(sub))
}

func TestMenuVisibilityAndMultiOutletStaffScopingIntegration(t *testing.T) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}
	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	// Deactivate any prior VisZone test fixtures before and after this test so ST_Covers always hits this exact zone
	_, _ = pool.Exec(ctx, `UPDATE service_zones SET is_active = FALSE WHERE name LIKE 'VisZone-%'`)
	zoneID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active)
		VALUES ($1, $2, 'Sarjapur East, KA', 'Asia/Kolkata', 'INR',
		        ST_GeogFromText('POLYGON((77.8200 12.8200, 77.8800 12.8200, 77.8800 12.8800, 77.8200 12.8800, 77.8200 12.8200))'), TRUE)
	`, zoneID, "VisZone-"+zoneID[:8])
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE service_zones SET is_active = FALSE WHERE id = $1`, zoneID)
	})

	superAdminID := uuid.NewString()
	pwHash, _ := auth.HashPassword("Password#123")
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
		VALUES ($1, $2, $3, $4, 'Vis Super Admin', TRUE, TRUE, 'ACTIVE')
	`, superAdminID, "vis-sa-"+superAdminID[:6]+"@test.local", "+91-71888-"+superAdminID[:5], pwHash)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'PLATFORM_ADMIN'`, superAdminID)
	require.NoError(t, err)

	tokens := auth.NewTokenManager("vis-secret-32chars-minimum-length", 15*time.Minute, 7*24*time.Hour)
	authRepo := auth.NewRepository(pool)
	authSvc := auth.NewService(authRepo, tokens, nil, "test")
	restRepo := restaurants.NewRepository(pool)
	menuRepo := menu.NewRepository(pool, nil)
	discRepo := discovery.NewRepository(pool, menuRepo, nil)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	auth.NewHandler(authSvc, tokens, nil, false).RegisterRoutes(v1)
	restaurants.NewHandler(restRepo, tokens, nil).RegisterRoutes(v1)
	menu.NewHandler(menuRepo, restRepo, tokens, nil).RegisterRoutes(v1)
	discovery.NewHandler(discRepo).RegisterRoutes(v1)
	admin.NewHandler(pool, authRepo, tokens, nil).RegisterRoutes(v1)

	sfx := uuid.NewString()[:6]
	saTok, _, _, err := tokens.IssuePortalAccessToken(superAdminID, "admin", []string{"PLATFORM_ADMIN"}, []string{"users:manage", "restaurants:verify", "partners:verify", "orders:monitor"})
	require.NoError(t, err)

	ownerEmail := "multi-owner-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/register", "", map[string]any{
		"full_name": "Multi Owner", "email": ownerEmail, "phone": "+91-78400-" + sfx[:5], "password": "Password#123", "role": "OUTLET_OWNER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/otp/verify", "", map[string]any{
		"target": ownerEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wOwnerLogin := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/login", "", map[string]any{"email_or_phone": ownerEmail, "password": "Password#123"})
	var ownerLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wOwnerLogin.Body.Bytes(), &ownerLoginResp)
	ownerTok := ownerLoginResp.Data.AccessToken

	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/owner-profile", ownerTok, map[string]any{
		"organization_name": "Copper Hospitality", "id_document_type": "PAN_CARD", "id_document_number": "ABCDE9999Z", "id_document_filename": "demo-id.pdf",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/restaurant-owners/"+ownerLoginResp.Data.User.ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)

	// Create 2 distinct outlets/branches in VisZone
	onboard := func(setupType, name, brand, branch string) string {
		w := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/onboarding", ownerTok, map[string]any{
			"setup_type": setupType, "name": name, "brand_name": brand, "branch_name": branch,
			"service_zone_id": zoneID, "cuisines": []string{"Indian"},
			"phone": "+91-80-22223333", "email": ownerEmail,
			"address_line1": "10 Main St", "city": "Bengaluru", "state": "KA", "postal_code": "562125",
			"license_number": "FSSAI-" + sfx, "lat": 12.85, "lng": 77.85,
		})
		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
		var resp struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		return resp.Data.ID
	}

	outlet1ID := onboard("NEW_OUTLET", "Copper Kitchen "+sfx+" Koramangala", "Copper Kitchen "+sfx, "Koramangala")
	outlet2ID := onboard("ADD_BRANCH", "Copper Kitchen "+sfx+" HSR", "Copper Kitchen "+sfx, "HSR")

	// Approve outlet1 KYC -> Owner toggles online (200) -> STILL hidden from discovery until >= 1 active dish added!
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/outlets/"+outlet1ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)
	wOnline := doJSONReq(r, http.MethodPatch, "/api/v1/restaurant/me/availability?outlet_id="+outlet1ID, ownerTok, map[string]any{"is_accepting_orders": true})
	require.Equal(t, http.StatusOK, wOnline.Code, wOnline.Body.String())

	wFeedEmpty := doJSONReq(r, http.MethodGet, "/api/v1/customer/discovery/feed?lat=12.85&lng=77.85", "", nil)
	require.Equal(t, http.StatusOK, wFeedEmpty.Code)
	assert.NotContains(t, wFeedEmpty.Body.String(), outlet1ID, "approved outlet with 0 dishes must not appear on customer discovery feed")

	wSearchEmpty := doJSONReq(r, http.MethodGet, "/api/v1/customer/discovery/search?q=Copper&lat=12.85&lng=77.85", "", nil)
	require.Equal(t, http.StatusOK, wSearchEmpty.Code)
	assert.NotContains(t, wSearchEmpty.Body.String(), outlet1ID, "approved outlet with 0 dishes must not appear in customer search")

	// Owner adds category + 1 dish to outlet1 -> immediately appears on feed & search!
	wCat := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/menu/categories?outlet_id="+outlet1ID, ownerTok, map[string]any{"name": "Mains"})
	require.Equal(t, http.StatusCreated, wCat.Code)
	var catResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wCat.Body.Bytes(), &catResp)
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/menu/items?outlet_id="+outlet1ID, ownerTok, map[string]any{
		"category_id": catResp.Data.ID, "name": "Copper Paneer Bowl", "description": "Slow roasted", "base_price_minor": 32000,
	}).Code)

	wFeedWithItem := doJSONReq(r, http.MethodGet, "/api/v1/customer/discovery/feed?lat=12.85&lng=77.85", "", nil)
	require.Equal(t, http.StatusOK, wFeedWithItem.Code)
	assert.Contains(t, wFeedWithItem.Body.String(), outlet1ID, "approved outlet with >=1 dish must appear on customer discovery feed")

	wSearchWithItem := doJSONReq(r, http.MethodGet, "/api/v1/customer/discovery/search?q=Copper&lat=12.85&lng=77.85", "", nil)
	require.Equal(t, http.StatusOK, wSearchWithItem.Code)
	assert.Contains(t, wSearchWithItem.Body.String(), outlet1ID)

	// Multi-outlet scoped staff invite: invite staff ONLY to [outlet1ID], NOT outlet2ID
	staffEmail := "scoped-staff-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/register", "", map[string]any{
		"full_name": "Scoped Lead", "email": staffEmail, "phone": "+91-78500-" + sfx[:5], "password": "Password#123", "role": "OUTLET_STAFF",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/otp/verify", "", map[string]any{
		"target": staffEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wStaffLogin := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/login", "", map[string]any{"email_or_phone": staffEmail, "password": "Password#123"})
	var staffLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wStaffLogin.Body.Bytes(), &staffLoginResp)
	staffTok := staffLoginResp.Data.AccessToken

	wInv := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/staff/invite", ownerTok, map[string]any{
		"outlet_ids": []string{outlet1ID}, "email": staffEmail, "role_code": "BRANCH_MANAGER",
		"permissions": []string{"outlet:orders:manage", "outlet:hours:manage"},
	})
	require.Equal(t, http.StatusCreated, wInv.Code, wInv.Body.String())
	var invMulti struct {
		Data struct {
			First struct {
				ID string `json:"id"`
			} `json:"first"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wInv.Body.Bytes(), &invMulti)
	require.NotEmpty(t, invMulti.Data.First.ID)

	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/invitations/OUTLET/"+invMulti.Data.First.ID+"/respond", staffTok, map[string]any{"action": "ACCEPT"}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/outlets/"+outlet1ID+"/staff/"+invMulti.Data.First.ID+"/approve", ownerTok, nil).Code)

	wStaffOutlets := doJSONReq(r, http.MethodGet, "/api/v1/restaurant/outlets", staffTok, nil)
	require.Equal(t, http.StatusOK, wStaffOutlets.Code)
	assert.Contains(t, wStaffOutlets.Body.String(), outlet1ID)
	assert.NotContains(t, wStaffOutlets.Body.String(), outlet2ID, "staff must only see the specifically granted outlet/branch")
}

func TestAdminDirectorySubmenusRoleChangeAndRoleDeletionIntegration(t *testing.T) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}
	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	superAdminID := uuid.NewString()
	pwHash, _ := auth.HashPassword("Password#123")
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
		VALUES ($1, $2, $3, $4, 'Dir Super Admin', TRUE, TRUE, 'ACTIVE')
	`, superAdminID, "dir-sa-"+superAdminID[:6]+"@test.local", "+91-71999-"+superAdminID[:5], pwHash)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'PLATFORM_ADMIN'`, superAdminID)
	require.NoError(t, err)

	tokens := auth.NewTokenManager("dir-secret-32chars-minimum-length", 15*time.Minute, 7*24*time.Hour)
	authRepo := auth.NewRepository(pool)
	authSvc := auth.NewService(authRepo, tokens, nil, "test")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	auth.NewHandler(authSvc, tokens, nil, false).RegisterRoutes(v1)
	admin.NewHandler(pool, authRepo, tokens, nil).RegisterRoutes(v1)

	sfx := uuid.NewString()[:8]
	saTok, _, _, err := tokens.IssuePortalAccessToken(superAdminID, "admin", []string{"PLATFORM_ADMIN"}, []string{"users:manage", "roles:manage"})
	require.NoError(t, err)

	// 1. Super Admin creates a custom role scoped ONLY to users:customers:view
	wCustRole := doJSONReq(r, http.MethodPost, "/api/v1/admin/roles", saTok, map[string]any{
		"name":        "Customer Auditor " + sfx,
		"description": "View customers directory only",
		"permissions": []string{"users:customers:view"},
	})
	require.Equal(t, http.StatusCreated, wCustRole.Code, wCustRole.Body.String())
	var custRoleResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wCustRole.Body.Bytes(), &custRoleResp)
	require.NotEmpty(t, custRoleResp.Data.ID)

	// Second role to switch the management user to later
	wMgmtRole := doJSONReq(r, http.MethodPost, "/api/v1/admin/roles", saTok, map[string]any{
		"name":        "Directory Ops " + sfx,
		"description": "View management directory + monitor orders",
		"permissions": []string{"users:management:view", "orders:monitor"},
	})
	require.Equal(t, http.StatusCreated, wMgmtRole.Code, wMgmtRole.Body.String())
	var mgmtRoleResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wMgmtRole.Body.Bytes(), &mgmtRoleResp)
	require.NotEmpty(t, mgmtRoleResp.Data.ID)

	// 2. Register a customer + invite a sub-admin with Customer Auditor role
	custEmail := "dir-cust-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"full_name": "Dir Customer", "email": custEmail, "phone": "+91-71100-" + sfx[:5], "password": "Password#123", "role": "CUSTOMER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/otp/verify", "", map[string]any{
		"target": custEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)

	subEmail := "dir-subadmin-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/auth/register", "", map[string]any{
		"full_name": "Sub Admin", "email": subEmail, "phone": "+91-71200-" + sfx[:5], "password": "Password#123", "role": "CUSTOMER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/otp/verify", "", map[string]any{
		"target": subEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wSubLogin := doJSONReq(r, http.MethodPost, "/api/v1/auth/login", "", map[string]any{"email_or_phone": subEmail, "password": "Password#123"})
	var subLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wSubLogin.Body.Bytes(), &subLoginResp)
	subTok := subLoginResp.Data.AccessToken
	subID := subLoginResp.Data.User.ID

	wInv := doJSONReq(r, http.MethodPost, "/api/v1/admin/invitations", saTok, map[string]any{
		"email": subEmail, "role_id": custRoleResp.Data.ID, "pre_approved": true,
	})
	require.Equal(t, http.StatusCreated, wInv.Code)
	var invResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wInv.Body.Bytes(), &invResp)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/auth/invitations/PLATFORM/"+invResp.Data.ID+"/respond", subTok, map[string]any{"action": "ACCEPT"}).Code)

	// 3. Sub-admin can list Customers directory, but is FORBIDDEN (403) on Management, Owners, Role Delete, and Customer Delete
	wDirCust := doJSONReq(r, http.MethodGet, "/api/v1/admin/directory/customers", subTok, nil)
	require.Equal(t, http.StatusOK, wDirCust.Code, wDirCust.Body.String())
	assert.Contains(t, wDirCust.Body.String(), custEmail)

	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/directory/management", subTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/directory/owners", subTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodDelete, "/api/v1/admin/roles/"+custRoleResp.Data.ID, subTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodDelete, "/api/v1/admin/users/"+subID, subTok, nil).Code)

	// 4. Super Admin lists Management directory and updates sub-admin's role + custom granular permission
	wDirMgmt := doJSONReq(r, http.MethodGet, "/api/v1/admin/directory/management", saTok, nil)
	require.Equal(t, http.StatusOK, wDirMgmt.Code)
	assert.Contains(t, wDirMgmt.Body.String(), subEmail)

	wRolePatch := doJSONReq(r, http.MethodPatch, "/api/v1/admin/users/"+subID+"/roles", saTok, map[string]any{
		"role_id":            mgmtRoleResp.Data.ID,
		"custom_permissions": []string{"users:owners:view"},
	})
	require.Equal(t, http.StatusOK, wRolePatch.Code, wRolePatch.Body.String())

	// Sub-admin IMMEDIATELY has users:management:view and users:owners:view, and loses old users:customers:view
	assert.Equal(t, http.StatusOK, doJSONReq(r, http.MethodGet, "/api/v1/admin/directory/management", subTok, nil).Code)
	assert.Equal(t, http.StatusOK, doJSONReq(r, http.MethodGet, "/api/v1/admin/directory/owners", subTok, nil).Code)
	assert.Equal(t, http.StatusForbidden, doJSONReq(r, http.MethodGet, "/api/v1/admin/directory/customers", subTok, nil).Code)

	// 5. Super Admin deletes custom role (and core PLATFORM_ADMIN role stays protected)
	wRolesList := doJSONReq(r, http.MethodGet, "/api/v1/admin/roles", saTok, nil)
	require.Equal(t, http.StatusOK, wRolesList.Code)
	var rolesListResp struct {
		Data []struct {
			ID   string `json:"id"`
			Code string `json:"code"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wRolesList.Body.Bytes(), &rolesListResp)
	var platformAdminRoleID string
	for _, role := range rolesListResp.Data {
		if role.Code == "PLATFORM_ADMIN" {
			platformAdminRoleID = role.ID
			break
		}
	}
	require.NotEmpty(t, platformAdminRoleID)

	wProtectDel := doJSONReq(r, http.MethodDelete, "/api/v1/admin/roles/"+platformAdminRoleID, saTok, nil)
	assert.Equal(t, http.StatusBadRequest, wProtectDel.Code)
	assert.Contains(t, wProtectDel.Body.String(), "PROTECTED_ROLE")

	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodDelete, "/api/v1/admin/roles/"+custRoleResp.Data.ID, saTok, nil).Code)
	wRolesAfter := doJSONReq(r, http.MethodGet, "/api/v1/admin/roles", saTok, nil)
	assert.NotContains(t, wRolesAfter.Body.String(), custRoleResp.Data.ID)
}

func TestOpenSearchSynonymSearchAndRichMenuItemIntegration(t *testing.T) {
	ctx := context.Background()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}
	pool, err := database.NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()
	require.NoError(t, database.RunMigrations(ctx, pool, "../../../../supabase/migrations"))

	osURL := os.Getenv("OPENSEARCH_URL")
	if osURL == "" {
		osURL = "http://localhost:9200"
	}
	osClient := search.NewClient(osURL)
	if err := osClient.Ping(ctx); err != nil {
		t.Skipf("opensearch not reachable at %s (%v); skipping live opensearch integration test", osURL, err)
	}

	_, _ = pool.Exec(ctx, `UPDATE service_zones SET is_active = FALSE WHERE name LIKE 'OsZone-%'`)
	zoneID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active)
		VALUES ($1, $2, 'Whitefield, KA', 'Asia/Kolkata', 'INR',
		        ST_GeogFromText('POLYGON((77.7200 12.9200, 77.7800 12.9200, 77.7800 12.9800, 77.7200 12.9800, 77.7200 12.9200))'), TRUE)
	`, zoneID, "OsZone-"+zoneID[:8])
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE service_zones SET is_active = FALSE WHERE id = $1`, zoneID)
	})

	sfx := uuid.NewString()[:8]
	superAdminID := uuid.NewString()
	pwHash, _ := auth.HashPassword("Password#123")
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
		VALUES ($1, $2, $3, $4, 'OS Super Admin', TRUE, TRUE, 'ACTIVE')
	`, superAdminID, "os-sa-"+sfx+"@test.local", "+91-71777-"+sfx[:5], pwHash)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'PLATFORM_ADMIN'`, superAdminID)
	require.NoError(t, err)

	tokens := auth.NewTokenManager("os-secret-32chars-minimum-length", 15*time.Minute, 7*24*time.Hour)
	authRepo := auth.NewRepository(pool)
	authSvc := auth.NewService(authRepo, tokens, nil, "test")
	restRepo := restaurants.NewRepository(pool)
	menuRepo := menu.NewRepository(pool, nil)
	menuRepo.SetSearchClient(osClient)
	discRepo := discovery.NewRepository(pool, menuRepo, nil)
	discRepo.SetSearchClient(osClient)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	auth.NewHandler(authSvc, tokens, nil, false).RegisterRoutes(v1)
	restaurants.NewHandler(restRepo, tokens, nil).RegisterRoutes(v1)
	menu.NewHandler(menuRepo, restRepo, tokens, nil).RegisterRoutes(v1)
	discovery.NewHandler(discRepo).RegisterRoutes(v1)
	admin.NewHandler(pool, authRepo, tokens, nil).RegisterRoutes(v1)

	saTok, _, _, err := tokens.IssuePortalAccessToken(superAdminID, "admin", []string{"PLATFORM_ADMIN"}, []string{"restaurants:verify"})
	require.NoError(t, err)

	ownerEmail := "os-owner-" + sfx + "@test.local"
	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/register", "", map[string]any{
		"full_name": "OS Owner", "email": ownerEmail, "phone": "+91-78900-" + sfx[:5], "password": "Password#123", "role": "OUTLET_OWNER",
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/otp/verify", "", map[string]any{
		"target": ownerEmail, "purpose": "REGISTER", "code": "123456",
	}).Code)
	wOwnerLogin := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/auth/login", "", map[string]any{"email_or_phone": ownerEmail, "password": "Password#123"})
	var ownerLoginResp struct {
		Data struct {
			AccessToken string `json:"access_token"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wOwnerLogin.Body.Bytes(), &ownerLoginResp)
	ownerTok := ownerLoginResp.Data.AccessToken

	require.Equal(t, http.StatusCreated, doJSONReq(r, http.MethodPost, "/api/v1/restaurant/owner-profile", ownerTok, map[string]any{
		"id_document_type": "PAN_CARD", "id_document_number": "OSDOC" + sfx[:4],
	}).Code)
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/restaurant-owners/"+ownerLoginResp.Data.User.ID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)

	wOnb := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/onboarding", ownerTok, map[string]any{
		"setup_type": "NEW_OUTLET", "name": "Trattoria Nova " + sfx, "branch_name": "Whitefield",
		"service_zone_id": zoneID, "cuisines": []string{"Italian"},
		"phone": "+91-80-44556677", "email": ownerEmail,
		"address_line1": "22 Whitefield Main Rd", "city": "Bengaluru", "state": "KA", "postal_code": "560066",
		"license_number": "FSSAI-OS-" + sfx, "lat": 12.95, "lng": 77.75,
	})
	require.Equal(t, http.StatusCreated, wOnb.Code, wOnb.Body.String())
	var outResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wOnb.Body.Bytes(), &outResp)
	outletID := outResp.Data.ID
	require.Equal(t, http.StatusOK, doJSONReq(r, http.MethodPost, "/api/v1/admin/outlets/"+outletID+"/verify", saTok, map[string]any{"status": "APPROVED"}).Code)

	wCat := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/menu/categories?outlet_id="+outletID, ownerTok, map[string]any{"name": "Artisan Mains"})
	require.Equal(t, http.StatusCreated, wCat.Code)
	var catResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(wCat.Body.Bytes(), &catResp)

	// Notice NONE of these titles contain the literal word "pasta" — OpenSearch synonym graph matches them!
	dishes := []map[string]any{
		{
			"category_id":        catResp.Data.ID,
			"name":               "Penne Arrabbiata " + sfx,
			"description":        "Fiery chilli garlic San Marzano sauce",
			"veg_classification": "VEG",
			"cuisine_type":       "Italian",
			"spice_level":        "HOT",
			"serving_size":       "360g",
			"prep_time_minutes":  18,
			"calories_kcal":      540,
			"dietary_tags":       []string{"Vegetarian", "Vegan"},
			"allergens":          []string{"Gluten"},
			"ingredients":        []string{"Durum wheat", "San Marzano tomato", "Garlic"},
			"search_keywords":    []string{"spicy italian", "dairy free"},
			"is_recommended":     true,
			"base_price_minor":   41000,
			"customization_groups": []map[string]any{
				{
					"name":           "Extra Toppings",
					"min_selections": 0,
					"max_selections": 2,
					"is_required":    false,
					"options": []map[string]any{
						{"name": "Roasted Broccoli", "price_delta_minor": 6000},
					},
				},
			},
		},
		{
			"category_id":        catResp.Data.ID,
			"name":               "Spaghetti Aglio e Olio " + sfx,
			"description":        "Cold pressed olive oil, toasted garlic and parsley",
			"veg_classification": "NON_VEG",
			"base_price_minor":   39000,
		},
		{
			"category_id":        catResp.Data.ID,
			"name":               "Fettuccine Alfredo " + sfx,
			"description":        "Silky parmesan cream ribbons made with farm eggs",
			"veg_classification": "EGG_ONLY",
			"base_price_minor":   44000,
		},
	}
	for _, d := range dishes {
		wCreate := doJSONReq(r, http.MethodPost, "/api/v1/restaurant/menu/items?outlet_id="+outletID, ownerTok, d)
		require.Equal(t, http.StatusCreated, wCreate.Code, wCreate.Body.String())
	}

	// Verify customer searching "pasta" locates Penne, Spaghetti, AND Fettuccine via OpenSearch!
	wSearchPasta := doJSONReq(r, http.MethodGet, "/api/v1/customer/discovery/search?q=pasta&lat=12.95&lng=77.75", "", nil)
	require.Equal(t, http.StatusOK, wSearchPasta.Code, wSearchPasta.Body.String())
	assert.Contains(t, wSearchPasta.Body.String(), "Penne Arrabbiata "+sfx)
	assert.Contains(t, wSearchPasta.Body.String(), "Spaghetti Aglio e Olio "+sfx)
	assert.Contains(t, wSearchPasta.Body.String(), "Fettuccine Alfredo "+sfx)
	assert.Contains(t, wSearchPasta.Body.String(), `"veg_classification":"EGG_ONLY"`)
	assert.Contains(t, wSearchPasta.Body.String(), `"veg_classification":"NON_VEG"`)

	// Verify searching by ingredient, custom keyword, and customization option also locates Penne Arrabbiata
	wSearchIng := doJSONReq(r, http.MethodGet, "/api/v1/customer/discovery/search?q=San+Marzano&lat=12.95&lng=77.75", "", nil)
	assert.Contains(t, wSearchIng.Body.String(), "Penne Arrabbiata "+sfx)
	wSearchOpt := doJSONReq(r, http.MethodGet, "/api/v1/customer/discovery/search?q=Roasted+Broccoli&lat=12.95&lng=77.75", "", nil)
	assert.Contains(t, wSearchOpt.Body.String(), "Penne Arrabbiata "+sfx)
}
