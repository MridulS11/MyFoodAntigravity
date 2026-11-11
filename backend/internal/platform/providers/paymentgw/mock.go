package paymentgw

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"sync"

	"github.com/google/uuid"
)

// MockProvider simulates Razorpay-style HMAC signatures & upstream state locally for tests & offline dev.
type MockProvider struct {
	keySecret     string
	webhookSecret string
	publicKey     string

	mu       sync.Mutex
	upstream map[string][]GatewayPaymentSnapshot // providerOrderID -> snapshots
}

// NewMockProvider initializes a local HMAC-capable payment gateway sandbox.
func NewMockProvider(keySecret, webhookSecret string) *MockProvider {
	if keySecret == "" {
		keySecret = "mock_rzp_key_secret_dev"
	}
	if webhookSecret == "" {
		webhookSecret = "mock_rzp_webhook_secret_dev"
	}
	return &MockProvider{
		keySecret:     keySecret,
		webhookSecret: webhookSecret,
		publicKey:     "rzp_test_local_sandbox",
		upstream:      make(map[string][]GatewayPaymentSnapshot),
	}
}

func (m *MockProvider) Name() string      { return "RAZORPAY" }
func (m *MockProvider) PublicKey() string { return m.publicKey }

func (m *MockProvider) CreateOrder(_ context.Context, _ string, _ int64, _ string) (*GatewayOrder, error) {
	return &GatewayOrder{
		ProviderOrderID: "order_mock_" + uuid.NewString()[:12],
		PublicKey:       m.publicKey,
		ProviderName:    m.Name(),
	}, nil
}

func (m *MockProvider) VerifyClientCallbackSignature(providerOrderID, providerPaymentID, signature string) bool {
	return hmac.Equal([]byte(m.SignCallback(providerOrderID, providerPaymentID)), []byte(signature))
}

func (m *MockProvider) VerifyWebhookSignature(rawBody []byte, signatureHeader string) bool {
	return hmac.Equal([]byte(m.SignWebhook(rawBody)), []byte(signatureHeader))
}

// SignCallback helper generates a valid client verification HMAC for tests.
func (m *MockProvider) SignCallback(providerOrderID, providerPaymentID string) string {
	mac := hmac.New(sha256.New, []byte(m.keySecret))
	mac.Write([]byte(providerOrderID + "|" + providerPaymentID))
	return hex.EncodeToString(mac.Sum(nil))
}

// SignWebhook helper generates a valid X-Razorpay-Signature header for tests.
func (m *MockProvider) SignWebhook(rawBody []byte) string {
	mac := hmac.New(sha256.New, []byte(m.webhookSecret))
	mac.Write(rawBody)
	return hex.EncodeToString(mac.Sum(nil))
}

// SeedUpstreamPayment registers an upstream captured payment (simulating lost webhook recovery).
func (m *MockProvider) SeedUpstreamPayment(snap GatewayPaymentSnapshot) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.upstream[snap.ProviderOrderID] = append(m.upstream[snap.ProviderOrderID], snap)
}

func (m *MockProvider) FetchOrderPayments(_ context.Context, providerOrderID string) ([]GatewayPaymentSnapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	list := m.upstream[providerOrderID]
	out := make([]GatewayPaymentSnapshot, len(list))
	copy(out, list)
	return out, nil
}

func (m *MockProvider) IssueRefund(_ context.Context, _ string, _ int64, _ string) (*GatewayRefund, error) {
	return &GatewayRefund{
		ProviderRefundID: "rfnd_mock_" + uuid.NewString()[:12],
		Status:           "processed",
	}, nil
}
