package admin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/mailer"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// PermissionInfo describes an available platform admin permission slug.
type PermissionInfo struct {
	Slug        string `json:"slug"`
	Description string `json:"description"`
}

// RoleInfo describes a platform/admin role and its assigned permissions.
type RoleInfo struct {
	ID          string   `json:"id"`
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsSystem    bool     `json:"is_system"`
	Permissions []string `json:"permissions"`
}

// AdminInvitationRow tracks an invited admin user through acceptance and approval.
type AdminInvitationRow struct {
	ID                string     `json:"id"`
	Email             *string    `json:"email,omitempty"`
	Phone             *string    `json:"phone,omitempty"`
	UserID            *string    `json:"user_id,omitempty"`
	InviteeName       *string    `json:"invitee_name,omitempty"`
	RoleID            string     `json:"role_id"`
	RoleCode          string     `json:"role_code"`
	RoleName          string     `json:"role_name"`
	CustomPermissions []string   `json:"custom_permissions"`
	Status            string     `json:"status"`
	PreApproved       bool       `json:"pre_approved"`
	AcceptedAt        *time.Time `json:"accepted_at,omitempty"`
	ApprovedAt        *time.Time `json:"approved_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// AdminUserRow represents a directory entry in Admin User Governance.
type AdminUserRow struct {
	ID              string    `json:"id"`
	Email           string    `json:"email"`
	Phone           string    `json:"phone"`
	FullName        string    `json:"full_name"`
	Roles           []string  `json:"roles"`
	Status          string    `json:"status"`
	IsEmailVerified bool      `json:"is_email_verified"`
	CreatedAt       time.Time `json:"created_at"`
}

// Handler exposes Super Admin governance, custom roles, invitations, and KYC approvals.
type Handler struct {
	pool     *pgxpool.Pool
	authRepo *auth.Repository
	tokens   *auth.TokenManager
	rdb      *platformredis.Client
	mailer   mailer.Mailer
}

// NewHandler constructs an admin governance Handler.
func NewHandler(pool *pgxpool.Pool, authRepo *auth.Repository, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{pool: pool, authRepo: authRepo, tokens: tokens, rdb: rdb}
}

// SetMailer attaches a transactional mailer for KYC verification notifications.
func (h *Handler) SetMailer(m mailer.Mailer) {
	h.mailer = m
}

// RegisterRoutes attaches /api/v1/admin governance routes protected by isolated admin portal auth + live RBAC permissions.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	adm := v1.Group("/admin")
	adm.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "admin"))
	{
		adm.GET("/users", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:customers:view", "users:owners:view", "users:outlets:view", "users:management:view", "users:delivery:view"), h.listUsers)
		adm.GET("/users/:userId/detail", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:customers:view", "users:owners:view", "users:outlets:view", "users:management:view", "users:delivery:view"), h.getUserDetail)
		adm.PATCH("/users/:userId/status", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:customers:manage", "users:owners:manage", "users:outlets:manage", "users:management:manage", "users:delivery:manage"), h.updateUserStatus)
		adm.PATCH("/users/:userId/roles", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:management:manage"), h.updateManagementUserRoles)
		adm.DELETE("/users/:userId", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:customers:manage", "users:owners:manage", "users:outlets:manage", "users:management:manage", "users:delivery:manage"), h.deleteUser)

		adm.GET("/directory/customers", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:customers:view"), h.listDirectoryCustomers)
		adm.GET("/directory/owners", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:owners:view"), h.listDirectoryOwners)
		adm.GET("/directory/outlets", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:outlets:view"), h.listDirectoryOutlets)
		adm.GET("/directory/management", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:management:view"), h.listDirectoryManagement)
		adm.GET("/directory/delivery", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:delivery:view"), h.listDirectoryDelivery)

		adm.GET("/permissions", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "roles:manage", "users:management:manage"), h.listPermissions)
		adm.GET("/roles", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "roles:manage", "users:management:view", "users:management:manage"), h.listRoles)
		adm.POST("/roles", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "roles:manage"), h.createRole)
		adm.PATCH("/roles/:roleId/permissions", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "roles:manage"), h.updateRolePermissions)
		adm.DELETE("/roles/:roleId", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "roles:manage"), h.deleteRole)

		adm.GET("/invitations", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:management:manage"), h.listInvitations)
		adm.POST("/invitations", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:management:manage"), h.createInvitation)
		adm.POST("/invitations/:id/approve", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:management:manage"), h.approveInvitation)
		adm.DELETE("/invitations/:id", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:management:manage"), h.revokeInvitation)

		adm.GET("/outlets", auth.RequireLiveAnyPermission(h.authRepo, "restaurants:verify", "users:outlets:view", "users:manage"), h.listOutlets)
		adm.GET("/outlets/:outletId/detail", auth.RequireLiveAnyPermission(h.authRepo, "users:manage", "users:outlets:view", "restaurants:verify"), h.getOutletDetail)
		adm.POST("/outlets/:outletId/verify", auth.RequireLivePermission(h.authRepo, "restaurants:verify"), h.verifyOutlet)
		adm.GET("/restaurant-owners", auth.RequireLiveAnyPermission(h.authRepo, "restaurants:verify", "users:owners:view", "users:manage"), h.listRestaurantOwners)
		adm.POST("/restaurant-owners/:ownerId/verify", auth.RequireLivePermission(h.authRepo, "restaurants:verify"), h.verifyRestaurantOwner)

		adm.GET("/delivery-partners", auth.RequireLiveAnyPermission(h.authRepo, "partners:verify", "users:delivery:view", "users:manage"), h.listDeliveryPartners)
		adm.POST("/delivery-partners/:partnerId/verify", auth.RequireLivePermission(h.authRepo, "partners:verify"), h.verifyDeliveryPartner)

		adm.GET("/orders/monitor", auth.RequireLivePermission(h.authRepo, "orders:monitor"), h.ordersMonitor)
	}
}

func (h *Handler) listUsers(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT u.id, u.email, u.phone, u.full_name, u.status, u.is_email_verified, u.created_at,
		       COALESCE(ARRAY_AGG(r.code) FILTER (WHERE r.code IS NOT NULL), '{}')
		FROM users u
		LEFT JOIN user_roles ur ON ur.user_id = u.id
		LEFT JOIN roles r ON r.id = ur.role_id
		WHERE u.deleted_at IS NULL
		GROUP BY u.id
		ORDER BY u.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list users.", nil)
		return
	}
	defer rows.Close()
	var list []AdminUserRow
	for rows.Next() {
		var u AdminUserRow
		if err := rows.Scan(&u.ID, &u.Email, &u.Phone, &u.FullName, &u.Status, &u.IsEmailVerified, &u.CreatedAt, &u.Roles); err != nil {
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
			return
		}
		list = append(list, u)
	}
	if list == nil {
		list = []AdminUserRow{}
	}
	httputil.OK(c, list)
}

func (h *Handler) updateUserStatus(c *gin.Context) {
	targetID := c.Param("userId")
	if !h.authorizeTargetUserManage(c.Request.Context(), c, targetID) {
		return
	}
	var req struct {
		Status string `json:"status" binding:"required,oneof=ACTIVE SUSPENDED DEACTIVATED"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	tag, err := h.pool.Exec(c.Request.Context(), `UPDATE users SET status = $2 WHERE id = $1`, targetID, req.Status)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to update user status.", nil)
		return
	}
	if tag.RowsAffected() == 0 {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "User not found.", nil)
		return
	}
	httputil.OK(c, gin.H{"updated": true, "status": req.Status})
}

func (h *Handler) deleteUser(c *gin.Context) {
	targetID := c.Param("userId")
	if targetID == auth.CurrentUserID(c) {
		httputil.Fail(c, http.StatusBadRequest, "CANNOT_DELETE_SELF", "You cannot delete your own active admin account.", nil)
		return
	}
	if !h.authorizeTargetUserManage(c.Request.Context(), c, targetID) {
		return
	}

	mode := "HARD_DELETE"
	err := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		var uEmail, uPhone string
		if qErr := tx.QueryRow(c.Request.Context(), `
			SELECT email, phone FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE
		`, targetID).Scan(&uEmail, &uPhone); qErr != nil {
			if errors.Is(qErr, pgx.ErrNoRows) {
				return fmt.Errorf("NOT_FOUND")
			}
			return qErr
		}

		// Clean ephemeral auth/invite/profile artifacts
		_, _ = tx.Exec(c.Request.Context(), `DELETE FROM pending_registrations WHERE LOWER(email) = $1 OR phone = $2`, strings.ToLower(uEmail), uPhone)
		_, _ = tx.Exec(c.Request.Context(), `DELETE FROM auth_sessions WHERE user_id = $1`, targetID)
		_, _ = tx.Exec(c.Request.Context(), `DELETE FROM otp_verifications WHERE user_id = $1`, targetID)
		_, _ = tx.Exec(c.Request.Context(), `DELETE FROM user_roles WHERE user_id = $1`, targetID)
		_, _ = tx.Exec(c.Request.Context(), `DELETE FROM outlet_staff_assignments WHERE user_id = $1`, targetID)
		_, _ = tx.Exec(c.Request.Context(), `DELETE FROM restaurant_owner_profiles WHERE user_id = $1`, targetID)
		_, _ = tx.Exec(c.Request.Context(), `DELETE FROM platform_invitations WHERE user_id = $1 OR ($2 <> '' AND LOWER(email) = $2) OR ($3 <> '' AND phone = $3)`, targetID, strings.ToLower(uEmail), uPhone)

		// Remove unreferenced delivery_partners row only if no deliveries depend on it (savepoint prevents 25P02 tx abort)
		if _, dpSpErr := tx.Exec(c.Request.Context(), `SAVEPOINT try_del_dp`); dpSpErr != nil {
			return dpSpErr
		}
		if _, dpErr := tx.Exec(c.Request.Context(), `DELETE FROM delivery_partners WHERE user_id = $1`, targetID); dpErr != nil {
			_, _ = tx.Exec(c.Request.Context(), `ROLLBACK TO SAVEPOINT try_del_dp`)
		} else {
			_, _ = tx.Exec(c.Request.Context(), `RELEASE SAVEPOINT try_del_dp`)
		}

		if _, spErr := tx.Exec(c.Request.Context(), `SAVEPOINT try_hard_delete`); spErr != nil {
			return spErr
		}
		_, delErr := tx.Exec(c.Request.Context(), `DELETE FROM users WHERE id = $1`, targetID)
		if delErr == nil {
			_, _ = tx.Exec(c.Request.Context(), `RELEASE SAVEPOINT try_hard_delete`)
			return nil
		}

		var pgErr *pgconn.PgError
		if errors.As(delErr, &pgErr) && pgErr.Code == "23503" {
			_, _ = tx.Exec(c.Request.Context(), `ROLLBACK TO SAVEPOINT try_hard_delete`)
			mode = "SOFT_DELETE"
			scrubEmail := fmt.Sprintf("deleted-%s@deleted.goodly.local", targetID)
			cleanID := strings.ReplaceAll(targetID, "-", "")
			if len(cleanID) > 16 {
				cleanID = cleanID[:16]
			}
			scrubPhone := "del-" + cleanID // fits VARCHAR(20) cleanly
			if _, uErr := tx.Exec(c.Request.Context(), `
				UPDATE users
				SET status = 'DEACTIVATED',
				    deleted_at = NOW(),
				    email = $2,
				    phone = $3,
				    full_name = 'Deleted User',
				    password_hash = 'DELETED'
				WHERE id = $1
			`, targetID, scrubEmail, scrubPhone); uErr != nil {
				return uErr
			}
			// Deactivate any owned outlets & offline any rider profile linked to this deleted user
			_, _ = tx.Exec(c.Request.Context(), `UPDATE restaurants SET is_active = FALSE, is_accepting_orders = FALSE WHERE owner_user_id = $1`, targetID)
			_, _ = tx.Exec(c.Request.Context(), `UPDATE delivery_partners SET availability_status = 'OFFLINE' WHERE user_id = $1`, targetID)
			return nil
		}
		return delErr
	})
	if err != nil {
		if err.Error() == "NOT_FOUND" {
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "User not found.", nil)
			return
		}
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to delete user account.", nil)
		return
	}
	httputil.OK(c, gin.H{"deleted": true, "id": targetID, "mode": mode})
}

func (h *Handler) listPermissions(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `SELECT slug, COALESCE(description, '') FROM admin_permissions ORDER BY slug ASC`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list permissions.", nil)
		return
	}
	defer rows.Close()
	var out []PermissionInfo
	for rows.Next() {
		var p PermissionInfo
		if err := rows.Scan(&p.Slug, &p.Description); err != nil {
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
			return
		}
		out = append(out, p)
	}
	httputil.OK(c, out)
}

func (h *Handler) listRoles(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT r.id, r.code, r.name, COALESCE(r.description, ''), r.is_system,
		       COALESCE(ARRAY_AGG(ap.slug ORDER BY ap.slug) FILTER (WHERE ap.slug IS NOT NULL), '{}')
		FROM roles r
		LEFT JOIN role_permissions rp ON rp.role_id = r.id
		LEFT JOIN admin_permissions ap ON ap.id = rp.permission_id
		GROUP BY r.id
		ORDER BY r.is_system DESC, r.code ASC
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list roles.", nil)
		return
	}
	defer rows.Close()
	var out []RoleInfo
	for rows.Next() {
		var rl RoleInfo
		if err := rows.Scan(&rl.ID, &rl.Code, &rl.Name, &rl.Description, &rl.IsSystem, &rl.Permissions); err != nil {
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
			return
		}
		out = append(out, rl)
	}
	httputil.OK(c, out)
}

func (h *Handler) createRole(c *gin.Context) {
	var req struct {
		Name        string   `json:"name" binding:"required,min=2"`
		Code        string   `json:"code"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	if code == "" {
		slug := strings.Map(func(r rune) rune {
			if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
				return r
			}
			return '_'
		}, strings.ToUpper(req.Name))
		code = "CUSTOM_" + strings.Trim(slug, "_") + "_" + uuid.NewString()[:4]
	}

	roleID := uuid.NewString()
	actor := auth.CurrentUserID(c)
	err := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(c.Request.Context(), `
			INSERT INTO roles (id, code, name, description, is_system, created_by)
			VALUES ($1, $2, $3, $4, FALSE, $5)
		`, roleID, code, strings.TrimSpace(req.Name), strings.TrimSpace(req.Description), actor); err != nil {
			return err
		}
		_, err := tx.Exec(c.Request.Context(), `
			INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1, id FROM admin_permissions WHERE slug = ANY($2)
		`, roleID, req.Permissions)
		return err
	})
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	httputil.Created(c, RoleInfo{
		ID:          roleID,
		Code:        code,
		Name:        strings.TrimSpace(req.Name),
		Description: strings.TrimSpace(req.Description),
		IsSystem:    false,
		Permissions: req.Permissions,
	})
}

func (h *Handler) updateRolePermissions(c *gin.Context) {
	var req struct {
		Permissions []string `json:"permissions" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	roleID := c.Param("roleId")
	var roleCode string
	if err := h.pool.QueryRow(c.Request.Context(), `SELECT code FROM roles WHERE id = $1`, roleID).Scan(&roleCode); err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Role not found.", nil)
		return
	}
	if roleCode == "PLATFORM_ADMIN" {
		httputil.Fail(c, http.StatusBadRequest, "PROTECTED_ROLE", "PLATFORM_ADMIN super-admin role retains all permissions.", nil)
		return
	}
	err := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(c.Request.Context(), `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
			return err
		}
		if len(req.Permissions) > 0 {
			_, err := tx.Exec(c.Request.Context(), `
				INSERT INTO role_permissions (role_id, permission_id)
				SELECT $1, id FROM admin_permissions WHERE slug = ANY($2)
			`, roleID, req.Permissions)
			return err
		}
		return nil
	})
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	httputil.OK(c, gin.H{"role_id": roleID, "permissions": req.Permissions})
}

func (h *Handler) listInvitations(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT pi.id, pi.email, pi.phone, pi.user_id, u.full_name,
		       r.id, r.code, r.name, COALESCE(pi.custom_permissions, '{}'),
		       pi.status, COALESCE(pi.pre_approved, FALSE), pi.accepted_at, pi.approved_at, pi.created_at
		FROM platform_invitations pi
		JOIN roles r ON r.id = pi.role_id
		LEFT JOIN users u ON u.id = pi.user_id
		ORDER BY pi.created_at DESC
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list invitations.", nil)
		return
	}
	defer rows.Close()
	var list []AdminInvitationRow
	for rows.Next() {
		var row AdminInvitationRow
		if err := rows.Scan(
			&row.ID, &row.Email, &row.Phone, &row.UserID, &row.InviteeName,
			&row.RoleID, &row.RoleCode, &row.RoleName, &row.CustomPermissions,
			&row.Status, &row.PreApproved, &row.AcceptedAt, &row.ApprovedAt, &row.CreatedAt,
		); err != nil {
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
			return
		}
		list = append(list, row)
	}
	if list == nil {
		list = []AdminInvitationRow{}
	}
	httputil.OK(c, list)
}

func (h *Handler) createInvitation(c *gin.Context) {
	var req struct {
		Email             string   `json:"email"`
		Phone             string   `json:"phone"`
		RoleID            string   `json:"role_id"`
		RoleCode          string   `json:"role_code"`
		CustomPermissions []string `json:"custom_permissions"`
		PreApproved       bool     `json:"pre_approved"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	normEmail := strings.ToLower(strings.TrimSpace(req.Email))
	normPhone := strings.TrimSpace(req.Phone)
	if normEmail == "" && normPhone == "" {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Either email or contact phone number is required.", nil)
		return
	}

	roleID := strings.TrimSpace(req.RoleID)
	if roleID == "" && req.RoleCode != "" {
		if err := h.pool.QueryRow(c.Request.Context(), `SELECT id FROM roles WHERE code = $1`, strings.TrimSpace(req.RoleCode)).Scan(&roleID); err != nil {
			httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Role not found.", nil)
			return
		}
	}
	if roleID == "" {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "role_id or role_code is required.", nil)
		return
	}

	var targetUserID *string
	var uid string
	if err := h.pool.QueryRow(c.Request.Context(), `
		SELECT id FROM users WHERE ($1 <> '' AND LOWER(email) = $1) OR ($2 <> '' AND phone = $2) LIMIT 1
	`, normEmail, normPhone).Scan(&uid); err == nil {
		targetUserID = &uid
	}

	var emailPtr, phonePtr *string
	if normEmail != "" {
		emailPtr = &normEmail
	}
	if normPhone != "" {
		phonePtr = &normPhone
	}
	invID := uuid.NewString()
	_, err := h.pool.Exec(c.Request.Context(), `
		INSERT INTO platform_invitations (id, email, phone, user_id, role_id, custom_permissions, invited_by, status, pre_approved)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_ACCEPTANCE', $8)
	`, invID, emailPtr, phonePtr, targetUserID, roleID, req.CustomPermissions, auth.CurrentUserID(c), req.PreApproved)
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	httputil.Created(c, gin.H{
		"id":           invID,
		"status":       "PENDING_ACCEPTANCE",
		"email":        emailPtr,
		"phone":        phonePtr,
		"user_id":      targetUserID,
		"pre_approved": req.PreApproved,
	})
}

func (h *Handler) approveInvitation(c *gin.Context) {
	invID := c.Param("id")
	actor := auth.CurrentUserID(c)

	err := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		var userID *string
		var roleID, status string
		err := tx.QueryRow(c.Request.Context(), `
			SELECT user_id, role_id, status FROM platform_invitations WHERE id = $1 FOR UPDATE
		`, invID).Scan(&userID, &roleID, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("invitation not found")
		}
		if err != nil {
			return err
		}
		if userID == nil || status == "PENDING_ACCEPTANCE" {
			return fmt.Errorf("invitee must login and accept the invitation before admin approval")
		}
		if status != "PENDING_ADMIN_APPROVAL" && status != "ACTIVE" {
			return fmt.Errorf("cannot approve invitation in status %s", status)
		}

		if _, err := tx.Exec(c.Request.Context(), `
			UPDATE platform_invitations SET status = 'ACTIVE', approved_by = $2, approved_at = NOW() WHERE id = $1
		`, invID, actor); err != nil {
			return err
		}
		_, err = tx.Exec(c.Request.Context(), `
			INSERT INTO user_roles (user_id, role_id, granted_by)
			VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING
		`, *userID, roleID, actor)
		return err
	})
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "APPROVAL_BLOCKED", err.Error(), nil)
		return
	}
	httputil.OK(c, gin.H{"approved": true, "status": "ACTIVE"})
}

func (h *Handler) revokeInvitation(c *gin.Context) {
	invID := c.Param("id")
	err := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		var userID *string
		var roleID string
		if err := tx.QueryRow(c.Request.Context(), `SELECT user_id, role_id FROM platform_invitations WHERE id = $1`, invID).Scan(&userID, &roleID); err != nil {
			return err
		}
		if _, err := tx.Exec(c.Request.Context(), `UPDATE platform_invitations SET status = 'REVOKED' WHERE id = $1`, invID); err != nil {
			return err
		}
		if userID != nil {
			_, _ = tx.Exec(c.Request.Context(), `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, *userID, roleID)
		}
		return nil
	})
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Invitation not found.", nil)
		return
	}
	httputil.OK(c, gin.H{"revoked": true})
}

func (h *Handler) listOutlets(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT r.id, r.name, COALESCE(r.brand_name, ''), COALESCE(r.branch_name, ''), r.city, r.verification_status, r.is_accepting_orders, u.full_name, u.email
		FROM restaurants r
		JOIN users u ON u.id = r.owner_user_id
		WHERE u.deleted_at IS NULL
		ORDER BY r.created_at DESC
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list outlets.", nil)
		return
	}
	defer rows.Close()
	out := make([]gin.H, 0)
	for rows.Next() {
		var id, name, brand, branch, city, status, ownerName, ownerEmail string
		var accepting bool
		if err := rows.Scan(&id, &name, &brand, &branch, &city, &status, &accepting, &ownerName, &ownerEmail); err != nil {
			continue
		}
		out = append(out, gin.H{
			"id": id, "name": name, "brand_name": brand, "branch_name": branch,
			"city": city, "verification_status": status, "is_accepting_orders": accepting,
			"owner_name": ownerName, "owner_email": ownerEmail,
		})
	}
	httputil.OK(c, out)
}

func (h *Handler) verifyOutlet(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required,oneof=APPROVED REJECTED SUSPENDED"`
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	accepting := req.Status == "APPROVED"
	var outletName, outletEmail, ownerName, ownerEmail string
	err := h.pool.QueryRow(c.Request.Context(), `
		UPDATE restaurants r
		SET verification_status = $2,
		    is_accepting_orders = CASE WHEN $3 THEN is_accepting_orders ELSE FALSE END
		FROM users u
		WHERE r.id = $1 AND u.id = r.owner_user_id
		RETURNING r.name, COALESCE(r.email, ''), u.full_name, u.email
	`, c.Param("outletId"), req.Status, accepting).Scan(&outletName, &outletEmail, &ownerName, &ownerEmail)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Outlet not found.", nil)
		return
	}
	if h.mailer != nil {
		toEmail := outletEmail
		if toEmail == "" {
			toEmail = ownerEmail
		}
		if toEmail != "" {
			mailer.DispatchAsyncOrSync(c.Request.Context(), h.mailer, "failed to send outlet KYC verification email", func(sendCtx context.Context) error {
				return h.mailer.SendOnboardingKYCStatusEmail(sendCtx, toEmail, ownerName, "RESTAURANT_OUTLET", outletName, req.Status, req.Notes)
			})
		}
	}
	httputil.OK(c, gin.H{"updated": true, "verification_status": req.Status})
}

func (h *Handler) listRestaurantOwners(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT op.id, op.user_id, u.full_name, u.email, u.phone,
		       COALESCE(op.organization_name, ''), op.id_document_type, op.id_document_number,
		       COALESCE(op.id_document_filename, ''), op.verification_status,
		       COALESCE(op.review_notes, ''), op.created_at
		FROM restaurant_owner_profiles op
		JOIN users u ON u.id = op.user_id
		WHERE u.deleted_at IS NULL
		ORDER BY op.created_at DESC
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list restaurant owner KYC queue.", nil)
		return
	}
	defer rows.Close()
	out := make([]gin.H, 0)
	for rows.Next() {
		var id, userID, fullName, email, phone, org, docType, docNum, docFile, status, notes string
		var createdAt time.Time
		if err := rows.Scan(&id, &userID, &fullName, &email, &phone, &org, &docType, &docNum, &docFile, &status, &notes, &createdAt); err != nil {
			continue
		}
		out = append(out, gin.H{
			"id": id, "user_id": userID, "full_name": fullName, "email": email, "phone": phone,
			"organization_name": org, "id_document_type": docType, "id_document_number": docNum,
			"id_document_filename": docFile, "verification_status": status,
			"review_notes": notes, "created_at": createdAt,
		})
	}
	httputil.OK(c, out)
}

func (h *Handler) verifyRestaurantOwner(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required,oneof=APPROVED REJECTED SUSPENDED"`
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	actor := auth.CurrentUserID(c)
	var ownerName, ownerEmail, orgName string
	err := h.pool.QueryRow(c.Request.Context(), `
		UPDATE restaurant_owner_profiles op
		SET verification_status = $2,
		    review_notes = NULLIF($3::text, ''),
		    reviewed_by_admin_id = $4,
		    reviewed_at = NOW(),
		    updated_at = NOW()
		FROM users u
		WHERE (op.id::text = $1 OR op.user_id::text = $1) AND u.id = op.user_id
		RETURNING u.full_name, u.email, COALESCE(op.organization_name, u.full_name)
	`, c.Param("ownerId"), req.Status, strings.TrimSpace(req.Notes), actor).Scan(&ownerName, &ownerEmail, &orgName)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Restaurant owner profile not found.", nil)
		return
	}
	if h.mailer != nil && ownerEmail != "" {
		mailer.DispatchAsyncOrSync(c.Request.Context(), h.mailer, "failed to send owner KYC verification email", func(sendCtx context.Context) error {
			return h.mailer.SendOnboardingKYCStatusEmail(sendCtx, ownerEmail, ownerName, "RESTAURANT_OWNER", orgName, req.Status, req.Notes)
		})
	}
	httputil.OK(c, gin.H{"updated": true, "verification_status": req.Status})
}

func (h *Handler) listDeliveryPartners(c *gin.Context) {
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT dp.id, dp.user_id, u.full_name, u.email, u.phone, dp.vehicle_type, COALESCE(dp.vehicle_make_model, ''), COALESCE(dp.license_plate, ''), dp.verification_status, dp.availability_status
		FROM delivery_partners dp
		JOIN users u ON u.id = dp.user_id
		ORDER BY dp.created_at DESC
	`)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not list delivery partners.", nil)
		return
	}
	defer rows.Close()
	out := make([]gin.H, 0)
	for rows.Next() {
		var id, userID, name, email, phone, vType, vModel, plate, vStatus, aStatus string
		if err := rows.Scan(&id, &userID, &name, &email, &phone, &vType, &vModel, &plate, &vStatus, &aStatus); err != nil {
			continue
		}
		out = append(out, gin.H{
			"id": id, "user_id": userID, "full_name": name, "email": email, "phone": phone,
			"vehicle_type": vType, "vehicle_make_model": vModel, "license_plate": plate,
			"verification_status": vStatus, "availability_status": aStatus,
		})
	}
	httputil.OK(c, out)
}

func (h *Handler) verifyDeliveryPartner(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required,oneof=APPROVED REJECTED SUSPENDED"`
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var partnerName, partnerEmail string
	err := h.pool.QueryRow(c.Request.Context(), `
		UPDATE delivery_partners dp
		SET verification_status = $2
		FROM users u
		WHERE dp.id = $1 AND u.id = dp.user_id
		RETURNING u.full_name, u.email
	`, c.Param("partnerId"), req.Status).Scan(&partnerName, &partnerEmail)
	if err != nil {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Delivery partner not found.", nil)
		return
	}
	if h.mailer != nil && partnerEmail != "" {
		mailer.DispatchAsyncOrSync(c.Request.Context(), h.mailer, "failed to send delivery partner KYC verification email", func(sendCtx context.Context) error {
			return h.mailer.SendOnboardingKYCStatusEmail(sendCtx, partnerEmail, partnerName, "DELIVERY_PARTNER", partnerName, req.Status, req.Notes)
		})
	}
	httputil.OK(c, gin.H{"updated": true, "verification_status": req.Status})
}

func (h *Handler) ordersMonitor(c *gin.Context) {
	var totalOrders int
	_ = h.pool.QueryRow(c.Request.Context(), `SELECT COUNT(*) FROM orders`).Scan(&totalOrders)
	httputil.OK(c, gin.H{"total_orders": totalOrders, "status": "ok"})
}
