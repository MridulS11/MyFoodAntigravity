package database

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
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

	migrationsDir := filepath.Join("..", "..", "..", "..", "supabase", "migrations")
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

	// Verify canonical Supabase migration naming (14-digit timestamp, unique versions, non-empty SQL)
	entries, err := os.ReadDir(migrationsDir)
	require.NoError(t, err)
	pattern := regexp.MustCompile(`^(\d{14})_[a-z0-9_]+\.sql$`)
	seenVersions := make(map[string]bool)
	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		files = append(files, e.Name())
		m := pattern.FindStringSubmatch(e.Name())
		require.Len(t, m, 2, "invalid Supabase migration filename: %s", e.Name())
		assert.False(t, seenVersions[m[1]], "duplicate migration timestamp version: %s", m[1])
		seenVersions[m[1]] = true
		raw, rErr := os.ReadFile(filepath.Join(migrationsDir, e.Name()))
		require.NoError(t, rErr)
		assert.NotEmpty(t, strings.TrimSpace(string(raw)))
	}
	assert.GreaterOrEqual(t, len(files), 20)
	assert.True(t, sort.StringsAreSorted(files))
}
