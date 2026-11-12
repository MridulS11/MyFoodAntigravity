package orders

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/cart"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/outbox"
)

var (
	ErrOrderNotFound          = errors.New("order not found")
	ErrOutletAtCapacity       = errors.New("outlet has reached its maximum concurrent active orders limit")
	ErrOutletNotAccepting     = errors.New("outlet is currently not accepting orders")
	ErrItemOutOfStock         = errors.New("menu item unavailable or out of stock")
	ErrCancellationNotAllowed = errors.New("self-cancellation unavailable after preparation started")
	ErrOptimisticConflict     = errors.New("order was concurrently modified by another operation")
	ErrDuplicateReview        = errors.New("review already submitted for this order")
	ErrReviewEditWindowClosed = errors.New("review edit window has expired")
)

// OrderItemView represents a persisted immutable order item snapshot.
type OrderItemView struct {
	ID                           string `json:"id"`
	MenuItemID                   string `json:"menu_item_id"`
	Name                         string `json:"name"`
	Quantity                     int    `json:"quantity"`
	UnitBasePriceMinor           int64  `json:"unit_base_price_minor"`
	UnitCustomizationsPriceMinor int64  `json:"unit_customizations_price_minor"`
	LineTotalMinor               int64  `json:"line_total_minor"`
}

// OrderView represents the complete order resource returned by REST endpoints.
type OrderView struct {
	ID                        string          `json:"id"`
	OrderNumber               string          `json:"order_number"`
	CustomerID                string          `json:"customer_id"`
	RestaurantID              string          `json:"restaurant_id"`
	RestaurantName            string          `json:"restaurant_name"`
	OrderStatus               string          `json:"order_status"`
	PaymentStatus             string          `json:"payment_status"`
	DeliveryStatus            string          `json:"delivery_status"`
	PaymentMethod             string          `json:"payment_method"`
	Currency                  string          `json:"currency"`
	Breakdown                 cart.Breakdown  `json:"breakdown"`
	SpecialInstructions       *string         `json:"special_instructions,omitempty"`
	EstimatedPrepMinutes      int             `json:"estimated_prep_minutes"`
	AcceptDeadlineAt          *time.Time      `json:"accept_deadline_at,omitempty"`
	CustomerCareAlertedAt     *time.Time      `json:"customer_care_alerted_at,omitempty"`
	GraceDeadlineAt           *time.Time      `json:"grace_deadline_at,omitempty"`
	AcceptanceEscalationState string          `json:"acceptance_escalation_state"`
	RatingPromptStatus        string          `json:"rating_prompt_status"`
	CommissionRateBpsSnapshot int             `json:"commission_rate_bps_snapshot"`
	CommissionBasisSnapshot   string          `json:"commission_basis_snapshot"`
	DeliveryOTPHint           string          `json:"delivery_otp_hint,omitempty"`
	Version                   int             `json:"version"`
	Items                     []OrderItemView `json:"items"`
	CreatedAt                 time.Time       `json:"created_at"`
	UpdatedAt                 time.Time       `json:"updated_at"`
}

// ItemRatingInput holds optional per-dish rating data submitted in 3-category review.
type ItemRatingInput struct {
	MenuItemID string  `json:"menu_item_id" binding:"required"`
	Rating     int16   `json:"rating" binding:"required,min=1,max=5"`
	Comment    *string `json:"comment"`
}

// ReviewView represents a persisted 3-category customer review.
type ReviewView struct {
	ID                    string    `json:"id"`
	OrderID               string    `json:"order_id"`
	RestaurantRating      int16     `json:"restaurant_rating"`
	DeliveryPartnerRating *int16    `json:"delivery_partner_rating,omitempty"`
	RestaurantComment     *string   `json:"restaurant_comment,omitempty"`
	DeliveryComment       *string   `json:"delivery_partner_comment,omitempty"`
	EditableUntil         time.Time `json:"editable_until"`
	CreatedAt             time.Time `json:"created_at"`
}

// Repository manages ACID transactions across orders, inventory, capacity, timeouts, and ratings.
type Repository struct {
	pool      *pgxpool.Pool
	cartRepo  *cart.Repository
	otpSecret string
}

// NewRepository constructs an orders Repository.
func NewRepository(pool *pgxpool.Pool, cartRepo *cart.Repository, otpSecret string) *Repository {
	return &Repository{pool: pool, cartRepo: cartRepo, otpSecret: otpSecret}
}

// CreateOrder atomically validates address, enforces outlet capacity, locks & decrements stock in sorted order,
// snapshots pricing & 20% commission, and records an idempotent order + outbox event.
func (r *Repository) CreateOrder(ctx context.Context, customerID, idempotencyKey, addressID, paymentMethod string, tipMinor int64, specialInstructions string) (*OrderView, bool, error) {
	reqHash := hashString(fmt.Sprintf("%s:%s:%s:%d:%s", customerID, addressID, paymentMethod, tipMinor, specialInstructions))

	var existingBody []byte
	var existingStatus int
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(response_status, 0), response_body
		FROM idempotency_records
		WHERE user_id = $1 AND idempotency_key = $2
	`, customerID, idempotencyKey).Scan(&existingStatus, &existingBody)
	if err == nil && existingStatus > 0 && len(existingBody) > 0 {
		var cached OrderView
		if uErr := json.Unmarshal(existingBody, &cached); uErr == nil {
			return &cached, true, nil
		}
	}

	validation, err := r.cartRepo.ValidateCheckout(ctx, customerID, addressID, tipMinor)
	if err != nil {
		return nil, false, err
	}
	cartDTO := validation.Cart
	restaurantID := *cartDTO.RestaurantID

	var created OrderView
	var otpPlain string

	txErr := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		// Claim idempotency lock inside tx
		tag, err := tx.Exec(ctx, `
			INSERT INTO idempotency_records (user_id, idempotency_key, request_path, request_hash, locked_until)
			VALUES ($1, $2, '/api/v1/orders', $3, NOW() + INTERVAL '5 minutes')
			ON CONFLICT (user_id, idempotency_key) DO NOTHING
		`, customerID, idempotencyKey, reqHash)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			var body []byte
			_ = tx.QueryRow(ctx, `
				SELECT response_body FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2
			`, customerID, idempotencyKey).Scan(&body)
			if len(body) > 0 && json.Unmarshal(body, &created) == nil {
				return nil
			}
		}

		// Lock target outlet row and enforce optional max_concurrent_orders capacity limit
		var zoneID string
		var isAccepting bool
		var avgPrep int
		var maxConcurrent, commOverride *int
		var activeOrders int
		var commBasisOverride *string
		var pickupWKT string

		err = tx.QueryRow(ctx, `
			SELECT service_zone_id, is_accepting_orders, avg_prep_time_minutes,
			       max_concurrent_orders, active_orders_count,
			       commission_rate_bps, commission_calculation_basis,
			       ST_AsText(location)
			FROM restaurants
			WHERE id = $1
			FOR UPDATE
		`, restaurantID).Scan(
			&zoneID, &isAccepting, &avgPrep,
			&maxConcurrent, &activeOrders,
			&commOverride, &commBasisOverride, &pickupWKT,
		)
		if err != nil {
			return err
		}
		if !isAccepting {
			return ErrOutletNotAccepting
		}
		if maxConcurrent != nil && activeOrders >= *maxConcurrent {
			return ErrOutletAtCapacity
		}

		// Load immutable customer address snapshot + coordinates
		var addrJSON []byte
		var dropoffWKT string
		var distMeters int
		err = tx.QueryRow(ctx, `
			SELECT row_to_json(ca)::jsonb, ST_AsText(ca.location),
			       COALESCE(ROUND(ST_Distance(ca.location, ST_GeogFromText($3)))::int, 1500)
			FROM customer_addresses ca
			WHERE ca.id = $1 AND ca.user_id = $2 AND ca.is_archived = FALSE
		`, addressID, customerID, pickupWKT).Scan(&addrJSON, &dropoffWKT, &distMeters)
		if err != nil {
			return err
		}

		// Deterministically lock & decrement inventory sorted by menu_item_id ASC to prevent deadlocks
		sortedItems := append([]cart.CartItemDTO(nil), cartDTO.Items...)
		sort.Slice(sortedItems, func(i, j int) bool {
			return sortedItems[i].MenuItemID < sortedItems[j].MenuItemID
		})
		for _, it := range sortedItems {
			var trackInv bool
			var availQty int
			err := tx.QueryRow(ctx, `
				SELECT track_inventory, available_quantity
				FROM menu_item_inventory
				WHERE menu_item_id = $1
				FOR UPDATE
			`, it.MenuItemID).Scan(&trackInv, &availQty)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if trackInv {
				if availQty < it.Quantity {
					return ErrItemOutOfStock
				}
				tag, uErr := tx.Exec(ctx, `
					UPDATE menu_item_inventory
					SET available_quantity = available_quantity - $2
					WHERE menu_item_id = $1 AND available_quantity >= $2
				`, it.MenuItemID, it.Quantity)
				if uErr != nil {
					return uErr
				}
				if tag.RowsAffected() == 0 {
					return ErrItemOutOfStock
				}
				if availQty-it.Quantity == 0 {
					_, _ = tx.Exec(ctx, `UPDATE menu_items SET is_available = FALSE WHERE id = $1`, it.MenuItemID)
				}
			}
		}

		// Resolve 20% commission rate & configurable basis snapshot
		commBps := 2000
		commBasis := "GROSS_FOOD_SUBTOTAL"
		_ = tx.QueryRow(ctx, `
			SELECT default_commission_bps, calculation_basis
			FROM commission_configs
			WHERE service_zone_id = $1::uuid OR service_zone_id IS NULL
			ORDER BY service_zone_id NULLS LAST, effective_from DESC
			LIMIT 1
		`, zoneID).Scan(&commBps, &commBasis)
		if commOverride != nil {
			commBps = *commOverride
		}
		if commBasisOverride != nil {
			commBasis = *commBasisOverride
		}

		acceptTimeoutSec := 300
		_ = tx.QueryRow(ctx, `SELECT (value::text)::int FROM platform_configs WHERE key = 'acceptance_timeout_seconds'`).Scan(&acceptTimeoutSec)

		orderID := uuid.NewString()
		orderNum := generateOrderNumber()
		orderStatus := "PENDING_PAYMENT"
		paymentStatus := "UNPAID"
		var confirmedAt, acceptDeadline *time.Time
		now := time.Now().UTC()

		if paymentMethod == "COD" {
			orderStatus = "CONFIRMED"
			paymentStatus = "PENDING"
			confirmedAt = &now
			dl := now.Add(time.Duration(acceptTimeoutSec) * time.Second)
			acceptDeadline = &dl
			if _, err := tx.Exec(ctx, `UPDATE restaurants SET active_orders_count = active_orders_count + 1 WHERE id = $1`, restaurantID); err != nil {
				return err
			}
		}

		var instrPtr *string
		if specialInstructions != "" {
			instrPtr = &specialInstructions
		}

		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (
				id, order_number, customer_id, restaurant_id, service_zone_id, idempotency_key,
				order_status, payment_status, delivery_status, payment_method, currency,
				item_subtotal_minor, small_cart_fee_minor, min_cart_threshold_snapshot_minor,
				packaging_fee_minor, delivery_fee_minor, platform_fee_minor,
				discount_amount_minor, tax_amount_minor, tip_amount_minor, total_payable_minor,
				commission_rate_bps_snapshot, commission_basis_snapshot,
				coupon_code_snapshot, delivery_address_snapshot, delivery_location, pickup_location,
				road_distance_meters, special_instructions, estimated_prep_minutes,
				confirmed_at, accept_deadline_at
			)
			VALUES (
				$1, $2, $3, $4, $5, $6,
				$7, $8, 'ASSIGNMENT_PENDING', $9, 'INR',
				$10, $11, $12,
				$13, $14, $15,
				$16, $17, $18, $19,
				$20, $21,
				$22, $23, ST_GeogFromText($24), ST_GeogFromText($25),
				$26, $27, $28,
				$29, $30
			)
			RETURNING created_at, updated_at
		`,
			orderID, orderNum, customerID, restaurantID, zoneID, idempotencyKey,
			orderStatus, paymentStatus, paymentMethod,
			cartDTO.Breakdown.ItemSubtotalMinor, cartDTO.Breakdown.SmallCartFeeMinor, cartDTO.Breakdown.MinCartThresholdMinor,
			cartDTO.Breakdown.PackagingFeeMinor, cartDTO.Breakdown.DeliveryFeeMinor, cartDTO.Breakdown.PlatformFeeMinor,
			cartDTO.Breakdown.DiscountAmountMinor, cartDTO.Breakdown.TaxAmountMinor, cartDTO.Breakdown.TipAmountMinor, cartDTO.Breakdown.TotalPayableMinor,
			commBps, commBasis,
			cartDTO.AppliedCouponCode, addrJSON, dropoffWKT, pickupWKT,
			distMeters, instrPtr, avgPrep,
			confirmedAt, acceptDeadline,
		).Scan(&created.CreatedAt, &created.UpdatedAt); err != nil {
			return err
		}

		var itemViews []OrderItemView
		for _, ci := range cartDTO.Items {
			oiID := uuid.NewString()
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_items (id, order_id, menu_item_id, item_name_snapshot, quantity, unit_base_price_minor, unit_customizations_price_minor, line_total_minor)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			`, oiID, orderID, ci.MenuItemID, ci.Name, ci.Quantity, ci.UnitBasePriceMinor, ci.UnitCustomizationsPriceMinor, ci.LineTotalMinor); err != nil {
				return err
			}
			for _, opt := range ci.Customizations {
				if _, err := tx.Exec(ctx, `
					INSERT INTO order_item_customizations (id, order_item_id, option_id, group_name_snapshot, option_name_snapshot, price_delta_minor)
					VALUES ($1, $2, $3, $4, $5, $6)
				`, uuid.NewString(), oiID, opt.OptionID, opt.GroupName, opt.OptionName, opt.PriceDeltaMinor); err != nil {
					return err
				}
			}
			itemViews = append(itemViews, OrderItemView{
				ID:                           oiID,
				MenuItemID:                   ci.MenuItemID,
				Name:                         ci.Name,
				Quantity:                     ci.Quantity,
				UnitBasePriceMinor:           ci.UnitBasePriceMinor,
				UnitCustomizationsPriceMinor: ci.UnitCustomizationsPriceMinor,
				LineTotalMinor:               ci.LineTotalMinor,
			})
		}

		// Create payment record & status history
		payProvider := "RAZORPAY"
		if paymentMethod == "COD" {
			payProvider = "COD"
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO payments (id, order_id, customer_id, provider, amount_minor, currency, status)
			VALUES ($1, $2, $3, $4, $5, 'INR', 'INITIATED')
		`, uuid.NewString(), orderID, customerID, payProvider, cartDTO.Breakdown.TotalPayableMinor); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO order_status_history (id, order_id, to_order_status, to_payment_status, to_delivery_status, actor_user_id, actor_role)
			VALUES ($1, $2, $3, $4, 'ASSIGNMENT_PENDING', $5, 'CUSTOMER')
		`, uuid.NewString(), orderID, orderStatus, paymentStatus, customerID); err != nil {
			return err
		}

		// Delivery OTP is ONLY generated for ONLINE Paid orders upon payment capture/acceptance (never for COD).
		otpPlain = ""

		if paymentMethod == "COD" {
			_, _ = tx.Exec(ctx, `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE customer_id = $1)`, customerID)
			_, _ = tx.Exec(ctx, `UPDATE carts SET restaurant_id = NULL, applied_coupon_id = NULL WHERE customer_id = $1`, customerID)
			if err := outbox.WriteEvent(ctx, tx, "ORDER", orderID, "order.confirmed", map[string]any{
				"order_id":      orderID,
				"restaurant_id": restaurantID,
				"order_number":  orderNum,
			}); err != nil {
				return err
			}
		} else {
			if err := outbox.WriteEvent(ctx, tx, "ORDER", orderID, "order.created", map[string]any{
				"order_id":      orderID,
				"restaurant_id": restaurantID,
				"order_number":  orderNum,
			}); err != nil {
				return err
			}
		}

		restName := ""
		if cartDTO.RestaurantName != nil {
			restName = *cartDTO.RestaurantName
		}

		created = OrderView{
			ID:                        orderID,
			OrderNumber:               orderNum,
			CustomerID:                customerID,
			RestaurantID:              restaurantID,
			RestaurantName:            restName,
			OrderStatus:               orderStatus,
			PaymentStatus:             paymentStatus,
			DeliveryStatus:            "ASSIGNMENT_PENDING",
			PaymentMethod:             paymentMethod,
			Currency:                  "INR",
			Breakdown:                 cartDTO.Breakdown,
			SpecialInstructions:       instrPtr,
			EstimatedPrepMinutes:      avgPrep,
			AcceptDeadlineAt:          acceptDeadline,
			AcceptanceEscalationState: "NONE",
			RatingPromptStatus:        "PENDING_DELIVERY",
			CommissionRateBpsSnapshot: commBps,
			CommissionBasisSnapshot:   commBasis,
			DeliveryOTPHint:           otpPlain,
			Version:                   1,
			Items:                     itemViews,
			CreatedAt:                 created.CreatedAt,
			UpdatedAt:                 created.UpdatedAt,
		}

		encoded, _ := json.Marshal(created)
		_, _ = tx.Exec(ctx, `
			UPDATE idempotency_records SET response_status = 201, response_body = $3
			WHERE user_id = $1 AND idempotency_key = $2
		`, customerID, idempotencyKey, encoded)

		return nil
	})
	if txErr != nil {
		return nil, false, txErr
	}

	return &created, false, nil
}

// ListCustomerOrders returns paginated customer orders ordered newest first.
func (r *Repository) ListCustomerOrders(ctx context.Context, customerID string) ([]OrderView, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT o.id, o.order_number, o.customer_id, o.restaurant_id, rest.name,
		       o.order_status, o.payment_status, o.delivery_status, o.payment_method, o.currency,
		       o.item_subtotal_minor, o.small_cart_fee_minor, o.min_cart_threshold_snapshot_minor,
		       o.packaging_fee_minor, o.delivery_fee_minor, o.platform_fee_minor,
		       o.discount_amount_minor, o.tax_amount_minor, o.tip_amount_minor, o.total_payable_minor,
		       o.special_instructions, o.estimated_prep_minutes,
		       o.accept_deadline_at, o.customer_care_alerted_at, o.grace_deadline_at,
		       o.acceptance_escalation_state, o.rating_prompt_status,
		       o.commission_rate_bps_snapshot, o.commission_basis_snapshot,
		       CASE WHEN o.payment_method = 'ONLINE' AND o.payment_status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN COALESCE(o.delivery_otp_hint, '') ELSE '' END,
		       o.version, o.created_at, o.updated_at
		FROM orders o
		JOIN restaurants rest ON rest.id = o.restaurant_id
		WHERE o.customer_id = $1
		ORDER BY o.created_at DESC
		LIMIT 50
	`, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []OrderView
	for rows.Next() {
		ov, err := scanOrderRow(rows)
		if err != nil {
			return nil, err
		}
		ov.Items = []OrderItemView{}
		list = append(list, ov)
	}
	if list == nil {
		list = []OrderView{}
	}
	return list, nil
}

// GetOrderByID returns an order with item snapshots.
func (r *Repository) GetOrderByID(ctx context.Context, orderID string) (*OrderView, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT o.id, o.order_number, o.customer_id, o.restaurant_id, rest.name,
		       o.order_status, o.payment_status, o.delivery_status, o.payment_method, o.currency,
		       o.item_subtotal_minor, o.small_cart_fee_minor, o.min_cart_threshold_snapshot_minor,
		       o.packaging_fee_minor, o.delivery_fee_minor, o.platform_fee_minor,
		       o.discount_amount_minor, o.tax_amount_minor, o.tip_amount_minor, o.total_payable_minor,
		       o.special_instructions, o.estimated_prep_minutes,
		       o.accept_deadline_at, o.customer_care_alerted_at, o.grace_deadline_at,
		       o.acceptance_escalation_state, o.rating_prompt_status,
		       o.commission_rate_bps_snapshot, o.commission_basis_snapshot,
		       CASE WHEN o.payment_method = 'ONLINE' AND o.payment_status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN COALESCE(o.delivery_otp_hint, '') ELSE '' END,
		       o.version, o.created_at, o.updated_at
		FROM orders o
		JOIN restaurants rest ON rest.id = o.restaurant_id
		WHERE o.id = $1
	`, orderID)
	ov, err := scanOrderRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}

	iRows, err := r.pool.Query(ctx, `
		SELECT id, menu_item_id, item_name_snapshot, quantity, unit_base_price_minor, unit_customizations_price_minor, line_total_minor
		FROM order_items WHERE order_id = $1
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer iRows.Close()
	for iRows.Next() {
		var it OrderItemView
		if err := iRows.Scan(&it.ID, &it.MenuItemID, &it.Name, &it.Quantity, &it.UnitBasePriceMinor, &it.UnitCustomizationsPriceMinor, &it.LineTotalMinor); err != nil {
			return nil, err
		}
		ov.Items = append(ov.Items, it)
	}
	if ov.Items == nil {
		ov.Items = []OrderItemView{}
	}
	return &ov, nil
}

// CancelOrder allows customer cancellation prior to kitchen preparation, restoring stock & capacity atomically.
func (r *Repository) CancelOrder(ctx context.Context, customerID, orderID, reason string) (*OrderView, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var currentStatus, payStatus, restID string
		var totalMinor int64
		err := tx.QueryRow(ctx, `
			SELECT order_status, payment_status, restaurant_id, total_payable_minor
			FROM orders
			WHERE id = $1 AND customer_id = $2
			FOR UPDATE
		`, orderID, customerID).Scan(&currentStatus, &payStatus, &restID, &totalMinor)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		if err != nil {
			return err
		}
		if !CanCustomerSelfCancel(currentStatus) {
			return ErrCancellationNotAllowed
		}

		nextPayStatus := payStatus
		if payStatus == "CAPTURED" {
			nextPayStatus = "REFUND_PENDING"
		}
		if _, err := tx.Exec(ctx, `
			UPDATE orders
			SET order_status = 'CANCELLED', delivery_status = 'CANCELLED', payment_status = $2,
			    cancelled_at = NOW(), cancellation_reason = $3, cancelled_by_role = 'CUSTOMER',
			    version = version + 1
			WHERE id = $1
		`, orderID, nextPayStatus, reason); err != nil {
			return err
		}

		if currentStatus != "PENDING_PAYMENT" {
			_, _ = tx.Exec(ctx, `UPDATE restaurants SET active_orders_count = GREATEST(0, active_orders_count - 1) WHERE id = $1`, restID)
		}

		if err := restoreInventoryInTx(ctx, tx, orderID); err != nil {
			return err
		}

		if payStatus == "CAPTURED" {
			var payID string
			if err := tx.QueryRow(ctx, `SELECT id FROM payments WHERE order_id = $1 LIMIT 1`, orderID).Scan(&payID); err == nil {
				_, _ = tx.Exec(ctx, `
					INSERT INTO refunds (id, payment_id, order_id, idempotency_key, amount_minor, refund_type, reason_code, notes, status, initiated_by_user_id, initiated_by_role)
					VALUES ($1, $2, $3, $4, $5, 'FULL', 'CUSTOMER_CANCELLED', $6, 'PENDING', $7, 'CUSTOMER')
				`, uuid.NewString(), payID, orderID, "cancel:"+orderID, totalMinor, reason, customerID)
			}
		}

		_, _ = tx.Exec(ctx, `
			INSERT INTO order_status_history (id, order_id, from_order_status, to_order_status, to_payment_status, to_delivery_status, actor_user_id, actor_role, reason)
			VALUES ($1, $2, $3, 'CANCELLED', $4, 'CANCELLED', $5, 'CUSTOMER', $6)
		`, uuid.NewString(), orderID, currentStatus, nextPayStatus, customerID, reason)

		return outbox.WriteEvent(ctx, tx, "ORDER", orderID, "order.cancelled", map[string]any{
			"order_id": orderID,
			"reason":   reason,
		})
	})
	if err != nil {
		return nil, err
	}
	return r.GetOrderByID(ctx, orderID)
}

// ListOutletOrders fetches KDS active and recent orders for an outlet.
func (r *Repository) ListOutletOrders(ctx context.Context, outletID string) ([]OrderView, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT o.id, o.order_number, o.customer_id, o.restaurant_id, rest.name,
		       o.order_status, o.payment_status, o.delivery_status, o.payment_method, o.currency,
		       o.item_subtotal_minor, o.small_cart_fee_minor, o.min_cart_threshold_snapshot_minor,
		       o.packaging_fee_minor, o.delivery_fee_minor, o.platform_fee_minor,
		       o.discount_amount_minor, o.tax_amount_minor, o.tip_amount_minor, o.total_payable_minor,
		       o.special_instructions, o.estimated_prep_minutes,
		       o.accept_deadline_at, o.customer_care_alerted_at, o.grace_deadline_at,
		       o.acceptance_escalation_state, o.rating_prompt_status,
		       o.commission_rate_bps_snapshot, o.commission_basis_snapshot,
		       CASE WHEN o.payment_method = 'ONLINE' AND o.payment_status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN COALESCE(o.delivery_otp_hint, '') ELSE '' END,
		       o.version, o.created_at, o.updated_at
		FROM orders o
		JOIN restaurants rest ON rest.id = o.restaurant_id
		WHERE o.restaurant_id = $1
		ORDER BY o.created_at DESC
		LIMIT 100
	`, outletID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []OrderView
	for rows.Next() {
		ov, err := scanOrderRow(rows)
		if err != nil {
			return nil, err
		}
		ov.Items = []OrderItemView{}
		list = append(list, ov)
	}
	if list == nil {
		list = []OrderView{}
	}
	return list, nil
}

// AcceptOrder atomically transitions CONFIRMED -> RESTAURANT_ACCEPTED using row lock & optimistic version guard,
// initializes the delivery row (OTP is generated later when the partner arrives at the customer location for ONLINE paid orders),
// and emits order.restaurant_accepted for broadcast dispatch.
func (r *Repository) AcceptOrder(ctx context.Context, outletID, orderID, actorUserID string, prepMinutes int) (*OrderView, string, error) {
	if prepMinutes <= 0 {
		prepMinutes = 20
	}

	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var status, payStatus, pickupWKT, dropoffWKT string
		var version int
		err := tx.QueryRow(ctx, `
			SELECT order_status, payment_status, version, ST_AsText(pickup_location), ST_AsText(delivery_location)
			FROM orders
			WHERE id = $1 AND restaurant_id = $2
			FOR UPDATE
		`, orderID, outletID).Scan(&status, &payStatus, &version, &pickupWKT, &dropoffWKT)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		if err != nil {
			return err
		}
		if err := ValidateTransition(status, "RESTAURANT_ACCEPTED"); err != nil {
			return ErrOptimisticConflict
		}

		tag, err := tx.Exec(ctx, `
			UPDATE orders
			SET order_status = 'RESTAURANT_ACCEPTED', delivery_status = 'PARTNER_OFFERED',
			    estimated_prep_minutes = $3,
			    accepted_at = NOW(), version = version + 1
			WHERE id = $1 AND version = $2 AND order_status = 'CONFIRMED'
		`, orderID, version, prepMinutes)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrOptimisticConflict
		}

		delivID := uuid.NewString()
		if _, err := tx.Exec(ctx, `
			INSERT INTO deliveries (id, order_id, status, pickup_location, dropoff_location)
			VALUES ($1, $2, 'PARTNER_OFFERED', ST_GeogFromText($3), ST_GeogFromText($4))
			ON CONFLICT (order_id) DO NOTHING
		`, delivID, orderID, pickupWKT, dropoffWKT); err != nil {
			return err
		}

		_, _ = tx.Exec(ctx, `
			INSERT INTO order_status_history (id, order_id, from_order_status, to_order_status, to_payment_status, to_delivery_status, actor_user_id, actor_role)
			VALUES ($1, $2, 'CONFIRMED', 'RESTAURANT_ACCEPTED', $3, 'PARTNER_OFFERED', $4, 'OUTLET_OWNER')
		`, uuid.NewString(), orderID, payStatus, actorUserID)

		return outbox.WriteEvent(ctx, tx, "ORDER", orderID, "order.restaurant_accepted", map[string]any{
			"order_id":               orderID,
			"restaurant_id":          outletID,
			"estimated_prep_minutes": prepMinutes,
		})
	})
	if err != nil {
		return nil, "", err
	}
	ov, err := r.GetOrderByID(ctx, orderID)
	if err != nil {
		return nil, "", err
	}
	return ov, "", nil
}

// RejectOrder atomically rejects a CONFIRMED order with optimistic version guard, restoring stock & capacity.
func (r *Repository) RejectOrder(ctx context.Context, outletID, orderID, actorUserID, reason string) (*OrderView, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var status, payStatus string
		var version int
		var totalMinor int64
		err := tx.QueryRow(ctx, `
			SELECT order_status, payment_status, version, total_payable_minor
			FROM orders
			WHERE id = $1 AND restaurant_id = $2
			FOR UPDATE
		`, orderID, outletID).Scan(&status, &payStatus, &version, &totalMinor)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		if err != nil {
			return err
		}
		if status != "CONFIRMED" {
			return ErrOptimisticConflict
		}

		nextPay := payStatus
		if payStatus == "CAPTURED" {
			nextPay = "REFUND_PENDING"
		}
		tag, err := tx.Exec(ctx, `
			UPDATE orders
			SET order_status = 'CANCELLED', delivery_status = 'CANCELLED', payment_status = $3,
			    cancelled_at = NOW(), cancellation_reason = $4, cancelled_by_role = 'OUTLET_OWNER',
			    version = version + 1
			WHERE id = $1 AND version = $2 AND order_status = 'CONFIRMED'
		`, orderID, version, nextPay, reason)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrOptimisticConflict
		}

		_, _ = tx.Exec(ctx, `UPDATE restaurants SET active_orders_count = GREATEST(0, active_orders_count - 1) WHERE id = $1`, outletID)
		if err := restoreInventoryInTx(ctx, tx, orderID); err != nil {
			return err
		}

		if payStatus == "CAPTURED" {
			var payID string
			if err := tx.QueryRow(ctx, `SELECT id FROM payments WHERE order_id = $1 LIMIT 1`, orderID).Scan(&payID); err == nil {
				_, _ = tx.Exec(ctx, `
					INSERT INTO refunds (id, payment_id, order_id, idempotency_key, amount_minor, refund_type, reason_code, notes, status, initiated_by_user_id, initiated_by_role)
					VALUES ($1, $2, $3, $4, $5, 'FULL', 'RESTAURANT_REJECTED', $6, 'PENDING', $7, 'OUTLET_OWNER')
				`, uuid.NewString(), payID, orderID, "reject:"+orderID, totalMinor, reason, actorUserID)
			}
		}

		_, _ = tx.Exec(ctx, `
			INSERT INTO order_status_history (id, order_id, from_order_status, to_order_status, to_payment_status, to_delivery_status, actor_user_id, actor_role, reason)
			VALUES ($1, $2, 'CONFIRMED', 'CANCELLED', $3, 'CANCELLED', $4, 'OUTLET_OWNER', $5)
		`, uuid.NewString(), orderID, nextPay, actorUserID, reason)

		return outbox.WriteEvent(ctx, tx, "ORDER", orderID, "order.restaurant_rejected", map[string]any{
			"order_id": orderID,
			"reason":   reason,
		})
	})
	if err != nil {
		return nil, err
	}
	return r.GetOrderByID(ctx, orderID)
}

// AdvanceKitchenStatus transitions RESTAURANT_ACCEPTED -> PREPARING or PREPARING -> READY_FOR_PICKUP.
func (r *Repository) AdvanceKitchenStatus(ctx context.Context, outletID, orderID, actorUserID, nextStatus string) (*OrderView, error) {
	if nextStatus != "PREPARING" && nextStatus != "READY_FOR_PICKUP" {
		return nil, ErrInvalidTransition
	}
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var status, payStatus, delivStatus string
		err := tx.QueryRow(ctx, `
			SELECT order_status, payment_status, delivery_status
			FROM orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE
		`, orderID, outletID).Scan(&status, &payStatus, &delivStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		if err != nil {
			return err
		}
		if err := ValidateTransition(status, nextStatus); err != nil {
			return err
		}
		if nextStatus == "READY_FOR_PICKUP" {
			_, _ = tx.Exec(ctx, `UPDATE orders SET order_status = $2, prepared_at = NOW(), version = version + 1 WHERE id = $1`, orderID, nextStatus)
		} else {
			_, _ = tx.Exec(ctx, `UPDATE orders SET order_status = $2, version = version + 1 WHERE id = $1`, orderID, nextStatus)
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO order_status_history (id, order_id, from_order_status, to_order_status, to_payment_status, to_delivery_status, actor_user_id, actor_role)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'OUTLET_OWNER')
		`, uuid.NewString(), orderID, status, nextStatus, payStatus, delivStatus, actorUserID)

		return outbox.WriteEvent(ctx, tx, "ORDER", orderID, "order.status_updated", map[string]any{
			"order_id":     orderID,
			"order_status": nextStatus,
		})
	})
	if err != nil {
		return nil, err
	}
	return r.GetOrderByID(ctx, orderID)
}

// SubmitThreeCategoryReview persists Restaurant rating, optional Delivery Partner rating, and optional per-Item ratings.
func (r *Repository) SubmitThreeCategoryReview(ctx context.Context, customerID, orderID string, restaurantRating int16, deliveryRating *int16, restComment, delivComment *string, itemRatings []ItemRatingInput) (*ReviewView, error) {
	var rev ReviewView
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var restID, orderStatus string
		var partnerID *string
		err := tx.QueryRow(ctx, `
			SELECT o.restaurant_id, o.order_status, d.partner_id
			FROM orders o LEFT JOIN deliveries d ON d.order_id = o.id
			WHERE o.id = $1 AND o.customer_id = $2
			FOR UPDATE
		`, orderID, customerID).Scan(&restID, &orderStatus, &partnerID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		if err != nil {
			return err
		}

		var exists bool
		_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM reviews WHERE order_id = $1)`, orderID).Scan(&exists)
		if exists {
			return ErrDuplicateReview
		}

		revID := uuid.NewString()
		if err := tx.QueryRow(ctx, `
			INSERT INTO reviews (id, order_id, customer_id, restaurant_id, partner_id, restaurant_rating, delivery_partner_rating, restaurant_comment, delivery_partner_comment)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, order_id, restaurant_rating, delivery_partner_rating, restaurant_comment, delivery_partner_comment, editable_until, created_at
		`, revID, orderID, customerID, restID, partnerID, restaurantRating, deliveryRating, restComment, delivComment).Scan(
			&rev.ID, &rev.OrderID, &rev.RestaurantRating, &rev.DeliveryPartnerRating,
			&rev.RestaurantComment, &rev.DeliveryComment, &rev.EditableUntil, &rev.CreatedAt,
		); err != nil {
			return err
		}

		for _, ir := range itemRatings {
			var orderItemID string
			if err := tx.QueryRow(ctx, `
				SELECT id FROM order_items WHERE order_id = $1 AND menu_item_id = $2 LIMIT 1
			`, orderID, ir.MenuItemID).Scan(&orderItemID); err == nil {
				_, _ = tx.Exec(ctx, `
					INSERT INTO order_item_ratings (id, review_id, order_id, order_item_id, menu_item_id, customer_id, rating, comment)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
					ON CONFLICT (order_item_id) DO NOTHING
				`, uuid.NewString(), revID, orderID, orderItemID, ir.MenuItemID, customerID, ir.Rating, ir.Comment)
			}
		}

		_, _ = tx.Exec(ctx, `UPDATE orders SET rating_prompt_status = 'RATED' WHERE id = $1`, orderID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &rev, nil
}

// GetPendingRatingPrompt fetches the most recent delivered order awaiting automatic app-open rating.
func (r *Repository) GetPendingRatingPrompt(ctx context.Context, customerID string) (*OrderView, error) {
	var orderID string
	err := r.pool.QueryRow(ctx, `
		SELECT id FROM orders
		WHERE customer_id = $1 AND order_status = 'DELIVERED' AND rating_prompt_status = 'ELIGIBLE_ON_APP_OPEN'
		ORDER BY delivered_at DESC NULLS LAST, created_at DESC
		LIMIT 1
	`, customerID).Scan(&orderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r.GetOrderByID(ctx, orderID)
}

// DismissRatingPrompt updates rating_prompt_status to PROMPT_DISMISSED.
func (r *Repository) DismissRatingPrompt(ctx context.Context, customerID, orderID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE orders SET rating_prompt_status = 'PROMPT_DISMISSED'
		WHERE id = $1 AND customer_id = $2 AND rating_prompt_status = 'ELIGIBLE_ON_APP_OPEN'
	`, orderID, customerID)
	return err
}

func restoreInventoryInTx(ctx context.Context, tx pgx.Tx, orderID string) error {
	rows, err := tx.Query(ctx, `SELECT menu_item_id, quantity FROM order_items WHERE order_id = $1 ORDER BY menu_item_id ASC`, orderID)
	if err != nil {
		return err
	}
	type restoreRow struct {
		itemID string
		qty    int
	}
	var list []restoreRow
	for rows.Next() {
		var r restoreRow
		if err := rows.Scan(&r.itemID, &r.qty); err != nil {
			rows.Close()
			return err
		}
		list = append(list, r)
	}
	rows.Close()

	for _, r := range list {
		tag, err := tx.Exec(ctx, `
			UPDATE menu_item_inventory SET available_quantity = available_quantity + $2
			WHERE menu_item_id = $1 AND track_inventory = TRUE
		`, r.itemID, r.qty)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			_, _ = tx.Exec(ctx, `UPDATE menu_items SET is_available = TRUE WHERE id = $1`, r.itemID)
		}
	}
	return nil
}

type scannable interface {
	Scan(dest ...any) error
}

func scanOrderRow(row scannable) (OrderView, error) {
	var o OrderView
	err := row.Scan(
		&o.ID, &o.OrderNumber, &o.CustomerID, &o.RestaurantID, &o.RestaurantName,
		&o.OrderStatus, &o.PaymentStatus, &o.DeliveryStatus, &o.PaymentMethod, &o.Currency,
		&o.Breakdown.ItemSubtotalMinor, &o.Breakdown.SmallCartFeeMinor, &o.Breakdown.MinCartThresholdMinor,
		&o.Breakdown.PackagingFeeMinor, &o.Breakdown.DeliveryFeeMinor, &o.Breakdown.PlatformFeeMinor,
		&o.Breakdown.DiscountAmountMinor, &o.Breakdown.TaxAmountMinor, &o.Breakdown.TipAmountMinor, &o.Breakdown.TotalPayableMinor,
		&o.SpecialInstructions, &o.EstimatedPrepMinutes,
		&o.AcceptDeadlineAt, &o.CustomerCareAlertedAt, &o.GraceDeadlineAt,
		&o.AcceptanceEscalationState, &o.RatingPromptStatus,
		&o.CommissionRateBpsSnapshot, &o.CommissionBasisSnapshot, &o.DeliveryOTPHint,
		&o.Version, &o.CreatedAt, &o.UpdatedAt,
	)
	return o, err
}

func generateOrderNumber() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(9000))
	return fmt.Sprintf("GD-%s-%04d", time.Now().UTC().Format("20060102"), n.Int64()+1000)
}

func random4DigitOTP() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(9000))
	return fmt.Sprintf("%04d", n.Int64()+1000)
}

func hmacSHA256(secret, data string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(data))
	return hex.EncodeToString(m.Sum(nil))
}

func hashString(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
