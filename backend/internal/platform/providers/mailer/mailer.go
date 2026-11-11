package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// EmailMessage represents an outgoing transactional email payload.
type EmailMessage struct {
	ToEmail     string
	ToName      string
	Subject     string
	HTMLContent string
	TextContent string
}

// Mailer abstracts transactional email delivery (Brevo API or local mock logger).
type Mailer interface {
	ProviderName() string
	IsLive() bool
	Send(ctx context.Context, msg EmailMessage) error
	SendOTPEmail(ctx context.Context, toEmail, toName, purpose, otpCode string) error
	SendOnboardingKYCStatusEmail(ctx context.Context, toEmail, toName, entityKind, entityName, status, notes string) error
}

// BrevoMailer sends transactional emails using Brevo's v3 SMTP HTTP API with BREVO_KEY.
type BrevoMailer struct {
	apiKey      string
	senderEmail string
	senderName  string
	endpoint    string
	client      *http.Client
	logger      *slog.Logger
}

// NewBrevoMailer constructs a live Brevo API mailer using BREVO_KEY.
func NewBrevoMailer(apiKey, senderEmail, senderName string, logger *slog.Logger) *BrevoMailer {
	if senderEmail == "" {
		senderEmail = "noreply@goodly.in"
	}
	if senderName == "" {
		senderName = "Goodly Food Delivery"
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &BrevoMailer{
		apiKey:      strings.TrimSpace(apiKey),
		senderEmail: strings.TrimSpace(senderEmail),
		senderName:  strings.TrimSpace(senderName),
		endpoint:    "https://api.brevo.com/v3/smtp/email",
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        20,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
				ForceAttemptHTTP2:   true,
			},
		},
		logger: logger,
	}
}

// DispatchAsyncOrSync runs fn synchronously for in-memory MockMailer (deterministic tests)
// and in a non-blocking HTTP/2 background goroutine for live BrevoMailer so API responses do not stall.
func DispatchAsyncOrSync(ctx context.Context, m Mailer, warnMsg string, fn func(sendCtx context.Context) error) {
	if m == nil {
		return
	}
	if !m.IsLive() {
		if err := fn(ctx); err != nil {
			slog.Default().Warn(warnMsg, "error", err)
		}
		return
	}
	detached := context.WithoutCancel(ctx)
	go func() {
		sendCtx, cancel := context.WithTimeout(detached, 10*time.Second)
		defer cancel()
		if err := fn(sendCtx); err != nil {
			slog.Default().Warn(warnMsg, "error", err)
		}
	}()
}

// WithEndpoint overrides the HTTP endpoint (used by unit tests against httptest.Server).
func (b *BrevoMailer) WithEndpoint(endpoint string) *BrevoMailer {
	b.endpoint = endpoint
	return b
}

func (b *BrevoMailer) ProviderName() string { return "BREVO" }
func (b *BrevoMailer) IsLive() bool         { return b.apiKey != "" }

func (b *BrevoMailer) Send(ctx context.Context, msg EmailMessage) error {
	if strings.TrimSpace(msg.ToEmail) == "" {
		return nil
	}
	toName := strings.TrimSpace(msg.ToName)
	if toName == "" {
		toName = msg.ToEmail
	}

	payload := map[string]any{
		"sender": map[string]string{
			"name":  b.senderName,
			"email": b.senderEmail,
		},
		"to": []map[string]string{
			{"email": strings.TrimSpace(msg.ToEmail), "name": toName},
		},
		"subject":     msg.Subject,
		"htmlContent": msg.HTMLContent,
		"textContent": msg.TextContent,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("api-key", b.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("brevo request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("brevo API error (%d): %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	b.logger.Info("brevo email dispatched", "to", msg.ToEmail, "subject", msg.Subject)
	return nil
}

func (b *BrevoMailer) SendOTPEmail(ctx context.Context, toEmail, toName, purpose, otpCode string) error {
	return b.Send(ctx, buildOTPEmail(toEmail, toName, purpose, otpCode))
}

func (b *BrevoMailer) SendOnboardingKYCStatusEmail(ctx context.Context, toEmail, toName, entityKind, entityName, status, notes string) error {
	return b.Send(ctx, buildKYCStatusEmail(toEmail, toName, entityKind, entityName, status, notes))
}

// MockMailer captures emails in memory & logs when BREVO_KEY is unset during local development or tests.
type MockMailer struct {
	logger     *slog.Logger
	mu         sync.Mutex
	SentEmails []EmailMessage
}

// NewMockMailer initializes a thread-safe local email capture mailer.
func NewMockMailer(logger *slog.Logger) *MockMailer {
	if logger == nil {
		logger = slog.Default()
	}
	return &MockMailer{logger: logger}
}

func (m *MockMailer) ProviderName() string { return "MOCK_BREVO" }
func (m *MockMailer) IsLive() bool         { return false }

func (m *MockMailer) Send(_ context.Context, msg EmailMessage) error {
	m.mu.Lock()
	m.SentEmails = append(m.SentEmails, msg)
	m.mu.Unlock()
	m.logger.Info("mock email captured (set BREVO_KEY for live Brevo delivery)", "to", msg.ToEmail, "subject", msg.Subject)
	return nil
}

func (m *MockMailer) SendOTPEmail(ctx context.Context, toEmail, toName, purpose, otpCode string) error {
	return m.Send(ctx, buildOTPEmail(toEmail, toName, purpose, otpCode))
}

func (m *MockMailer) SendOnboardingKYCStatusEmail(ctx context.Context, toEmail, toName, entityKind, entityName, status, notes string) error {
	return m.Send(ctx, buildKYCStatusEmail(toEmail, toName, entityKind, entityName, status, notes))
}

func buildOTPEmail(toEmail, toName, purpose, otpCode string) EmailMessage {
	safeName := html.EscapeString(toName)
	if safeName == "" {
		safeName = "there"
	}
	safePurpose := html.EscapeString(strings.ReplaceAll(strings.ToLower(purpose), "_", " "))
	safeCode := html.EscapeString(otpCode)
	subject := fmt.Sprintf("Your Goodly verification code: %s", otpCode)
	text := fmt.Sprintf("Hi %s,\n\nYour Goodly %s verification OTP is: %s\nThis code expires in 10 minutes.\n", toName, safePurpose, otpCode)
	htmlBody := fmt.Sprintf(
		`<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#FCF9F0;border:1px solid #E8E3D5;border-radius:12px;">
			<h2 style="margin:0 0 12px;color:#1E1F1C;">Goodly Verification Code</h2>
			<p style="color:#5E5D57;font-size:14px;">Hi %s,</p>
			<p style="color:#5E5D57;font-size:14px;">Use this one-time code to complete your <strong>%s</strong> verification:</p>
			<div style="margin:18px 0;padding:14px;text-align:center;background:#DEC146;color:#1E1F1C;font-size:24px;font-weight:800;letter-spacing:6px;border-radius:10px;">%s</div>
			<p style="color:#8A8880;font-size:12px;">This OTP expires in 10 minutes. Never share it with anyone.</p>
		</div>`,
		safeName, safePurpose, safeCode,
	)
	return EmailMessage{
		ToEmail:     toEmail,
		ToName:      toName,
		Subject:     subject,
		HTMLContent: htmlBody,
		TextContent: text,
	}
}

func buildKYCStatusEmail(toEmail, toName, entityKind, entityName, status, notes string) EmailMessage {
	kindLabel := "Partner Onboarding"
	if entityKind == "RESTAURANT_OUTLET" {
		kindLabel = "Restaurant Outlet Onboarding & KYC"
	} else if entityKind == "DELIVERY_PARTNER" {
		kindLabel = "Delivery Courier Onboarding & KYC"
	}
	statusHeadline := fmt.Sprintf("%s — Status: %s", entityName, status)
	subject := fmt.Sprintf("[Goodly] %s (%s)", kindLabel, status)
	safeNotes := html.EscapeString(notes)
	if safeNotes == "" {
		safeNotes = "No additional notes provided."
	}
	text := fmt.Sprintf("Hi %s,\n\n%s\nStatus: %s\nDetails: %s\n", toName, kindLabel, status, notes)
	htmlBody := fmt.Sprintf(
		`<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#FCF9F0;border:1px solid #E8E3D5;border-radius:12px;">
			<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#5F8E63;text-transform:uppercase;">%s</div>
			<h2 style="margin:6px 0 12px;color:#1E1F1C;">%s</h2>
			<p style="color:#5E5D57;font-size:14px;">Hi %s,</p>
			<p style="color:#5E5D57;font-size:14px;">Your onboarding &amp; KYC status is now <strong>%s</strong>.</p>
			<p style="color:#5E5D57;font-size:13px;background:#FFFFFF;padding:12px;border-radius:8px;border:1px solid #E8E3D5;">%s</p>
		</div>`,
		html.EscapeString(kindLabel), html.EscapeString(statusHeadline), html.EscapeString(toName), html.EscapeString(status), safeNotes,
	)
	return EmailMessage{
		ToEmail:     toEmail,
		ToName:      toName,
		Subject:     subject,
		HTMLContent: htmlBody,
		TextContent: text,
	}
}
