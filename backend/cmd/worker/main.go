package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/config"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/orders"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/payments"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/outbox"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/paymentgw"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/rabbitmq"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/telemetry"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	logger := telemetry.NewLogger("goodly-worker", cfg.AppEnv)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		logger.Error("worker failed to connect postgresql", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	rmq, err := rabbitmq.Connect(cfg.RabbitMQURL)
	if err != nil {
		logger.Warn("rabbitmq unavailable at worker startup; outbox relay disabled", "error", err)
		rmq = nil
	} else {
		defer rmq.Close()
		logger.Info("connected to rabbitmq exchange", "exchange", rabbitmq.EventsExchange)
	}

	workerCtx, workerCancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer workerCancel()

	if rmq != nil {
		relay := outbox.NewRelay(pool, rmq, logger)
		go relay.Run(workerCtx, 1*time.Second)
	}

	timeoutWorker := orders.NewTimeoutWorker(pool, logger)
	go timeoutWorker.Run(workerCtx, 10*time.Second)

	var gwProvider paymentgw.Provider
	if cfg.RazorpayKeyID != "" && cfg.RazorpayKeySecret != "" {
		gwProvider = paymentgw.NewRazorpayProvider(cfg.RazorpayKeyID, cfg.RazorpayKeySecret, cfg.RazorpayWebhookSecret)
	} else {
		gwProvider = paymentgw.NewMockProvider(cfg.RazorpayKeySecret, cfg.RazorpayWebhookSecret)
	}
	payRepo := payments.NewRepository(pool, gwProvider)
	reconciler := payments.NewReconciler(pool, payRepo, gwProvider, logger)
	go reconciler.Run(workerCtx, 30*time.Second, 2*time.Minute)

	logger.Info("goodly-worker running outbox relay + 5m acceptance timeout monitor + payment reconciler")
	<-workerCtx.Done()
	logger.Info("goodly-worker stopped")
}
