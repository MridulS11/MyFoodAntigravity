package restaurants

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
)

var (
	ErrOutletNotFound = errors.New("outlet not found")
	ErrForbidden      = errors.New("insufficient outlet permissions")
)

// Outlet represents an operational restaurant/branch entity.
type Outlet struct {
	ID                         string     `json:"id"`
	OwnerUserID                string     `json:"owner_user_id"`
	BrandName                  *string    `json:"brand_name,omitempty"`
	BranchName                 *string    `json:"branch_name,omitempty"`
	ServiceZoneID              string     `json:"service_zone_id"`
	Slug                       string     `json:"slug"`
	Name                       string     `json:"name"`
	Eyebrow                    *string    `json:"eyebrow,omitempty"`
	Tagline                    *string    `json:"tagline,omitempty"`
	Description                *string    `json:"description,omitempty"`
	Cuisines                   []string   `json:"cuisines"`
	Phone                      string     `json:"phone"`
	Email                      string     `json:"email"`
	AddressLine1               string     `json:"address_line1"`
	City                       string     `json:"city"`
	State                      string     `json:"state"`
	PostalCode                 string     `json:"postal_code"`
	Lat                        float64    `json:"lat"`
	Lng                        float64    `json:"lng"`
	MaxDeliveryRadiusMeters    int        `json:"max_delivery_radius_meters"`
	HeroImageURL               *string    `json:"hero_image_url,omitempty"`
	VerificationStatus         string     `json:"verification_status"`
	IsActive                   bool       `json:"is_active"`
	IsAcceptingOrders          bool       `json:"is_accepting_orders"`
	PauseReason                *string    `json:"pause_reason,omitempty"`
	PausedUntil                *time.Time `json:"paused_until,omitempty"`
	MaxConcurrentOrders        *int       `json:"max_concurrent_orders,omitempty"`
	ActiveOrdersCount          int        `json:"active_orders_count"`
	AvgPrepTimeMinutes         int        `json:"avg_prep_time_minutes"`
	MinOrderAmountMinor        int64      `json:"min_order_amount_minor"`
	PackagingFeeMinor          int64      `json:"packaging_fee_minor"`
	CommissionRateBps          *int       `json:"commission_rate_bps,omitempty"`
	CommissionCalculationBasis *string    `json:"commission_calculation_basis,omitempty"`
	RatingAverage              float64    `json:"rating_average"`
	RatingCount                int        `json:"rating_count"`
	CreatedAt                  time.Time  `json:"created_at"`
}

// OperatingHourSlot represents a weekly schedule slot.
type OperatingHourSlot struct {
	DayOfWeek  int    `json:"day_of_week"`
	SlotNumber int    `json:"slot_number"`
	OpenTime   string `json:"open_time"`
	CloseTime  string `json:"close_time"`
	IsClosed   bool   `json:"is_closed"`
}

// StaffAssignment represents branch manager/staff access or pending invitation for an outlet.
type StaffAssignment struct {
	ID             string     `json:"id"`
	OutletID       string     `json:"outlet_id"`
	OutletName     string     `json:"outlet_name,omitempty"`
	BrandName      string     `json:"brand_name,omitempty"`
	BranchName     string     `json:"branch_name,omitempty"`
	UserID         *string    `json:"user_id,omitempty"`
	FullName       string     `json:"full_name"`
	Email          string     `json:"email"`
	Phone          string     `json:"phone"`
	RoleCode       string     `json:"role_code"`
	OutletRoleID   *string    `json:"outlet_role_id,omitempty"`
	OutletRoleName *string    `json:"outlet_role_name,omitempty"`
	Permissions    []string   `json:"permissions"`
	Status         string     `json:"status"`
	AcceptedAt     *time.Time `json:"accepted_at,omitempty"`
	ApprovedAt     *time.Time `json:"approved_at,omitempty"`
}

// OutletRole represents a custom role configured by an Outlet Owner for managing their outlets.
type OutletRole struct {
	ID          string   `json:"id"`
	OwnerUserID string   `json:"owner_user_id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

// ServiceZoneItem describes an active Goodly service zone for onboarding & UI selection.
type ServiceZoneItem struct {
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	City                  string `json:"city"`
	BaseDeliveryFeeMinor  int64  `json:"base_delivery_fee_minor"`
	MinCartThresholdMinor int64  `json:"min_cart_threshold_minor"`
	SmallCartFeeMinor     int64  `json:"small_cart_fee_minor"`
}

// SettlementSummary holds per-order accrual rows and penalties for an outlet.
type SettlementSummary struct {
	ID                      string    `json:"id"`
	OrderID                 string    `json:"order_id"`
	OrderNumber             string    `json:"order_number"`
	RestaurantID            string    `json:"restaurant_id"`
	GrossFoodAmountMinor    int64     `json:"gross_food_amount_minor"`
	PackagingFeeMinor       int64     `json:"packaging_fee_minor"`
	PlatformCommissionBps   int       `json:"platform_commission_bps"`
	PlatformCommissionMinor int64     `json:"platform_commission_minor"`
	PenaltyDeductionMinor   int64     `json:"penalty_deduction_minor"`
	NetPayoutMinor          int64     `json:"net_payout_minor"`
	SettlementStatus        string    `json:"settlement_status"`
	CreatedAt               time.Time `json:"created_at"`
}

// PenaltyRecord represents a non-acceptance penalty ledger row.
type PenaltyRecord struct {
	ID                    string    `json:"id"`
	OrderID               string    `json:"order_id"`
	OutletID              string    `json:"outlet_id"`
	ReasonCode            string    `json:"reason_code"`
	PenaltyAmountMinor    int64     `json:"penalty_amount_minor"`
	Currency              string    `json:"currency"`
	OrderResolutionPolicy string    `json:"order_resolution_policy"`
	Status                string    `json:"status"`
	CreatedAt             time.Time `json:"created_at"`
}

// OwnerProfile stores a restaurant owner's KYC verification state and optional organization name.
type OwnerProfile struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	FullName           string     `json:"full_name"`
	Email              string     `json:"email"`
	Phone              string     `json:"phone"`
	OrganizationName   *string    `json:"organization_name,omitempty"`
	IDDocumentType     string     `json:"id_document_type"`
	IDDocumentNumber   string     `json:"id_document_number"`
	IDDocumentFilename string     `json:"id_document_filename,omitempty"`
	VerificationStatus string     `json:"verification_status"`
	ReviewNotes        *string    `json:"review_notes,omitempty"`
	CreatedAt          *time.Time `json:"created_at,omitempty"`
}

// Repository manages multi-outlet data in PostgreSQL.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a restaurants Repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// AuthorizeOutletAction checks if actorUserID owns the outlet OR has active branch assignment with requiredPermission.
func (r *Repository) AuthorizeOutletAction(ctx context.Context, actorUserID, outletID, requiredPermission string) error {
	var isOwner bool
	err := r.pool.QueryRow(ctx, `
		SELECT (owner_user_id = $2) FROM restaurants WHERE id = $1
	`, outletID, actorUserID).Scan(&isOwner)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOutletNotFound
	}
	if err != nil {
		return err
	}
	if isOwner {
		return nil
	}

	var perms []string
	err = r.pool.QueryRow(ctx, `
		SELECT permissions FROM outlet_staff_assignments
		WHERE outlet_id = $1 AND user_id = $2 AND status = 'ACTIVE'
	`, outletID, actorUserID).Scan(&perms)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if requiredPermission == "" || slices.Contains(perms, requiredPermission) {
		return nil
	}
	return ErrForbidden
}

// ListMyOutlets lists all outlets owned by or assigned to userID.
func (r *Repository) ListMyOutlets(ctx context.Context, userID string) ([]Outlet, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT r.id, r.owner_user_id, r.brand_name, r.branch_name, r.service_zone_id,
		       r.slug, r.name, r.eyebrow, r.tagline, r.description, r.cuisines,
		       r.phone, r.email, r.address_line1, r.city, r.state, r.postal_code,
		       ST_Y(r.location::geometry), ST_X(r.location::geometry), r.max_delivery_radius_meters,
		       r.hero_image_url, r.verification_status, r.is_active, r.is_accepting_orders,
		       r.pause_reason, r.paused_until, r.max_concurrent_orders, r.active_orders_count,
		       r.avg_prep_time_minutes, r.min_order_amount_minor, r.packaging_fee_minor,
		       r.commission_rate_bps, r.commission_calculation_basis, r.rating_average::float8,
		       r.rating_count, r.created_at
		FROM restaurants r
		WHERE r.owner_user_id = $1
		   OR EXISTS (
		       SELECT 1 FROM outlet_staff_assignments osa
		       WHERE osa.outlet_id = r.id AND osa.user_id = $1 AND osa.status = 'ACTIVE'
		   )
		ORDER BY r.created_at ASC, r.id ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Outlet
	for rows.Next() {
		o, err := scanOutlet(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	if out == nil {
		out = []Outlet{}
	}
	return out, nil
}

// GetOutletByID returns a single outlet record.
func (r *Repository) GetOutletByID(ctx context.Context, outletID string) (*Outlet, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT r.id, r.owner_user_id, r.brand_name, r.branch_name, r.service_zone_id,
		       r.slug, r.name, r.eyebrow, r.tagline, r.description, r.cuisines,
		       r.phone, r.email, r.address_line1, r.city, r.state, r.postal_code,
		       ST_Y(r.location::geometry), ST_X(r.location::geometry), r.max_delivery_radius_meters,
		       r.hero_image_url, r.verification_status, r.is_active, r.is_accepting_orders,
		       r.pause_reason, r.paused_until, r.max_concurrent_orders, r.active_orders_count,
		       r.avg_prep_time_minutes, r.min_order_amount_minor, r.packaging_fee_minor,
		       r.commission_rate_bps, r.commission_calculation_basis, r.rating_average::float8,
		       r.rating_count, r.created_at
		FROM restaurants r
		WHERE r.id = $1
	`, outletID)
	o, err := scanOutlet(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOutletNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// GetOwnerProfile fetches the owner's profile & KYC status (returning NOT_SUBMITTED if not yet created).
func (r *Repository) GetOwnerProfile(ctx context.Context, userID string) (*OwnerProfile, error) {
	var op OwnerProfile
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(op.id::text, ''), u.id, u.full_name, u.email, u.phone,
		       op.organization_name, COALESCE(op.id_document_type, ''),
		       COALESCE(op.id_document_number, ''), COALESCE(op.id_document_filename, ''),
		       COALESCE(op.verification_status, 'NOT_SUBMITTED'),
		       op.review_notes, op.created_at
		FROM users u
		LEFT JOIN restaurant_owner_profiles op ON op.user_id = u.id
		WHERE u.id = $1
	`, userID).Scan(
		&op.ID, &op.UserID, &op.FullName, &op.Email, &op.Phone,
		&op.OrganizationName, &op.IDDocumentType,
		&op.IDDocumentNumber, &op.IDDocumentFilename,
		&op.VerificationStatus, &op.ReviewNotes, &op.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOutletNotFound
	}
	if err != nil {
		return nil, err
	}
	return &op, nil
}

// UpsertOwnerProfile creates or resubmits a restaurant owner's KYC profile for admin review.
func (r *Repository) UpsertOwnerProfile(ctx context.Context, userID, organizationName, idDocType, idDocNumber, idDocFilename string) (*OwnerProfile, error) {
	id := uuid.NewString()
	org := strings.TrimSpace(organizationName)
	docType := strings.TrimSpace(idDocType)
	if docType == "" {
		docType = "PAN_CARD"
	}
	docNum := strings.TrimSpace(idDocNumber)
	docFile := strings.TrimSpace(idDocFilename)
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO restaurant_owner_profiles (
				id, user_id, organization_name, id_document_type, id_document_number,
				id_document_filename, verification_status, review_notes
			)
			VALUES ($1, $2, NULLIF($3::text, ''), $4, $5, NULLIF($6::text, ''), 'PENDING_REVIEW', NULL)
			ON CONFLICT (user_id) DO UPDATE
			SET organization_name = EXCLUDED.organization_name,
			    id_document_type = EXCLUDED.id_document_type,
			    id_document_number = EXCLUDED.id_document_number,
			    id_document_filename = COALESCE(EXCLUDED.id_document_filename, restaurant_owner_profiles.id_document_filename),
			    verification_status = 'PENDING_REVIEW',
			    review_notes = NULL
		`, id, userID, org, docType, docNum, docFile)
		if err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id)
			SELECT $1, id FROM roles WHERE code = 'OUTLET_OWNER'
			ON CONFLICT DO NOTHING
		`, userID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetOwnerProfile(ctx, userID)
}

// HasDuplicateOutletName checks whether the owner already has an outlet group matching outletName (case-insensitive).
func (r *Repository) HasDuplicateOutletName(ctx context.Context, ownerUserID, outletName string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM restaurants
			WHERE owner_user_id = $1
			  AND LOWER(TRIM(COALESCE(NULLIF(brand_name, ''), name))) = LOWER(TRIM($2))
		)
	`, ownerUserID, outletName).Scan(&exists)
	return exists, err
}

// CreateOnboardingOutlet creates a new outlet in PENDING_REVIEW status under an OUTLET_OWNER.
func (r *Repository) CreateOnboardingOutlet(ctx context.Context, ownerUserID string, name, brandName, branchName, zoneID string, cuisines []string, phone, email, addr, city, state, postalCode, licenseNumber string, lat, lng float64) (*Outlet, error) {
	outletID := uuid.NewString()
	slug := fmt.Sprintf("%s-%s", strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), " ", "-")), outletID[:6])

	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO restaurants (
				id, owner_user_id, brand_name, branch_name, service_zone_id, slug, name,
				cuisines, phone, email, address_line1, city, state, postal_code, location,
				verification_status, is_active, is_accepting_orders, packaging_fee_minor, commission_rate_bps
			)
			VALUES (
				$1, $2, NULLIF($3::text,''), NULLIF($4::text,''), $5, $6, $7,
				$8, $9, $10, $11, $12, $13, $14, ST_SetSRID(ST_MakePoint($15, $16), 4326)::geography,
				'PENDING_REVIEW', TRUE, FALSE, 2000, 2000
			)
		`, outletID, ownerUserID, brandName, branchName, zoneID, slug, name,
			cuisines, phone, email, addr, city, state, postalCode, lng, lat,
		); err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id)
			SELECT $1, id FROM roles WHERE code = 'OUTLET_OWNER'
			ON CONFLICT DO NOTHING
		`, ownerUserID)

		if licenseNumber != "" {
			if _, err := tx.Exec(ctx, `
				INSERT INTO restaurant_documents (id, restaurant_id, document_type, document_number, file_key, status)
				VALUES ($1, $2, 'FSSAI_LICENSE', $3, $4, 'PENDING')
			`, uuid.NewString(), outletID, licenseNumber, "pending-kyc/"+licenseNumber); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetOutletByID(ctx, outletID)
}

// UpdateOutletSettings updates prep time, min order, packaging fee, and max_concurrent_orders capacity limit.
func (r *Repository) UpdateOutletSettings(ctx context.Context, outletID string, avgPrepMinutes *int, packagingFeeMinor, minOrderMinor *int64, maxConcurrentOrders *int, clearCapacity bool) (*Outlet, error) {
	_, err := r.pool.Exec(ctx, `
		UPDATE restaurants
		SET avg_prep_time_minutes = COALESCE($2, avg_prep_time_minutes),
		    packaging_fee_minor = COALESCE($3, packaging_fee_minor),
		    min_order_amount_minor = COALESCE($4, min_order_amount_minor),
		    max_concurrent_orders = CASE WHEN $5 THEN NULL ELSE COALESCE($6, max_concurrent_orders) END
		WHERE id = $1
	`, outletID, avgPrepMinutes, packagingFeeMinor, minOrderMinor, clearCapacity, maxConcurrentOrders)
	if err != nil {
		return nil, err
	}
	return r.GetOutletByID(ctx, outletID)
}

// SetAvailability updates live accepting orders toggle on a verified outlet.
func (r *Repository) SetAvailability(ctx context.Context, outletID string, isAccepting bool, reason *string) (*Outlet, error) {
	o, err := r.GetOutletByID(ctx, outletID)
	if err != nil {
		return nil, err
	}
	if isAccepting && o.VerificationStatus != "APPROVED" {
		return nil, fmt.Errorf("outlet must be APPROVED before going online")
	}
	if _, err := r.pool.Exec(ctx, `
		UPDATE restaurants SET is_accepting_orders = $2, pause_reason = $3 WHERE id = $1
	`, outletID, isAccepting, reason); err != nil {
		return nil, err
	}
	return r.GetOutletByID(ctx, outletID)
}

// ReplaceOperatingHours atomically replaces weekly operating slots.
func (r *Repository) ReplaceOperatingHours(ctx context.Context, outletID string, slots []OperatingHourSlot) ([]OperatingHourSlot, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM restaurant_operating_hours WHERE restaurant_id = $1`, outletID); err != nil {
			return err
		}
		for _, s := range slots {
			slotNum := s.SlotNumber
			if slotNum <= 0 {
				slotNum = 1
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO restaurant_operating_hours (id, restaurant_id, day_of_week, slot_number, open_time, close_time, is_closed)
				VALUES ($1, $2, $3, $4, $5::time, $6::time, $7)
			`, uuid.NewString(), outletID, s.DayOfWeek, slotNum, s.OpenTime, s.CloseTime, s.IsClosed); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return slots, nil
}

// ListServiceZones lists active service zones for restaurant & courier onboarding.
func (r *Repository) ListServiceZones(ctx context.Context) ([]ServiceZoneItem, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, name, city, base_delivery_fee_minor, min_cart_threshold_minor, small_cart_fee_minor
		FROM service_zones
		WHERE is_active = TRUE
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []ServiceZoneItem
	for rows.Next() {
		var z ServiceZoneItem
		if err := rows.Scan(&z.ID, &z.Name, &z.City, &z.BaseDeliveryFeeMinor, &z.MinCartThresholdMinor, &z.SmallCartFeeMinor); err != nil {
			return nil, err
		}
		list = append(list, z)
	}
	if list == nil {
		list = []ServiceZoneItem{}
	}
	return list, nil
}

// ListOutletRoles returns custom roles defined by the outlet owner.
func (r *Repository) ListOutletRoles(ctx context.Context, ownerUserID string) ([]OutletRole, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, owner_user_id, name, COALESCE(description, ''), permissions
		FROM outlet_roles
		WHERE owner_user_id = $1
		ORDER BY created_at ASC
	`, ownerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []OutletRole
	for rows.Next() {
		var role OutletRole
		if err := rows.Scan(&role.ID, &role.OwnerUserID, &role.Name, &role.Description, &role.Permissions); err != nil {
			return nil, err
		}
		if role.Permissions == nil {
			role.Permissions = []string{}
		}
		list = append(list, role)
	}
	if list == nil {
		list = []OutletRole{}
	}
	return list, nil
}

// CreateOutletRole inserts a granular custom outlet role for an owner.
func (r *Repository) CreateOutletRole(ctx context.Context, ownerUserID, name, description string, permissions []string) (*OutletRole, error) {
	var created OutletRole
	err := r.pool.QueryRow(ctx, `
		INSERT INTO outlet_roles (id, owner_user_id, name, description, permissions)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, owner_user_id, name, COALESCE(description, ''), permissions
	`, uuid.NewString(), ownerUserID, strings.TrimSpace(name), strings.TrimSpace(description), permissions).Scan(
		&created.ID, &created.OwnerUserID, &created.Name, &created.Description, &created.Permissions,
	)
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// UpdateOutletRole modifies permissions or metadata on a custom outlet role.
func (r *Repository) UpdateOutletRole(ctx context.Context, ownerUserID, roleID, name, description string, permissions []string) (*OutletRole, error) {
	var updated OutletRole
	err := r.pool.QueryRow(ctx, `
		UPDATE outlet_roles
		SET name = COALESCE(NULLIF($3, ''), name),
		    description = $4,
		    permissions = $5
		WHERE id = $1 AND owner_user_id = $2
		RETURNING id, owner_user_id, name, COALESCE(description, ''), permissions
	`, roleID, ownerUserID, strings.TrimSpace(name), strings.TrimSpace(description), permissions).Scan(
		&updated.ID, &updated.OwnerUserID, &updated.Name, &updated.Description, &updated.Permissions,
	)
	if err != nil {
		return nil, err
	}
	// Sync permissions onto active or pending staff assignments referencing this role
	_, _ = r.pool.Exec(ctx, `
		UPDATE outlet_staff_assignments SET permissions = $2, outlet_role_name = $3 WHERE outlet_role_id = $1
	`, roleID, updated.Permissions, updated.Name)
	return &updated, nil
}

func scanStaffRows(rows pgx.Rows) ([]StaffAssignment, error) {
	defer rows.Close()
	var list []StaffAssignment
	for rows.Next() {
		var s StaffAssignment
		if err := rows.Scan(
			&s.ID, &s.OutletID, &s.OutletName, &s.BrandName, &s.BranchName, &s.UserID,
			&s.FullName, &s.Email, &s.Phone,
			&s.RoleCode, &s.OutletRoleID, &s.OutletRoleName,
			&s.Permissions, &s.Status, &s.AcceptedAt, &s.ApprovedAt,
		); err != nil {
			return nil, err
		}
		if s.Permissions == nil {
			s.Permissions = []string{}
		}
		list = append(list, s)
	}
	if list == nil {
		list = []StaffAssignment{}
	}
	return list, nil
}

// ListBranchStaff returns staff assignments and invitations for an outlet.
func (r *Repository) ListBranchStaff(ctx context.Context, outletID string) ([]StaffAssignment, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT osa.id, osa.outlet_id, rest.name, COALESCE(NULLIF(rest.brand_name, ''), rest.name), COALESCE(rest.branch_name, ''), osa.user_id,
		       COALESCE(u.full_name, 'Invited Member'),
		       COALESCE(u.email, osa.invited_email, ''),
		       COALESCE(u.phone, osa.invited_phone, ''),
		       osa.role_code, osa.outlet_role_id, osa.outlet_role_name,
		       osa.permissions, osa.status, osa.accepted_at, osa.approved_at
		FROM outlet_staff_assignments osa
		JOIN restaurants rest ON rest.id = osa.outlet_id
		LEFT JOIN users u ON u.id = osa.user_id
		WHERE osa.outlet_id = $1
		ORDER BY osa.created_at DESC
	`, outletID)
	if err != nil {
		return nil, err
	}
	return scanStaffRows(rows)
}

// ListAllOwnerStaff returns staff assignments across every outlet & branch owned by ownerUserID.
func (r *Repository) ListAllOwnerStaff(ctx context.Context, ownerUserID string) ([]StaffAssignment, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT osa.id, osa.outlet_id, rest.name, COALESCE(NULLIF(rest.brand_name, ''), rest.name), COALESCE(rest.branch_name, ''), osa.user_id,
		       COALESCE(u.full_name, 'Invited Member'),
		       COALESCE(u.email, osa.invited_email, ''),
		       COALESCE(u.phone, osa.invited_phone, ''),
		       osa.role_code, osa.outlet_role_id, osa.outlet_role_name,
		       osa.permissions, osa.status, osa.accepted_at, osa.approved_at
		FROM outlet_staff_assignments osa
		JOIN restaurants rest ON rest.id = osa.outlet_id
		LEFT JOIN users u ON u.id = osa.user_id
		WHERE rest.owner_user_id = $1
		ORDER BY osa.created_at DESC
	`, ownerUserID)
	if err != nil {
		return nil, err
	}
	return scanStaffRows(rows)
}

// InviteBranchStaff creates a pending outlet staff invitation mapped by email or phone.
// Invitee must accept the invitation and then receive owner/admin approval before accessing the outlet.
func (r *Repository) InviteBranchStaff(ctx context.Context, ownerID, outletID, email, phone, roleCode, outletRoleID string, permissions []string) (*StaffAssignment, error) {
	normEmail := strings.ToLower(strings.TrimSpace(email))
	normPhone := strings.TrimSpace(phone)
	if normEmail == "" && normPhone == "" {
		return nil, fmt.Errorf("either email or contact phone number is required")
	}

	var targetUserID *string
	var uid string
	err := r.pool.QueryRow(ctx, `
		SELECT id FROM users
		WHERE ($1 <> '' AND LOWER(email) = $1) OR ($2 <> '' AND phone = $2)
		LIMIT 1
	`, normEmail, normPhone).Scan(&uid)
	if err == nil {
		targetUserID = &uid
	}

	var roleIDPtr *string
	var roleNamePtr *string
	if outletRoleID != "" {
		var rName string
		var rPerms []string
		if err := r.pool.QueryRow(ctx, `
			SELECT name, permissions FROM outlet_roles WHERE id = $1 AND owner_user_id = $2
		`, outletRoleID, ownerID).Scan(&rName, &rPerms); err != nil {
			return nil, fmt.Errorf("custom outlet role not found")
		}
		roleIDPtr = &outletRoleID
		roleNamePtr = &rName
		if len(permissions) == 0 {
			permissions = rPerms
		}
		roleCode = "CUSTOM"
	}

	var emailPtr, phonePtr *string
	if normEmail != "" {
		emailPtr = &normEmail
	}
	if normPhone != "" {
		phonePtr = &normPhone
	}

	assignID := uuid.NewString()
	_, err = r.pool.Exec(ctx, `
		INSERT INTO outlet_staff_assignments (
			id, outlet_id, user_id, invited_email, invited_phone, invited_by_owner_id,
			role_code, outlet_role_id, outlet_role_name, permissions, status
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING_ACCEPTANCE')
	`, assignID, outletID, targetUserID, emailPtr, phonePtr, ownerID, roleCode, roleIDPtr, roleNamePtr, permissions)
	if err != nil {
		return nil, fmt.Errorf("could not create staff invitation (may already exist for this outlet): %w", err)
	}

	list, err := r.ListBranchStaff(ctx, outletID)
	if err != nil {
		return nil, err
	}
	for _, s := range list {
		if s.ID == assignID {
			return &s, nil
		}
	}
	return nil, nil
}

// ApproveBranchStaff activates an accepted outlet staff invitation and grants canonical staff role.
func (r *Repository) ApproveBranchStaff(ctx context.Context, actorID, outletID, assignmentID string) (*StaffAssignment, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var status string
		var userID *string
		var roleCode string
		err := tx.QueryRow(ctx, `
			SELECT status, user_id, role_code
			FROM outlet_staff_assignments
			WHERE id = $1 AND outlet_id = $2
			FOR UPDATE
		`, assignmentID, outletID).Scan(&status, &userID, &roleCode)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOutletNotFound
		}
		if err != nil {
			return err
		}
		if userID == nil || status == "PENDING_ACCEPTANCE" || status == "INVITED" {
			return fmt.Errorf("invitee must accept the invitation before approval")
		}
		if status != "PENDING_APPROVAL" && status != "ACTIVE" {
			return fmt.Errorf("cannot approve invitation in status %s", status)
		}

		if _, err := tx.Exec(ctx, `
			UPDATE outlet_staff_assignments
			SET status = 'ACTIVE', approved_by = $2, approved_at = NOW()
			WHERE id = $1
		`, assignmentID, actorID); err != nil {
			return err
		}

		targetRole := "OUTLET_STAFF"
		if roleCode == "BRANCH_MANAGER" {
			targetRole = "BRANCH_MANAGER"
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id, granted_by)
			SELECT $1, id, $3 FROM roles WHERE code = $2
			ON CONFLICT DO NOTHING
		`, *userID, targetRole, actorID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	list, err := r.ListBranchStaff(ctx, outletID)
	if err != nil {
		return nil, err
	}
	for _, s := range list {
		if s.ID == assignmentID {
			return &s, nil
		}
	}
	return nil, nil
}

// RevokeBranchStaff revokes a pending or active staff assignment.
func (r *Repository) RevokeBranchStaff(ctx context.Context, outletID, assignmentID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE outlet_staff_assignments SET status = 'REVOKED' WHERE id = $1 AND outlet_id = $2
	`, assignmentID, outletID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrOutletNotFound
	}
	return nil
}

// GetSettlementsAndPenalties fetches settlements and penalties for one outlet or all outlets owned by ownerUserID.
func (r *Repository) GetSettlementsAndPenalties(ctx context.Context, ownerUserID string, outletID string) ([]SettlementSummary, []PenaltyRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT rs.id, rs.order_id, o.order_number, rs.restaurant_id,
		       rs.gross_food_amount_minor, rs.packaging_fee_minor, rs.platform_commission_bps,
		       rs.platform_commission_minor, rs.penalty_deduction_minor, rs.net_payout_minor,
		       rs.settlement_status, rs.created_at
		FROM restaurant_settlements rs
		JOIN orders o ON o.id = rs.order_id
		WHERE ($2 <> '' AND rs.restaurant_id = $2::uuid) OR ($2 = '' AND rs.owner_user_id = $1::uuid)
		ORDER BY rs.created_at DESC
		LIMIT 100
	`, ownerUserID, outletID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var settlements []SettlementSummary
	for rows.Next() {
		var s SettlementSummary
		if err := rows.Scan(
			&s.ID, &s.OrderID, &s.OrderNumber, &s.RestaurantID,
			&s.GrossFoodAmountMinor, &s.PackagingFeeMinor, &s.PlatformCommissionBps,
			&s.PlatformCommissionMinor, &s.PenaltyDeductionMinor, &s.NetPayoutMinor,
			&s.SettlementStatus, &s.CreatedAt,
		); err != nil {
			return nil, nil, err
		}
		settlements = append(settlements, s)
	}
	if settlements == nil {
		settlements = []SettlementSummary{}
	}

	pRows, err := r.pool.Query(ctx, `
		SELECT id, order_id, outlet_id, reason_code, penalty_amount_minor, currency,
		       order_resolution_policy, status, created_at
		FROM outlet_penalties
		WHERE ($2 <> '' AND outlet_id = $2::uuid) OR ($2 = '' AND owner_user_id = $1::uuid)
		ORDER BY created_at DESC
		LIMIT 50
	`, ownerUserID, outletID)
	if err != nil {
		return nil, nil, err
	}
	defer pRows.Close()

	var penalties []PenaltyRecord
	for pRows.Next() {
		var p PenaltyRecord
		if err := pRows.Scan(
			&p.ID, &p.OrderID, &p.OutletID, &p.ReasonCode, &p.PenaltyAmountMinor,
			&p.Currency, &p.OrderResolutionPolicy, &p.Status, &p.CreatedAt,
		); err != nil {
			return nil, nil, err
		}
		penalties = append(penalties, p)
	}
	if penalties == nil {
		penalties = []PenaltyRecord{}
	}
	return settlements, penalties, nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanOutlet(row scannable) (Outlet, error) {
	var o Outlet
	err := row.Scan(
		&o.ID, &o.OwnerUserID, &o.BrandName, &o.BranchName, &o.ServiceZoneID,
		&o.Slug, &o.Name, &o.Eyebrow, &o.Tagline, &o.Description, &o.Cuisines,
		&o.Phone, &o.Email, &o.AddressLine1, &o.City, &o.State, &o.PostalCode,
		&o.Lat, &o.Lng, &o.MaxDeliveryRadiusMeters,
		&o.HeroImageURL, &o.VerificationStatus, &o.IsActive, &o.IsAcceptingOrders,
		&o.PauseReason, &o.PausedUntil, &o.MaxConcurrentOrders, &o.ActiveOrdersCount,
		&o.AvgPrepTimeMinutes, &o.MinOrderAmountMinor, &o.PackagingFeeMinor,
		&o.CommissionRateBps, &o.CommissionCalculationBasis, &o.RatingAverage,
		&o.RatingCount, &o.CreatedAt,
	)
	if o.Cuisines == nil {
		o.Cuisines = []string{}
	}
	return o, err
}
