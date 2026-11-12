package redis

import (
	"context"
	"fmt"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Client wraps go-redis with Goodly platform primitives (rate limiting, revocation, WS tickets).
type Client struct {
	raw *goredis.Client
}

// NewClientWithURL connects using REDIS_URL (supporting redis:// and rediss:// TLS)
// when provided, otherwise falling back to addr and password.
func NewClientWithURL(ctx context.Context, redisURL, addr, password string) (*Client, error) {
	redisURL = strings.TrimSpace(redisURL)
	if redisURL == "" {
		return NewClient(ctx, addr, password)
	}
	opts, err := goredis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	opts.DialTimeout = 5 * time.Second
	opts.ReadTimeout = 3 * time.Second
	opts.WriteTimeout = 3 * time.Second

	rdb := goredis.NewClient(opts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &Client{raw: rdb}, nil
}

// NewClient initializes and pings a Redis connection.
func NewClient(ctx context.Context, addr, password string) (*Client, error) {
	rdb := goredis.NewClient(&goredis.Options{
		Addr:         addr,
		Password:     password,
		DB:           0,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &Client{raw: rdb}, nil
}

// Raw exposes the underlying go-redis client for Geo/PubSub operations.
func (c *Client) Raw() *goredis.Client {
	return c.raw
}

// Ping verifies live connectivity to Redis.
func (c *Client) Ping(ctx context.Context) error {
	return c.raw.Ping(ctx).Err()
}

// Close closes the underlying Redis connection pool.
func (c *Client) Close() error {
	return c.raw.Close()
}

// AllowSlidingWindow checks and increments a fixed/sliding window rate limit bucket.
// Returns (allowed, remaining, resetSeconds, error).
func (c *Client) AllowSlidingWindow(ctx context.Context, key string, limit int, window time.Duration) (bool, int, int64, error) {
	if c == nil || c.raw == nil {
		return true, limit, int64(window.Seconds()), nil
	}
	count, err := c.raw.Incr(ctx, key).Result()
	if err != nil {
		return false, 0, 0, err
	}
	if count == 1 {
		if err := c.raw.Expire(ctx, key, window).Err(); err != nil {
			return false, 0, 0, err
		}
	}
	ttl, err := c.raw.TTL(ctx, key).Result()
	if err != nil || ttl < 0 {
		ttl = window
	}
	remaining := limit - int(count)
	if remaining < 0 {
		remaining = 0
	}
	return count <= int64(limit), remaining, int64(ttl.Seconds()), nil
}

// RevokeSession marks an access/refresh JTI as revoked until expiration.
func (c *Client) RevokeSession(ctx context.Context, jti string, ttl time.Duration) error {
	if c == nil || c.raw == nil || ttl <= 0 {
		return nil
	}
	return c.raw.Set(ctx, "session:revoked:"+jti, "1", ttl).Err()
}

// IsSessionRevoked checks if a session JTI has been revoked in Redis.
func (c *Client) IsSessionRevoked(ctx context.Context, jti string) (bool, error) {
	if c == nil || c.raw == nil {
		return false, nil
	}
	n, err := c.raw.Exists(ctx, "session:revoked:"+jti).Result()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}
