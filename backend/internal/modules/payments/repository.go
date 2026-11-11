package payments

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/outbox"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/paymentgw"
)

var (
	ErrPaymentNotFound         = errors.New("payment record not found")
	ErrInvalidSignature        = errors.New("payment gateway signature verification failed")
	ErrOrderNotPayable         = errors.New("order is no longer awaiting payment")
	ErrRefundExceedsBalance    = errors.New("refund amount exceeds remaining captured payment balance")
)

// PaymentSessionDTO contains Razorpay/gateway session parameters for frontend checkout.
type PaymentSessionDTO struct {
	PaymentID       string `json:"payment_id"`
	OrderID         string `json:"order_id"`
	Provider        string `json:"provider"`
	ProviderOrderID string `json:"provider_order_id"`
	AmountMinor     int64  `json:"amount_minor"`
	Currency        string `json:"currency"`
	PublicKey       string `json:"public_key"`
}

// PaymentDTO mirrors a payment record.
type PaymentDTO struct {
	ID                string     `json:"id"`
	OrderID           string     `json:"order_id"`
	Provider          string     `json:"provider"`
	ProviderOrderID   *string    `json:"provider_order_id,omitempty"`
	ProviderPaymentID *string    `json:"provider_payment_id,omitempty"`
	AmountMinor       int64      `json:"amount_minor"`
	Currency          string     `json:"currency"`
	Status            string     `json:"status"`
	PaymentInstrument *string    `json:"payment_instrument,omitempty"`
	FailureMessage    *string    `json:"failure_message,omitempty"`
	ReconciledAt      *time.Time `json:"reconciled_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// AdminPaymentDTO includes order_number and customer_id for the admin financial console.
type AdminPaymentDTO struct {
	ID                string     `json:"id"`
	OrderID           string     `json:"order_id"`
	OrderNumber       string     `json:"order_number"`
	CustomerID        string     `json:"customer_id"`
	Provider          string     `json:"provider"`
	ProviderOrderID   *string    `json:"provider_order_id,omitempty"`
	ProviderPaymentID *string    `json:"provider_payment_id,omitempty"`
	AmountMinor       int64      `json:"amount_minor"`
	Currency          string     `json:"currency"`
	Status            string     `json:"status"`
	PaymentInstrument *string    `json:"payment_instrument,omitempty"`
	FailureMessage    *string    `json:"failure_message,omitempty"`
	ReconciledAt      *time.Time `json:"reconciled_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// AdminRefundDTO includes order_number and currency alongside refund ledger fields.
type AdminRefundDTO struct {
	ID               string     `json:"id"`
	PaymentID        string     `json:"payment_id"`
	OrderID          string     `json:"order_id"`
	OrderNumber      string     `json:"order_number"`
	ProviderRefundID *string    `json:"provider_refund_id,omitempty"`
	AmountMinor      int64      `json:"amount_minor"`
	Currency         string     `json:"currency"`
	RefundType       string     `json:"refund_type"`
	ReasonCode       string     `json:"reason_code"`
	Notes            *string    `json:"notes,omitempty"`
	Status           string     `json:"status"`
	InitiatedByRole  string     `json:"initiated_by_role"`
	ProcessedAt      *time.Time `json:"processed_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// RefundDTO mirrors a refund ledger row.
type RefundDTO struct {
	ID               string    `json:"id"`
	PaymentID        string    `json:"payment_id"`
	OrderID          string    `json:"order_id"`
	ProviderRefundID *string   `json:"provider_refund_id,omitempty"`
	AmountMinor      int64     `json:"amount_minor"`
	RefundType       string    `json:"refund_type"`
	ReasonCode       string    `json:"reason_code"`
	Notes            *string   `json:"notes,omitempty"`
	Status           string    `json:"status"`
	InitiatedByRole  string    `json:"initiated_by_role"`
	CreatedAt        time.Time `json:"created_at"`
}

// Repository manages ACID payment verification, webhook deduplication, refunds, and ledger writes.
type Repository struct {
	pool     *pgxpool.Pool
	provider paymentgw.Provider
}

// NewRepository creates a payments Repository.
func NewRepository(pool *pgxpool.Pool, provider paymentgw.Provider) *Repository {
	return &Repository{pool: pool, provider: provider}
}

// InitiatePaymentSession creates or retrieves a gateway checkout order for a PENDING_PAYMENT order.
func (r *Repository) InitiatePaymentSession(ctx context.Context, customerID, orderID string) (*PaymentSessionDTO, error) {
	var paymentID, orderNum, orderStatus, currency string
	var existingProvOrderID *string
	var amountMinor int64

	err := r.pool.QueryRow(ctx, `
		SELECT p.id, o.order_number, o.order_status, p.amount_minor, p.currency, p.provider_order_id
		FROM payments p
		JOIN orders o ON o.id = p.order_id
		WHERE p.order_id = $1 AND o.customer_id = $2
		LIMIT 1
	`, orderID, customerID).Scan(&paymentID, &orderNum, &orderStatus, &amountMinor, &currency, &existingProvOrderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPaymentNotFound
	}
	if err != nil {
		return nil, err
	}
	if orderStatus != "PENDING_PAYMENT" {
		return nil, ErrOrderNotPayable
	}

	if existingProvOrderID != nil && *existingProvOrderID != "" {
		return &PaymentSessionDTO{
			PaymentID:       paymentID,
			OrderID:         orderID,
			Provider:        r.provider.Name(),
			ProviderOrderID: *existingProvOrderID,
			AmountMinor:     amountMinor,
			Currency:        currency,
			PublicKey:       r.provider.PublicKey(),
		}, nil
	}

	gwOrder, err := r.provider.CreateOrder(ctx, orderNum, amountMinor, currency)
	if err != nil {
		return nil, err
	}

	_, err = r.pool.Exec(ctx, `
		UPDATE payments SET provider = $2, provider_order_id = $3 WHERE id = $1
	`, paymentID, gwOrder.ProviderName, gwOrder.ProviderOrderID)
	if err != nil {
		return nil, err
	}

	return &PaymentSessionDTO{
		PaymentID:       paymentID,
		OrderID:         orderID,
		Provider:        gwOrder.ProviderName,
		ProviderOrderID: gwOrder.ProviderOrderID,
		AmountMinor:     amountMinor,
		Currency:        currency,
		PublicKey:       gwOrder.PublicKey,
	}, nil
}

// VerifyClientCallback verifies HMAC client payment signature and captures the payment transactionally.
func (r *Repository) VerifyClientCallback(ctx context.Context, customerID, orderID, providerOrderID, providerPaymentID, signature string) error {
	if !r.provider.VerifyClientCallbackSignature(providerOrderID, providerPaymentID, signature) {
		return ErrInvalidSignature
	}

	var payID string
	var amount int64
	err := r.pool.QueryRow(ctx, `
		SELECT p.id, p.amount_minor
		FROM payments p
		JOIN orders o ON o.id = p.order_id
		WHERE p.order_id = $1 AND o.customer_id = $2 AND p.provider_order_id = $3
		LIMIT 1
	`, orderID, customerID, providerOrderID).Scan(&payID, &amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPaymentNotFound
	}
	if err != nil {
		return err
	}

	raw, _ := json.Marshal(map[string]any{
		"source":              "client_verify",
		"provider_order_id":   providerOrderID,
		"provider_payment_id": providerPaymentID,
	})
	_, err = r.ApplyPaymentCapture(ctx, r.provider.Name(), "cb:"+providerPaymentID, "payment.captured", providerOrderID, providerPaymentID, amount, "ONLINE", raw, true, false)
	return err
}

// ApplyPaymentCapture handles idempotent payment capture for webhooks and active reconciliation.
// Returns deduplicated = true when (provider, provider_event_id) already exists in payment_transactions.
func (r *Repository) ApplyPaymentCapture(
	ctx context.Context,
	providerName, providerEventID, eventType, providerOrderID, providerPaymentID string,
	amountMinor int64,
	instrument string,
	rawPayload []byte,
	signatureVerified bool,
	markReconciled bool,
) (bool, error) {
	deduplicated := false

	txErr := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var payID, orderID, customerID, restID, currency, payStatus string
		var payAmount int64
		err := tx.QueryRow(ctx, `
			SELECT id, order_id, customer_id, amount_minor, currency, status
			FROM payments
			WHERE provider_order_id = $1 OR provider_payment_id = $2
			FOR UPDATE
		`, providerOrderID, providerPaymentID).Scan(&payID, &orderID, &customerID, &payAmount, &currency, &payStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPaymentNotFound
		}
		if err != nil {
			return err
		}

		// Webhook Deduplication via UNIQUE (provider, provider_event_id)
		txTag, err := tx.Exec(ctx, `
			INSERT INTO payment_transactions (id, payment_id, provider, provider_event_id, event_type, amount_minor, raw_payload, signature_verified)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (provider, provider_event_id) DO NOTHING
		`, uuid.NewString(), payID, providerName, providerEventID, eventType, amountMinor, rawPayload, signatureVerified)
		if err != nil {
			return err
		}
		if txTag.RowsAffected() == 0 {
			deduplicated = true
			return nil
		}

		var orderStatus string
		if err := tx.QueryRow(ctx, `
			SELECT order_status, restaurant_id FROM orders WHERE id = $1 FOR UPDATE
		`, orderID).Scan(&orderStatus, &restID); err != nil {
			return err
		}

		// Update payment row to CAPTURED (and reconciled_at if recovered by worker)
		if _, err := tx.Exec(ctx, `
			UPDATE payments
			SET status = 'CAPTURED',
			    provider_payment_id = COALESCE(NULLIF($2, ''), provider_payment_id),
			    payment_instrument = COALESCE(NULLIF($3, ''), payment_instrument),
			    failure_message = NULL,
			    captured_at = COALESCE(captured_at, NOW()),
			    reconciled_at = CASE WHEN $4 THEN COALESCE(reconciled_at, NOW()) ELSE reconciled_at END,
			    version = version + 1
			WHERE id = $1
		`, payID, providerPaymentID, instrument, markReconciled); err != nil {
			return err
		}

		if payStatus != "CAPTURED" {
			if _, err := tx.Exec(ctx, `
				INSERT INTO financial_ledger_entries (id, order_id, reference_type, reference_id, debit_account, credit_account, amount_minor, currency)
				VALUES ($1, $2, 'PAYMENT_CAPTURE', $3, 'GATEWAY_CLEARING', 'PLATFORM_ESCROW', $4, $5)
			`, uuid.NewString(), orderID, payID, payAmount, currency); err != nil {
				return err
			}
		}

		// Normal capture flow: PENDING_PAYMENT -> CONFIRMED + 5m accept deadline
		// Delivery OTP is generated only when the delivery partner marks ARRIVED_AT_CUSTOMER.
		if orderStatus == "PENDING_PAYMENT" {
			acceptTimeoutSec := 300
			_ = tx.QueryRow(ctx, `SELECT (value::text)::int FROM platform_configs WHERE key = 'acceptance_timeout_seconds'`).Scan(&acceptTimeoutSec)

			if _, err := tx.Exec(ctx, `
				UPDATE orders
				SET order_status = 'CONFIRMED',
				    payment_status = 'CAPTURED',
				    confirmed_at = NOW(),
				    accept_deadline_at = NOW() + ($2 * INTERVAL '1 second'),
				    version = version + 1
				WHERE id = $1
			`, orderID, acceptTimeoutSec); err != nil {
				return err
			}

			_, _ = tx.Exec(ctx, `UPDATE restaurants SET active_orders_count = active_orders_count + 1 WHERE id = $1`, restID)
			_, _ = tx.Exec(ctx, `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE customer_id = $1)`, customerID)
			_, _ = tx.Exec(ctx, `UPDATE carts SET restaurant_id = NULL, applied_coupon_id = NULL WHERE customer_id = $1`, customerID)

			_, _ = tx.Exec(ctx, `
				INSERT INTO order_status_history (id, order_id, from_order_status, to_order_status, to_payment_status, to_delivery_status, actor_role)
				VALUES ($1, $2, 'PENDING_PAYMENT', 'CONFIRMED', 'CAPTURED', 'ASSIGNMENT_PENDING', 'PAYMENT_GATEWAY')
			`, uuid.NewString(), orderID)

			return outbox.WriteEvent(ctx, tx, "ORDER", orderID, "order.confirmed", map[string]any{
				"order_id":      orderID,
				"restaurant_id": restID,
				"payment_id":    payID,
			})
		}

		// Late payment recovery: webhook arrived AFTER order expired/cancelled -> automatically queue FULL refund
		if orderStatus == "CANCELLED" {
			_, _ = tx.Exec(ctx, `UPDATE orders SET payment_status = 'REFUND_PENDING', version = version + 1 WHERE id = $1`, orderID)
			refID := uuid.NewString()
			_, err := tx.Exec(ctx, `
				INSERT INTO refunds (id, payment_id, order_id, idempotency_key, amount_minor, refund_type, reason_code, notes, status, initiated_by_role)
				VALUES ($1, $2, $3, $4, $5, 'FULL', 'LATE_PAYMENT_AFTER_CANCEL', 'Auto-queued refund for late gateway capture on cancelled order', 'PENDING', 'SYSTEM')
				ON CONFLICT (idempotency_key) DO NOTHING
			`, refID, payID, orderID, "late-pay:"+orderID, payAmount)
			if err != nil {
				return err
			}
			return outbox.WriteEvent(ctx, tx, "PAYMENT", payID, "refund.requested", map[string]any{
				"order_id":   orderID,
				"payment_id": payID,
				"refund_id":  refID,
				"reason":     "LATE_PAYMENT_AFTER_CANCEL",
			})
		}

		return nil
	})
	return deduplicated, txErr
}

// MarkPaymentFailed logs a gateway failure without duplicating failed order states.
func (r *Repository) MarkPaymentFailed(ctx context.Context, providerName, providerEventID, providerOrderID, reason string, rawPayload []byte) error {
	return database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var payID, orderID, payStatus string
		var amount int64
		err := tx.QueryRow(ctx, `
			SELECT id, order_id, amount_minor, status FROM payments WHERE provider_order_id = $1 FOR UPDATE
		`, providerOrderID).Scan(&payID, &orderID, &amount, &payStatus)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO payment_transactions (id, payment_id, provider, provider_event_id, event_type, amount_minor, raw_payload, signature_verified)
			VALUES ($1, $2, $3, $4, 'payment.failed', $5, $6, TRUE)
			ON CONFLICT (provider, provider_event_id) DO NOTHING
		`, uuid.NewString(), payID, providerName, providerEventID, amount, rawPayload)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		if payStatus == "INITIATED" || payStatus == "AUTHORIZED" {
			_, _ = tx.Exec(ctx, `UPDATE payments SET status = 'FAILED', failure_message = $2, version = version + 1 WHERE id = $1`, payID, reason)
			_, _ = tx.Exec(ctx, `UPDATE orders SET payment_status = 'FAILED', version = version + 1 WHERE id = $1 AND order_status = 'PENDING_PAYMENT'`, orderID)
		}
		return nil
	})
}

// IssueRefund safely processes full or partial refunds while strictly preventing double refunds.
func (r *Repository) IssueRefund(ctx context.Context, actorID, actorRole, orderID, idempKey string, amountMinor int64, reasonCode, notes string) (*RefundDTO, error) {
	var created RefundDTO

	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		var existing RefundDTO
		eErr := tx.QueryRow(ctx, `
			SELECT id, payment_id, order_id, provider_refund_id, amount_minor, refund_type, reason_code, notes, status, initiated_by_role, created_at
			FROM refunds WHERE idempotency_key = $1
		`, idempKey).Scan(
			&existing.ID, &existing.PaymentID, &existing.OrderID, &existing.ProviderRefundID,
			&existing.AmountMinor, &existing.RefundType, &existing.ReasonCode, &existing.Notes,
			&existing.Status, &existing.InitiatedByRole, &existing.CreatedAt,
		)
		if eErr == nil {
			created = existing
			return nil
		}

		var payID, currency, payStatus string
		var provPayID *string
		var payAmount int64
		err := tx.QueryRow(ctx, `
			SELECT id, provider_payment_id, amount_minor, currency, status
			FROM payments
			WHERE order_id = $1 AND status IN ('CAPTURED', 'PARTIALLY_REFUNDED')
			FOR UPDATE
		`, orderID).Scan(&payID, &provPayID, &payAmount, &currency, &payStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPaymentNotFound
		}
		if err != nil {
			return err
		}

		var alreadyRefunded int64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_minor), 0) FROM refunds
			WHERE payment_id = $1 AND status <> 'FAILED'
		`, payID).Scan(&alreadyRefunded); err != nil {
			return err
		}

		if amountMinor <= 0 || alreadyRefunded+amountMinor > payAmount {
			return ErrRefundExceedsBalance
		}

		refType := "PARTIAL"
		nextPayStatus := "PARTIALLY_REFUNDED"
		if alreadyRefunded+amountMinor == payAmount {
			refType = "FULL"
			nextPayStatus = "REFUNDED"
		}

		var provRefundID *string
		if provPayID != nil && *provPayID != "" {
			gwRef, gwErr := r.provider.IssueRefund(ctx, *provPayID, amountMinor, notes)
			if gwErr != nil {
				return gwErr
			}
			provRefundID = &gwRef.ProviderRefundID
		}

		var actorPtr *string
		if actorID != "" {
			actorPtr = &actorID
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO refunds (id, payment_id, order_id, idempotency_key, provider_refund_id, amount_minor, refund_type, reason_code, notes, status, initiated_by_user_id, initiated_by_role, processed_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PROCESSED', $10, $11, NOW())
			RETURNING id, payment_id, order_id, provider_refund_id, amount_minor, refund_type, reason_code, notes, status, initiated_by_role, created_at
		`, uuid.NewString(), payID, orderID, idempKey, provRefundID, amountMinor, refType, reasonCode, notes, actorPtr, actorRole).Scan(
			&created.ID, &created.PaymentID, &created.OrderID, &created.ProviderRefundID,
			&created.AmountMinor, &created.RefundType, &created.ReasonCode, &created.Notes,
			&created.Status, &created.InitiatedByRole, &created.CreatedAt,
		); err != nil {
			return err
		}

		_, _ = tx.Exec(ctx, `UPDATE payments SET status = $2, version = version + 1 WHERE id = $1`, payID, nextPayStatus)
		_, _ = tx.Exec(ctx, `UPDATE orders SET payment_status = $2, version = version + 1 WHERE id = $1`, orderID, nextPayStatus)

		if _, err := tx.Exec(ctx, `
			INSERT INTO financial_ledger_entries (id, order_id, reference_type, reference_id, debit_account, credit_account, amount_minor, currency)
			VALUES ($1, $2, 'REFUND', $3, 'PLATFORM_ESCROW', 'GATEWAY_CLEARING', $4, $5)
		`, uuid.NewString(), orderID, created.ID, amountMinor, currency); err != nil {
			return err
		}

		return outbox.WriteEvent(ctx, tx, "PAYMENT", payID, "refund.processed", map[string]any{
			"order_id":     orderID,
			"refund_id":    created.ID,
			"amount_minor": amountMinor,
			"refund_type":  refType,
		})
	})
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// GetOrderPaymentsAndRefunds fetches payment and refund rows for an order.
func (r *Repository) GetOrderPaymentsAndRefunds(ctx context.Context, orderID string) ([]PaymentDTO, []RefundDTO, error) {
	pRows, err := r.pool.Query(ctx, `
		SELECT id, order_id, provider, provider_order_id, provider_payment_id, amount_minor, currency, status, payment_instrument, failure_message, reconciled_at, created_at
		FROM payments WHERE order_id = $1 ORDER BY created_at DESC
	`, orderID)
	if err != nil {
		return nil, nil, err
	}
	defer pRows.Close()

	var pays []PaymentDTO
	for pRows.Next() {
		var p PaymentDTO
		if err := pRows.Scan(&p.ID, &p.OrderID, &p.Provider, &p.ProviderOrderID, &p.ProviderPaymentID, &p.AmountMinor, &p.Currency, &p.Status, &p.PaymentInstrument, &p.FailureMessage, &p.ReconciledAt, &p.CreatedAt); err != nil {
			return nil, nil, err
		}
		pays = append(pays, p)
	}
	if pays == nil {
		pays = []PaymentDTO{}
	}

	rRows, err := r.pool.Query(ctx, `
		SELECT id, payment_id, order_id, provider_refund_id, amount_minor, refund_type, reason_code, notes, status, initiated_by_role, created_at
		FROM refunds WHERE order_id = $1 ORDER BY created_at DESC
	`, orderID)
	if err != nil {
		return nil, nil, err
	}
	defer rRows.Close()

	var refs []RefundDTO
	for rRows.Next() {
		var rf RefundDTO
		if err := rRows.Scan(&rf.ID, &rf.PaymentID, &rf.OrderID, &rf.ProviderRefundID, &rf.AmountMinor, &rf.RefundType, &rf.ReasonCode, &rf.Notes, &rf.Status, &rf.InitiatedByRole, &rf.CreatedAt); err != nil {
			return nil, nil, err
		}
		refs = append(refs, rf)
	}
	if refs == nil {
		refs = []RefundDTO{}
	}
	return pays, refs, nil
}

// SandboxCapturePayment initializes a provider order (or falls back to sandbox order ID) and executes real HMAC callback verification.
func (r *Repository) SandboxCapturePayment(ctx context.Context, customerID, orderID string) (*PaymentDTO, error) {
	var paymentID, orderStatus string
	var existingProvOrderID *string
	err := r.pool.QueryRow(ctx, `
		SELECT p.id, o.order_status, p.provider_order_id
		FROM payments p
		JOIN orders o ON o.id = p.order_id
		WHERE p.order_id = $1 AND o.customer_id = $2
		LIMIT 1
	`, orderID, customerID).Scan(&paymentID, &orderStatus, &existingProvOrderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPaymentNotFound
	}
	if err != nil {
		return nil, err
	}
	if orderStatus != "PENDING_PAYMENT" {
		return nil, ErrOrderNotPayable
	}

	var provOrderID string
	if existingProvOrderID != nil && *existingProvOrderID != "" {
		provOrderID = *existingProvOrderID
	} else {
		sess, sErr := r.InitiatePaymentSession(ctx, customerID, orderID)
		if sErr == nil && sess.ProviderOrderID != "" {
			provOrderID = sess.ProviderOrderID
		} else {
			provOrderID = "order_sandbox_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
			if _, uErr := r.pool.Exec(ctx, `
				UPDATE payments SET provider = $2, provider_order_id = $3 WHERE id = $1
			`, paymentID, r.provider.Name(), provOrderID); uErr != nil {
				return nil, uErr
			}
		}
	}

	provPayID := "pay_sandbox_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	sig := r.provider.SignCallback(provOrderID, provPayID)
	if err := r.VerifyClientCallback(ctx, customerID, orderID, provOrderID, provPayID, sig); err != nil {
		return nil, err
	}

	pays, _, err := r.GetOrderPaymentsAndRefunds(ctx, orderID)
	if err != nil || len(pays) == 0 {
		return nil, err
	}
	return &pays[0], nil
}

// MarkPaymentDeclinedByCustomer records a simulated or customer-aborted payment failure while keeping the order PENDING_PAYMENT for retry.
func (r *Repository) MarkPaymentDeclinedByCustomer(ctx context.Context, customerID, orderID, reason string) (*PaymentDTO, error) {
	if strings.TrimSpace(reason) == "" {
		reason = "Simulated bank authorization decline (timeout / insufficient funds)"
	}
	var paymentID, orderStatus string
	var existingProvOrderID *string
	err := r.pool.QueryRow(ctx, `
		SELECT p.id, o.order_status, p.provider_order_id
		FROM payments p
		JOIN orders o ON o.id = p.order_id
		WHERE p.order_id = $1 AND o.customer_id = $2
		LIMIT 1
	`, orderID, customerID).Scan(&paymentID, &orderStatus, &existingProvOrderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPaymentNotFound
	}
	if err != nil {
		return nil, err
	}
	if orderStatus != "PENDING_PAYMENT" {
		return nil, ErrOrderNotPayable
	}

	provOrderID := ""
	if existingProvOrderID != nil && *existingProvOrderID != "" {
		provOrderID = *existingProvOrderID
	} else {
		provOrderID = "order_sandbox_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
		if _, uErr := r.pool.Exec(ctx, `
			UPDATE payments SET provider = $2, provider_order_id = $3 WHERE id = $1
		`, paymentID, r.provider.Name(), provOrderID); uErr != nil {
			return nil, uErr
		}
	}

	raw, _ := json.Marshal(map[string]any{
		"source":            "sandbox_decline",
		"provider_order_id": provOrderID,
		"reason":            reason,
	})
	if err := r.MarkPaymentFailed(ctx, r.provider.Name(), "fail:"+uuid.NewString(), provOrderID, reason, raw); err != nil {
		return nil, err
	}

	pays, _, err := r.GetOrderPaymentsAndRefunds(ctx, orderID)
	if err != nil || len(pays) == 0 {
		return nil, err
	}
	return &pays[0], nil
}

// ListAdminPaymentsAndRefunds returns recent payment transactions and refund ledger rows across all orders.
func (r *Repository) ListAdminPaymentsAndRefunds(ctx context.Context) ([]AdminPaymentDTO, []AdminRefundDTO, error) {
	pRows, err := r.pool.Query(ctx, `
		SELECT p.id, p.order_id, o.order_number, p.customer_id, p.provider,
		       p.provider_order_id, p.provider_payment_id, p.amount_minor, p.currency,
		       p.status, p.payment_instrument, p.failure_message, p.reconciled_at, p.created_at
		FROM payments p
		JOIN orders o ON o.id = p.order_id
		ORDER BY p.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, nil, err
	}
	defer pRows.Close()

	var pays []AdminPaymentDTO
	for pRows.Next() {
		var p AdminPaymentDTO
		if err := pRows.Scan(
			&p.ID, &p.OrderID, &p.OrderNumber, &p.CustomerID, &p.Provider,
			&p.ProviderOrderID, &p.ProviderPaymentID, &p.AmountMinor, &p.Currency,
			&p.Status, &p.PaymentInstrument, &p.FailureMessage, &p.ReconciledAt, &p.CreatedAt,
		); err != nil {
			return nil, nil, err
		}
		pays = append(pays, p)
	}
	if pays == nil {
		pays = []AdminPaymentDTO{}
	}

	rRows, err := r.pool.Query(ctx, `
		SELECT rf.id, rf.payment_id, rf.order_id, o.order_number, rf.provider_refund_id,
		       rf.amount_minor, p.currency, rf.refund_type, rf.reason_code, rf.notes,
		       rf.status, rf.initiated_by_role, rf.processed_at, rf.created_at
		FROM refunds rf
		JOIN orders o ON o.id = rf.order_id
		JOIN payments p ON p.id = rf.payment_id
		ORDER BY rf.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, nil, err
	}
	defer rRows.Close()

	var refs []AdminRefundDTO
	for rRows.Next() {
		var rf AdminRefundDTO
		if err := rRows.Scan(
			&rf.ID, &rf.PaymentID, &rf.OrderID, &rf.OrderNumber, &rf.ProviderRefundID,
			&rf.AmountMinor, &rf.Currency, &rf.RefundType, &rf.ReasonCode, &rf.Notes,
			&rf.Status, &rf.InitiatedByRole, &rf.ProcessedAt, &rf.CreatedAt,
		); err != nil {
			return nil, nil, err
		}
		refs = append(refs, rf)
	}
	if refs == nil {
		refs = []AdminRefundDTO{}
	}
	return pays, refs, nil
}
