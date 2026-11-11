package paymentgw

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// RazorpayProvider integrates with Razorpay v1 REST Orders, Payments, Refunds, and HMAC Webhooks.
type RazorpayProvider struct {
	keyID         string
	keySecret     string
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// NewRazorpayProvider creates a live/sandbox Razorpay adapter.
func NewRazorpayProvider(keyID, keySecret, webhookSecret string) *RazorpayProvider {
	return &RazorpayProvider{
		keyID:         keyID,
		keySecret:     keySecret,
		webhookSecret: webhookSecret,
		baseURL:       "https://api.razorpay.com/v1",
		httpClient:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (p *RazorpayProvider) Name() string      { return "RAZORPAY" }
func (p *RazorpayProvider) PublicKey() string { return p.keyID }

func (p *RazorpayProvider) SignCallback(providerOrderID, providerPaymentID string) string {
	if p.keySecret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(p.keySecret))
	mac.Write([]byte(providerOrderID + "|" + providerPaymentID))
	return hex.EncodeToString(mac.Sum(nil))
}

func (p *RazorpayProvider) CreateOrder(ctx context.Context, receiptOrderNum string, amountMinor int64, currency string) (*GatewayOrder, error) {
	payload := map[string]any{
		"amount":   amountMinor,
		"currency": currency,
		"receipt":  receiptOrderNum,
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/orders", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(p.keyID, p.keySecret)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("razorpay create order error (%d): %s", resp.StatusCode, string(respBytes))
	}

	var parsed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return nil, err
	}
	return &GatewayOrder{
		ProviderOrderID: parsed.ID,
		PublicKey:       p.keyID,
		ProviderName:    p.Name(),
	}, nil
}

func (p *RazorpayProvider) VerifyClientCallbackSignature(providerOrderID, providerPaymentID, signature string) bool {
	if p.keySecret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(p.keySecret))
	mac.Write([]byte(providerOrderID + "|" + providerPaymentID))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func (p *RazorpayProvider) VerifyWebhookSignature(rawBody []byte, signatureHeader string) bool {
	if p.webhookSecret == "" || signatureHeader == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(p.webhookSecret))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signatureHeader))
}

func (p *RazorpayProvider) FetchOrderPayments(ctx context.Context, providerOrderID string) ([]GatewayPaymentSnapshot, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/orders/"+providerOrderID+"/payments", nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(p.keyID, p.keySecret)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("razorpay fetch order payments error (%d): %s", resp.StatusCode, string(respBytes))
	}

	var parsed struct {
		Items []struct {
			ID      string `json:"id"`
			OrderID string `json:"order_id"`
			Status  string `json:"status"`
			Method  string `json:"method"`
			Amount  int64  `json:"amount"`
		} `json:"items"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return nil, err
	}

	out := make([]GatewayPaymentSnapshot, 0, len(parsed.Items))
	for _, it := range parsed.Items {
		out = append(out, GatewayPaymentSnapshot{
			ProviderOrderID:   it.OrderID,
			ProviderPaymentID: it.ID,
			Status:            it.Status,
			Method:            it.Method,
			AmountMinor:       it.Amount,
		})
	}
	return out, nil
}

func (p *RazorpayProvider) IssueRefund(ctx context.Context, providerPaymentID string, amountMinor int64, notes string) (*GatewayRefund, error) {
	// Dev/sandbox payments created via /customer/payments/sandbox-capture use pay_sandbox_* / pay_mock_* IDs
	// and must resolve cleanly without calling live Razorpay's external refund API.
	if strings.HasPrefix(providerPaymentID, "pay_sandbox_") || strings.HasPrefix(providerPaymentID, "pay_mock_") {
		suffix := strings.TrimPrefix(strings.TrimPrefix(providerPaymentID, "pay_sandbox_"), "pay_mock_")
		return &GatewayRefund{
			ProviderRefundID: "rfnd_sandbox_" + suffix,
			Status:           "processed",
		}, nil
	}
	payload := map[string]any{
		"amount": amountMinor,
		"notes":  map[string]string{"reason": notes},
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/payments/"+providerPaymentID+"/refund", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(p.keyID, p.keySecret)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("razorpay refund error (%d): %s", resp.StatusCode, string(respBytes))
	}

	var parsed struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return nil, err
	}
	return &GatewayRefund{
		ProviderRefundID: parsed.ID,
		Status:           parsed.Status,
	}, nil
}
