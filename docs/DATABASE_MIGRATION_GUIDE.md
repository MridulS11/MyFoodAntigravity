# Goodly Database Migration Architecture & Operations Guide

## 1. Final Migration Architecture
Goodly uses **Supabase CLI migrations** (`supabase/migrations/`) as the **single canonical source of truth** for all PostgreSQL schema changes across local development, CI, staging/preview environments, and production.

- **Schema authority**: Supabase CLI (`supabase db push`) via GitHub Actions ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)).
- **Tracking table**: `supabase_migrations.schema_migrations` (managed by Supabase CLI).
- **Application runtime (`cmd/api`)**: **Never runs production migrations.** `AUTO_MIGRATE` defaults to `false` in `APP_ENV=production` and is explicitly forced off in [`backend/internal/config/config.go`](../backend/internal/config/config.go).
- **Legacy `backend/migrations/`**: Removed to eliminate duplicate/competing migration histories.

---

## 2. Why Supabase CLI Is the Canonical System
1. Eliminates split-brain tracking between Go's `public.schema_migrations` and Supabase's `supabase_migrations.schema_migrations`.
2. Prevents multiple API/worker containers from racing to alter production tables during rolling deploys.
3. Integrates natively with Supabase Postgres 17, GitHub Actions (`supabase/setup-cli@v1`), and safe remote history inspection (`supabase migration list`, `supabase migration repair`).

---

## 3. Repository Directory Structure
```text
goodly-food-delivery/
├── supabase/
│   ├── config.toml                  # Supabase CLI configuration (Postgres major_version = 17)
│   └── migrations/                  # SINGLE CANONICAL MIGRATION SOURCE (14-digit timestamp_*.sql)
│       ├── 20261112000100_extensions_and_types.sql
│       ├── ...
│       └── 20261112002000_order_delivery_otp_hint.sql
├── backend/
│   ├── cmd/                         # api, worker, ws, seed
│   ├── internal/
│   │   ├── config/config.go         # Forces AUTO_MIGRATE=false when APP_ENV=production
│   │   └── platform/database/       # pgxpool + RunMigrations (local/test compatibility only)
│   └── docker-compose.yml           # Local PostGIS, Redis, RabbitMQ, OpenSearch
├── web/                             # Next.js frontend (Vercel)
├── docs/
│   └── DATABASE_MIGRATION_GUIDE.md
└── .github/workflows/
    ├── ci.yml                       # PR/push validation: disposable DB init + Go unit/race + frontend
    └── deploy.yml                   # Production migration deployment (main branch, protected environment)
```

---

## 4. Installing & Configuring Supabase CLI (macOS / zsh)
```zsh
brew install supabase/tap/supabase
supabase --version
```
To link your local CLI to the hosted Supabase project (interactive):
```zsh
cd /Users/m/.gemini/antigravity/scratch/goodly-food-delivery
supabase login
supabase link --project-ref edstrfhxjxtaoyvjbeui
```

---

## 5. Creating a New Migration
Always generate new migrations with the Supabase CLI so timestamps are strictly ordered:
```zsh
cd /Users/m/.gemini/antigravity/scratch/goodly-food-delivery
supabase migration new add_driver_shift_windows
```
Edit the generated `supabase/migrations/<YYYYMMDDHHMMSS>_add_driver_shift_windows.sql` file with forward SQL.

---

## 6. Applying Migrations Locally
Start local Docker dependencies (`goodly-postgres`, `goodly-redis`, `goodly-rabbitmq`, `goodly-opensearch`):
```zsh
cd /Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend
docker compose up -d
```
Apply canonical migrations via Supabase CLI to your local Docker Postgres:
```zsh
cd /Users/m/.gemini/antigravity/scratch/goodly-food-delivery
supabase db push --db-url "postgres://goodly:goodly_secret@127.0.0.1:5432/goodly_db?sslmode=disable" --include-all --yes
```
*(Or start full local Supabase stack with `supabase start` and push via `supabase db push --local`.)*

---

## 7. Running Go Integration Tests
Go integration tests read `supabase/migrations/` cleanly against a local/disposable PostGIS database:
```zsh
cd /Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend
go test -short ./...
DATABASE_URL="postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable" go test -p 1 -count=1 -race ./...
```

---

## 8. Validating Migrations Before Pushing
1. Check filename format (`<14-digit-timestamp>_<snake_case>.sql`) and sort order:
   ```zsh
   ls -1 /Users/m/.gemini/antigravity/scratch/goodly-food-delivery/supabase/migrations
   ```
2. Test on a disposable local database:
   ```zsh
   docker exec goodly-postgres psql -U goodly -d goodly_db -c "CREATE DATABASE goodly_mig_check;"
   supabase db push --db-url "postgres://goodly:goodly_secret@127.0.0.1:5432/goodly_mig_check?sslmode=disable" --include-all --yes
   docker exec goodly-postgres psql -U goodly -d goodly_db -c "DROP DATABASE goodly_mig_check;"
   ```

---

## 9. How Migrations Reach Production (and Vercel Sequencing)
- **Single Production Authority**: `.github/workflows/deploy.yml` runs on `push` to `main` (when `supabase/**` changes) under the protected `production` GitHub environment with `concurrency` locking.
- **Do NOT enable automatic migration execution in Supabase's native Dashboard GitHub Integration simultaneously** if `.github/workflows/deploy.yml` is active — keep **one** deployment authority (GitHub Actions `deploy.yml`).
- **Vercel / Backend Deploy Order**:
  1. Merge PR to `main`.
  2. `deploy.yml` applies backward-compatible (expand-and-contract) migrations to Supabase first.
  3. Vercel deploys the frontend (`web/`) and the Go backend rolls out with `AUTO_MIGRATE=false`.

---

## 10. Inspecting Migration History
```zsh
supabase migration list
```
Look for matching `local` and `remote` 14-digit timestamps across every row.

---

## 11. Recovering From Failed Migration Deployments
1. Never edit an already-applied migration file on `main`.
2. Inspect the failed statement in GitHub Actions logs or `supabase migration list`.
3. Fix the database state manually or via a new forward-fix migration (`supabase migration new fix_...`).
4. If a half-applied version needs status correction in `supabase_migrations.schema_migrations`:
   ```zsh
   supabase migration repair --status reverted <VERSION>
   # or after manually completing the DDL:
   supabase migration repair --status applied <VERSION>
   ```

---

## 12. Backups & Restoration
- **Before risky schema changes**: Create a logical backup from Supabase (using your direct/session URI):
  ```zsh
  pg_dump "$DATABASE_URL" --schema=public --format=custom --file="backup_$(date +%Y%m%d_%H%M%S).dump"
  ```
- **Restore**:
  ```zsh
  pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --no-privileges backup_YYYYMMDD_HHMMSS.dump
  ```
- *(Note: Automated daily backups & Point-in-Time Recovery (PITR) on Supabase require a paid Pro/Team plan.)*

---

## 13. Preview & Local Environments (Free vs. Pro Plan)
- **Supabase Free Plan**:
  - **GitHub PR Database Branching is NOT included** on the Free plan (it requires a Supabase Pro plan or higher).
  - **Recommended Free-tier alternative**: Run PR validation against disposable PostGIS databases in GitHub Actions CI (`ci.yml`) and local Docker `goodly-postgres` (`supabase db push --db-url ...`).
- **Supabase Pro Plan (when upgraded)**:
  - Supports isolated per-PR Preview Branches; if enabled later, disable duplicate migration runs in `deploy.yml` or scope `deploy.yml` strictly to `main` while branching handles PRs.

---

## 14. Avoiding Breaking Changes (Expand-and-Contract)
Because production Go servers and Vercel frontends may run concurrently with a migration:
1. **Expand**: Add new nullable columns / tables / dual-write triggers first.
2. **Deploy app code**: Roll out Go & Next.js code reading/writing the new columns.
3. **Contract**: Only in a **later** migration, enforce `NOT NULL` or drop deprecated columns after confirming zero old-version traffic remains.

---

## 15. Reconciling the Historical 20 Go Migrations
The original 20 Go migrations (`000001`–`000020`, previously tracked in `public.schema_migrations`) were migrated 1:1 to `supabase/migrations/20261112000100`–`20261112002000`, verified from scratch on a disposable PostGIS database, and registered in `supabase_migrations.schema_migrations` on `DineHub` (`edstrfhxjxtaoyvjbeui`) via `supabase migration repair --status applied` without re-executing DDL or disturbing existing data.
