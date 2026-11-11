package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/config"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/telemetry"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	logger := telemetry.NewLogger("goodly-ws", cfg.AppEnv)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	rdb, err := platformredis.NewClient(ctx, cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		logger.Warn("redis unavailable for ws hub", "error", err)
	} else {
		defer rdb.Close()
	}

	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "alive", "service": "goodly-ws"})
	})
	router.GET("/health/ready", func(c *gin.Context) {
		if rdb == nil || rdb.Ping(c.Request.Context()) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not_ready"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready", "redis": "up"})
	})

	srv := &http.Server{
		Addr:    cfg.WSAddr,
		Handler: router,
	}

	go func() {
		logger.Info("goodly-ws listening", "addr", cfg.WSAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("ws server exited", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
	logger.Info("goodly-ws stopped")
}
