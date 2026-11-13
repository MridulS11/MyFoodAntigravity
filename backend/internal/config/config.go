package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration loaded from environment variables and optional .env files.
type Config struct {
	AppEnv                string
	HTTPAddr              string
	WSAddr                string
	DatabaseURL           string
	RedisURL              string
	RedisAddr             string
	RedisPassword         string
	RabbitMQURL           string
	OpenSearchURL         string
	JWTAccessSecret       string
	JWTAccessTTL          time.Duration
	RefreshTokenTTL       time.Duration
	CookieSecure          bool
	FrontendOrigin        string
	MigrationsDir         string
	OpenAPISpecPath       string
	AutoMigrate           bool
	PaymentProvider       string
	RazorpayKeyID         string
	RazorpayKeySecret     string
	RazorpayWebhookSecret string
	BrevoKey              string
	BrevoSenderEmail      string
	BrevoSenderName       string
	R2AccountID           string
	R2AccessKeyID         string
	R2SecretAccessKey     string
	R2Bucket              string
	R2PublicURL           string
}

// Load reads .env (without overriding already-exported env vars) and populates Config.
func Load() (*Config, error) {
	loadDotEnv(".env")

	appEnv := getEnv("APP_ENV", "development")
	migrationsDir := getEnv("MIGRATIONS_DIR", "../supabase/migrations")
	if migrationsDir == "migrations" {
		if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
			if _, supaErr := os.Stat("../supabase/migrations"); supaErr == nil {
				migrationsDir = "../supabase/migrations"
			}
		}
	}
	autoMigrate := getEnvBool("AUTO_MIGRATE", appEnv != "production")
	if appEnv == "production" {
		// Production schema changes are managed exclusively by Supabase CLI / GitHub Actions.
		autoMigrate = false
	}

	cfg := &Config{
		AppEnv:                appEnv,
		HTTPAddr:              getEnv("HTTP_ADDR", ":8080"),
		WSAddr:                getEnv("WS_ADDR", ":8081"),
		DatabaseURL:           getEnv("DATABASE_URL", "postgres://goodly:goodly_secret@localhost:5432/goodly_db?sslmode=disable"),
		RedisURL:              strings.TrimSpace(os.Getenv("REDIS_URL")),
		RedisAddr:             getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:         getEnv("REDIS_PASSWORD", ""),
		RabbitMQURL:           getEnv("RABBITMQ_URL", "amqp://goodly:goodly_secret@localhost:5672/"),
		OpenSearchURL:         strings.TrimSpace(getEnv("OPENSEARCH_URL", "http://localhost:9200")),
		JWTAccessSecret:       getEnv("JWT_ACCESS_SECRET", "goodly-dev-jwt-secret-change-in-production-32bytes"),
		JWTAccessTTL:          time.Duration(getEnvInt("JWT_ACCESS_TTL_MIN", 15)) * time.Minute,
		RefreshTokenTTL:       time.Duration(getEnvInt("REFRESH_TOKEN_TTL_DAYS", 7)) * 24 * time.Hour,
		CookieSecure:          getEnvBool("COOKIE_SECURE", false),
		FrontendOrigin:        getEnv("FRONTEND_ORIGIN", "http://localhost:3000"),
		MigrationsDir:         migrationsDir,
		OpenAPISpecPath:       getEnv("OPENAPI_SPEC_PATH", "api/openapi/openapi.yaml"),
		AutoMigrate:           autoMigrate,
		PaymentProvider:       getEnv("PAYMENT_PROVIDER", "razorpay"),
		RazorpayKeyID:         strings.TrimSpace(os.Getenv("RAZORPAY_KEY_ID")),
		RazorpayKeySecret:     strings.TrimSpace(os.Getenv("RAZORPAY_KEY_SECRET")),
		RazorpayWebhookSecret: strings.TrimSpace(os.Getenv("RAZORPAY_WEBHOOK_SECRET")),
		BrevoKey:              strings.TrimSpace(os.Getenv("BREVO_KEY")),
		BrevoSenderEmail:      getEnv("BREVO_SENDER_EMAIL", "noreply@goodly.in"),
		BrevoSenderName:       getEnv("BREVO_SENDER_NAME", "Goodly Food Delivery"),
		R2AccountID:           strings.TrimSpace(os.Getenv("R2_ACCOUNT_ID")),
		R2AccessKeyID:         strings.TrimSpace(os.Getenv("R2_ACCESS_KEY_ID")),
		R2SecretAccessKey:     strings.TrimSpace(os.Getenv("R2_SECRET_ACCESS_KEY")),
		R2Bucket:              getEnv("R2_BUCKET", "goodly-media"),
		R2PublicURL:           strings.TrimRight(strings.TrimSpace(os.Getenv("R2_PUBLIC_URL")), "/"),
	}

	if cfg.AppEnv == "production" && len(cfg.JWTAccessSecret) < 32 {
		return nil, fmt.Errorf("JWT_ACCESS_SECRET must be at least 32 characters in production")
	}
	return cfg, nil
}

func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		v = strings.Trim(v, `"'`)
		if k != "" && os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.ParseBool(v); err == nil {
			return parsed
		}
	}
	return fallback
}
