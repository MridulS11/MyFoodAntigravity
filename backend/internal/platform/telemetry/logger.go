package telemetry

import (
	"log/slog"
	"os"
)

// NewLogger constructs a structured JSON slog logger scoped to the service environment.
func NewLogger(serviceName, appEnv string) *slog.Logger {
	level := slog.LevelInfo
	if appEnv == "development" {
		level = slog.LevelDebug
	}
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})
	return slog.New(handler).With("service", serviceName, "env", appEnv)
}
