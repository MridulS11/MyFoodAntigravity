.PHONY: up down ps logs migrate-up migrate-down db-seed db-reset-test test test-unit test-int run-api run-ws run-worker build

APP_ENV ?= development
DATABASE_URL ?= postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable

up:
	docker compose up -d

down:
	docker compose down

ps:
	docker compose ps

logs:
	docker compose logs -f

build:
	go build -o bin/api ./cmd/api
	go build -o bin/ws ./cmd/ws
	go build -o bin/worker ./cmd/worker
	go build -o bin/seed ./cmd/seed

run-api:
	go run ./cmd/api

run-ws:
	go run ./cmd/ws

run-worker:
	go run ./cmd/worker

db-seed:
	APP_ENV=$(APP_ENV) DATABASE_URL="$(DATABASE_URL)" go run ./cmd/seed --action=seed

db-reset-test:
	@if [ "$(APP_ENV)" = "production" ] || [ "$(APP_ENV)" = "prod" ]; then \
		echo "REFUSING to run db-reset-test in production!"; exit 1; \
	fi
	APP_ENV=test DATABASE_URL="$(DATABASE_URL)" go run ./cmd/seed --action=reset

test:
	go test -race ./...

test-unit:
	go test -race -short ./...

test-int:
	go test -race -v ./internal/... -run Integration
