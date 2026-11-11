package payments

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/paymentgw"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

// Handler exposes /api/v1/payments/*, /api/v1/admin/payments/*, and /api/v1/admin/refunds endpoints.
type Handler struct {
	repo           *Repository
	provider       paymentgw.Provider
	tokens         *auth.TokenManager
	rdb            *platformredis.Client
	authRepo       *auth.Repository
	reconciler     *Reconciler
	sandboxEnabled bool
}

// NewHandler creates a payments Handler.
func NewHandler(repo *Repository, provider paymentgw.Provider, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{repo: repo, provider: provider, tokens: tokens, rdb: rdb}
}

// SetSandboxEnabled enables dev/sandbox capture and failure simulation routes (non-production only).
func (h *Handler) SetSandboxEnabled(enabled bool) {
	h.sandboxEnabled = enabled
}

// SetReconciler attaches a reconciler instance used by admin manual reconciliation sweeps.
func (h *Handler) SetReconciler(rec *Reconciler) {
	h.reconciler = rec
}

// SetAuthRepository enables live DB RBAC permission checks on admin payment & refund endpoints.
func (h *Handler) SetAuthRepository(repo *auth.Repository) {
	h.authRepo = repo
}

// RegisterRoutes attaches payment initiation, verification, webhook, history, reconciliation, and admin refund routes.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	pay := v1.Group("/payments")
	{
		pay.POST("/webhooks/:provider", h.handleWebhook)
		pay.POST("/initiate", auth.RequirePortalAuth(h.tokens, h.rdb, "customer"), h.initiatePayment)
		pay.POST("/verify", auth.RequirePortalAuth(h.tokens, h.rdb, "customer"), h.verifyClientPayment)
		pay.POST("/sandbox-capture", auth.RequirePortalAuth(h.tokens, h.rdb, "customer"), h.sandboxCapturePayment)
		pay.POST("/sandbox-fail", auth.RequirePortalAuth(h.tokens, h.rdb, "customer"), h.sandboxFailPayment)
		pay.GET("/orders/:orderId", auth.RequirePortalAuth(h.tokens, h.rdb, "customer"), h.getOrderPayments)
	}
	custPay := v1.Group("/customer/payments")
	custPay.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "customer"))
	{
		custPay.POST("/initiate", h.initiatePayment)
		custPay.POST("/verify", h.verifyClientPayment)
		custPay.POST("/sandbox-capture", h.sandboxCapturePayment)
		custPay.POST("/sandbox-fail", h.sandboxFailPayment)
		custPay.GET("/orders/:orderId", h.getOrderPayments)
	}

	adminPay := v1.Group("/admin/payments")
	adminPay.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "admin"), auth.RequireLivePermission(h.authRepo, "refunds:approve"))
	{
		adminPay.GET("", h.listAdminPayments)
		adminPay.POST("/reconcile", h.reconcileAdminPayments)
	}

	admin := v1.Group("/admin/refunds")
	admin.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "admin"), auth.RequireLivePermission(h.authRepo, "refunds:approve"))
	{
		admin.POST("", h.issueAdminRefund)
	}
}

func (h *Handler) initiatePayment(c *gin.Context) {
	var req struct {
		OrderID string `json:"order_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	sess, err := h.repo.InitiatePaymentSession(c.Request.Context(), auth.CurrentUserID(c), req.OrderID)
	if err != nil {
		switch {
		case errors.Is(err, ErrPaymentNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Payment session not found for order.", nil)
		case errors.Is(err, ErrOrderNotPayable):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, sess)
}

func (h *Handler) verifyClientPayment(c *gin.Context) {
	var req struct {
		OrderID           string `json:"order_id" binding:"required"`
		ProviderOrderID   string `json:"provider_order_id" binding:"required"`
		ProviderPaymentID string `json:"provider_payment_id" binding:"required"`
		Signature         string `json:"signature" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	err := h.repo.VerifyClientCallback(c.Request.Context(), auth.CurrentUserID(c), req.OrderID, req.ProviderOrderID, req.ProviderPaymentID, req.Signature)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidSignature):
			httputil.Fail(c, http.StatusUnauthorized, "INVALID_SIGNATURE", err.Error(), nil)
		case errors.Is(err, ErrPaymentNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Payment record not found.", nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, gin.H{"verified": true, "payment_status": "CAPTURED"})
}

func (h *Handler) handleWebhook(c *gin.Context) {
	rawBody, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Unable to read webhook payload.", nil)
		return
	}

	sig := c.GetHeader("X-Razorpay-Signature")
	if sig == "" {
		sig = c.GetHeader("x-webhook-signature")
	}
	if !h.provider.VerifyWebhookSignature(rawBody, sig) {
		httputil.Fail(c, http.StatusUnauthorized, "INVALID_WEBHOOK_SIGNATURE", "Webhook HMAC signature verification failed.", nil)
		return
	}

	var evt struct {
		Event   string `json:"event"`
		EventID string `json:"event_id"`
		Payload struct {
			Payment struct {
				Entity struct {
					ID          string `json:"id"`
					OrderID     string `json:"order_id"`
					Amount      int64  `json:"amount"`
					Method      string `json:"method"`
					ErrorReason string `json:"error_description"`
				} `json:"entity"`
			} `json:"payment"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(rawBody, &evt); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", "Malformed webhook JSON.", nil)
		return
	}

	eventID := evt.EventID
	if eventID == "" {
		eventID = c.GetHeader("X-Razorpay-Event-Id")
	}
	if eventID == "" {
		eventID = evt.Event + ":" + evt.Payload.Payment.Entity.ID
	}

	entity := evt.Payload.Payment.Entity
	providerName := strings.ToUpper(c.Param("provider"))
	if providerName == "" {
		providerName = h.provider.Name()
	}

	switch evt.Event {
	case "payment.captured", "order.paid":
		dedup, err := h.repo.ApplyPaymentCapture(
			c.Request.Context(),
			providerName,
			eventID,
			evt.Event,
			entity.OrderID,
			entity.ID,
			entity.Amount,
			strings.ToUpper(entity.Method),
			rawBody,
			true,
			false,
		)
		if errors.Is(err, ErrPaymentNotFound) {
			httputil.OK(c, gin.H{"acknowledged": true, "ignored": "unknown_provider_order"})
			return
		}
		if err != nil {
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
			return
		}
		httputil.OK(c, gin.H{"acknowledged": true, "deduplicated": dedup})
	case "payment.failed":
		_ = h.repo.MarkPaymentFailed(c.Request.Context(), providerName, eventID, entity.OrderID, entity.ErrorReason, rawBody)
		httputil.OK(c, gin.H{"acknowledged": true})
	default:
		httputil.OK(c, gin.H{"acknowledged": true, "ignored_event": evt.Event})
	}
}

func (h *Handler) getOrderPayments(c *gin.Context) {
	pays, refs, err := h.repo.GetOrderPaymentsAndRefunds(c.Request.Context(), c.Param("orderId"))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load payment history.", nil)
		return
	}
	httputil.OK(c, gin.H{"payments": pays, "refunds": refs})
}

func (h *Handler) issueAdminRefund(c *gin.Context) {
	idempKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if idempKey == "" {
		httputil.Fail(c, http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required.", nil)
		return
	}
	var req struct {
		OrderID     string `json:"order_id" binding:"required"`
		AmountMinor int64  `json:"amount_minor" binding:"required,min=1"`
		ReasonCode  string `json:"reason_code" binding:"required"`
		Notes       string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	roles := auth.CurrentUserRoles(c)
	actorRole := "PLATFORM_ADMIN"
	if len(roles) > 0 {
		actorRole = roles[0]
	}

	rf, err := h.repo.IssueRefund(c.Request.Context(), auth.CurrentUserID(c), actorRole, req.OrderID, idempKey, req.AmountMinor, req.ReasonCode, req.Notes)
	if err != nil {
		switch {
		case errors.Is(err, ErrPaymentNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
		case errors.Is(err, ErrRefundExceedsBalance):
			httputil.Fail(c, http.StatusBadRequest, "REFUND_EXCEEDS_BALANCE", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.Created(c, rf)
}

func (h *Handler) sandboxCapturePayment(c *gin.Context) {
	if !h.sandboxEnabled {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Sandbox capture is disabled in production.", nil)
		return
	}
	var req struct {
		OrderID string `json:"order_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	pay, err := h.repo.SandboxCapturePayment(c.Request.Context(), auth.CurrentUserID(c), req.OrderID)
	if err != nil {
		switch {
		case errors.Is(err, ErrPaymentNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Payment record not found.", nil)
		case errors.Is(err, ErrOrderNotPayable):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		case errors.Is(err, ErrInvalidSignature):
			httputil.Fail(c, http.StatusUnauthorized, "INVALID_SIGNATURE", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, gin.H{"verified": true, "payment": pay})
}

func (h *Handler) sandboxFailPayment(c *gin.Context) {
	if !h.sandboxEnabled {
		httputil.Fail(c, http.StatusForbidden, "FORBIDDEN", "Sandbox failure simulation is disabled in production.", nil)
		return
	}
	var req struct {
		OrderID string `json:"order_id" binding:"required"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	pay, err := h.repo.MarkPaymentDeclinedByCustomer(c.Request.Context(), auth.CurrentUserID(c), req.OrderID, req.Reason)
	if err != nil {
		switch {
		case errors.Is(err, ErrPaymentNotFound):
			httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Payment record not found.", nil)
		case errors.Is(err, ErrOrderNotPayable):
			httputil.Fail(c, http.StatusConflict, "ORDER_STATE_CONFLICT", err.Error(), nil)
		default:
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		}
		return
	}
	httputil.OK(c, gin.H{"verified": false, "payment": pay})
}

func (h *Handler) listAdminPayments(c *gin.Context) {
	pays, refs, err := h.repo.ListAdminPaymentsAndRefunds(c.Request.Context())
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load payment ledger.", nil)
		return
	}
	httputil.OK(c, gin.H{"payments": pays, "refunds": refs})
}

func (h *Handler) reconcileAdminPayments(c *gin.Context) {
	rec := h.reconciler
	if rec == nil {
		rec = NewReconciler(h.repo.pool, h.repo, h.provider, slog.Default())
	}
	reconciledCount, processedRefundsCount, err := rec.RunOnce(c.Request.Context(), 0)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error(), nil)
		return
	}
	httputil.OK(c, gin.H{
		"reconciled_count":        reconciledCount,
		"processed_refunds_count": processedRefundsCount,
	})
}
