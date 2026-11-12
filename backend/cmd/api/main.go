package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/config"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/admin"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/cart"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/delivery"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/discovery"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/menu"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/orders"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/payments"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/restaurants"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/users"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/mailer"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/paymentgw"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/search"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/telemetry"
)

const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Goodly API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({ url: '/swagger/openapi.yaml', dom_id: '#swagger-ui' });
    };
  </script>
</body>
</html>`

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}

	logger := telemetry.NewLogger("goodly-api", cfg.AppEnv)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("failed to connect postgresql", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if cfg.AutoMigrate {
		if err := database.RunMigrations(ctx, pool, cfg.MigrationsDir); err != nil {
			logger.Error("failed to run migrations", "error", err)
			os.Exit(1)
		}
		logger.Info("database migrations verified")
	}

	rdb, err := platformredis.NewClientWithURL(ctx, cfg.RedisURL, cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		logger.Warn("redis unavailable at startup; rate limiting and revocation degraded", "error", err)
		rdb = nil
	} else {
		defer rdb.Close()
	}

	if cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(middleware.CorrelationID())
	router.Use(middleware.CORS(cfg.FrontendOrigin))
	router.Use(middleware.RequestLogger(logger))

	// Health & Readiness probes
	router.GET("/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "alive", "service": "goodly-api"})
	})
	router.GET("/health/ready", func(c *gin.Context) {
		if err := pool.Ping(c.Request.Context()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not_ready", "postgres": "down"})
			return
		}
		redisState := "up"
		if rdb == nil || rdb.Ping(c.Request.Context()) != nil {
			redisState = "degraded"
		}
		osState := "disabled"
		if cfg.OpenSearchURL != "" {
			if search.NewClient(cfg.OpenSearchURL).Ping(c.Request.Context()) == nil {
				osState = "up"
			} else {
				osState = "degraded"
			}
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready", "postgres": "up", "redis": redisState, "opensearch": osState})
	})

	// OpenAPI & Swagger UI
	router.GET("/swagger/index.html", func(c *gin.Context) {
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(swaggerHTML))
	})
	router.GET("/swagger/openapi.yaml", func(c *gin.Context) {
		c.File(cfg.OpenAPISpecPath)
	})

	var mailSvc mailer.Mailer
	if cfg.BrevoKey != "" {
		mailSvc = mailer.NewBrevoMailer(cfg.BrevoKey, cfg.BrevoSenderEmail, cfg.BrevoSenderName, logger)
		logger.Info("initialized live Brevo transactional mailer", "sender_email", cfg.BrevoSenderEmail)
	} else {
		mailSvc = mailer.NewMockMailer(logger)
		logger.Info("BREVO_KEY unset; using in-memory dev transactional mailer")
	}

	// Phase 2 & 3 Modules: Auth, Users, Restaurants, Menu, Discovery, Cart, Orders
	tokens := auth.NewTokenManager(cfg.JWTAccessSecret, cfg.JWTAccessTTL, cfg.RefreshTokenTTL)
	authRepo := auth.NewRepository(pool)
	authSvc := auth.NewService(authRepo, tokens, rdb, cfg.AppEnv)
	authSvc.SetMailer(mailSvc)
	authHandler := auth.NewHandler(authSvc, tokens, rdb, cfg.CookieSecure)

	usersRepo := users.NewRepository(pool)
	usersHandler := users.NewHandler(usersRepo, tokens, rdb)

	restRepo := restaurants.NewRepository(pool)
	restHandler := restaurants.NewHandler(restRepo, tokens, rdb)
	restHandler.SetMailer(mailSvc)

	searchClient := search.NewClient(cfg.OpenSearchURL)
	if searchClient != nil {
		if err := searchClient.ReindexAll(ctx, pool); err != nil {
			logger.Warn("opensearch initial index sync deferred", "url", cfg.OpenSearchURL, "error", err)
		} else {
			logger.Info("opensearch indices synced cleanly", "url", cfg.OpenSearchURL)
		}
	}

	menuRepo := menu.NewRepository(pool, rdb)
	menuRepo.SetSearchClient(searchClient)
	menuHandler := menu.NewHandler(menuRepo, restRepo, tokens, rdb)

	discRepo := discovery.NewRepository(pool, menuRepo, rdb)
	discRepo.SetSearchClient(searchClient)
	discHandler := discovery.NewHandler(discRepo)

	cartRepo := cart.NewRepository(pool, cfg.JWTAccessSecret)
	cartHandler := cart.NewHandler(cartRepo, tokens, rdb)

	orderRepo := orders.NewRepository(pool, cartRepo, cfg.JWTAccessSecret)
	orderHandler := orders.NewHandler(orderRepo, restRepo, tokens, rdb)

	var gwProvider paymentgw.Provider
	if cfg.RazorpayKeyID != "" && cfg.RazorpayKeySecret != "" {
		gwProvider = paymentgw.NewRazorpayProvider(cfg.RazorpayKeyID, cfg.RazorpayKeySecret, cfg.RazorpayWebhookSecret)
		logger.Info("initialized live/test Razorpay payment gateway provider")
	} else {
		gwProvider = paymentgw.NewMockProvider(cfg.RazorpayKeySecret, cfg.RazorpayWebhookSecret)
		logger.Info("RAZORPAY_KEY_ID unset; using built-in HMAC-compatible sandbox payment gateway provider")
	}
	payRepo := payments.NewRepository(pool, gwProvider)
	payHandler := payments.NewHandler(payRepo, gwProvider, tokens, rdb)
	payHandler.SetSandboxEnabled(cfg.AppEnv != "production")
	payHandler.SetReconciler(payments.NewReconciler(pool, payRepo, gwProvider, logger))
	payHandler.SetAuthRepository(authRepo)

	delivHandler := delivery.NewHandler(pool, tokens, rdb)
	delivHandler.SetMailer(mailSvc)
	delivHandler.SetOTPSecret(cfg.JWTAccessSecret)
	adminHandler := admin.NewHandler(pool, authRepo, tokens, rdb)
	adminHandler.SetMailer(mailSvc)

	v1 := router.Group("/api/v1")
	authHandler.RegisterRoutes(v1)
	usersHandler.RegisterRoutes(v1)
	restHandler.RegisterRoutes(v1)
	menuHandler.RegisterRoutes(v1)
	discHandler.RegisterRoutes(v1)
	cartHandler.RegisterRoutes(v1)
	orderHandler.RegisterRoutes(v1)
	payHandler.RegisterRoutes(v1)
	delivHandler.RegisterRoutes(v1)
	adminHandler.RegisterRoutes(v1)

	srv := &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("goodly-api listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server exited", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
	logger.Info("goodly-api stopped")
}
