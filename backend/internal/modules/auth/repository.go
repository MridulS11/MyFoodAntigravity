package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
)

var (
	ErrUserNotFound       = errors.New("user not found")
	ErrDuplicateUser      = errors.New("email or phone already registered")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountSuspended   = errors.New("account is suspended or deactivated")
	ErrInvalidOTP         = errors.New("invalid or expired OTP")
	ErrTokenReuseDetected = errors.New("refresh token reuse detected; session family revoked")
	ErrInvalidRefresh     = errors.New("invalid or expired refresh token")
	ErrPendingNotFound    = errors.New("pending registration not found")
)

// UserRecord represents a hydrated user with roles and granular RBAC permission slugs.
type UserRecord struct {
	ID              string    `json:"id"`
	Email           string    `json:"email"`
	Phone           string    `json:"phone"`
	PasswordHash    string    `json:"-"`
	FullName        string    `json:"full_name"`
	Roles           []string  `json:"roles"`
	Permissions     []string  `json:"permissions"`
	Status          string    `json:"status"`
	IsEmailVerified bool      `json:"is_email_verified"`
	IsPhoneVerified bool      `json:"is_phone_verified"`
	CreatedAt       time.Time `json:"created_at"`
}

// SessionRecord maps to auth_sessions.
type SessionRecord struct {
	ID               string
	UserID           string
	TokenFamilyID    string
	RefreshTokenHash string
	IsRevoked        bool
	ExpiresAt        time.Time
}

// Repository encapsulates all SQL persistence for the auth module.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository creates an auth Repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// CreateUserWithRole inserts a new user, assigns their canonical role, and creates customer_profiles if CUSTOMER.
func (r *Repository) CreateUserWithRole(ctx context.Context, email, phone, fullName, passwordHash, roleCode string) (*UserRecord, error) {
	userID := uuid.NewString()
	email = strings.ToLower(strings.TrimSpace(email))
	phone = strings.TrimSpace(phone)

	var created UserRecord
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE (LOWER(email) = $1 OR phone = $2) AND deleted_at IS NULL)`, email, phone).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrDuplicateUser
		}

		if err := tx.QueryRow(ctx, `
			INSERT INTO users (id, email, phone, password_hash, full_name)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id, email, phone, password_hash, full_name, status, is_email_verified, is_phone_verified, created_at
		`, userID, email, phone, passwordHash, strings.TrimSpace(fullName)).Scan(
			&created.ID,
			&created.Email,
			&created.Phone,
			&created.PasswordHash,
			&created.FullName,
			&created.Status,
			&created.IsEmailVerified,
			&created.IsPhoneVerified,
			&created.CreatedAt,
		); err != nil {
			return err
		}

		var roleID string
		if err := tx.QueryRow(ctx, `SELECT id FROM roles WHERE code = $1`, roleCode).Scan(&roleID); err != nil {
			return fmt.Errorf("role %s not found: %w", roleCode, err)
		}

		if _, err := tx.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, userID, roleID); err != nil {
			return err
		}

		if roleCode == "CUSTOMER" {
			if _, err := tx.Exec(ctx, `INSERT INTO customer_profiles (user_id) VALUES ($1)`, userID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return r.GetUserByID(ctx, created.ID)
}

// SavePendingRegistration stages unverified credentials outside users until OTP verification succeeds.
func (r *Repository) SavePendingRegistration(ctx context.Context, email, phone, fullName, passwordHash, roleCode, otpHash string, expiresAt time.Time) error {
	email = strings.ToLower(strings.TrimSpace(email))
	phone = strings.TrimSpace(phone)
	return database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE (LOWER(email) = $1 OR phone = $2) AND deleted_at IS NULL)`, email, phone).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrDuplicateUser
		}
		if _, err := tx.Exec(ctx, `DELETE FROM pending_registrations WHERE LOWER(email) = $1 OR phone = $2`, email, phone); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO pending_registrations (id, email, phone, full_name, password_hash, role_code, otp_hash, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, uuid.NewString(), email, phone, strings.TrimSpace(fullName), passwordHash, roleCode, otpHash, expiresAt)
		return err
	})
}

// RefreshPendingRegistrationOTP updates a staged registration's OTP code for resend flows.
func (r *Repository) RefreshPendingRegistrationOTP(ctx context.Context, target, otpHash string, expiresAt time.Time) (email, fullName string, found bool, err error) {
	norm := strings.ToLower(strings.TrimSpace(target))
	raw := strings.TrimSpace(target)
	err = r.pool.QueryRow(ctx, `
		UPDATE pending_registrations
		SET otp_hash = $2, expires_at = $3, attempts = 0, updated_at = NOW()
		WHERE LOWER(email) = $1 OR phone = $4
		RETURNING email, full_name
	`, norm, otpHash, expiresAt, raw).Scan(&email, &fullName)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	return email, fullName, true, nil
}

// CompletePendingRegistration validates the OTP on a staged signup and only then persists the user account.
func (r *Repository) CompletePendingRegistration(ctx context.Context, target, otpHash string) (*UserRecord, error) {
	norm := strings.ToLower(strings.TrimSpace(target))
	raw := strings.TrimSpace(target)

	var pendingID, email, phone, fullName, passwordHash, roleCode, storedHash string
	var attempts, maxAttempts int
	var expiresAt time.Time

	var createdID string
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		qErr := tx.QueryRow(ctx, `
			SELECT id, email, phone, full_name, password_hash, role_code, otp_hash, expires_at, attempts, max_attempts
			FROM pending_registrations
			WHERE LOWER(email) = $1 OR phone = $2
			ORDER BY updated_at DESC
			LIMIT 1
			FOR UPDATE
		`, norm, raw).Scan(&pendingID, &email, &phone, &fullName, &passwordHash, &roleCode, &storedHash, &expiresAt, &attempts, &maxAttempts)
		if errors.Is(qErr, pgx.ErrNoRows) {
			return ErrPendingNotFound
		}
		if qErr != nil {
			return qErr
		}
		if time.Now().UTC().After(expiresAt) || attempts >= maxAttempts {
			return ErrInvalidOTP
		}
		if storedHash != otpHash {
			_, _ = r.pool.Exec(ctx, `UPDATE pending_registrations SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1`, pendingID)
			return ErrInvalidOTP
		}

		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE (LOWER(email) = $1 OR phone = $2) AND deleted_at IS NULL)`, strings.ToLower(email), phone).Scan(&exists); err != nil {
			return err
		}
		if exists {
			_, _ = tx.Exec(ctx, `DELETE FROM pending_registrations WHERE id = $1`, pendingID)
			return ErrDuplicateUser
		}

		createdID = uuid.NewString()
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
			VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, 'ACTIVE')
		`, createdID, email, phone, passwordHash, fullName); err != nil {
			return err
		}

		var roleID string
		if err := tx.QueryRow(ctx, `SELECT id FROM roles WHERE code = $1`, roleCode).Scan(&roleID); err != nil {
			return fmt.Errorf("role %s not found: %w", roleCode, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, createdID, roleID); err != nil {
			return err
		}
		if roleCode == "CUSTOMER" {
			if _, err := tx.Exec(ctx, `INSERT INTO customer_profiles (user_id) VALUES ($1)`, createdID); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `DELETE FROM pending_registrations WHERE id = $1`, pendingID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return r.GetUserByID(ctx, createdID)
}

// GetUserByEmailOrPhone looks up a user and loads their roles and permissions.
func (r *Repository) GetUserByEmailOrPhone(ctx context.Context, emailOrPhone string) (*UserRecord, error) {
	norm := strings.ToLower(strings.TrimSpace(emailOrPhone))
	var userID string
	err := r.pool.QueryRow(ctx, `
		SELECT id FROM users WHERE (LOWER(email) = $1 OR phone = $2) AND deleted_at IS NULL LIMIT 1
	`, norm, strings.TrimSpace(emailOrPhone)).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	return r.GetUserByID(ctx, userID)
}

// GetUserByID fetches a hydrated user record by UUID.
func (r *Repository) GetUserByID(ctx context.Context, userID string) (*UserRecord, error) {
	var u UserRecord
	err := r.pool.QueryRow(ctx, `
		SELECT id, email, phone, password_hash, full_name, status, is_email_verified, is_phone_verified, created_at
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
	`, userID).Scan(
		&u.ID, &u.Email, &u.Phone, &u.PasswordHash, &u.FullName,
		&u.Status, &u.IsEmailVerified, &u.IsPhoneVerified, &u.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}

	roleRows, err := r.pool.Query(ctx, `
		SELECT r.code
		FROM roles r
		JOIN user_roles ur ON ur.role_id = r.id
		WHERE ur.user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer roleRows.Close()
	for roleRows.Next() {
		var code string
		if err := roleRows.Scan(&code); err != nil {
			return nil, err
		}
		u.Roles = append(u.Roles, code)
	}

	permRows, err := r.pool.Query(ctx, `
		SELECT DISTINCT ap.slug
		FROM admin_permissions ap
		JOIN role_permissions rp ON rp.permission_id = ap.id
		JOIN user_roles ur ON ur.role_id = rp.role_id
		WHERE ur.user_id = $1
		UNION
		SELECT DISTINCT perm
		FROM platform_invitations pi, UNNEST(pi.custom_permissions) AS perm
		WHERE pi.user_id = $1 AND pi.status = 'ACTIVE' AND pi.custom_permissions IS NOT NULL
		UNION
		SELECT DISTINCT perm
		FROM user_admin_permissions uap, UNNEST(uap.permissions) AS perm
		WHERE uap.user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer permRows.Close()
	for permRows.Next() {
		var slug string
		if err := permRows.Scan(&slug); err != nil {
			return nil, err
		}
		u.Permissions = append(u.Permissions, slug)
	}

	if u.Roles == nil {
		u.Roles = []string{}
	}
	if u.Permissions == nil {
		u.Permissions = []string{}
	}
	return &u, nil
}

// CreateOTP inserts a new hashed single-use OTP verification record.
func (r *Repository) CreateOTP(ctx context.Context, userID *string, target, purpose, otpHash string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO otp_verifications (id, user_id, target, purpose, otp_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, uuid.NewString(), userID, strings.ToLower(strings.TrimSpace(target)), purpose, otpHash, expiresAt)
	return err
}

// VerifyAndConsumeOTP atomically validates an OTP hash with attempt counting and marks phone verified.
func (r *Repository) VerifyAndConsumeOTP(ctx context.Context, target, purpose, otpHash string) error {
	norm := strings.ToLower(strings.TrimSpace(target))
	return database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var id string
		var userID *string
		var storedHash string
		var attempts, maxAttempts int
		var expiresAt time.Time

		err := tx.QueryRow(ctx, `
			SELECT id, user_id, otp_hash, attempts, max_attempts, expires_at
			FROM otp_verifications
			WHERE (
				target = $1
				OR user_id = (SELECT id FROM users WHERE LOWER(email) = $1 OR phone = $1 LIMIT 1)
			) AND purpose = $2 AND consumed_at IS NULL
			ORDER BY created_at DESC
			LIMIT 1
			FOR UPDATE
		`, norm, purpose).Scan(&id, &userID, &storedHash, &attempts, &maxAttempts, &expiresAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidOTP
		}
		if err != nil {
			return err
		}
		if time.Now().UTC().After(expiresAt) || attempts >= maxAttempts {
			return ErrInvalidOTP
		}
		if storedHash != otpHash {
			_, _ = tx.Exec(ctx, `UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`, id)
			return ErrInvalidOTP
		}

		if _, err := tx.Exec(ctx, `UPDATE otp_verifications SET consumed_at = NOW() WHERE id = $1`, id); err != nil {
			return err
		}
		if userID != nil {
			if _, err := tx.Exec(ctx, `UPDATE users SET is_phone_verified = TRUE, is_email_verified = TRUE WHERE id = $1`, *userID); err != nil {
				return err
			}
		}
		return nil
	})
}

// CreateSession stores a newly issued refresh token family session.
func (r *Repository) CreateSession(ctx context.Context, sessionID, userID, familyID, refreshHash, userAgent, ip string, expiresAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO auth_sessions (id, user_id, token_family_id, refresh_token_hash, user_agent, ip_address, expires_at)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::inet, $7)
	`, sessionID, userID, familyID, refreshHash, userAgent, ip, expiresAt)
	if err != nil {
		return err
	}
	_, _ = r.pool.Exec(ctx, `UPDATE users SET last_login_at = NOW() WHERE id = $1`, userID)
	return nil
}

// RotateRefreshToken atomically rotates a refresh token and revokes the entire token family if reuse is detected.
func (r *Repository) RotateRefreshToken(ctx context.Context, currentHash, nextSessionID, nextHash, userAgent, ip string, nextExpiresAt time.Time) (string, error) {
	var userID string
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var sess SessionRecord
		err := tx.QueryRow(ctx, `
			SELECT id, user_id, token_family_id, refresh_token_hash, is_revoked, expires_at
			FROM auth_sessions
			WHERE refresh_token_hash = $1
			FOR UPDATE
		`, currentHash).Scan(&sess.ID, &sess.UserID, &sess.TokenFamilyID, &sess.RefreshTokenHash, &sess.IsRevoked, &sess.ExpiresAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidRefresh
		}
		if err != nil {
			return err
		}

		// Reuse Detection: revoked refresh token presented again -> revoke entire family immediately
		if sess.IsRevoked {
			if _, err := tx.Exec(ctx, `UPDATE auth_sessions SET is_revoked = TRUE WHERE token_family_id = $1`, sess.TokenFamilyID); err != nil {
				return err
			}
			return ErrTokenReuseDetected
		}

		if time.Now().UTC().After(sess.ExpiresAt) {
			return ErrInvalidRefresh
		}

		if _, err := tx.Exec(ctx, `UPDATE auth_sessions SET is_revoked = TRUE WHERE id = $1`, sess.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO auth_sessions (id, user_id, token_family_id, refresh_token_hash, user_agent, ip_address, expires_at)
			VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::inet, $7)
		`, nextSessionID, sess.UserID, sess.TokenFamilyID, nextHash, userAgent, ip, nextExpiresAt); err != nil {
			return err
		}
		userID = sess.UserID
		return nil
	})
	return userID, err
}

// RevokeSessionByRefreshHash marks a session revoked on logout.
func (r *Repository) RevokeSessionByRefreshHash(ctx context.Context, refreshHash string) error {
	_, err := r.pool.Exec(ctx, `UPDATE auth_sessions SET is_revoked = TRUE WHERE refresh_token_hash = $1`, refreshHash)
	return err
}

// UpdatePasswordHash sets a new Argon2id hash after password reset verification.
func (r *Repository) UpdatePasswordHash(ctx context.Context, target, newHash string) error {
	norm := strings.ToLower(strings.TrimSpace(target))
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET password_hash = $1 WHERE LOWER(email) = $2 OR phone = $3
	`, newHash, norm, strings.TrimSpace(target))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

// InvitationView unifies platform admin invitations and outlet staff invitations for the logged-in user.
type InvitationView struct {
	ID            string     `json:"id"`
	Kind          string     `json:"kind"` // PLATFORM | OUTLET
	TargetID      string     `json:"target_id"`
	TargetName    string     `json:"target_name"`
	RoleName      string     `json:"role_name"`
	RoleCode      string     `json:"role_code"`
	Permissions   []string   `json:"permissions"`
	InvitedByName string     `json:"invited_by_name"`
	Status        string     `json:"status"`
	PreApproved   bool       `json:"pre_approved"`
	InvitedEmail  *string    `json:"invited_email,omitempty"`
	InvitedPhone  *string    `json:"invited_phone,omitempty"`
	AcceptedAt    *time.Time `json:"accepted_at,omitempty"`
	ApprovedAt    *time.Time `json:"approved_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// ListUserInvitations returns all platform and outlet invitations matching user's ID, email, or phone.
func (r *Repository) ListUserInvitations(ctx context.Context, userID string) ([]InvitationView, error) {
	u, err := r.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	email := strings.ToLower(strings.TrimSpace(u.Email))
	phone := strings.TrimSpace(u.Phone)

	var out []InvitationView

	pRows, err := r.pool.Query(ctx, `
		SELECT pi.id, rl.id, 'Goodly Platform Operations', rl.name, rl.code,
		       COALESCE(NULLIF(pi.custom_permissions, '{}'), ARRAY(
		           SELECT ap.slug FROM admin_permissions ap
		           JOIN role_permissions rp ON rp.permission_id = ap.id
		           WHERE rp.role_id = rl.id
		       )),
		       COALESCE(inv.full_name, 'Super Admin'),
		       pi.status, COALESCE(pi.pre_approved, FALSE), pi.email, pi.phone, pi.accepted_at, pi.approved_at, pi.created_at
		FROM platform_invitations pi
		JOIN roles rl ON rl.id = pi.role_id
		LEFT JOIN users inv ON inv.id = pi.invited_by
		WHERE (pi.user_id = $1
		   OR ($2 <> '' AND LOWER(pi.email) = $2)
		   OR ($3 <> '' AND pi.phone = $3))
		  AND pi.status IN ('PENDING_ACCEPTANCE', 'PENDING_ADMIN_APPROVAL', 'ACTIVE', 'DECLINED')
		ORDER BY pi.created_at DESC
	`, userID, email, phone)
	if err != nil {
		return nil, err
	}
	defer pRows.Close()
	for pRows.Next() {
		var iv InvitationView
		iv.Kind = "PLATFORM"
		if err := pRows.Scan(
			&iv.ID, &iv.TargetID, &iv.TargetName, &iv.RoleName, &iv.RoleCode,
			&iv.Permissions, &iv.InvitedByName, &iv.Status, &iv.PreApproved,
			&iv.InvitedEmail, &iv.InvitedPhone, &iv.AcceptedAt, &iv.ApprovedAt, &iv.CreatedAt,
		); err != nil {
			return nil, err
		}
		if iv.Permissions == nil {
			iv.Permissions = []string{}
		}
		out = append(out, iv)
	}

	oRows, err := r.pool.Query(ctx, `
		SELECT osa.id, rest.id,
		       COALESCE(NULLIF(rest.brand_name, ''), rest.name) || CASE WHEN COALESCE(rest.branch_name, '') <> '' THEN ' · ' || rest.branch_name ELSE '' END,
		       COALESCE(NULLIF(osa.outlet_role_name, ''), osa.role_code),
		       osa.role_code, osa.permissions,
		       COALESCE(inv.full_name, 'Outlet Owner'),
		       osa.status, osa.invited_email, osa.invited_phone, osa.accepted_at, osa.approved_at, osa.created_at
		FROM outlet_staff_assignments osa
		JOIN restaurants rest ON rest.id = osa.outlet_id
		LEFT JOIN users inv ON inv.id = osa.invited_by_owner_id
		WHERE (osa.user_id = $1
		   OR ($2 <> '' AND LOWER(osa.invited_email) = $2)
		   OR ($3 <> '' AND osa.invited_phone = $3))
		  AND osa.status IN ('INVITED', 'PENDING_ACCEPTANCE', 'PENDING_APPROVAL', 'ACTIVE', 'DECLINED')
		ORDER BY osa.created_at DESC
	`, userID, email, phone)
	if err != nil {
		return nil, err
	}
	defer oRows.Close()
	for oRows.Next() {
		var iv InvitationView
		iv.Kind = "OUTLET"
		if err := oRows.Scan(
			&iv.ID, &iv.TargetID, &iv.TargetName, &iv.RoleName, &iv.RoleCode,
			&iv.Permissions, &iv.InvitedByName, &iv.Status,
			&iv.InvitedEmail, &iv.InvitedPhone, &iv.AcceptedAt, &iv.ApprovedAt, &iv.CreatedAt,
		); err != nil {
			return nil, err
		}
		if iv.Permissions == nil {
			iv.Permissions = []string{}
		}
		out = append(out, iv)
	}

	if out == nil {
		out = []InvitationView{}
	}
	return out, nil
}

// RespondToInvitation records invitee acceptance or decline without auto-bypassing final admin approval.
func (r *Repository) RespondToInvitation(ctx context.Context, userID, kind, invID, action string) error {
	u, err := r.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	email := strings.ToLower(strings.TrimSpace(u.Email))
	phone := strings.TrimSpace(u.Phone)
	upperKind := strings.ToUpper(strings.TrimSpace(kind))
	upperAction := strings.ToUpper(strings.TrimSpace(action))

	if upperAction != "ACCEPT" && upperAction != "DECLINE" {
		return fmt.Errorf("invalid action %q", action)
	}

	switch upperKind {
	case "PLATFORM":
		return database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
			var roleID string
			var invitedBy *string
			var preApproved bool
			qErr := tx.QueryRow(ctx, `
				SELECT role_id, invited_by, COALESCE(pre_approved, FALSE)
				FROM platform_invitations
				WHERE id = $1
				  AND (user_id = $2 OR ($3::text <> '' AND LOWER(email) = $3::text) OR ($4::text <> '' AND phone = $4::text))
				  AND status = 'PENDING_ACCEPTANCE'
				FOR UPDATE
			`, invID, userID, email, phone).Scan(&roleID, &invitedBy, &preApproved)
			if errors.Is(qErr, pgx.ErrNoRows) {
				return ErrUserNotFound
			}
			if qErr != nil {
				return qErr
			}
			if upperAction == "DECLINE" {
				_, uErr := tx.Exec(ctx, `
					UPDATE platform_invitations SET user_id = $1, status = 'DECLINED' WHERE id = $2
				`, userID, invID)
				return uErr
			}
			if preApproved {
				if _, uErr := tx.Exec(ctx, `
					UPDATE platform_invitations
					SET user_id = $1, status = 'ACTIVE', accepted_at = NOW(), approved_at = NOW(), approved_by = $3
					WHERE id = $2
				`, userID, invID, invitedBy); uErr != nil {
					return uErr
				}
				_, rErr := tx.Exec(ctx, `
					INSERT INTO user_roles (user_id, role_id, granted_by)
					VALUES ($1, $2, $3)
					ON CONFLICT DO NOTHING
				`, userID, roleID, invitedBy)
				return rErr
			}
			_, uErr := tx.Exec(ctx, `
				UPDATE platform_invitations
				SET user_id = $1, status = 'PENDING_ADMIN_APPROVAL', accepted_at = NOW()
				WHERE id = $2
			`, userID, invID)
			return uErr
		})

	case "OUTLET":
		nextStatus := "PENDING_APPROVAL"
		if upperAction == "DECLINE" {
			nextStatus = "DECLINED"
		}
		tag, err := r.pool.Exec(ctx, `
			UPDATE outlet_staff_assignments
			SET user_id = $1,
			    status = $2::text,
			    accepted_at = CASE WHEN $2::text = 'PENDING_APPROVAL' THEN NOW() ELSE accepted_at END
			WHERE id = $3
			  AND (user_id = $1 OR ($4::text <> '' AND LOWER(invited_email) = $4::text) OR ($5::text <> '' AND invited_phone = $5::text))
			  AND status IN ('INVITED', 'PENDING_ACCEPTANCE')
		`, userID, nextStatus, invID, email, phone)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrUserNotFound
		}
		return nil

	default:
		return fmt.Errorf("unknown invitation kind %q", kind)
	}
}

// CheckPortalOnboardingStatus evaluates whether a user should be prompted for onboarding in the requested portal.
func (r *Repository) CheckPortalOnboardingStatus(ctx context.Context, portal, userID string) (onboardingRequired bool, hint string) {
	switch strings.ToLower(strings.TrimSpace(portal)) {
	case "restaurant":
		var count int
		_ = r.pool.QueryRow(ctx, `
			SELECT (
				(SELECT COUNT(*) FROM restaurants WHERE owner_user_id = $1) +
				(SELECT COUNT(*) FROM outlet_staff_assignments WHERE user_id = $1 AND status = 'ACTIVE')
			)
		`, userID).Scan(&count)
		if count == 0 {
			return true, "Create/onboard your outlet or accept an outlet invitation."
		}
		return false, ""
	case "delivery":
		var approved int
		_ = r.pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM delivery_partners WHERE user_id = $1 AND verification_status = 'APPROVED'
		`, userID).Scan(&approved)
		if approved == 0 {
			return true, "Complete delivery partner onboarding or submit KYC verification."
		}
		return false, ""
	case "customer":
		var addrCount int
		_ = r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM customer_addresses WHERE user_id = $1`, userID).Scan(&addrCount)
		if addrCount == 0 {
			return true, "Add a delivery address to personalize nearby spots."
		}
		return false, ""
	case "admin":
		u, uErr := r.GetUserByID(ctx, userID)
		if uErr == nil && len(u.Permissions) > 0 {
			return false, ""
		}
		invs, err := r.ListUserInvitations(ctx, userID)
		if err == nil {
			for _, iv := range invs {
				if iv.Kind == "PLATFORM" && (iv.Status == "PENDING_ACCEPTANCE" || iv.Status == "PENDING_ADMIN_APPROVAL") {
					return true, "Accept your pending Admin invitation to unlock dashboard access."
				}
			}
		}
		return true, "Account active with zero admin access. Wait for an eligible Admin invitation and accept it to unlock access."
	default:
		return false, ""
	}
}

// HasAdminPortalAccessOrInvite checks whether a user already holds admin/care privileges OR has a pending platform invitation.
func (r *Repository) HasAdminPortalAccessOrInvite(ctx context.Context, userID string) (bool, error) {
	u, err := r.GetUserByID(ctx, userID)
	if err != nil {
		return false, err
	}
	if len(u.Permissions) > 0 {
		return true, nil
	}
	for _, role := range u.Roles {
		if strings.HasSuffix(role, "_ADMIN") || role == "CUSTOMER_CARE" {
			return true, nil
		}
	}
	invs, err := r.ListUserInvitations(ctx, userID)
	if err != nil {
		return false, err
	}
	for _, iv := range invs {
		if iv.Kind == "PLATFORM" && (iv.Status == "PENDING_ACCEPTANCE" || iv.Status == "PENDING_ADMIN_APPROVAL" || iv.Status == "ACTIVE") {
			return true, nil
		}
	}
	return false, nil
}
