package payments

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/outbox"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/paymentgw"
)

// Reconciler actively queries gateway APIs to recover unresolved payments after lost/delayed webhooks (FR-048, NFR-015).
type Reconciler struct {
	pool     *pgxpool.Pool
	repo     *Repository
	provider paymentgw.Provider
	logger   *slog.Logger
}

// NewReconciler creates a background payment reconciler.
func NewReconciler(pool *pgxpool.Pool, repo *Repository, provider paymentgw.Provider, logger *slog.Logger) *Reconciler {
	return &Reconciler{pool: pool, repo: repo, provider: provider, logger: logger}
}

// Run executes upstream capture reconciliation and pending refund settlement at interval until ctx cancels.
func (rec *Reconciler) Run(ctx context.Context, interval, minAge time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, _, err := rec.RunOnce(ctx, minAge); err != nil {
				rec.logger.Warn("payment reconciliation sweep error", "error", err)
			}
		}
	}
}

// RunOnce performs upstream capture recovery followed by automated PENDING refund settlement.
func (rec *Reconciler) RunOnce(ctx context.Context, minAge time.Duration) (int, int, error) {
	reconciled, recErr := rec.ReconcileOnce(ctx, minAge)
	refunded, refErr := rec.ProcessPendingRefunds(ctx)
	if recErr != nil {
		return reconciled, refunded, recErr
	}
	return reconciled, refunded, refErr
}

// ReconcileOnce scans INITIATED/AUTHORIZED online payments older than minAge and reconciles upstream state.
func (rec *Reconciler) ReconcileOnce(ctx context.Context, minAge time.Duration) (int, error) {
	cutoff := time.Now().UTC().Add(-minAge)
	rows, err := rec.pool.Query(ctx, `
		SELECT id, provider_order_id
		FROM payments
		WHERE provider <> 'COD'
		  AND provider_order_id IS NOT NULL
		  AND status IN ('INITIATED', 'AUTHORIZED')
		  AND created_at <= $1
		LIMIT 50
	`, cutoff)
	if err != nil {
		return 0, err
	}

	type unresolved struct {
		payID           string
		providerOrderID string
	}
	var list []unresolved
	for rows.Next() {
		var u unresolved
		if scanErr := rows.Scan(&u.payID, &u.providerOrderID); scanErr == nil {
			list = append(list, u)
		}
	}
	rows.Close()

	reconciled := 0
	for _, u := range list {
		snaps, err := rec.provider.FetchOrderPayments(ctx, u.providerOrderID)
		if err != nil {
			continue
		}
		for _, snap := range snaps {
			if snap.Status == "captured" {
				raw, _ := json.Marshal(snap)
				if _, capErr := rec.repo.ApplyPaymentCapture(
					ctx,
					rec.provider.Name(),
					"reconcile:"+snap.ProviderPaymentID,
					"payment.captured",
					snap.ProviderOrderID,
					snap.ProviderPaymentID,
					snap.AmountMinor,
					snap.Method,
					raw,
					true,
					true,
				); capErr == nil {
					reconciled++
				}
				break
			}
		}
	}
	return reconciled, nil
}

// ProcessPendingRefunds settles PENDING refund rows (created by customer cancellations,
// restaurant rejections, or late webhook captures) against the payment gateway, writes
// REFUND ledger entries, updates payment/order status, and emits refund.processed.
func (rec *Reconciler) ProcessPendingRefunds(ctx context.Context) (int, error) {
	rows, err := rec.pool.Query(ctx, `
		SELECT id
		FROM refunds
		WHERE status = 'PENDING'
		ORDER BY created_at ASC
		LIMIT 25
	`)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if scanErr := rows.Scan(&id); scanErr == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	processed := 0
	for _, refundID := range ids {
		settled := false
		txErr := database.WithTx(ctx, rec.pool, func(tx pgx.Tx) error {
			var payID, orderID, notes string
			var refAmount int64
			err := tx.QueryRow(ctx, `
				SELECT r.payment_id, r.order_id, r.amount_minor, COALESCE(r.notes, '')
				FROM refunds r
				WHERE r.id = $1 AND r.status = 'PENDING'
				FOR UPDATE SKIP LOCKED
			`, refundID).Scan(&payID, &orderID, &refAmount, &notes)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}

			var provPayID *string
			var payAmount int64
			var currency string
			if err := tx.QueryRow(ctx, `
				SELECT provider_payment_id, amount_minor, currency
				FROM payments
				WHERE id = $1
				FOR UPDATE
			`, payID).Scan(&provPayID, &payAmount, &currency); err != nil {
				return err
			}

			var provRefundID *string
			if provPayID != nil && *provPayID != "" {
				gwRef, gwErr := rec.provider.IssueRefund(ctx, *provPayID, refAmount, notes)
				if gwErr != nil {
					return gwErr
				}
				provRefundID = &gwRef.ProviderRefundID
			}

			var alreadyProcessed int64
			if err := tx.QueryRow(ctx, `
				SELECT COALESCE(SUM(amount_minor), 0)
				FROM refunds
				WHERE payment_id = $1 AND status = 'PROCESSED'
			`, payID).Scan(&alreadyProcessed); err != nil {
				return err
			}

			nextPayStatus := "PARTIALLY_REFUNDED"
			if alreadyProcessed+refAmount >= payAmount {
				nextPayStatus = "REFUNDED"
			}

			if _, err := tx.Exec(ctx, `
				UPDATE refunds
				SET status = 'PROCESSED',
				    provider_refund_id = COALESCE($2, provider_refund_id),
				    processed_at = NOW()
				WHERE id = $1
			`, refundID, provRefundID); err != nil {
				return err
			}

			if _, err := tx.Exec(ctx, `
				UPDATE payments
				SET status = $2,
				    reconciled_at = COALESCE(reconciled_at, NOW()),
				    version = version + 1
				WHERE id = $1
			`, payID, nextPayStatus); err != nil {
				return err
			}

			if _, err := tx.Exec(ctx, `
				UPDATE orders
				SET payment_status = $2,
				    version = version + 1
				WHERE id = $1
			`, orderID, nextPayStatus); err != nil {
				return err
			}

			if _, err := tx.Exec(ctx, `
				INSERT INTO financial_ledger_entries (id, order_id, reference_type, reference_id, debit_account, credit_account, amount_minor, currency)
				VALUES ($1, $2, 'REFUND', $3, 'PLATFORM_ESCROW', 'GATEWAY_CLEARING', $4, $5)
			`, uuid.NewString(), orderID, refundID, refAmount, currency); err != nil {
				return err
			}

			if err := outbox.WriteEvent(ctx, tx, "PAYMENT", payID, "refund.processed", map[string]any{
				"order_id":     orderID,
				"payment_id":   payID,
				"refund_id":    refundID,
				"amount_minor": refAmount,
				"source":       "reconciler",
			}); err != nil {
				return err
			}

			settled = true
			return nil
		})
		if txErr != nil {
			rec.logger.Warn("pending refund execution deferred", "refund_id", refundID, "error", txErr)
			continue
		}
		if settled {
			processed++
		}
	}
	return processed, nil
}
