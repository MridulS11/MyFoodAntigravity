package users

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
)

var (
	ErrAddressNotFoundOrForbidden = errors.New("address not found or access denied")
	ErrDuplicateAddressLabel      = errors.New("an address with this tag already exists")
)

// CustomerProfile represents GET /api/v1/customers/me payload.
type CustomerProfile struct {
	UserID             string   `json:"user_id"`
	Email              string   `json:"email"`
	Phone              string   `json:"phone"`
	FullName           string   `json:"full_name"`
	Roles              []string `json:"roles"`
	Permissions        []string `json:"permissions"`
	DietaryPreferences []string `json:"dietary_preferences"`
	DefaultAddressID   *string  `json:"default_address_id,omitempty"`
	TotalOrdersCount   int      `json:"total_orders_count"`
}

// CustomerAddress represents a saved delivery address with PostGIS coordinates & serviceability check.
type CustomerAddress struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"user_id"`
	Label                string    `json:"label"`
	RecipientName        string    `json:"recipient_name"`
	RecipientPhone       string    `json:"recipient_phone"`
	AddressLine1         string    `json:"address_line1"`
	AddressLine2         *string   `json:"address_line2,omitempty"`
	Landmark             *string   `json:"landmark,omitempty"`
	City                 string    `json:"city"`
	State                string    `json:"state"`
	PostalCode           string    `json:"postal_code"`
	CountryCode          string    `json:"country_code"`
	DeliveryInstructions *string   `json:"delivery_instructions,omitempty"`
	Lat                  float64   `json:"lat"`
	Lng                  float64   `json:"lng"`
	IsDefault            bool      `json:"is_default"`
	IsServiceable        bool      `json:"is_serviceable"`
	CreatedAt            time.Time `json:"created_at"`
}

// CreateAddressInput holds validated address creation fields.
type CreateAddressInput struct {
	Label                string
	RecipientName        string
	RecipientPhone       string
	AddressLine1         string
	AddressLine2         *string
	Landmark             *string
	City                 string
	State                string
	PostalCode           string
	CountryCode          string
	DeliveryInstructions *string
	Lat                  float64
	Lng                  float64
	IsDefault            bool
}

// Repository handles PostgreSQL + PostGIS queries for customer profiles, addresses, and favorites.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a users Repository.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// GetCustomerProfile fetches the authenticated user's profile and preferences.
func (r *Repository) GetCustomerProfile(ctx context.Context, userID string) (*CustomerProfile, error) {
	var prof CustomerProfile
	err := r.pool.QueryRow(ctx, `
		SELECT u.id, u.email, u.phone, u.full_name,
		       COALESCE(cp.dietary_preferences, '{}'),
		       cp.default_address_id,
		       COALESCE(cp.total_orders_count, 0)
		FROM users u
		LEFT JOIN customer_profiles cp ON cp.user_id = u.id
		WHERE u.id = $1
	`, userID).Scan(
		&prof.UserID, &prof.Email, &prof.Phone, &prof.FullName,
		&prof.DietaryPreferences, &prof.DefaultAddressID, &prof.TotalOrdersCount,
	)
	if err != nil {
		return nil, err
	}

	roleRows, err := r.pool.Query(ctx, `
		SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = $1
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
		prof.Roles = append(prof.Roles, code)
	}
	return &prof, nil
}

// UpdateCustomerProfile updates display name and dietary preferences.
func (r *Repository) UpdateCustomerProfile(ctx context.Context, userID, fullName string, dietaryPrefs []string) (*CustomerProfile, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		if fullName != "" {
			if _, err := tx.Exec(ctx, `UPDATE users SET full_name = $1 WHERE id = $2`, fullName, userID); err != nil {
				return err
			}
		}
		if dietaryPrefs != nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO customer_profiles (user_id, dietary_preferences)
				VALUES ($1, $2)
				ON CONFLICT (user_id) DO UPDATE SET dietary_preferences = EXCLUDED.dietary_preferences
			`, userID, dietaryPrefs); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetCustomerProfile(ctx, userID)
}

// ListAddresses returns all active saved addresses for userID along with live PostGIS service zone coverage.
func (r *Repository) ListAddresses(ctx context.Context, userID string) ([]CustomerAddress, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT ca.id, ca.user_id, ca.label, ca.recipient_name, ca.recipient_phone,
		       ca.address_line1, ca.address_line2, ca.landmark, ca.city, ca.state,
		       ca.postal_code, ca.country_code, ca.delivery_instructions,
		       ST_Y(ca.location::geometry) AS lat,
		       ST_X(ca.location::geometry) AS lng,
		       ca.is_default,
		       EXISTS (
		           SELECT 1 FROM service_zones sz
		           WHERE sz.is_active = TRUE AND ST_Covers(sz.boundary, ca.location)
		       ) AS is_serviceable,
		       ca.created_at
		FROM customer_addresses ca
		WHERE ca.user_id = $1 AND ca.is_archived = FALSE
		ORDER BY ca.is_default DESC, ca.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []CustomerAddress
	for rows.Next() {
		var a CustomerAddress
		if err := rows.Scan(
			&a.ID, &a.UserID, &a.Label, &a.RecipientName, &a.RecipientPhone,
			&a.AddressLine1, &a.AddressLine2, &a.Landmark, &a.City, &a.State,
			&a.PostalCode, &a.CountryCode, &a.DeliveryInstructions,
			&a.Lat, &a.Lng, &a.IsDefault, &a.IsServiceable, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	if result == nil {
		result = []CustomerAddress{}
	}
	return result, nil
}

// CreateAddress inserts a saved customer address using PostGIS ST_MakePoint and evaluates serviceability.
func (r *Repository) CreateAddress(ctx context.Context, userID string, in CreateAddressInput) (*CustomerAddress, error) {
	addrID := uuid.NewString()
	label := strings.TrimSpace(in.Label)
	country := in.CountryCode
	if country == "" {
		country = "IN"
	}

	var out CustomerAddress
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM customer_addresses
				WHERE user_id = $1 AND is_archived = FALSE AND LOWER(btrim(label)) = LOWER($2)
			)
		`, userID, label).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrDuplicateAddressLabel
		}

		if in.IsDefault {
			if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default = FALSE WHERE user_id = $1`, userID); err != nil {
				return err
			}
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO customer_addresses (
				id, user_id, label, recipient_name, recipient_phone,
				address_line1, address_line2, landmark, city, state,
				postal_code, country_code, delivery_instructions, location, is_default
			)
			VALUES (
				$1, $2, $3, $4, $5,
				$6, $7, $8, $9, $10,
				$11, $12, $13, ST_SetSRID(ST_MakePoint($14, $15), 4326)::geography, $16
			)
			RETURNING id, user_id, label, recipient_name, recipient_phone,
			          address_line1, address_line2, landmark, city, state,
			          postal_code, country_code, delivery_instructions,
			          ST_Y(location::geometry), ST_X(location::geometry),
			          is_default,
			          EXISTS (
			              SELECT 1 FROM service_zones sz
			              WHERE sz.is_active = TRUE AND ST_Covers(sz.boundary, location)
			          ),
			          created_at
		`, addrID, userID, label, in.RecipientName, in.RecipientPhone,
			in.AddressLine1, in.AddressLine2, in.Landmark, in.City, in.State,
			in.PostalCode, country, in.DeliveryInstructions, in.Lng, in.Lat, in.IsDefault,
		).Scan(
			&out.ID, &out.UserID, &out.Label, &out.RecipientName, &out.RecipientPhone,
			&out.AddressLine1, &out.AddressLine2, &out.Landmark, &out.City, &out.State,
			&out.PostalCode, &out.CountryCode, &out.DeliveryInstructions,
			&out.Lat, &out.Lng, &out.IsDefault, &out.IsServiceable, &out.CreatedAt,
		); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrDuplicateAddressLabel
			}
			return err
		}

		if in.IsDefault {
			_, _ = tx.Exec(ctx, `UPDATE customer_profiles SET default_address_id = $1 WHERE user_id = $2`, addrID, userID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// SetDefaultAddress updates is_default strictly for addresses owned by userID.
func (r *Repository) SetDefaultAddress(ctx context.Context, userID, addressID string) error {
	return database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var owned bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customer_addresses WHERE id = $1 AND user_id = $2 AND is_archived = FALSE)`, addressID, userID).Scan(&owned); err != nil {
			return err
		}
		if !owned {
			return ErrAddressNotFoundOrForbidden
		}
		if _, err := tx.Exec(ctx, `UPDATE customer_addresses SET is_default = (id = $1) WHERE user_id = $2 AND is_archived = FALSE`, addressID, userID); err != nil {
			return err
		}
		_, _ = tx.Exec(ctx, `UPDATE customer_profiles SET default_address_id = $1 WHERE user_id = $2`, addressID, userID)
		return nil
	})
}

// ArchiveAddress soft-deletes an address belonging strictly to userID.
func (r *Repository) ArchiveAddress(ctx context.Context, userID, addressID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE customer_addresses SET is_archived = TRUE, is_default = FALSE
		WHERE id = $1 AND user_id = $2 AND is_archived = FALSE
	`, addressID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAddressNotFoundOrForbidden
	}
	return nil
}

// ListFavoriteIDs returns restaurant IDs favorited by userID.
func (r *Repository) ListFavoriteIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT restaurant_id FROM customer_favorites WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, nil
}

// AddFavorite stores a customer favorite restaurant idempotently.
func (r *Repository) AddFavorite(ctx context.Context, userID, restaurantID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO customer_favorites (user_id, restaurant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
	`, userID, restaurantID)
	return err
}

// RemoveFavorite removes a favorite entry.
func (r *Repository) RemoveFavorite(ctx context.Context, userID, restaurantID string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM customer_favorites WHERE user_id = $1 AND restaurant_id = $2`, userID, restaurantID)
	return err
}
