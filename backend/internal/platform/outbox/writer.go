package outbox

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// WriteEvent inserts an outbox event within an existing PostgreSQL transaction.
func WriteEvent(ctx context.Context, tx pgx.Tx, aggregateType, aggregateID, eventType string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal outbox payload: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, status)
		VALUES ($1, $2, $3, $4, $5, 'PENDING')
	`, uuid.NewString(), aggregateType, aggregateID, eventType, raw)
	return err
}
