package admin

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
)

var nonDeletableCoreRoles = []string{
	"PLATFORM_ADMIN",
	"CUSTOMER",
	"OUTLET_OWNER",
	"BRANCH_MANAGER",
	"OUTLET_STAFF",
	"DELIVERY_PARTNER",
}

func (h *Handler) authorizeTargetUserManage(ctx context.Context, c *gin.Context, targetID string) bool {
	actor, err := h.authRepo.GetUserByID(ctx, auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Unauthorized.", nil)
		return false
	}
	if slices.Contains(actor.Permissions, "users:manage") {
		return true
	}
	target, err := h.authRepo.GetUserByID(ctx, targetID)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "User not found.", nil)
		return false
	}
	for _, r := range target.Roles {
		switch {
		case (r == "PLATFORM_ADMIN" || r == "OPS_ADMIN" || r == "FINANCE_ADMIN" || r == "CUSTOMER_CARE" || strings.HasPrefix(r, "CUSTOM_")) &&
			slices.Contains(actor.Permissions, "users:management:manage"):
			return true
		case (r == "OUTLET_OWNER" || r == "RESTAURANT_OWNER") &&
			slices.Contains(actor.Permissions, "users:owners:manage"):
			return true
		case (r == "BRANCH_MANAGER" || r == "OUTLET_STAFF") &&
			slices.Contains(actor.Permissions, "users:outlets:manage"):
			return true
		case r == "DELIVERY_PARTNER" &&
			slices.Contains(actor.Permissions, "users:delivery:manage"):
			return true
		case r == "CUSTOMER" &&
			slices.Contains(actor.Permissions, "users:customers:manage"):
			return true
		}
	}
	httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Missing granular manage permission for this user category.", nil)
	return false
}

func (h *Handler) deleteRole(c *gin.Context) {
	actor, err := h.authRepo.GetUserByID(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil || !slices.Contains(actor.Roles, "PLATFORM_ADMIN") {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Only Super Admin can delete platform roles.", nil)
		return
	}
	roleID := c.Param("roleId")
	var roleCode string
	if err := h.pool.QueryRow(c.Request.Context(), `SELECT code FROM roles WHERE id = $1`, roleID).Scan(&roleCode); err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Role not found.", nil)
		return
	}
	if slices.Contains(nonDeletableCoreRoles, roleCode) {
		httputil.Fail(c, http.StatusBadRequest, "PROTECTED_ROLE", "Core platform roles cannot be deleted.", nil)
		return
	}

	err = database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(c.Request.Context(), `DELETE FROM platform_invitations WHERE role_id = $1`, roleID); err != nil {
			return err
		}
		if _, err := tx.Exec(c.Request.Context(), `DELETE FROM user_roles WHERE role_id = $1`, roleID); err != nil {
			return err
		}
		if _, err := tx.Exec(c.Request.Context(), `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
			return err
		}
		_, err := tx.Exec(c.Request.Context(), `DELETE FROM roles WHERE id = $1`, roleID)
		return err
	})
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not delete role.", nil)
		return
	}
	httputil.OK(c, gin.H{"deleted": true, "id": roleID})
}

func (h *Handler) updateManagementUserRoles(c *gin.Context) {
	targetID := c.Param("userId")
	if targetID == auth.CurrentUserID(c) {
		httputil.Fail(c, http.StatusBadRequest, "CANNOT_MODIFY_SELF_ROLE", "You cannot modify your own admin roles or permissions.", nil)
		return
	}
	var req struct {
		RoleID            string    `json:"role_id"`
		RoleCodes         []string  `json:"role_codes"`
		CustomPermissions *[]string `json:"custom_permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	targetRoleIDs := make([]string, 0)
	if strings.TrimSpace(req.RoleID) != "" {
		var rid string
		if err := h.pool.QueryRow(c.Request.Context(), `SELECT id FROM roles WHERE id = $1`, strings.TrimSpace(req.RoleID)).Scan(&rid); err != nil {
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Selected role not found.", nil)
			return
		}
		targetRoleIDs = append(targetRoleIDs, rid)
	}
	for _, rc := range req.RoleCodes {
		if strings.TrimSpace(rc) == "" {
			continue
		}
		var rid string
		if err := h.pool.QueryRow(c.Request.Context(), `SELECT id FROM roles WHERE code = $1`, strings.TrimSpace(rc)).Scan(&rid); err != nil {
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Role code not found: "+rc, nil)
			return
		}
		if !slices.Contains(targetRoleIDs, rid) {
			targetRoleIDs = append(targetRoleIDs, rid)
		}
	}
	if len(targetRoleIDs) == 0 && req.CustomPermissions == nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Specify role_id, role_codes, or custom_permissions.", nil)
		return
	}

	actorID := auth.CurrentUserID(c)
	err := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(c.Request.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)`, targetID).Scan(&exists); err != nil || !exists {
			return pgx.ErrNoRows
		}
		if len(targetRoleIDs) > 0 {
			// Replace management/admin roles while preserving consumer/outlet/delivery roles if held
			if _, err := tx.Exec(c.Request.Context(), `
				DELETE FROM user_roles ur
				USING roles r
				WHERE ur.role_id = r.id
				  AND ur.user_id = $1
				  AND r.code NOT IN ('CUSTOMER', 'OUTLET_OWNER', 'BRANCH_MANAGER', 'OUTLET_STAFF', 'DELIVERY_PARTNER')
			`, targetID); err != nil {
				return err
			}
			for _, rid := range targetRoleIDs {
				if _, err := tx.Exec(c.Request.Context(), `
					INSERT INTO user_roles (user_id, role_id, granted_by)
					VALUES ($1, $2, $3)
					ON CONFLICT DO NOTHING
				`, targetID, rid, actorID); err != nil {
					return err
				}
			}
			// Keep platform_invitations in sync so stale invitation overrides do not re-inject old permissions
			_, _ = tx.Exec(c.Request.Context(), `UPDATE platform_invitations SET role_id = $2, custom_permissions = NULL WHERE user_id = $1 AND status = 'ACTIVE'`, targetID, targetRoleIDs[0])
		}
		if req.CustomPermissions != nil {
			if _, err := tx.Exec(c.Request.Context(), `
				INSERT INTO user_admin_permissions (user_id, permissions, updated_by, updated_at)
				VALUES ($1, $2, $3, NOW())
				ON CONFLICT (user_id) DO UPDATE
				SET permissions = EXCLUDED.permissions, updated_by = EXCLUDED.updated_by, updated_at = NOW()
			`, targetID, *req.CustomPermissions, actorID); err != nil {
				return err
			}
			_, _ = tx.Exec(c.Request.Context(), `UPDATE platform_invitations SET custom_permissions = NULL WHERE user_id = $1 AND status = 'ACTIVE'`, targetID)
		}
		return nil
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "User not found.", nil)
			return
		}
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update user roles.", nil)
		return
	}

	updated, err := h.authRepo.GetUserByID(c.Request.Context(), targetID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Updated roles but could not reload user.", nil)
		return
	}
	httputil.OK(c, gin.H{"user_id": updated.ID, "roles": updated.Roles, "permissions": updated.Permissions})
}

func (h *Handler) listDirectoryCustomers(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT u.id, u.full_name, u.email, u.phone, u.status, u.is_email_verified, u.created_at,
		       COALESCE((SELECT COUNT(*) FROM customer_addresses ca WHERE ca.user_id = u.id), 0),
		       COALESCE((SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id), 0),
		       COALESCE((SELECT SUM(o.total_payable_minor) FROM orders o WHERE o.customer_id = u.id AND o.payment_status = 'CAPTURED'), 0)
		FROM users u
		WHERE u.deleted_at IS NULL
		  AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = 'CUSTOMER')
		ORDER BY u.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load customers directory.", nil)
		return
	}
	defer rows.Close()
	out := make([]gin.H, 0)
	for rows.Next() {
		var id, name, email, phone, status string
		var emailVer bool
		var createdAt time.Time
		var addrCount, ordersCount int
		var totalSpent int64
		if err := rows.Scan(&id, &name, &email, &phone, &status, &emailVer, &createdAt, &addrCount, &ordersCount, &totalSpent); err != nil {
			continue
		}
		out = append(out, gin.H{
			"id": id, "full_name": name, "email": email, "phone": phone, "status": status,
			"is_email_verified": emailVer, "created_at": createdAt,
			"addresses_count": addrCount, "orders_count": ordersCount, "total_spent_minor": totalSpent,
		})
	}
	httputil.OK(c, out)
}

func (h *Handler) listDirectoryOwners(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
		       COALESCE(op.organization_name, ''),
		       COALESCE(op.verification_status, 'NOT_SUBMITTED'),
		       COALESCE(op.id_document_type, ''),
		       COALESCE(op.id_document_number, ''),
		       COALESCE((SELECT COUNT(*) FROM restaurants rest WHERE rest.owner_user_id = u.id AND rest.is_active = TRUE), 0),
		       COALESCE((SELECT COUNT(*) FROM restaurants rest WHERE rest.owner_user_id = u.id AND rest.is_active = TRUE AND rest.verification_status = 'APPROVED'), 0)
		FROM users u
		LEFT JOIN restaurant_owner_profiles op ON op.user_id = u.id
		WHERE u.deleted_at IS NULL
		  AND (
		    op.id IS NOT NULL
		    OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code IN ('OUTLET_OWNER', 'RESTAURANT_OWNER'))
		  )
		ORDER BY u.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load owners directory.", nil)
		return
	}
	defer rows.Close()
	out := make([]gin.H, 0)
	for rows.Next() {
		var id, name, email, phone, status, org, kycStatus, docType, docNum string
		var createdAt time.Time
		var outletsCount, approvedOutletsCount int
		if err := rows.Scan(&id, &name, &email, &phone, &status, &createdAt, &org, &kycStatus, &docType, &docNum, &outletsCount, &approvedOutletsCount); err != nil {
			continue
		}
		out = append(out, gin.H{
			"id": id, "full_name": name, "email": email, "phone": phone, "status": status,
			"created_at": createdAt, "organization_name": org, "kyc_status": kycStatus,
			"id_document_type": docType, "id_document_number": docNum,
			"outlets_count": outletsCount, "approved_outlets_count": approvedOutletsCount,
		})
	}
	httputil.OK(c, out)
}

func (h *Handler) listDirectoryOutlets(c *gin.Context) {
	oRows, err := h.pool.Query(c.Request.Context(), `
		SELECT r.id, r.name, COALESCE(r.brand_name, ''), COALESCE(r.branch_name, ''), r.city,
		       r.verification_status, r.is_accepting_orders, r.owner_user_id, u.full_name, u.email,
		       COALESCE((SELECT COUNT(*) FROM menu_items mi WHERE mi.restaurant_id = r.id AND mi.is_active = TRUE), 0),
		       COALESCE((SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id), 0),
		       COALESCE((SELECT COUNT(*) FROM outlet_staff_assignments osa WHERE osa.outlet_id = r.id AND osa.status = 'ACTIVE'), 0)
		FROM restaurants r
		JOIN users u ON u.id = r.owner_user_id
		WHERE u.deleted_at IS NULL AND r.is_active = TRUE
		ORDER BY r.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load outlets directory.", nil)
		return
	}
	defer oRows.Close()
	outlets := make([]gin.H, 0)
	for oRows.Next() {
		var id, name, brand, branch, city, status, ownerID, ownerName, ownerEmail string
		var accepting bool
		var menuCount, ordersCount, staffCount int
		if err := oRows.Scan(&id, &name, &brand, &branch, &city, &status, &accepting, &ownerID, &ownerName, &ownerEmail, &menuCount, &ordersCount, &staffCount); err != nil {
			continue
		}
		outlets = append(outlets, gin.H{
			"id": id, "name": name, "brand_name": brand, "branch_name": branch, "city": city,
			"verification_status": status, "is_accepting_orders": accepting,
			"owner_user_id": ownerID, "owner_name": ownerName, "owner_email": ownerEmail,
			"menu_items_count": menuCount, "orders_count": ordersCount, "staff_count": staffCount,
		})
	}

	sRows, err := h.pool.Query(c.Request.Context(), `
		SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
		       COALESCE(ARRAY_AGG(DISTINCT rest.name || CASE WHEN COALESCE(rest.branch_name, '') <> '' THEN ' · ' || rest.branch_name ELSE '' END) FILTER (WHERE rest.id IS NOT NULL), '{}'),
		       COALESCE(ARRAY_AGG(DISTINCT osa.role_code) FILTER (WHERE osa.id IS NOT NULL), '{}')
		FROM users u
		LEFT JOIN outlet_staff_assignments osa ON osa.user_id = u.id AND osa.status IN ('ACTIVE', 'PENDING_ACCEPTANCE', 'PENDING_APPROVAL')
		LEFT JOIN restaurants rest ON rest.id = osa.outlet_id
		WHERE u.deleted_at IS NULL
		  AND (
		    osa.id IS NOT NULL
		    OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code IN ('BRANCH_MANAGER', 'OUTLET_STAFF'))
		  )
		GROUP BY u.id
		ORDER BY u.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load outlet staff directory.", nil)
		return
	}
	defer sRows.Close()
	staff := make([]gin.H, 0)
	for sRows.Next() {
		var id, name, email, phone, status string
		var createdAt time.Time
		var outletNames, staffRoles []string
		if err := sRows.Scan(&id, &name, &email, &phone, &status, &createdAt, &outletNames, &staffRoles); err != nil {
			continue
		}
		staff = append(staff, gin.H{
			"id": id, "full_name": name, "email": email, "phone": phone, "status": status,
			"created_at": createdAt, "outlet_names": outletNames, "staff_roles": staffRoles,
		})
	}
	httputil.OK(c, gin.H{"outlets": outlets, "staff": staff})
}

func (h *Handler) listDirectoryManagement(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT u.id
		FROM users u
		WHERE u.deleted_at IS NULL
		  AND (
		    EXISTS (
		      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
		      WHERE ur.user_id = u.id AND r.code NOT IN ('CUSTOMER', 'OUTLET_OWNER', 'RESTAURANT_OWNER', 'BRANCH_MANAGER', 'OUTLET_STAFF', 'DELIVERY_PARTNER')
		    )
		    OR EXISTS (
		      SELECT 1 FROM platform_invitations pi
		      WHERE pi.user_id = u.id AND pi.status IN ('PENDING_ACCEPTANCE', 'PENDING_ADMIN_APPROVAL', 'ACTIVE')
		    )
		  )
		ORDER BY u.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load management directory.", nil)
		return
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	out := make([]gin.H, 0, len(ids))
	for _, id := range ids {
		u, err := h.authRepo.GetUserByID(c.Request.Context(), id)
		if err != nil {
			continue
		}
		out = append(out, gin.H{
			"id":                u.ID,
			"full_name":         u.FullName,
			"email":             u.Email,
			"phone":             u.Phone,
			"status":            u.Status,
			"is_email_verified": u.IsEmailVerified,
			"roles":             u.Roles,
			"permissions":       u.Permissions,
			"created_at":        u.CreatedAt,
		})
	}
	httputil.OK(c, out)
}

func (h *Handler) listDirectoryDelivery(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
		       COALESCE(dp.id::text, ''), COALESCE(dp.vehicle_type, ''), COALESCE(dp.vehicle_make_model, ''),
		       COALESCE(dp.license_plate, ''), COALESCE(dp.verification_status, 'NOT_SUBMITTED'),
		       COALESCE(dp.availability_status, 'OFFLINE'), COALESCE(dp.total_deliveries_count, 0),
		       COALESCE(dp.rating_average::float8, 5.0)
		FROM users u
		LEFT JOIN delivery_partners dp ON dp.user_id = u.id
		WHERE u.deleted_at IS NULL
		  AND (
		    dp.id IS NOT NULL
		    OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = 'DELIVERY_PARTNER')
		  )
		ORDER BY u.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load delivery directory.", nil)
		return
	}
	defer rows.Close()
	out := make([]gin.H, 0)
	for rows.Next() {
		var id, name, email, phone, status, dpID, vType, vModel, plate, verStatus, availStatus string
		var createdAt time.Time
		var totalDeliv int
		var rating float64
		if err := rows.Scan(&id, &name, &email, &phone, &status, &createdAt, &dpID, &vType, &vModel, &plate, &verStatus, &availStatus, &totalDeliv, &rating); err != nil {
			continue
		}
		out = append(out, gin.H{
			"id": id, "full_name": name, "email": email, "phone": phone, "status": status, "created_at": createdAt,
			"partner_id": dpID, "vehicle_type": vType, "vehicle_make_model": vModel, "license_plate": plate,
			"verification_status": verStatus, "availability_status": availStatus,
			"total_deliveries_count": totalDeliv, "rating_average": rating,
		})
	}
	httputil.OK(c, out)
}

func (h *Handler) getUserDetail(c *gin.Context) {
	userID := c.Param("userId")
	u, err := h.authRepo.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "User not found.", nil)
		return
	}

	// Saved customer addresses
	addrRows, _ := h.pool.Query(c.Request.Context(), `
		SELECT id, label, address_line1, city, postal_code, is_default
		FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 10
	`, userID)
	addresses := make([]gin.H, 0)
	if addrRows != nil {
		defer addrRows.Close()
		for addrRows.Next() {
			var aid, lbl, line1, city, pc string
			var isDef bool
			if addrRows.Scan(&aid, &lbl, &line1, &city, &pc, &isDef) == nil {
				addresses = append(addresses, gin.H{
					"id": aid, "label": lbl, "address_line1": line1, "city": city, "postal_code": pc, "is_default": isDef,
				})
			}
		}
	}

	// Customer recent orders
	ordRows, _ := h.pool.Query(c.Request.Context(), `
		SELECT o.id, o.order_number, r.name, o.order_status, o.total_payable_minor, o.created_at
		FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
		WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 10
	`, userID)
	orders := make([]gin.H, 0)
	if ordRows != nil {
		defer ordRows.Close()
		for ordRows.Next() {
			var oid, num, rname, st string
			var total int64
			var cat time.Time
			if ordRows.Scan(&oid, &num, &rname, &st, &total, &cat) == nil {
				orders = append(orders, gin.H{
					"id": oid, "order_number": num, "restaurant_name": rname, "order_status": st, "total_payable_minor": total, "created_at": cat,
				})
			}
		}
	}

	var complaintsCount int
	_ = h.pool.QueryRow(c.Request.Context(), `SELECT COUNT(*) FROM complaints WHERE raised_by_user_id = $1`, userID).Scan(&complaintsCount)

	// Owner profile & owned outlets
	var ownerProfile gin.H
	var opID, orgName, docType, docNum, docFile, kycStatus string
	if h.pool.QueryRow(c.Request.Context(), `
		SELECT id, COALESCE(organization_name, ''), id_document_type, id_document_number, COALESCE(id_document_filename, ''), verification_status
		FROM restaurant_owner_profiles WHERE user_id = $1
	`, userID).Scan(&opID, &orgName, &docType, &docNum, &docFile, &kycStatus) == nil {
		ownerProfile = gin.H{
			"id": opID, "organization_name": orgName, "id_document_type": docType,
			"id_document_number": docNum, "id_document_filename": docFile, "verification_status": kycStatus,
		}
	}

	ownedRows, _ := h.pool.Query(c.Request.Context(), `
		SELECT id, name, COALESCE(brand_name, ''), COALESCE(branch_name, ''), city, verification_status, is_accepting_orders
		FROM restaurants WHERE owner_user_id = $1 AND is_active = TRUE ORDER BY created_at DESC
	`, userID)
	ownedOutlets := make([]gin.H, 0)
	if ownedRows != nil {
		defer ownedRows.Close()
		for ownedRows.Next() {
			var rid, rname, brand, branch, city, st string
			var acc bool
			if ownedRows.Scan(&rid, &rname, &brand, &branch, &city, &st, &acc) == nil {
				ownedOutlets = append(ownedOutlets, gin.H{
					"id": rid, "name": rname, "brand_name": brand, "branch_name": branch,
					"city": city, "verification_status": st, "is_accepting_orders": acc,
				})
			}
		}
	}

	// Outlet staff assignments
	staffRows, _ := h.pool.Query(c.Request.Context(), `
		SELECT osa.id, rest.id, rest.name, COALESCE(rest.branch_name, ''), osa.role_code, COALESCE(osa.outlet_role_name, ''), osa.permissions, osa.status
		FROM outlet_staff_assignments osa
		JOIN restaurants rest ON rest.id = osa.outlet_id
		WHERE osa.user_id = $1
		ORDER BY osa.created_at DESC
	`, userID)
	staffAssignments := make([]gin.H, 0)
	if staffRows != nil {
		defer staffRows.Close()
		for staffRows.Next() {
			var sid, oid, oname, br, rcode, orname, st string
			var perms []string
			if staffRows.Scan(&sid, &oid, &oname, &br, &rcode, &orname, &perms, &st) == nil {
				staffAssignments = append(staffAssignments, gin.H{
					"id": sid, "outlet_id": oid, "outlet_name": oname, "branch_name": br,
					"role_code": rcode, "outlet_role_name": orname, "permissions": perms, "status": st,
				})
			}
		}
	}

	// Delivery partner profile & recent deliveries
	var partnerProfile gin.H
	var dpID, vType, vModel, plate, pVer, pAvail string
	var totalDeliv int
	var rating float64
	if h.pool.QueryRow(c.Request.Context(), `
		SELECT id, vehicle_type, COALESCE(vehicle_make_model, ''), COALESCE(license_plate, ''),
		       verification_status, availability_status, total_deliveries_count, rating_average::float8
		FROM delivery_partners WHERE user_id = $1
	`, userID).Scan(&dpID, &vType, &vModel, &plate, &pVer, &pAvail, &totalDeliv, &rating) == nil {
		partnerProfile = gin.H{
			"id": dpID, "vehicle_type": vType, "vehicle_make_model": vModel, "license_plate": plate,
			"verification_status": pVer, "availability_status": pAvail,
			"total_deliveries_count": totalDeliv, "rating_average": rating,
		}
	}

	recentDeliveries := make([]gin.H, 0)
	if dpID != "" {
		dRows, _ := h.pool.Query(c.Request.Context(), `
			SELECT o.order_number, r.name, d.status, o.total_payable_minor, d.created_at
			FROM deliveries d
			JOIN orders o ON o.id = d.order_id
			JOIN restaurants r ON r.id = o.restaurant_id
			WHERE d.partner_id = $1
			ORDER BY d.created_at DESC LIMIT 10
		`, dpID)
		if dRows != nil {
			defer dRows.Close()
			for dRows.Next() {
				var onum, rname, dst string
				var total int64
				var cat time.Time
				if dRows.Scan(&onum, &rname, &dst, &total, &cat) == nil {
					recentDeliveries = append(recentDeliveries, gin.H{
						"order_number": onum, "restaurant_name": rname, "status": dst, "total_payable_minor": total, "created_at": cat,
					})
				}
			}
		}
	}

	httputil.OK(c, gin.H{
		"user": gin.H{
			"id": u.ID, "full_name": u.FullName, "email": u.Email, "phone": u.Phone,
			"status": u.Status, "is_email_verified": u.IsEmailVerified, "is_phone_verified": u.IsPhoneVerified,
			"roles": u.Roles, "permissions": u.Permissions, "created_at": u.CreatedAt,
		},
		"addresses":         addresses,
		"orders":            orders,
		"complaints_count":  complaintsCount,
		"owner_profile":     ownerProfile,
		"owned_outlets":     ownedOutlets,
		"staff_assignments": staffAssignments,
		"partner_profile":   partnerProfile,
		"recent_deliveries": recentDeliveries,
	})
}

func (h *Handler) getOutletDetail(c *gin.Context) {
	outletID := c.Param("outletId")
	var id, name, brand, branch, addr, city, state, postal, phone, email, status, ownerID, ownerName, ownerEmail string
	var accepting bool
	var avgPrep int
	var maxConc *int
	err := h.pool.QueryRow(c.Request.Context(), `
		SELECT r.id, r.name, COALESCE(r.brand_name, ''), COALESCE(r.branch_name, ''),
		       r.address_line1, r.city, r.state, r.postal_code, r.phone, r.email,
		       r.verification_status, r.is_accepting_orders, r.avg_prep_time_minutes, r.max_concurrent_orders,
		       u.id, u.full_name, u.email
		FROM restaurants r
		JOIN users u ON u.id = r.owner_user_id
		WHERE r.id = $1
	`, outletID).Scan(&id, &name, &brand, &branch, &addr, &city, &state, &postal, &phone, &email, &status, &accepting, &avgPrep, &maxConc, &ownerID, &ownerName, &ownerEmail)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Outlet not found.", nil)
		return
	}

	var menuCount, ordersCount int
	var gmv int64
	_ = h.pool.QueryRow(c.Request.Context(), `SELECT COUNT(*) FROM menu_items WHERE restaurant_id = $1 AND is_active = TRUE`, outletID).Scan(&menuCount)
	_ = h.pool.QueryRow(c.Request.Context(), `SELECT COUNT(*), COALESCE(SUM(total_payable_minor), 0) FROM orders WHERE restaurant_id = $1`, outletID).Scan(&ordersCount, &gmv)

	sRows, _ := h.pool.Query(c.Request.Context(), `
		SELECT osa.id, COALESCE(u.full_name, 'Invited Member'), COALESCE(u.email, osa.invited_email, ''),
		       COALESCE(osa.outlet_role_name, osa.role_code), osa.permissions, osa.status
		FROM outlet_staff_assignments osa
		LEFT JOIN users u ON u.id = osa.user_id
		WHERE osa.outlet_id = $1
		ORDER BY osa.created_at DESC
	`, outletID)
	staff := make([]gin.H, 0)
	if sRows != nil {
		defer sRows.Close()
		for sRows.Next() {
			var sid, sname, semail, role, st string
			var perms []string
			if sRows.Scan(&sid, &sname, &semail, &role, &perms, &st) == nil {
				staff = append(staff, gin.H{
					"id": sid, "full_name": sname, "email": semail, "role": role, "permissions": perms, "status": st,
				})
			}
		}
	}

	httputil.OK(c, gin.H{
		"outlet": gin.H{
			"id": id, "name": name, "brand_name": brand, "branch_name": branch,
			"address_line1": addr, "city": city, "state": state, "postal_code": postal,
			"phone": phone, "email": email, "verification_status": status, "is_accepting_orders": accepting,
			"avg_prep_time_minutes": avgPrep, "max_concurrent_orders": maxConc,
			"owner_user_id": ownerID, "owner_name": ownerName, "owner_email": ownerEmail,
			"menu_items_count": menuCount, "orders_count": ordersCount, "total_gmv_minor": gmv,
		},
		"staff": staff,
	})
}
