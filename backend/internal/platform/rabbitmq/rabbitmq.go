package rabbitmq

import (
	"context"
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	// EventsExchange is the durable topic exchange for Goodly domain events.
	EventsExchange = "goodly.events"
)

// Client manages the RabbitMQ connection and topology declarations.
type Client struct {
	conn    *amqp.Connection
	channel *amqp.Channel
}

// Connect dials RabbitMQ and declares the core durable events exchange.
func Connect(url string) (*Client, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, fmt.Errorf("dial rabbitmq: %w", err)
	}
	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("open rabbitmq channel: %w", err)
	}
	if err := ch.ExchangeDeclare(
		EventsExchange,
		"topic",
		true,  // durable
		false, // auto-deleted
		false, // internal
		false, // no-wait
		nil,
	); err != nil {
		_ = ch.Close()
		_ = conn.Close()
		return nil, fmt.Errorf("declare exchange %s: %w", EventsExchange, err)
	}
	return &Client{conn: conn, channel: ch}, nil
}

// Publish publishes a persistent JSON event payload to goodly.events.
func (c *Client) Publish(ctx context.Context, routingKey string, messageID string, body []byte) error {
	return c.channel.PublishWithContext(
		ctx,
		EventsExchange,
		routingKey,
		false,
		false,
		amqp.Publishing{
			ContentType:  "application/json",
			DeliveryMode: amqp.Persistent,
			MessageId:    messageID,
			Body:         body,
		},
	)
}

// IsHealthy verifies that the RabbitMQ connection is open.
func (c *Client) IsHealthy() bool {
	return c != nil && c.conn != nil && !c.conn.IsClosed()
}

// Close closes channel and connection gracefully.
func (c *Client) Close() error {
	if c.channel != nil {
		_ = c.channel.Close()
	}
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
