package cart

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
)

var (
	ErrMultiRestaurantConflict = errors.New("cart contains items from another restaurant")
	ErrItemOutOfStock          = errors.New("menu item unavailable or insufficient stock")
	ErrInvalidCustomization    = errors.New("invalid customization option selection")
	ErrInvalidCoupon           = errors.New("coupon is invalid, expired, or below minimum subtotal")
	ErrOutOfServiceArea        = errors.New("selected address is outside active delivery zones")
	ErrRestaurantClosed        = errors.New("restaurant is currently not accepting orders")
	ErrEmptyCart               = errors.New("cart is empty")
)

// CartItemOptionDTO represents a selected customization on a cart line.
type CartItemOptionDTO struct {
	OptionID        string `json:"option_id"`
	GroupName       string `json:"group_name"`
	OptionName      string `json:"option_name"`
	PriceDeltaMinor int64  `json:"price_delta_minor"`
}

// CartItemDTO represents an item line inside the cart.
type CartItemDTO struct {
	ID                           string              `json:"id"`
	MenuItemID                   string              `json:"menu_item_id"`
	Name                         string              `json:"name"`
	ImageURL                     *string             `json:"image_url,omitempty"`
	UnitBasePriceMinor           int64               `json:"unit_base_price_minor"`
	UnitCustomizationsPriceMinor int64               `json:"unit_customizations_price_minor"`
	Quantity                     int                 `json:"quantity"`
	Customizations               []CartItemOptionDTO `json:"customizations"`
	LineTotalMinor               int64               `json:"line_total_minor"`
}

// CartDTO is the complete cart response including authoritative breakdown.
type CartDTO struct {
	RestaurantID        *string       `json:"restaurant_id"`
	RestaurantName      *string       `json:"restaurant_name"`
	RestaurantSlug      *string       `json:"restaurant_slug"`
	Currency            string        `json:"currency"`
	Items               []CartItemDTO `json:"items"`
	AppliedCouponCode   *string       `json:"applied_coupon_code"`
	SpecialInstructions string        `json:"special_instructions"`
	Breakdown           Breakdown     `json:"breakdown"`
}

// CheckoutValidationDTO confirms pre-order checkout readiness.
type CheckoutValidationDTO struct {
	IsValid          bool     `json:"is_valid"`
	PricingQuoteHash string   `json:"pricing_quote_hash"`
	Cart             *CartDTO `json:"cart"`
}

// Repository persists carts and computes live PostgreSQL prices.
type Repository struct {
	pool        *pgxpool.Pool
	quoteSecret string
}

// NewRepository constructs a cart Repository.
func NewRepository(pool *pgxpool.Pool, quoteSecret string) *Repository {
	return &Repository{pool: pool, quoteSecret: quoteSecret}
}

// GetCart hydrates the customer's cart from PostgreSQL and computes current prices.
func (r *Repository) GetCart(ctx context.Context, customerID string, addressID *string, tipMinor int64) (*CartDTO, error) {
	var cartID string
	var restID, couponID, savedAddrID, instructions *string
	var restName, restSlug, zoneID *string
	var packagingFee int64
	err := r.pool.QueryRow(ctx, `
		SELECT c.id, c.restaurant_id, c.applied_coupon_id, c.delivery_address_id, c.special_instructions,
		       rest.name, rest.slug, rest.service_zone_id, COALESCE(rest.packaging_fee_minor, 0)
		FROM carts c
		LEFT JOIN restaurants rest ON rest.id = c.restaurant_id
		WHERE c.customer_id = $1
	`, customerID).Scan(&cartID, &restID, &couponID, &savedAddrID, &instructions, &restName, &restSlug, &zoneID, &packagingFee)
	if errors.Is(err, pgx.ErrNoRows) {
		return &CartDTO{
			Currency:  "INR",
			Items:     []CartItemDTO{},
			Breakdown: Breakdown{MinCartThresholdMinor: 29900},
		}, nil
	}
	if err != nil {
		return nil, err
	}

	if addressID != nil && *addressID != "" {
		savedAddrID = addressID
	}

	rows, err := r.pool.Query(ctx, `
		SELECT ci.id, ci.menu_item_id, mi.name, mi.image_url, mi.base_price_minor, ci.quantity
		FROM cart_items ci
		JOIN menu_items mi ON mi.id = ci.menu_item_id
		WHERE ci.cart_id = $1
		ORDER BY ci.created_at ASC
	`, cartID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []CartItemDTO
	var itemIDs []string
	for rows.Next() {
		var it CartItemDTO
		if err := rows.Scan(&it.ID, &it.MenuItemID, &it.Name, &it.ImageURL, &it.UnitBasePriceMinor, &it.Quantity); err != nil {
			return nil, err
		}
		it.Customizations = []CartItemOptionDTO{}
		items = append(items, it)
		itemIDs = append(itemIDs, it.ID)
	}

	if len(items) == 0 {
		instrStr := ""
		if instructions != nil {
			instrStr = *instructions
		}
		return &CartDTO{
			RestaurantID:        restID,
			RestaurantName:      restName,
			RestaurantSlug:      restSlug,
			Currency:            "INR",
			Items:               []CartItemDTO{},
			SpecialInstructions: instrStr,
			Breakdown:           Breakdown{MinCartThresholdMinor: 29900},
		}, nil
	}

	// Batch-load all customizations for all cart items in a single round-trip.
	optsByItem := make(map[string][]CartItemOptionDTO, len(itemIDs))
	optRows, oErr := r.pool.Query(ctx, `
		SELECT cic.cart_item_id, mco.id, mcg.name, mco.name, mco.price_delta_minor
		FROM cart_item_customizations cic
		JOIN menu_customization_options mco ON mco.id = cic.option_id
		JOIN menu_customization_groups mcg ON mcg.id = mco.group_id
		WHERE cic.cart_item_id = ANY($1)
	`, itemIDs)
	if oErr != nil {
		return nil, oErr
	}
	for optRows.Next() {
		var ciID string
		var opt CartItemOptionDTO
		if sErr := optRows.Scan(&ciID, &opt.OptionID, &opt.GroupName, &opt.OptionName, &opt.PriceDeltaMinor); sErr != nil {
			optRows.Close()
			return nil, sErr
		}
		optsByItem[ciID] = append(optsByItem[ciID], opt)
	}
	optRows.Close()

	var pricingLines []PricingLineItem
	for idx := range items {
		opts := optsByItem[items[idx].ID]
		var deltaSum int64
		for _, opt := range opts {
			deltaSum += opt.PriceDeltaMinor
		}
		if opts != nil {
			items[idx].Customizations = opts
		}
		items[idx].UnitCustomizationsPriceMinor = deltaSum
		items[idx].LineTotalMinor = (items[idx].UnitBasePriceMinor + deltaSum) * int64(items[idx].Quantity)
		pricingLines = append(pricingLines, PricingLineItem{
			MenuItemID: items[idx].MenuItemID,
			LineTotal:  items[idx].LineTotalMinor,
		})
	}

	rules := r.loadPricingRules(ctx, zoneID)
	var coupon *CouponRule
	var couponCode *string
	if couponID != nil {
		var cr CouponRule
		cErr := r.pool.QueryRow(ctx, `
			SELECT id, code, discount_type, discount_value, max_discount_minor, min_order_subtotal_minor
			FROM coupons WHERE id = $1 AND is_active = TRUE
		`, *couponID).Scan(&cr.ID, &cr.Code, &cr.DiscountType, &cr.DiscountValue, &cr.MaxDiscountMinor, &cr.MinOrderSubtotalMinor)
		if cErr == nil {
			coupon = &cr
			couponCode = &cr.Code
		}
	}

	distanceMeters := 1500
	if restID != nil && savedAddrID != nil && *savedAddrID != "" {
		_ = r.pool.QueryRow(ctx, `
			SELECT ROUND(ST_Distance(r.location, ca.location))::int
			FROM restaurants r, customer_addresses ca
			WHERE r.id = $1 AND ca.id = $2
		`, *restID, *savedAddrID).Scan(&distanceMeters)
	}

	breakdown := ComputeBreakdown(pricingLines, packagingFee, distanceMeters, coupon, rules, tipMinor)

	instrStr := ""
	if instructions != nil {
		instrStr = *instructions
	}

	return &CartDTO{
		RestaurantID:        restID,
		RestaurantName:      restName,
		RestaurantSlug:      restSlug,
		Currency:            "INR",
		Items:               items,
		AppliedCouponCode:   couponCode,
		SpecialInstructions: instrStr,
		Breakdown:           breakdown,
	}, nil
}

// AddItem inserts/merges a dish into the customer's cart enforcing FR-026 single-restaurant cart guard.
func (r *Repository) AddItem(ctx context.Context, customerID, restaurantID, menuItemID string, quantity int, optionIDs []string, replaceCart bool) (*CartDTO, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var isAccepting bool
		if err := tx.QueryRow(ctx, `SELECT is_accepting_orders FROM restaurants WHERE id = $1`, restaurantID).Scan(&isAccepting); err != nil {
			return ErrRestaurantClosed
		}
		if !isAccepting {
			return ErrRestaurantClosed
		}

		// Verify availability & inventory
		var itemAvail, trackInv bool
		var availQty int
		if err := tx.QueryRow(ctx, `
			SELECT mi.is_available AND mi.is_active, COALESCE(inv.track_inventory, FALSE), COALESCE(inv.available_quantity, 0)
			FROM menu_items mi
			LEFT JOIN menu_item_inventory inv ON inv.menu_item_id = mi.id
			WHERE mi.id = $1 AND mi.restaurant_id = $2
		`, menuItemID, restaurantID).Scan(&itemAvail, &trackInv, &availQty); err != nil {
			return ErrItemOutOfStock
		}
		if !itemAvail || (trackInv && availQty < quantity) {
			return ErrItemOutOfStock
		}

		// Ensure cart exists
		var cartID string
		var existingRestID *string
		err := tx.QueryRow(ctx, `SELECT id, restaurant_id FROM carts WHERE customer_id = $1 FOR UPDATE`, customerID).Scan(&cartID, &existingRestID)
		if errors.Is(err, pgx.ErrNoRows) {
			cartID = uuid.NewString()
			if _, iErr := tx.Exec(ctx, `INSERT INTO carts (id, customer_id, restaurant_id) VALUES ($1, $2, $3)`, cartID, customerID, restaurantID); iErr != nil {
				return iErr
			}
			existingRestID = &restaurantID
		} else if err != nil {
			return err
		}

		// Enforce single-restaurant guard (FR-026)
		if existingRestID != nil && *existingRestID != "" && *existingRestID != restaurantID {
			var count int
			_ = tx.QueryRow(ctx, `SELECT COUNT(*) FROM cart_items WHERE cart_id = $1`, cartID).Scan(&count)
			if count > 0 {
				if !replaceCart {
					return ErrMultiRestaurantConflict
				}
				if _, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE cart_id = $1`, cartID); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE carts SET restaurant_id = $2, applied_coupon_id = NULL WHERE id = $1`, cartID, restaurantID); err != nil {
					return err
				}
			}
		} else if existingRestID == nil || *existingRestID == "" {
			if _, err := tx.Exec(ctx, `UPDATE carts SET restaurant_id = $2 WHERE id = $1`, cartID, restaurantID); err != nil {
				return err
			}
		}

		sortedOpts := append([]string(nil), optionIDs...)
		sort.Strings(sortedOpts)
		fpSum := sha256.Sum256([]byte(strings.Join(sortedOpts, ",")))
		fingerprint := hex.EncodeToString(fpSum[:])

		var existingCartItemID string
		err = tx.QueryRow(ctx, `
			SELECT id FROM cart_items WHERE cart_id = $1 AND menu_item_id = $2 AND options_fingerprint = $3
		`, cartID, menuItemID, fingerprint).Scan(&existingCartItemID)
		if errors.Is(err, pgx.ErrNoRows) {
			ciID := uuid.NewString()
			if _, err := tx.Exec(ctx, `
				INSERT INTO cart_items (id, cart_id, menu_item_id, quantity, options_fingerprint)
				VALUES ($1, $2, $3, $4, $5)
			`, ciID, cartID, menuItemID, quantity, fingerprint); err != nil {
				return err
			}
			for _, oid := range sortedOpts {
				if _, err := tx.Exec(ctx, `INSERT INTO cart_item_customizations (cart_item_id, option_id) VALUES ($1, $2)`, ciID, oid); err != nil {
					return ErrInvalidCustomization
				}
			}
		} else if err == nil {
			if _, err := tx.Exec(ctx, `UPDATE cart_items SET quantity = quantity + $2 WHERE id = $1`, existingCartItemID, quantity); err != nil {
				return err
			}
		} else {
			return err
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetCart(ctx, customerID, nil, 0)
}

// UpdateItemQuantity sets item quantity or removes it if quantity <= 0.
func (r *Repository) UpdateItemQuantity(ctx context.Context, customerID, cartItemID string, quantity int) (*CartDTO, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var cartID string
		if err := tx.QueryRow(ctx, `SELECT id FROM carts WHERE customer_id = $1`, customerID).Scan(&cartID); err != nil {
			return err
		}
		if quantity <= 0 {
			_, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`, cartItemID, cartID)
			if err != nil {
				return err
			}
		} else {
			_, err := tx.Exec(ctx, `UPDATE cart_items SET quantity = $3 WHERE id = $1 AND cart_id = $2`, cartItemID, cartID, quantity)
			if err != nil {
				return err
			}
		}
		var remaining int
		_ = tx.QueryRow(ctx, `SELECT COUNT(*) FROM cart_items WHERE cart_id = $1`, cartID).Scan(&remaining)
		if remaining == 0 {
			_, _ = tx.Exec(ctx, `UPDATE carts SET restaurant_id = NULL, applied_coupon_id = NULL WHERE id = $1`, cartID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetCart(ctx, customerID, nil, 0)
}

// ClearCart empties all items and resets restaurant_id on customer's cart.
func (r *Repository) ClearCart(ctx context.Context, customerID string) (*CartDTO, error) {
	_, _ = r.pool.Exec(ctx, `
		DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE customer_id = $1);
	`, customerID)
	_, _ = r.pool.Exec(ctx, `
		UPDATE carts SET restaurant_id = NULL, applied_coupon_id = NULL, special_instructions = NULL WHERE customer_id = $1;
	`, customerID)
	return r.GetCart(ctx, customerID, nil, 0)
}

// ApplyCoupon validates and attaches a coupon code to the cart.
func (r *Repository) ApplyCoupon(ctx context.Context, customerID, code string) (*CartDTO, error) {
	cartDTO, err := r.GetCart(ctx, customerID, nil, 0)
	if err != nil {
		return nil, err
	}
	var couponID string
	var minSub int64
	err = r.pool.QueryRow(ctx, `
		SELECT id, min_order_subtotal_minor FROM coupons
		WHERE UPPER(code) = UPPER($1) AND is_active = TRUE AND starts_at <= NOW() AND ends_at >= NOW()
	`, strings.TrimSpace(code)).Scan(&couponID, &minSub)
	if err != nil || cartDTO.Breakdown.ItemSubtotalMinor < minSub {
		return nil, ErrInvalidCoupon
	}
	if _, err := r.pool.Exec(ctx, `UPDATE carts SET applied_coupon_id = $2 WHERE customer_id = $1`, customerID, couponID); err != nil {
		return nil, err
	}
	return r.GetCart(ctx, customerID, nil, 0)
}

// RemoveCoupon clears applied_coupon_id.
func (r *Repository) RemoveCoupon(ctx context.Context, customerID string) (*CartDTO, error) {
	_, _ = r.pool.Exec(ctx, `UPDATE carts SET applied_coupon_id = NULL WHERE customer_id = $1`, customerID)
	return r.GetCart(ctx, customerID, nil, 0)
}

// ValidateCheckout authoritatively validates zone coverage, outlet open status, and live item stock.
func (r *Repository) ValidateCheckout(ctx context.Context, customerID, addressID string, tipMinor int64) (*CheckoutValidationDTO, error) {
	var isServiceable bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM service_zones sz, customer_addresses ca
			WHERE ca.id = $1 AND ca.user_id = $2 AND ca.is_archived = FALSE
			  AND sz.is_active = TRUE AND ST_Covers(sz.boundary, ca.location)
		)
	`, addressID, customerID).Scan(&isServiceable)
	if err != nil || !isServiceable {
		return nil, ErrOutOfServiceArea
	}

	cartDTO, err := r.GetCart(ctx, customerID, &addressID, tipMinor)
	if err != nil {
		return nil, err
	}
	if cartDTO.RestaurantID == nil || len(cartDTO.Items) == 0 {
		return nil, ErrEmptyCart
	}

	var isAccepting bool
	if err := r.pool.QueryRow(ctx, `SELECT is_accepting_orders FROM restaurants WHERE id = $1`, *cartDTO.RestaurantID).Scan(&isAccepting); err != nil || !isAccepting {
		return nil, ErrRestaurantClosed
	}

	for _, it := range cartDTO.Items {
		var ok, track bool
		var avail int
		_ = r.pool.QueryRow(ctx, `
			SELECT mi.is_available AND mi.is_active, COALESCE(inv.track_inventory, FALSE), COALESCE(inv.available_quantity, 0)
			FROM menu_items mi LEFT JOIN menu_item_inventory inv ON inv.menu_item_id = mi.id
			WHERE mi.id = $1
		`, it.MenuItemID).Scan(&ok, &track, &avail)
		if !ok || (track && avail < it.Quantity) {
			return nil, fmt.Errorf("%w: %s", ErrItemOutOfStock, it.Name)
		}
	}

	hash := SignPricingQuote(r.quoteSecret, customerID, *cartDTO.RestaurantID, cartDTO.Breakdown)
	return &CheckoutValidationDTO{
		IsValid:          true,
		PricingQuoteHash: hash,
		Cart:             cartDTO,
	}, nil
}

func (r *Repository) loadPricingRules(ctx context.Context, zoneID *string) PricingRules {
	rules := PricingRules{
		MinCartThresholdMinor:      29900,
		SmallCartFeeMinor:          2900,
		BaseDeliveryFeeMinor:       2900,
		BaseDistanceMeters:         2000,
		PerKmDeliveryFeeMinor:      800,
		FreeDeliveryThresholdMinor: 59900,
		PlatformFeeMinor:           900,
		TaxRateBps:                 500,
	}
	_ = r.pool.QueryRow(ctx, `
		SELECT min_cart_threshold_minor, small_cart_fee_minor, base_fee_minor,
		       base_distance_meters, per_km_fee_minor, COALESCE(free_delivery_threshold_minor, 0)
		FROM delivery_charge_rules
		WHERE is_active = TRUE AND (service_zone_id = $1::uuid OR service_zone_id IS NULL)
		ORDER BY service_zone_id NULLS LAST
		LIMIT 1
	`, zoneID).Scan(&rules.MinCartThresholdMinor, &rules.SmallCartFeeMinor, &rules.BaseDeliveryFeeMinor, &rules.BaseDistanceMeters, &rules.PerKmDeliveryFeeMinor, &rules.FreeDeliveryThresholdMinor)

	_ = r.pool.QueryRow(ctx, `
		SELECT tax_rate_bps, platform_fee_minor FROM commission_configs
		WHERE service_zone_id = $1::uuid OR service_zone_id IS NULL
		ORDER BY service_zone_id NULLS LAST, effective_from DESC
		LIMIT 1
	`, zoneID).Scan(&rules.TaxRateBps, &rules.PlatformFeeMinor)

	return rules
}
