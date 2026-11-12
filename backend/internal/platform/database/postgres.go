package database

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool creates and verifies a pgxpool connection to PostgreSQL.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 25
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	if _, ok := cfg.ConnConfig.RuntimeParams["search_path"]; !ok {
		cfg.ConnConfig.RuntimeParams["search_path"] = "public,extensions"
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect database pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// WithTx executes fn inside an ACID PostgreSQL transaction and rolls back on panic or error.
func WithTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			return fmt.Errorf("tx error: %w (rollback error: %v)", err, rbErr)
		}
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

// RunMigrations applies unapplied canonical *.sql files (from supabase/migrations) idempotently
// for local development and integration tests. Production environments must keep AUTO_MIGRATE=false
// and apply migrations exclusively via Supabase CLI / GitHub Actions.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool, migrationsDir string) error {
	lockConn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration lock conn: %w", err)
	}
	defer lockConn.Release()
	if _, err := lockConn.Exec(ctx, `SELECT pg_advisory_lock(88421001)`); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	defer func() {
		_, _ = lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock(88421001)`)
	}()

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`)
	if err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	var hasSupabaseTracking bool
	_ = pool.QueryRow(ctx, `SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL`).Scan(&hasSupabaseTracking)

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations dir %q: %w", migrationsDir, err)
	}

	var sqlFiles []string
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() && strings.HasSuffix(name, ".sql") && !strings.HasSuffix(name, ".down.sql") {
			sqlFiles = append(sqlFiles, name)
		}
	}
	sort.Strings(sqlFiles)

	for _, fileName := range sqlFiles {
		var alreadyApplied bool
		_, slugWithExt, hasSlug := strings.Cut(fileName, "_")
		legacyPattern := ""
		if hasSlug {
			legacyPattern = "%_" + strings.TrimSuffix(slugWithExt, ".sql") + ".up.sql"
		}
		err := pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM schema_migrations
				WHERE version = $1 OR ($2 <> '' AND version LIKE $2)
			)
		`, fileName, legacyPattern).Scan(&alreadyApplied)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", fileName, err)
		}
		if !alreadyApplied && hasSupabaseTracking {
			tsVersion, _, _ := strings.Cut(fileName, "_")
			_ = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1)`, tsVersion).Scan(&alreadyApplied)
		}
		if alreadyApplied {
			continue
		}

		sqlBytes, err := os.ReadFile(filepath.Join(migrationsDir, fileName))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", fileName, err)
		}

		if err := WithTx(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
				return fmt.Errorf("exec %s: %w", fileName, err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, fileName); err != nil {
				return fmt.Errorf("record %s: %w", fileName, err)
			}
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}
