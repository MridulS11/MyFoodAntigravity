package mailer_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/mailer"
)

func TestBrevoMailerSendsAPIKeyAndJSONPayload(t *testing.T) {
	var receivedAPIKey string
	var receivedBody map[string]any

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAPIKey = r.Header.Get("api-key")
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&receivedBody))
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"messageId":"<brevo-msg-123>"}`))
	}))
	defer srv.Close()

	bm := mailer.NewBrevoMailer("xkeysib-test-secret", "noreply@goodly.in", "Goodly", nil).WithEndpoint(srv.URL)
	assert.True(t, bm.IsLive())

	require.NoError(t, bm.SendOTPEmail(context.Background(), "chef@bistro.in", "Chef Vikram", "REGISTER", "654321"))
	assert.Equal(t, "xkeysib-test-secret", receivedAPIKey)
	assert.Contains(t, receivedBody["subject"], "654321")
	assert.Contains(t, receivedBody["htmlContent"], "654321")

	require.NoError(t, bm.SendOnboardingKYCStatusEmail(context.Background(), "rider@goodly.in", "Rohan", "DELIVERY_PARTNER", "Rohan Verma", "APPROVED", "DL & RC verified"))
	assert.Contains(t, receivedBody["subject"], "APPROVED")
	assert.Contains(t, receivedBody["htmlContent"], "DL &amp; RC verified")
}
