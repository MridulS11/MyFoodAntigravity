package restaurants

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/mailer"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// Handler exposes /api/v1/outlets and /api/v1/restaurants/me endpoints.
type Handler struct {
	repo   *Repository
	tokens *auth.TokenManager
	rdb    *platformredis.Client
	mailer mailer.Mailer
}

// NewHandler creates a restaurants Handler.
func NewHandler(repo *Repository, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{repo: repo, tokens: tokens, rdb: rdb}
}

// SetMailer attaches a transactional mailer for outlet onboarding/KYC notifications.
func (h *Handler) SetMailer(m mailer.Mailer) {
	h.mailer = m
}

// RegisterRoutes attaches multi-outlet management routes under isolated restaurant portal auth.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	v1.GET("/service-zones", h.listServiceZones)

	portalRoles := auth.RequireRoles("OUTLET_OWNER", "BRANCH_MANAGER", "OUTLET_STAFF", "RESTAURANT_OWNER", "CUSTOMER")

	mountOutlets := func(prefix string) {
		outlets := v1.Group(prefix)
		outlets.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "restaurant"), portalRoles)
		{
			outlets.GET("", h.listMyOutlets)
			outlets.GET("/roles", h.listOutletRoles)
			outlets.POST("/roles", h.createOutletRole)
			outlets.PATCH("/roles/:roleId", h.updateOutletRole)
			outlets.POST("/staff/invite", h.assignStaffMulti)
			outlets.GET("/:outletId/staff", h.listStaff)
			outlets.POST("/:outletId/staff", h.assignStaff)
			outlets.POST("/:outletId/staff/:assignmentId/approve", h.approveStaff)
			outlets.DELETE("/:outletId/staff/:assignmentId", h.revokeStaff)
		}
	}
	mountOutlets("/outlets")
	mountOutlets("/restaurant/outlets")

	mountRest := func(prefix string) {
		rest := v1.Group(prefix)
		rest.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "restaurant"), portalRoles)
		{
			rest.GET("/owner-profile", h.getOwnerProfile)
			rest.POST("/owner-profile", h.submitOwnerProfile)
			rest.POST("/onboarding", h.submitOnboarding)
			rest.GET("/me", h.getActiveOutlet)
			rest.PATCH("/me", h.updateSettings)
			rest.PATCH("/me/availability", h.toggleAvailability)
			rest.PUT("/me/operating-hours", h.replaceOperatingHours)
			rest.GET("/me/settlements", h.getSettlements)
		}
	}
	mountRest("/restaurants")
	mountRest("/restaurant")

	// Also expose /restaurant/roles cleanly alongside /restaurant/outlets/roles
	restDirect := v1.Group("/restaurant")
	restDirect.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "restaurant"), portalRoles)
	{
		restDirect.GET("/roles", h.listOutletRoles)
		restDirect.POST("/roles", h.createOutletRole)
		restDirect.PATCH("/roles/:roleId", h.updateOutletRole)
		restDirect.GET("/staff", h.listAllStaff)
		restDirect.POST("/staff/invite", h.assignStaffMulti)
	}
}

func (h *Handler) resolveOutletID(c *gin.Context) (string, error) {
	requested := c.Query("outlet_id")
	if requested == "" {
		requested = c.GetHeader("X-Outlet-ID")
	}
	if requested != "" {
		return requested, nil
	}
	list, err := h.repo.ListMyOutlets(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		return "", err
	}
	if len(list) == 0 {
		return "", ErrOutletNotFound
	}
	return list[0].ID, nil
}

func (h *Handler) listMyOutlets(c *gin.Context) {
	list, err := h.repo.ListMyOutlets(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch outlets.", nil)
		return
	}
	httputil.OK(c, list)
}

func (h *Handler) requireAnyOutletAccess(c *gin.Context) bool {
	list, err := h.repo.ListMyOutlets(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not verify outlet access.", nil)
		return false
	}
	if len(list) == 0 {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "Restaurant portal access is locked until you accept an outlet invitation (with approval) or onboard your own outlet.", nil)
		return false
	}
	return true
}

func (h *Handler) getActiveOutlet(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership. Accept an outlet invitation (with approval) or onboard an outlet.", nil)
		return
	}
	if err := h.repo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, ""); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	o, err := h.repo.GetOutletByID(c.Request.Context(), outletID)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Outlet not found.", nil)
		return
	}
	httputil.OK(c, o)
}

func (h *Handler) getOwnerProfile(c *gin.Context) {
	prof, err := h.repo.GetOwnerProfile(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load owner profile.", nil)
		return
	}
	httputil.OK(c, prof)
}

func (h *Handler) submitOwnerProfile(c *gin.Context) {
	var req struct {
		OrganizationName   string `json:"organization_name"`
		IDDocumentType     string `json:"id_document_type" binding:"required"`
		IDDocumentNumber   string `json:"id_document_number" binding:"required,min=4"`
		IDDocumentFilename string `json:"id_document_filename"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	prof, err := h.repo.UpsertOwnerProfile(
		c.Request.Context(), auth.CurrentUserID(c),
		req.OrganizationName, req.IDDocumentType, req.IDDocumentNumber, req.IDDocumentFilename,
	)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not submit owner profile.", nil)
		return
	}
	if h.mailer != nil && prof.Email != "" {
		targetLabel := prof.FullName
		if prof.OrganizationName != nil && *prof.OrganizationName != "" {
			targetLabel = *prof.OrganizationName
		}
		mailer.DispatchAsyncOrSync(c.Request.Context(), h.mailer, "failed to send owner KYC pending email", func(sendCtx context.Context) error {
			return h.mailer.SendOnboardingKYCStatusEmail(sendCtx, prof.Email, prof.FullName, "RESTAURANT_OWNER", targetLabel, "PENDING_REVIEW", "")
		})
	}
	httputil.Created(c, prof)
}

func (h *Handler) submitOnboarding(c *gin.Context) {
	userID := auth.CurrentUserID(c)
	ownerProf, err := h.repo.GetOwnerProfile(c.Request.Context(), userID)
	if err != nil || ownerProf.VerificationStatus != "APPROVED" {
		httputil.Fail(c, http.StatusForbidden, "OWNER_KYC_REQUIRED", "Only verified restaurant owners can add outlets. Complete Owner Profile & ID KYC and await admin approval.", nil)
		return
	}

	var req struct {
		SetupType     string   `json:"setup_type"`
		Name          string   `json:"name" binding:"required,min=2"`
		BrandName     string   `json:"brand_name"`
		BranchName    string   `json:"branch_name"`
		ServiceZoneID string   `json:"service_zone_id" binding:"required"`
		Cuisines      []string `json:"cuisines" binding:"required,min=1"`
		Phone         string   `json:"phone" binding:"required"`
		Email         string   `json:"email" binding:"required,email"`
		AddressLine1  string   `json:"address_line1" binding:"required"`
		City          string   `json:"city" binding:"required"`
		State         string   `json:"state" binding:"required"`
		PostalCode    string   `json:"postal_code" binding:"required"`
		LicenseNumber string   `json:"license_number" binding:"required"`
		Lat           float64  `json:"lat"`
		Lng           float64  `json:"lng"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	outletGroup := req.BrandName
	if outletGroup == "" {
		outletGroup = req.Name
	}
	if req.SetupType == "NEW_OUTLET" || (req.SetupType == "" && req.BrandName == "") {
		dup, dErr := h.repo.HasDuplicateOutletName(c.Request.Context(), userID, outletGroup)
		if dErr == nil && dup {
			httputil.Fail(c, http.StatusConflict, "DUPLICATE_OUTLET_NAME", "An outlet with this name already exists under your account. Add a branch location instead.", nil)
			return
		}
	}
	if req.Lat == 0 && req.Lng == 0 {
		req.Lat = 12.9784
		req.Lng = 77.6408
	}
	created, err := h.repo.CreateOnboardingOutlet(
		c.Request.Context(), userID,
		req.Name, outletGroup, req.BranchName, req.ServiceZoneID,
		req.Cuisines, req.Phone, req.Email, req.AddressLine1, req.City, req.State, req.PostalCode,
		req.LicenseNumber, req.Lat, req.Lng,
	)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	if h.mailer != nil && created.Email != "" {
		mailer.DispatchAsyncOrSync(c.Request.Context(), h.mailer, "failed to send restaurant onboarding KYC email", func(sendCtx context.Context) error {
			return h.mailer.SendOnboardingKYCStatusEmail(sendCtx, created.Email, created.Name, "RESTAURANT_OUTLET", created.Name, "PENDING_REVIEW", "")
		})
	}
	httputil.Created(c, created)
}

func (h *Handler) updateSettings(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.repo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:capacity:configure"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		AvgPrepTimeMinutes  *int   `json:"avg_prep_time_minutes"`
		PackagingFeeMinor   *int64 `json:"packaging_fee_minor"`
		MinOrderAmountMinor *int64 `json:"min_order_amount_minor"`
		MaxConcurrentOrders *int   `json:"max_concurrent_orders"`
		ClearCapacityLimit  bool   `json:"clear_capacity_limit"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	updated, err := h.repo.UpdateOutletSettings(c.Request.Context(), outletID, req.AvgPrepTimeMinutes, req.PackagingFeeMinor, req.MinOrderAmountMinor, req.MaxConcurrentOrders, req.ClearCapacityLimit)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update outlet settings.", nil)
		return
	}
	h.invalidateCaches(c, updated.ID, updated.Slug)
	httputil.OK(c, updated)
}

func (h *Handler) toggleAvailability(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.repo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:hours:manage"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		IsAcceptingOrders bool    `json:"is_accepting_orders"`
		PauseReason       *string `json:"pause_reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	updated, err := h.repo.SetAvailability(c.Request.Context(), outletID, req.IsAcceptingOrders, req.PauseReason)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	h.invalidateCaches(c, updated.ID, updated.Slug)
	httputil.OK(c, updated)
}

func (h *Handler) replaceOperatingHours(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.repo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:hours:manage"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	var req struct {
		Slots []OperatingHourSlot `json:"slots" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	saved, err := h.repo.ReplaceOperatingHours(c.Request.Context(), outletID, req.Slots)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not save operating hours.", nil)
		return
	}
	httputil.OK(c, saved)
}

func (h *Handler) listStaff(c *gin.Context) {
	outletID := c.Param("outletId")
	if outletID == "all" {
		h.listAllStaff(c)
		return
	}
	if err := h.repo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, ""); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	list, err := h.repo.ListBranchStaff(c.Request.Context(), outletID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch branch staff.", nil)
		return
	}
	httputil.OK(c, list)
}

func (h *Handler) listAllStaff(c *gin.Context) {
	if !h.requireAnyOutletAccess(c) {
		return
	}
	list, err := h.repo.ListAllOwnerStaff(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch team roster.", nil)
		return
	}
	httputil.OK(c, list)
}

func (h *Handler) listServiceZones(c *gin.Context) {
	zones, err := h.repo.ListServiceZones(c.Request.Context())
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch service zones.", nil)
		return
	}
	httputil.OK(c, zones)
}

func (h *Handler) listOutletRoles(c *gin.Context) {
	if !h.requireAnyOutletAccess(c) {
		return
	}
	roles, err := h.repo.ListOutletRoles(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load outlet roles.", nil)
		return
	}
	httputil.OK(c, roles)
}

func (h *Handler) createOutletRole(c *gin.Context) {
	if !h.requireAnyOutletAccess(c) {
		return
	}
	var req struct {
		Name        string   `json:"name" binding:"required,min=2"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	role, err := h.repo.CreateOutletRole(c.Request.Context(), auth.CurrentUserID(c), req.Name, req.Description, req.Permissions)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	httputil.Created(c, role)
}

func (h *Handler) updateOutletRole(c *gin.Context) {
	if !h.requireAnyOutletAccess(c) {
		return
	}
	var req struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	role, err := h.repo.UpdateOutletRole(c.Request.Context(), auth.CurrentUserID(c), c.Param("roleId"), req.Name, req.Description, req.Permissions)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	httputil.OK(c, role)
}

func (h *Handler) assignStaff(c *gin.Context) {
	outletID := c.Param("outletId")
	o, err := h.repo.GetOutletByID(c.Request.Context(), outletID)
	if errors.Is(err, ErrOutletNotFound) || (err == nil && o.OwnerUserID != auth.CurrentUserID(c)) {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Only the Outlet Owner can invite or configure branch staff.", nil)
		return
	}
	var req struct {
		Email        string   `json:"email"`
		Phone        string   `json:"phone"`
		RoleCode     string   `json:"role_code"`
		OutletRoleID string   `json:"outlet_role_id"`
		Permissions  []string `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if req.RoleCode == "" {
		req.RoleCode = "OUTLET_STAFF"
	}
	assigned, err := h.repo.InviteBranchStaff(
		c.Request.Context(), auth.CurrentUserID(c), outletID,
		req.Email, req.Phone, req.RoleCode, req.OutletRoleID, req.Permissions,
	)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	httputil.Created(c, assigned)
}

func (h *Handler) assignStaffMulti(c *gin.Context) {
	var req struct {
		OutletID     string   `json:"outlet_id"`
		OutletIDs    []string `json:"outlet_ids"`
		Email        string   `json:"email"`
		Phone        string   `json:"phone"`
		RoleCode     string   `json:"role_code"`
		OutletRoleID string   `json:"outlet_role_id"`
		Permissions  []string `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	targets := req.OutletIDs
	if len(targets) == 0 && req.OutletID != "" {
		targets = []string{req.OutletID}
	}
	if len(targets) == 0 {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Select at least one outlet or branch for access.", nil)
		return
	}
	userID := auth.CurrentUserID(c)
	seen := make(map[string]bool, len(targets))
	uniqueTargets := make([]string, 0, len(targets))
	for _, id := range targets {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		o, err := h.repo.GetOutletByID(c.Request.Context(), id)
		if errors.Is(err, ErrOutletNotFound) || (err == nil && o.OwnerUserID != userID) {
			httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Only the Outlet Owner can invite or configure branch staff.", nil)
			return
		}
		uniqueTargets = append(uniqueTargets, id)
	}
	if req.RoleCode == "" {
		req.RoleCode = "OUTLET_STAFF"
	}
	created := make([]*StaffAssignment, 0, len(uniqueTargets))
	for _, oid := range uniqueTargets {
		assigned, err := h.repo.InviteBranchStaff(
			c.Request.Context(), userID, oid,
			req.Email, req.Phone, req.RoleCode, req.OutletRoleID, req.Permissions,
		)
		if err != nil {
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
			return
		}
		created = append(created, assigned)
	}
	httputil.Created(c, gin.H{"assignments": created, "first": created[0]})
}

func (h *Handler) approveStaff(c *gin.Context) {
	outletID := c.Param("outletId")
	o, err := h.repo.GetOutletByID(c.Request.Context(), outletID)
	if errors.Is(err, ErrOutletNotFound) || (err == nil && o.OwnerUserID != auth.CurrentUserID(c)) {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Only the Outlet Owner can approve branch staff access.", nil)
		return
	}
	approved, err := h.repo.ApproveBranchStaff(c.Request.Context(), auth.CurrentUserID(c), outletID, c.Param("assignmentId"))
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "APPROVAL_BLOCKED", err.Error(), nil)
		return
	}
	httputil.OK(c, approved)
}

func (h *Handler) revokeStaff(c *gin.Context) {
	outletID := c.Param("outletId")
	o, err := h.repo.GetOutletByID(c.Request.Context(), outletID)
	if errors.Is(err, ErrOutletNotFound) || (err == nil && o.OwnerUserID != auth.CurrentUserID(c)) {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Only the Outlet Owner can revoke branch staff access.", nil)
		return
	}
	if err := h.repo.RevokeBranchStaff(c.Request.Context(), outletID, c.Param("assignmentId")); err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
		return
	}
	httputil.OK(c, gin.H{"revoked": true})
}

func (h *Handler) getSettlements(c *gin.Context) {
	outletID, err := h.resolveOutletID(c)
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "RESTAURANT_ACCESS_LOCKED", "No active outlet membership.", nil)
		return
	}
	if err := h.repo.AuthorizeOutletAction(c.Request.Context(), auth.CurrentUserID(c), outletID, "outlet:reports:view"); err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", err.Error(), nil)
		return
	}
	settlements, penalties, err := h.repo.GetSettlementsAndPenalties(c.Request.Context(), auth.CurrentUserID(c), outletID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch settlements.", nil)
		return
	}
	httputil.OK(c, gin.H{"settlements": settlements, "penalties": penalties})
}

func (h *Handler) invalidateCaches(c *gin.Context, outletID, slug string) {
	if h.rdb == nil || h.rdb.Raw() == nil {
		return
	}
	ctx := c.Request.Context()
	_ = h.rdb.Raw().Del(ctx, "menu:outlet:"+outletID, "menu:slug:"+slug).Err()
}
