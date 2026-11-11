package redis

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSlidingWindowAndSessionRevocation(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping redis integration test in -short mode")
	}

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "localhost:6379"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rdb, err := NewClient(ctx, addr, "")
	require.NoError(t, err)
	defer rdb.Close()

	key := "test:ratelimit:" + time.Now().Format("150405.000000")
	allowed1, rem1, _, err := rdb.AllowSlidingWindow(ctx, key, 2, 10*time.Second)
	require.NoError(t, err)
	assert.True(t, allowed1)
	assert.Equal(t, 1, rem1)

	allowed2, rem2, _, err := rdb.AllowSlidingWindow(ctx, key, 2, 10*time.Second)
	require.NoError(t, err)
	assert.True(t, allowed2)
	assert.Equal(t, 0, rem2)

	allowed3, rem3, _, err := rdb.AllowSlidingWindow(ctx, key, 2, 10*time.Second)
	require.NoError(t, err)
	assert.False(t, allowed3)
	assert.Equal(t, 0, rem3)

	// Session revocation check
	jti := "test-jti-" + time.Now().Format("150405.000000")
	revokedBefore, err := rdb.IsSessionRevoked(ctx, jti)
	require.NoError(t, err)
	assert.False(t, revokedBefore)

	require.NoError(t, rdb.RevokeSession(ctx, jti, 30*time.Second))
	revokedAfter, err := rdb.IsSessionRevoked(ctx, jti)
	require.NoError(t, err)
	assert.True(t, revokedAfter)
}
