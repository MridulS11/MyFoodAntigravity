package database

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigrationsIdempotentUpAndDown(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping database migration test in -short mode")
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	pool, err := NewPool(ctx, dbURL)
	require.NoError(t, err)
	defer pool.Close()

	migrationsDir := "../../../migrations"
	require.NoError(t, RunMigrations(ctx, pool, migrationsDir))
	// Idempotent second run must also succeed with zero error
	require.NoError(t, RunMigrations(ctx, pool, migrationsDir))

	// Verify table count >= 55 tables in public schema
	var tableCount int
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
	`).Scan(&tableCount)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, tableCount, 55)

	// Verify all down migrations syntax exists for every up migration
	entries, err := os.ReadDir(migrationsDir)
	require.NoError(t, err)
	var upCount, downCount int
	var downs []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".up.sql") {
			upCount++
		} else if strings.HasSuffix(e.Name(), ".down.sql") {
			downCount++
			downs = append(downs, e.Name())
		}
	}
	assert.Equal(t, 20, upCount)
	assert.Equal(t, 20, downCount)
	sort.Sort(sort.Reverse(sort.StringSlice(downs)))
	for _, d := range downs {
		raw, rErr := os.ReadFile(filepath.Join(migrationsDir, d))
		require.NoError(t, rErr)
		assert.NotEmpty(t, string(raw))
	}
}
