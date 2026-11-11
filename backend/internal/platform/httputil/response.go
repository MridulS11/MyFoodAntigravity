package httputil

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/middleware"
)

// OK writes a standard 200 OK JSON envelope.
func OK(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    data,
		"meta": gin.H{
			"correlation_id": middleware.GetCorrelationID(c),
		},
	})
}

// Created writes a standard 201 Created JSON envelope.
func Created(c *gin.Context, data any) {
	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data":    data,
		"meta": gin.H{
			"correlation_id": middleware.GetCorrelationID(c),
		},
	})
}

// Fail writes a standardized error JSON envelope matching API_SPECIFICATION.md.
func Fail(c *gin.Context, status int, code, message string, details any) {
	errObj := gin.H{
		"code":           code,
		"message":        message,
		"correlation_id": middleware.GetCorrelationID(c),
	}
	if details != nil {
		errObj["details"] = details
	}
	c.JSON(status, gin.H{
		"success": false,
		"error":   errObj,
	})
}
