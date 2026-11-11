package paymentgw

import "context"

// GatewayOrder represents an initialized payment order on the external gateway.
type GatewayOrder struct {
	ProviderOrderID string
	PublicKey       string
	ProviderName    string
}

// GatewayPaymentSnapshot describes an upstream payment record queried during reconciliation.
type GatewayPaymentSnapshot struct {
	ProviderOrderID   string
	ProviderPaymentID string
	Status            string // created, authorized, captured, failed, refunded
	Method            string // upi, card, netbanking, wallet
	AmountMinor       int64
}

// GatewayRefund represents an executed gateway refund transaction.
type GatewayRefund struct {
	ProviderRefundID string
	Status           string // processed, pending, failed
}

// Provider defines the pluggable payment gateway interface (Razorpay, Cashfree, Mock Sandbox).
type Provider interface {
	Name() string
	PublicKey() string
	CreateOrder(ctx context.Context, receiptOrderNum string, amountMinor int64, currency string) (*GatewayOrder, error)
	VerifyClientCallbackSignature(providerOrderID, providerPaymentID, signature string) bool
	SignCallback(providerOrderID, providerPaymentID string) string
	VerifyWebhookSignature(rawBody []byte, signatureHeader string) bool
	FetchOrderPayments(ctx context.Context, providerOrderID string) ([]GatewayPaymentSnapshot, error)
	IssueRefund(ctx context.Context, providerPaymentID string, amountMinor int64, notes string) (*GatewayRefund, error)
}
