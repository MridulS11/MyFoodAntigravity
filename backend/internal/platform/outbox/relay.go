package outbox

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/rabbitmq"
)

// Relay polls PENDING outbox_events using FOR UPDATE SKIP LOCKED and publishes them to RabbitMQ.
type Relay struct {
	pool   *pgxpool.Pool
	rmq    *rabbitmq.Client
	logger *slog.Logger
}

// NewRelay creates a Transactional Outbox Relay.
func NewRelay(pool *pgxpool.Pool, rmq *rabbitmq.Client, logger *slog.Logger) *Relay {
	return &Relay{pool: pool, rmq: rmq, logger: logger}
}

// Run starts the polling loop until ctx is cancelled.
func (r *Relay) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := r.ProcessBatch(ctx, 50); err != nil {
				r.logger.Warn("outbox relay batch error", "error", err)
			}
		}
	}
}

// ProcessBatch claims up to limit pending events and publishes each to RabbitMQ.
func (r *Relay) ProcessBatch(ctx context.Context, limit int) error {
	if r.rmq == nil || !r.rmq.IsHealthy() {
		return nil
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT id, event_type, payload
		FROM outbox_events
		WHERE status = 'PENDING'
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, limit)
	if err != nil {
		return err
	}

	type pendingRow struct {
		id        string
		eventType string
		payload   []byte
	}
	var batch []pendingRow
	for rows.Next() {
		var row pendingRow
		if scanErr := rows.Scan(&row.id, &row.eventType, &row.payload); scanErr != nil {
			rows.Close()
			return scanErr
		}
		batch = append(batch, row)
	}
	rows.Close()

	for _, item := range batch {
		if pubErr := r.rmq.Publish(ctx, item.eventType, item.id, item.payload); pubErr != nil {
			_, _ = tx.Exec(ctx, `UPDATE outbox_events SET attempts = attempts + 1 WHERE id = $1`, item.id)
			continue
		}
		if _, err := tx.Exec(ctx, `
			UPDATE outbox_events SET status = 'PUBLISHED', published_at = NOW(), attempts = attempts + 1
			WHERE id = $1
		`, item.id); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}
