package delivery

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/payments"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/outbox"
)

type deliveryOfferDTO struct {
	AssignmentID          string    `json:"assignment_id"`
	DeliveryID            string    `json:"delivery_id"`
	OrderID               string    `json:"order_id"`
	OrderNumber           string    `json:"order_number"`
	RestaurantName        string    `json:"restaurant_name"`
	RestaurantAddress     string    `json:"restaurant_address"`
	DropoffAddress        string    `json:"dropoff_address"`
	DistanceMeters        int       `json:"distance_meters"`
	EstimatedEarningMinor int64     `json:"estimated_earning_minor"`
	ExpiresAt             time.Time `json:"expires_at"`
}

type deliveryOrderDTO struct {
	ID                    string             `json:"id"`
	OrderNumber           string             `json:"order_number"`
	CustomerID            string             `json:"customer_id"`
	CustomerName          string             `json:"customer_name"`
	CustomerPhone         string             `json:"customer_phone"`
	RestaurantID          string             `json:"restaurant_id"`
	RestaurantName        string             `json:"restaurant_name"`
	RestaurantAddress     string             `json:"restaurant_address"`
	DeliveryAddressLine1  string             `json:"delivery_address_line1"`
	PickupLat             float64            `json:"pickup_lat"`
	PickupLng             float64            `json:"pickup_lng"`
	DropoffLat            float64            `json:"dropoff_lat"`
	DropoffLng            float64            `json:"dropoff_lng"`
	OrderStatus           string             `json:"order_status"`
	PaymentStatus         string             `json:"payment_status"`
	DeliveryStatus        string             `json:"delivery_status"`
	PaymentMethod         string             `json:"payment_method"`
	Currency              string             `json:"currency"`
	PartnerID             *string            `json:"partner_id,omitempty"`
	PartnerName           *string            `json:"partner_name,omitempty"`
	DeliveryOTPHint       string             `json:"delivery_otp_hint,omitempty"`
	OTPVerifiedAt         *time.Time         `json:"otp_verified_at,omitempty"`
	TotalPayableMinor     int64              `json:"total_payable_minor"`
	TipAmountMinor        int64              `json:"tip_amount_minor"`
	EstimatedPrepMinutes  int                `json:"estimated_prep_minutes"`
	Items                 []deliveryItemDTO  `json:"items"`
	CreatedAt             time.Time          `json:"created_at"`
	UpdatedAt             time.Time          `json:"updated_at"`
}

type deliveryItemDTO struct {
	ID                         string `json:"id"`
	MenuItemID                 string `json:"menu_item_id"`
	Name                       string `json:"name"`
	Quantity                   int    `json:"quantity"`
	UnitBasePriceMinor         int64  `json:"unit_base_price_minor"`
	UnitCustomizationsPriceMin int64  `json:"unit_customizations_price_minor"`
	LineTotalMinor             int64  `json:"line_total_minor"`
}

func (h *Handler) getApprovedPartner(ctx context.Context, userID string) (partnerID string, availStatus string, err error) {
	var verif string
	err = h.pool.QueryRow(ctx, `
		SELECT id, verification_status, availability_status
		FROM delivery_partners
		WHERE user_id = $1
	`, userID).Scan(&partnerID, &verif, &availStatus)
	if err != nil {
		return "", "", err
	}
	if verif != "APPROVED" {
		return partnerID, availStatus, errors.New("partner not approved")
	}
	return partnerID, availStatus, nil
}

func (h *Handler) loadDeliveryOrder(ctx context.Context, orderID, partnerID string) (*deliveryOrderDTO, error) {
	var o deliveryOrderDTO
	err := h.pool.QueryRow(ctx, `
		SELECT o.id, o.order_number, o.customer_id, cu.full_name, cu.phone,
		       o.restaurant_id, rest.name, CONCAT(rest.address_line1, ', ', rest.city),
		       COALESCE(o.delivery_address_snapshot->>'address_line1', 'Indiranagar, Bengaluru'),
		       ST_Y(o.pickup_location::geometry), ST_X(o.pickup_location::geometry),
		       ST_Y(o.delivery_location::geometry), ST_X(o.delivery_location::geometry),
		       o.order_status, o.payment_status, o.delivery_status, o.payment_method, o.currency,
		       d.partner_id, pu.full_name,
		       CASE WHEN o.payment_method = 'ONLINE' AND o.payment_status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') THEN COALESCE(o.delivery_otp_hint, '') ELSE '' END,
		       dotp.verified_at,
		       o.total_payable_minor, o.tip_amount_minor, o.estimated_prep_minutes,
		       o.created_at, o.updated_at
		FROM orders o
		JOIN deliveries d ON d.order_id = o.id
		JOIN restaurants rest ON rest.id = o.restaurant_id
		JOIN users cu ON cu.id = o.customer_id
		LEFT JOIN delivery_partners dp ON dp.id = d.partner_id
		LEFT JOIN users pu ON pu.id = dp.user_id
		LEFT JOIN delivery_otps dotp ON dotp.order_id = o.id
		WHERE o.id = $1 AND d.partner_id = $2
	`, orderID, partnerID).Scan(
		&o.ID, &o.OrderNumber, &o.CustomerID, &o.CustomerName, &o.CustomerPhone,
		&o.RestaurantID, &o.RestaurantName, &o.RestaurantAddress,
		&o.DeliveryAddressLine1,
		&o.PickupLat, &o.PickupLng, &o.DropoffLat, &o.DropoffLng,
		&o.OrderStatus, &o.PaymentStatus, &o.DeliveryStatus, &o.PaymentMethod, &o.Currency,
		&o.PartnerID, &o.PartnerName, &o.DeliveryOTPHint, &o.OTPVerifiedAt,
		&o.TotalPayableMinor, &o.TipAmountMinor, &o.EstimatedPrepMinutes,
		&o.CreatedAt, &o.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	iRows, err := h.pool.Query(ctx, `
		SELECT id, menu_item_id, item_name_snapshot, quantity, unit_base_price_minor, unit_customizations_price_minor, line_total_minor
		FROM order_items WHERE order_id = $1
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer iRows.Close()
	for iRows.Next() {
		var it deliveryItemDTO
		if scanErr := iRows.Scan(&it.ID, &it.MenuItemID, &it.Name, &it.Quantity, &it.UnitBasePriceMinor, &it.UnitCustomizationsPriceMin, &it.LineTotalMinor); scanErr == nil {
			o.Items = append(o.Items, it)
		}
	}
	if o.Items == nil {
		o.Items = []deliveryItemDTO{}
	}
	return &o, nil
}

func (h *Handler) listOffers(c *gin.Context) {
	partnerID, avail, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil || avail != "ONLINE_AVAILABLE" {
		httputil.OK(c, []deliveryOfferDTO{})
		return
	}

	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT d.id, d.order_id, o.order_number, rest.name,
		       CONCAT(rest.address_line1, ', ', rest.city),
		       COALESCE(o.delivery_address_snapshot->>'address_line1', 'Bengaluru'),
		       GREATEST(800, ROUND(ST_Distance(d.pickup_location, d.dropoff_location))::int),
		       (3500 + GREATEST(1, ROUND(ST_Distance(d.pickup_location, d.dropoff_location) / 1000.0))::bigint * 1000 + o.tip_amount_minor),
		       d.created_at + INTERVAL '5 minutes'
		FROM deliveries d
		JOIN orders o ON o.id = d.order_id
		JOIN restaurants rest ON rest.id = o.restaurant_id
		WHERE d.status = 'PARTNER_OFFERED'
		  AND d.partner_id IS NULL
		  AND o.order_status IN ('RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP')
		  AND NOT EXISTS (
		    SELECT 1 FROM delivery_assignments da
		    WHERE da.delivery_id = d.id AND da.partner_id = $1 AND da.status = 'REJECTED'
		  )
		ORDER BY d.created_at DESC
		LIMIT 20
	`, partnerID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch offers.", nil)
		return
	}
	defer rows.Close()

	var list []deliveryOfferDTO
	for rows.Next() {
		var off deliveryOfferDTO
		if scanErr := rows.Scan(
			&off.DeliveryID, &off.OrderID, &off.OrderNumber, &off.RestaurantName,
			&off.RestaurantAddress, &off.DropoffAddress, &off.DistanceMeters,
			&off.EstimatedEarningMinor, &off.ExpiresAt,
		); scanErr == nil {
			off.AssignmentID = off.DeliveryID
			list = append(list, off)
		}
	}
	if list == nil {
		list = []deliveryOfferDTO{}
	}
	httputil.OK(c, list)
}

func (h *Handler) acceptOffer(c *gin.Context) {
	partnerID, avail, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "PARTNER_NOT_VERIFIED", PendingOnboardingWarning, nil)
		return
	}
	if avail == "OFFLINE" {
		httputil.Fail(c, http.StatusConflict, "PARTNER_OFFLINE", "Go online before accepting delivery offers.", nil)
		return
	}

	offerID := c.Param("id")
	var acceptedOrderID string
	txErr := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		var delivID, orderID string
		err := tx.QueryRow(ctxWithTimeout(c), `
			SELECT d.id, d.order_id
			FROM deliveries d
			WHERE (d.id::text = $1 OR d.order_id::text = $1)
			  AND d.status = 'PARTNER_OFFERED'
			  AND d.partner_id IS NULL
			FOR UPDATE SKIP LOCKED
		`, offerID).Scan(&delivID, &orderID)
		if errors.Is(err, pgx.ErrNoRows) {
			return pgx.ErrNoRows
		}
		if err != nil {
			return err
		}

		if _, err := tx.Exec(c.Request.Context(), `
			UPDATE deliveries
			SET partner_id = $2, status = 'PARTNER_ASSIGNED', assigned_at = NOW(), version = version + 1
			WHERE id = $1
		`, delivID, partnerID); err != nil {
			return err
		}
		if _, err := tx.Exec(c.Request.Context(), `
			INSERT INTO delivery_assignments (id, delivery_id, order_id, partner_id, status, expires_at, responded_at)
			VALUES ($1, $2, $3, $4, 'ACCEPTED', NOW() + INTERVAL '5 minutes', NOW())
			ON CONFLICT DO NOTHING
		`, uuid.NewString(), delivID, orderID, partnerID); err != nil {
			return err
		}
		if _, err := tx.Exec(c.Request.Context(), `
			UPDATE orders SET delivery_status = 'PARTNER_ASSIGNED', version = version + 1 WHERE id = $1
		`, orderID); err != nil {
			return err
		}
		if _, err := tx.Exec(c.Request.Context(), `
			UPDATE delivery_partners
			SET availability_status = 'ON_DELIVERY', is_busy = TRUE, active_deliveries_count = active_deliveries_count + 1
			WHERE id = $1
		`, partnerID); err != nil {
			return err
		}
		acceptedOrderID = orderID
		return outbox.WriteEvent(c.Request.Context(), tx, "DELIVERY", delivID, "delivery.assigned", map[string]any{
			"order_id":    orderID,
			"delivery_id": delivID,
			"partner_id":  partnerID,
		})
	})
	if errors.Is(txErr, pgx.ErrNoRows) {
		httputil.Fail(c, http.StatusConflict, "OFFER_ALREADY_CLAIMED", "Offer has already been claimed or expired.", nil)
		return
	}
	if txErr != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", txErr.Error(), nil)
		return
	}
	ov, err := h.loadDeliveryOrder(c.Request.Context(), acceptedOrderID, partnerID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Assigned but could not load order.", nil)
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) rejectOffer(c *gin.Context) {
	partnerID, _, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.OK(c, gin.H{"rejected": true})
		return
	}
	offerID := c.Param("id")
	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	if req.Reason == "" {
		req.Reason = "PARTNER_BUSY"
	}
	_, _ = h.pool.Exec(c.Request.Context(), `
		INSERT INTO delivery_assignments (id, delivery_id, order_id, partner_id, status, expires_at, responded_at, rejection_reason)
		SELECT $1, d.id, d.order_id, $2, 'REJECTED', NOW() + INTERVAL '5 minutes', NOW(), $3
		FROM deliveries d WHERE d.id::text = $4 OR d.order_id::text = $4
	`, uuid.NewString(), partnerID, req.Reason, offerID)
	httputil.OK(c, gin.H{"rejected": true})
}

func (h *Handler) getActiveDelivery(c *gin.Context) {
	partnerID, _, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.OK(c, nil)
		return
	}
	var orderID string
	err = h.pool.QueryRow(c.Request.Context(), `
		SELECT d.order_id
		FROM deliveries d
		JOIN orders o ON o.id = d.order_id
		WHERE d.partner_id = $1 AND o.order_status NOT IN ('DELIVERED', 'CANCELLED')
		ORDER BY d.assigned_at DESC NULLS LAST, d.created_at DESC
		LIMIT 1
	`, partnerID).Scan(&orderID)
	if errors.Is(err, pgx.ErrNoRows) {
		httputil.OK(c, nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch active delivery.", nil)
		return
	}
	ov, err := h.loadDeliveryOrder(c.Request.Context(), orderID, partnerID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load active delivery.", nil)
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) getDeliveryOrder(c *gin.Context) {
	partnerID, _, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Partner verification required.", nil)
		return
	}
	ov, err := h.loadDeliveryOrder(c.Request.Context(), c.Param("orderId"), partnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Delivery order not found for partner.", nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) updateDeliveryStage(c *gin.Context) {
	partnerID, _, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "PARTNER_NOT_VERIFIED", PendingOnboardingWarning, nil)
		return
	}
	var req struct {
		Stage string `json:"stage" binding:"required"`
		OTP   string `json:"otp"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	orderID := c.Param("orderId")
	var httpErrStatus int
	var httpErrCode, httpErrMsg string

	txErr := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		var delivID, delivStatus, payMethod, payStatus, restID string
		var existingOTP *string
		err := tx.QueryRow(c.Request.Context(), `
			SELECT d.id, d.status, o.payment_method, o.payment_status, o.restaurant_id, o.delivery_otp_hint
			FROM deliveries d
			JOIN orders o ON o.id = d.order_id
			WHERE d.order_id = $1 AND d.partner_id = $2
			FOR UPDATE
		`, orderID, partnerID).Scan(&delivID, &delivStatus, &payMethod, &payStatus, &restID, &existingOTP)
		if errors.Is(err, pgx.ErrNoRows) {
			httpErrStatus, httpErrCode, httpErrMsg = http.StatusNotFound, "NOT_FOUND", "Delivery assignment not found."
			return errors.New("not found")
		}
		if err != nil {
			return err
		}

		switch req.Stage {
		case "ARRIVED_AT_RESTAURANT":
			_, _ = tx.Exec(c.Request.Context(), `UPDATE deliveries SET status = 'ARRIVED_AT_RESTAURANT', arrived_restaurant_at = COALESCE(arrived_restaurant_at, NOW()), version = version + 1 WHERE id = $1`, delivID)
			_, _ = tx.Exec(c.Request.Context(), `UPDATE orders SET delivery_status = 'ARRIVED_AT_RESTAURANT', version = version + 1 WHERE id = $1`, orderID)
		case "PICKED_UP":
			_, _ = tx.Exec(c.Request.Context(), `UPDATE deliveries SET status = 'PICKED_UP', picked_up_at = COALESCE(picked_up_at, NOW()), version = version + 1 WHERE id = $1`, delivID)
			_, _ = tx.Exec(c.Request.Context(), `UPDATE orders SET delivery_status = 'PICKED_UP', order_status = 'OUT_FOR_DELIVERY', version = version + 1 WHERE id = $1`, orderID)
		case "OUT_FOR_DELIVERY":
			_, _ = tx.Exec(c.Request.Context(), `UPDATE deliveries SET status = 'OUT_FOR_DELIVERY', version = version + 1 WHERE id = $1`, delivID)
			_, _ = tx.Exec(c.Request.Context(), `UPDATE orders SET delivery_status = 'OUT_FOR_DELIVERY', order_status = 'OUT_FOR_DELIVERY', version = version + 1 WHERE id = $1`, orderID)
		case "ARRIVED_AT_CUSTOMER":
			_, _ = tx.Exec(c.Request.Context(), `UPDATE deliveries SET status = 'ARRIVED_AT_CUSTOMER', arrived_customer_at = COALESCE(arrived_customer_at, NOW()), version = version + 1 WHERE id = $1`, delivID)
			isOnlinePaid := payMethod == "ONLINE" && (payStatus == "CAPTURED" || payStatus == "PARTIALLY_REFUNDED" || payStatus == "REFUNDED")
			if isOnlinePaid {
				otpPlain := ""
				if existingOTP != nil && *existingOTP != "" {
					otpPlain = *existingOTP
				} else {
					otpPlain = random4DigitOTP()
				}
				otpHash := hmacOTP(h.otpSecret, orderID+":"+otpPlain)
				if _, err := tx.Exec(c.Request.Context(), `
					UPDATE orders
					SET delivery_status = 'ARRIVED_AT_CUSTOMER', delivery_otp_hint = $2, version = version + 1
					WHERE id = $1
				`, orderID, otpPlain); err != nil {
					return err
				}
				if _, err := tx.Exec(c.Request.Context(), `
					INSERT INTO delivery_otps (order_id, delivery_id, otp_hash, expires_at)
					VALUES ($1, $2, $3, NOW() + INTERVAL '4 hours')
					ON CONFLICT (order_id) DO NOTHING
				`, orderID, delivID, otpHash); err != nil {
					return err
				}
			} else {
				_, _ = tx.Exec(c.Request.Context(), `
					UPDATE orders SET delivery_status = 'ARRIVED_AT_CUSTOMER', delivery_otp_hint = NULL, version = version + 1 WHERE id = $1
				`, orderID)
			}
			_ = outbox.WriteEvent(c.Request.Context(), tx, "DELIVERY", delivID, "delivery.arrived_at_customer", map[string]any{"order_id": orderID})
		case "DELIVERED":
			isOnlinePaid := payMethod == "ONLINE" && (payStatus == "CAPTURED" || payStatus == "PARTIALLY_REFUNDED" || payStatus == "REFUNDED")
			if isOnlinePaid {
				var otpHash string
				var failedAttempts int
				var rateLimitedUntil, verifiedAt *time.Time
				otpErr := tx.QueryRow(c.Request.Context(), `
					SELECT otp_hash, failed_attempts, rate_limited_until, verified_at
					FROM delivery_otps WHERE order_id = $1 FOR UPDATE
				`, orderID).Scan(&otpHash, &failedAttempts, &rateLimitedUntil, &verifiedAt)
				if errors.Is(otpErr, pgx.ErrNoRows) {
					httpErrStatus, httpErrCode, httpErrMsg = http.StatusConflict, "ORDER_STATE_CONFLICT", "Mark arrived at customer location first to generate delivery OTP."
					return errors.New("missing otp")
				}
				if otpErr != nil {
					return otpErr
				}
				if verifiedAt != nil {
					httpErrStatus, httpErrCode, httpErrMsg = http.StatusConflict, "ORDER_STATE_CONFLICT", "Delivery OTP has already been verified and consumed."
					return errors.New("otp consumed")
				}
				if rateLimitedUntil != nil && rateLimitedUntil.After(time.Now().UTC()) {
					httpErrStatus, httpErrCode, httpErrMsg = http.StatusTooManyRequests, "INVALID_DELIVERY_PIN", "Too many incorrect OTP attempts. Try again later or request override."
					return errors.New("rate limited")
				}
				if hmacOTP(h.otpSecret, orderID+":"+req.OTP) != otpHash {
					attempts := failedAttempts + 1
					if attempts >= 3 {
						_, _ = tx.Exec(c.Request.Context(), `
							UPDATE delivery_otps SET failed_attempts = $2, rate_limited_until = NOW() + INTERVAL '5 minutes' WHERE order_id = $1
						`, orderID, attempts)
						httpErrStatus, httpErrCode, httpErrMsg = http.StatusTooManyRequests, "INVALID_DELIVERY_PIN", "3 incorrect OTP attempts. Verification locked for 5 minutes."
					} else {
						_, _ = tx.Exec(c.Request.Context(), `
							UPDATE delivery_otps SET failed_attempts = $2 WHERE order_id = $1
						`, orderID, attempts)
						httpErrStatus, httpErrCode, httpErrMsg = http.StatusBadRequest, "INVALID_DELIVERY_PIN", fmt.Sprintf("Incorrect 4-digit customer delivery OTP (%d attempt(s) remaining).", 3-attempts)
					}
					return errors.New("invalid otp")
				}
				_, _ = tx.Exec(c.Request.Context(), `
					UPDATE delivery_otps SET verified_at = NOW(), verified_by_partner_id = $2 WHERE order_id = $1
				`, orderID, partnerID)
			} else {
				// COD doorstep settlement
				_, _ = tx.Exec(c.Request.Context(), `UPDATE orders SET payment_status = 'CAPTURED' WHERE id = $1`, orderID)
			}

			_, _ = tx.Exec(c.Request.Context(), `UPDATE deliveries SET status = 'DELIVERED', delivered_at = NOW(), version = version + 1 WHERE id = $1`, delivID)
			_, _ = tx.Exec(c.Request.Context(), `
				UPDATE orders
				SET order_status = 'DELIVERED', delivery_status = 'DELIVERED', delivered_at = NOW(), rating_prompt_status = 'ELIGIBLE_ON_APP_OPEN', version = version + 1
				WHERE id = $1
			`, orderID)
			_, _ = tx.Exec(c.Request.Context(), `
				UPDATE delivery_partners
				SET availability_status = 'ONLINE_AVAILABLE', is_busy = FALSE,
				    active_deliveries_count = GREATEST(0, active_deliveries_count - 1),
				    total_deliveries_count = total_deliveries_count + 1
				WHERE id = $1
			`, partnerID)
			_, _ = tx.Exec(c.Request.Context(), `
				UPDATE restaurants SET active_orders_count = GREATEST(0, active_orders_count - 1) WHERE id = $1
			`, restID)
			if err := payments.AccrueDeliveryFinancials(c.Request.Context(), tx, orderID, delivID, partnerID); err != nil {
				return err
			}
			_ = outbox.WriteEvent(c.Request.Context(), tx, "ORDER", orderID, "order.delivered", map[string]any{"order_id": orderID})
		default:
			httpErrStatus, httpErrCode, httpErrMsg = http.StatusBadRequest, "VALIDATION_ERROR", "Unsupported delivery stage: "+req.Stage
			return errors.New("bad stage")
		}
		return nil
	})
	if txErr != nil {
		if httpErrStatus != 0 {
			httputil.Fail(c, httpErrStatus, httpErrCode, httpErrMsg, nil)
		} else {
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", txErr.Error(), nil)
		}
		return
	}
	ov, err := h.loadDeliveryOrder(c.Request.Context(), orderID, partnerID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	httputil.OK(c, ov)
}

func (h *Handler) pingLocation(c *gin.Context) {
	partnerID, _, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Partner profile required.", nil)
		return
	}
	var req struct {
		Lat            float64 `json:"lat"`
		Lng            float64 `json:"lng"`
		BearingDegrees float64 `json:"bearing_degrees"`
	}
	_ = c.ShouldBindJSON(&req)
	orderID := c.Param("orderId")
	_, _ = h.pool.Exec(c.Request.Context(), `
		UPDATE delivery_partners SET last_known_location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, last_location_at = NOW() WHERE id = $3
	`, req.Lat, req.Lng, partnerID)
	_, _ = h.pool.Exec(c.Request.Context(), `
		INSERT INTO delivery_tracking_history (delivery_id, order_id, partner_id, location, bearing_degrees)
		SELECT id, order_id, partner_id, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4
		FROM deliveries WHERE order_id = $1 AND partner_id = $5
	`, orderID, req.Lat, req.Lng, req.BearingDegrees, partnerID)
	httputil.OK(c, gin.H{"recorded": true})
}

func (h *Handler) listEarnings(c *gin.Context) {
	partnerID, _, err := h.getApprovedPartner(c.Request.Context(), auth.CurrentUserID(c))
	if err != nil {
		httputil.OK(c, []any{})
		return
	}
	rows, err := h.pool.Query(c.Request.Context(), `
		SELECT dpe.id, dpe.delivery_id, dpe.order_id, o.order_number,
		       dpe.base_payout_minor, dpe.distance_payout_minor, dpe.tip_amount_minor,
		       dpe.gross_earning_minor, dpe.daily_payout_fee_minor, dpe.net_earning_minor,
		       dpe.status, dpe.created_at
		FROM delivery_partner_earnings dpe
		JOIN orders o ON o.id = dpe.order_id
		WHERE dpe.partner_id = $1
		ORDER BY dpe.created_at DESC
		LIMIT 100
	`, partnerID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not fetch earnings.", nil)
		return
	}
	defer rows.Close()

	var list []map[string]any
	for rows.Next() {
		var id, delivID, ordID, ordNum, status string
		var basePay, distPay, tip, gross, fee, net int64
		var createdAt time.Time
		if scanErr := rows.Scan(&id, &delivID, &ordID, &ordNum, &basePay, &distPay, &tip, &gross, &fee, &net, &status, &createdAt); scanErr == nil {
			list = append(list, map[string]any{
				"id":                    id,
				"delivery_id":           delivID,
				"order_id":              ordID,
				"order_number":          ordNum,
				"base_payout_minor":     basePay,
				"distance_payout_minor": distPay,
				"tip_amount_minor":      tip,
				"gross_earning_minor":   gross,
				"daily_payout_fee_minor": fee,
				"net_earning_minor":     net,
				"status":                status,
				"created_at":            createdAt,
			})
		}
	}
	if list == nil {
		list = []map[string]any{}
	}
	httputil.OK(c, list)
}

func ctxWithTimeout(c *gin.Context) context.Context {
	return c.Request.Context()
}

func random4DigitOTP() string {
	n, err := rand.Int(rand.Reader, big.NewInt(9000))
	if err != nil {
		return "4821"
	}
	return fmt.Sprintf("%04d", n.Int64()+1000)
}

func hmacOTP(secret, data string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(data))
	return hex.EncodeToString(m.Sum(nil))
}
