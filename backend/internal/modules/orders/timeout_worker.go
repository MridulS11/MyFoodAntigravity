package orders

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/outbox"
)

type penaltyConfig struct {
	Mode     string `json:"mode"` // PERCENTAGE_OF_SUBTOTAL or FLAT_AMOUNT
	Bps      int64  `json:"bps"`
	FlatMin  int64  `json:"flat_minor"`
	MinMinor int64  `json:"min_minor"`
	MaxMinor int64  `json:"max_minor"`
}

// TimeoutWorker enforces the 5-minute acceptance SLA -> Customer Care alert -> grace period -> Admin-configured penalty.
type TimeoutWorker struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

// NewTimeoutWorker creates a TimeoutWorker.
func NewTimeoutWorker(pool *pgxpool.Pool, logger *slog.Logger) *TimeoutWorker {
	return &TimeoutWorker{pool: pool, logger: logger}
}

// Run executes the acceptance timeout monitor loop periodically until ctx is cancelled.
func (w *TimeoutWorker) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, _, err := w.ProcessAcceptanceTimeouts(ctx); err != nil {
				w.logger.Warn("acceptance timeout scan failed", "error", err)
			}
		}
	}
}

// ProcessAcceptanceTimeouts runs both escalation stages and returns counts of (alerted, penalized).
func (w *TimeoutWorker) ProcessAcceptanceTimeouts(ctx context.Context) (int, int, error) {
	alertedCount := 0
	penalizedCount := 0

	graceSeconds := 180
	_ = w.pool.QueryRow(ctx, `SELECT (value::text)::int FROM platform_configs WHERE key = 'acceptance_grace_period_seconds'`).Scan(&graceSeconds)

	// Stage 1: Initial 5-minute accept_deadline_at breached -> alert Customer Care & open grace window
	rows, err := w.pool.Query(ctx, `
		SELECT id, order_number, customer_id
		FROM orders
		WHERE order_status = 'CONFIRMED'
		  AND acceptance_escalation_state = 'NONE'
		  AND accept_deadline_at IS NOT NULL
		  AND accept_deadline_at <= NOW()
		LIMIT 50
	`)
	if err != nil {
		return 0, 0, err
	}
	type candidate struct {
		orderID     string
		orderNumber string
		customerID  string
	}
	var stage1 []candidate
	for rows.Next() {
		var c candidate
		if scanErr := rows.Scan(&c.orderID, &c.orderNumber, &c.customerID); scanErr == nil {
			stage1 = append(stage1, c)
		}
	}
	rows.Close()

	for _, c := range stage1 {
		txErr := database.WithTx(ctx, w.pool, func(tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, `
				UPDATE orders
				SET acceptance_escalation_state = 'CUSTOMER_CARE_ALERTED',
				    customer_care_alerted_at = NOW(),
				    grace_deadline_at = NOW() + ($2 * INTERVAL '1 second')
				WHERE id = $1 AND order_status = 'CONFIRMED' AND acceptance_escalation_state = 'NONE'
			`, c.orderID, graceSeconds)
			if err != nil || tag.RowsAffected() == 0 {
				return err
			}

			ticketNum := "ESC-" + c.orderNumber[len(c.orderNumber)-4:] + "-" + uuid.NewString()[:4]
			_, _ = tx.Exec(ctx, `
				INSERT INTO complaints (id, ticket_number, order_id, raised_by_user_id, category, priority, status, description)
				VALUES ($1, $2, $3, $4, 'ACCEPTANCE_TIMEOUT_ESCALATION', 'HIGH', 'OPEN', 'Outlet did not accept order within 5 minutes; grace window opened for Customer Care intervention.')
			`, uuid.NewString(), ticketNum, c.orderID, c.customerID)

			alertedCount++
			return outbox.WriteEvent(ctx, tx, "ORDER", c.orderID, "care.acceptance_timeout_alert", map[string]any{
				"order_id":     c.orderID,
				"order_number": c.orderNumber,
			})
		})
		if txErr != nil {
			return alertedCount, penalizedCount, txErr
		}
	}

	// Stage 2: Grace period expired without acceptance -> apply Admin-configured penalty & auto-cancel/refund
	pCfg := penaltyConfig{Mode: "PERCENTAGE_OF_SUBTOTAL", Bps: 1000, FlatMin: 10000, MinMinor: 5000, MaxMinor: 30000}
	var rawCfg []byte
	if err := w.pool.QueryRow(ctx, `SELECT value FROM platform_configs WHERE key = 'non_acceptance_penalty_rule'`).Scan(&rawCfg); err == nil {
		_ = json.Unmarshal(rawCfg, &pCfg)
	}

	rows2, err := w.pool.Query(ctx, `
		SELECT o.id, o.order_number, o.restaurant_id, r.owner_user_id, o.item_subtotal_minor, o.currency, o.payment_status, o.total_payable_minor
		FROM orders o
		JOIN restaurants r ON r.id = o.restaurant_id
		WHERE o.order_status = 'CONFIRMED'
		  AND o.acceptance_escalation_state IN ('CUSTOMER_CARE_ALERTED', 'GRACE_PERIOD')
		  AND o.grace_deadline_at IS NOT NULL
		  AND o.grace_deadline_at <= NOW()
		LIMIT 50
	`)
	if err != nil {
		return alertedCount, penalizedCount, err
	}
	type breach struct {
		orderID, orderNumber, outletID, ownerID, currency, payStatus string
		subtotal, totalMinor                                         int64
	}
	var stage2 []breach
	for rows2.Next() {
		var b breach
		if scanErr := rows2.Scan(&b.orderID, &b.orderNumber, &b.outletID, &b.ownerID, &b.subtotal, &b.currency, &b.payStatus, &b.totalMinor); scanErr == nil {
			stage2 = append(stage2, b)
		}
	}
	rows2.Close()

	for _, b := range stage2 {
		penaltyAmt := computeNonAcceptancePenalty(pCfg, b.subtotal)
		snapshotBytes, _ := json.Marshal(pCfg)

		txErr := database.WithTx(ctx, w.pool, func(tx pgx.Tx) error {
			var status string
			if err := tx.QueryRow(ctx, `SELECT order_status FROM orders WHERE id = $1 FOR UPDATE`, b.orderID).Scan(&status); err != nil {
				return err
			}
			if status != "CONFIRMED" {
				return nil
			}

			nextPay := b.payStatus
			if b.payStatus == "CAPTURED" {
				nextPay = "REFUND_PENDING"
			}
			if _, err := tx.Exec(ctx, `
				UPDATE orders
				SET order_status = 'CANCELLED', delivery_status = 'CANCELLED', payment_status = $2,
				    acceptance_escalation_state = 'PENALTY_APPLIED',
				    cancelled_at = NOW(), cancellation_reason = 'ACCEPTANCE_TIMEOUT_AFTER_GRACE', cancelled_by_role = 'SYSTEM',
				    version = version + 1
				WHERE id = $1
			`, b.orderID, nextPay); err != nil {
				return err
			}

			if _, err := tx.Exec(ctx, `
				INSERT INTO outlet_penalties (id, outlet_id, owner_user_id, order_id, reason_code, penalty_rule_snapshot, penalty_amount_minor, currency, order_resolution_policy, status)
				VALUES ($1, $2, $3, $4, 'ACCEPTANCE_TIMEOUT_AFTER_GRACE', $5, $6, $7, 'AUTO_CANCEL_AND_REFUND', 'APPLIED')
				ON CONFLICT (order_id) DO NOTHING
			`, uuid.NewString(), b.outletID, b.ownerID, b.orderID, snapshotBytes, penaltyAmt, b.currency); err != nil {
				return err
			}

			_, _ = tx.Exec(ctx, `UPDATE restaurants SET active_orders_count = GREATEST(0, active_orders_count - 1) WHERE id = $1`, b.outletID)
			if err := restoreInventoryInTx(ctx, tx, b.orderID); err != nil {
				return err
			}

			if b.payStatus == "CAPTURED" {
				var payID string
				if err := tx.QueryRow(ctx, `SELECT id FROM payments WHERE order_id = $1 LIMIT 1`, b.orderID).Scan(&payID); err == nil {
					_, _ = tx.Exec(ctx, `
						INSERT INTO refunds (id, payment_id, order_id, idempotency_key, amount_minor, refund_type, reason_code, notes, status, initiated_by_role)
						VALUES ($1, $2, $3, $4, $5, 'FULL', 'ACCEPTANCE_TIMEOUT', 'Auto-refund after 5m timeout + grace period expiry', 'PENDING', 'SYSTEM')
					`, uuid.NewString(), payID, b.orderID, "timeout:"+b.orderID, b.totalMinor)
				}
			}

			penalizedCount++
			return outbox.WriteEvent(ctx, tx, "ORDER", b.orderID, "outlet.penalty_applied", map[string]any{
				"order_id":             b.orderID,
				"outlet_id":            b.outletID,
				"penalty_amount_minor": penaltyAmt,
			})
		})
		if txErr != nil {
			return alertedCount, penalizedCount, txErr
		}
	}

	return alertedCount, penalizedCount, nil
}

func computeNonAcceptancePenalty(cfg penaltyConfig, subtotalMinor int64) int64 {
	if cfg.Mode == "FLAT_AMOUNT" {
		return cfg.FlatMin
	}
	amt := int64(math.Round(float64(subtotalMinor*cfg.Bps) / 10000.0))
	if cfg.MinMinor > 0 && amt < cfg.MinMinor {
		amt = cfg.MinMinor
	}
	if cfg.MaxMinor > 0 && amt > cfg.MaxMinor {
		amt = cfg.MaxMinor
	}
	return amt
}
