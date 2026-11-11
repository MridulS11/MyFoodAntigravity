package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestCorrelationIDAndCORS(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CorrelationID())
	r.Use(CORS("http://localhost:3000"))
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"cid": GetCorrelationID(c)})
	})

	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.NotEmpty(t, w.Header().Get("X-Correlation-ID"))
	assert.Equal(t, "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))

	reqCustom := httptest.NewRequest(http.MethodGet, "/ping", nil)
	reqCustom.Header.Set("X-Correlation-ID", "cid-trace-1234")
	wCustom := httptest.NewRecorder()
	r.ServeHTTP(wCustom, reqCustom)
	assert.Equal(t, "cid-trace-1234", wCustom.Header().Get("X-Correlation-ID"))
}
