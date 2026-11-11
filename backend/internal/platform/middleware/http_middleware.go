package middleware

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

const (
	ContextCorrelationID = "correlation_id"
)

// CorrelationID propagates or generates X-Correlation-ID on every request/response.
func CorrelationID() gin.HandlerFunc {
	return func(c *gin.Context) {
		cid := strings.TrimSpace(c.GetHeader("X-Correlation-ID"))
		if cid == "" {
			cid = uuid.NewString()
		}
		c.Set(ContextCorrelationID, cid)
		c.Writer.Header().Set("X-Correlation-ID", cid)
		c.Next()
	}
}

// GetCorrelationID fetches the request correlation ID from Gin context.
func GetCorrelationID(c *gin.Context) string {
	if v, ok := c.Get(ContextCorrelationID); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// CORS configures strict origin sharing for browser portals with credentials.
func CORS(allowedOrigin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == allowedOrigin || origin == "http://127.0.0.1:3000" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Correlation-ID")
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// RequestLogger emits structured JSON request logs via slog.
func RequestLogger(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.Info("http_request",
			"correlation_id", GetCorrelationID(c),
			"method", c.Request.Method,
			"path", c.FullPath(),
			"status", c.Writer.Status(),
			"latency_ms", time.Since(start).Milliseconds(),
			"client_ip", c.ClientIP(),
		)
	}
}

// RateLimiter applies Redis sliding-window rate limiting with standard X-RateLimit-* headers.
func RateLimiter(rdb *platformredis.Client, bucketPrefix string, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if rdb == nil {
			c.Next()
			return
		}
		key := "ratelimit:" + bucketPrefix + ":" + c.ClientIP()
		allowed, remaining, resetSec, err := rdb.AllowSlidingWindow(c.Request.Context(), key, limit, window)
		if err != nil {
			// Fail open for availability if Redis is momentarily unreachable, while logging elsewhere.
			c.Next()
			return
		}
		c.Writer.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
		c.Writer.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
		c.Writer.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetSec, 10))
		if !allowed {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error": gin.H{
					"code":           "RATE_LIMIT_EXCEEDED",
					"message":        "Too many requests. Please wait before retrying.",
					"correlation_id": GetCorrelationID(c),
				},
			})
			return
		}
		c.Next()
	}
}
