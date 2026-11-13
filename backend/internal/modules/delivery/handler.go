package delivery

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/mailer"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

const PendingOnboardingWarning = "You are not receiving orders due to onboarding verification pending"

// PartnerProfile represents a delivery partner's onboarding & verification status.
type PartnerProfile struct {
	ID                 string  `json:"id"`
	UserID             string  `json:"user_id"`
	FullName           string  `json:"full_name"`
	ServiceZoneID      string  `json:"service_zone_id"`
	VehicleType        string  `json:"vehicle_type"`
	VehicleMakeModel   *string `json:"vehicle_make_model,omitempty"`
	LicensePlate       *string `json:"license_plate,omitempty"`
	Onboarded          bool    `json:"onboarded"`
	VerificationStatus string  `json:"verification_status"` // NOT_SUBMITTED | PENDING_REVIEW | APPROVED | REJECTED | SUSPENDED
	AvailabilityStatus string  `json:"availability_status"` // OFFLINE | ONLINE_AVAILABLE | ON_DELIVERY
	CanReceiveOrders   bool    `json:"can_receive_orders"`
	WarningMessage     string  `json:"warning_message,omitempty"`
	RatingAverage      float64 `json:"rating_average"`
	TotalDeliveries    int     `json:"total_deliveries_count"`
}

// Handler exposes delivery partner onboarding, KYC status, availability, and delivery fulfillment routes.
type Handler struct {
	pool      *pgxpool.Pool
	tokens    *auth.TokenManager
	rdb       *platformredis.Client
	mailer    mailer.Mailer
	otpSecret string
}

// NewHandler creates a delivery Handler.
func NewHandler(pool *pgxpool.Pool, tokens *auth.TokenManager, rdb *platformredis.Client) *Handler {
	return &Handler{pool: pool, tokens: tokens, rdb: rdb, otpSecret: "goodly-otp-dev-secret"}
}

// SetMailer attaches a transactional mailer for KYC & onboarding status notifications.
func (h *Handler) SetMailer(m mailer.Mailer) {
	h.mailer = m
}

// SetOTPSecret configures the HMAC secret used when hashing single-use delivery OTPs.
func (h *Handler) SetOTPSecret(secret string) {
	if secret != "" {
		h.otpSecret = secret
	}
}

// RegisterRoutes attaches /api/v1/delivery routes under isolated delivery portal auth.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	grp := v1.Group("/delivery")
	grp.Use(auth.RequirePortalAuth(h.tokens, h.rdb, "delivery"), auth.RequireRoles("DELIVERY_PARTNER"))
	{
		grp.GET("/me", h.getMyProfile)
		grp.POST("/onboarding", h.submitOnboarding)
		grp.PATCH("/me/availability", h.setAvailability)
		grp.GET("/offers", h.listOffers)
		grp.POST("/offers/:id/accept", h.acceptOffer)
		grp.POST("/offers/:id/reject", h.rejectOffer)
		grp.GET("/active", h.getActiveDelivery)
		grp.GET("/orders/:orderId", h.getDeliveryOrder)
		grp.POST("/orders/:orderId/stage", h.updateDeliveryStage)
		grp.PATCH("/orders/:orderId/stage", h.updateDeliveryStage)
		grp.POST("/orders/:orderId/location", h.pingLocation)
		grp.GET("/history", h.listDeliveryHistory)
		grp.GET("/earnings", h.listEarnings)
	}
}

func (h *Handler) fetchPartnerProfile(c *gin.Context, userID string) (*PartnerProfile, error) {
	var p PartnerProfile
	var fullName string
	err := h.pool.QueryRow(c.Request.Context(), `
		SELECT dp.id, dp.user_id, u.full_name, dp.service_zone_id, dp.vehicle_type,
		       dp.vehicle_make_model, dp.license_plate, dp.verification_status,
		       dp.availability_status, dp.rating_average::float8, dp.total_deliveries_count
		FROM delivery_partners dp
		JOIN users u ON u.id = dp.user_id
		WHERE dp.user_id = $1
	`, userID).Scan(
		&p.ID, &p.UserID, &fullName, &p.ServiceZoneID, &p.VehicleType,
		&p.VehicleMakeModel, &p.LicensePlate, &p.VerificationStatus,
		&p.AvailabilityStatus, &p.RatingAverage, &p.TotalDeliveries,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = h.pool.QueryRow(c.Request.Context(), `SELECT full_name FROM users WHERE id = $1`, userID).Scan(&fullName)
		return &PartnerProfile{
			UserID:             userID,
			FullName:           fullName,
			Onboarded:          false,
			VerificationStatus: "NOT_SUBMITTED",
			AvailabilityStatus: "OFFLINE",
			CanReceiveOrders:   false,
			WarningMessage:     PendingOnboardingWarning,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	p.FullName = fullName
	p.Onboarded = true
	p.CanReceiveOrders = p.VerificationStatus == "APPROVED"
	if !p.CanReceiveOrders {
		p.WarningMessage = PendingOnboardingWarning
	}
	return &p, nil
}

func (h *Handler) getMyProfile(c *gin.Context) {
	p, err := h.fetchPartnerProfile(c, auth.CurrentUserID(c))
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load courier profile.", nil)
		return
	}
	httputil.OK(c, p)
}

func (h *Handler) submitOnboarding(c *gin.Context) {
	var req struct {
		ServiceZoneID    string `json:"service_zone_id" binding:"required"`
		VehicleType      string `json:"vehicle_type" binding:"required,oneof=BICYCLE SCOOTER MOTORCYCLE CAR"`
		VehicleMakeModel string `json:"vehicle_make_model" binding:"required,min=2"`
		LicensePlate     string `json:"license_plate" binding:"required,min=2"`
		DocumentType     string `json:"document_type"`
		FileKey          string `json:"file_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	docType := req.DocumentType
	if docType == "" {
		docType = "DRIVING_LICENSE"
	}
	fileKey := req.FileKey
	if fileKey == "" {
		fileKey = "kyc/pending-upload.pdf"
	}

	userID := auth.CurrentUserID(c)
	err := database.WithTx(c.Request.Context(), h.pool, func(tx pgx.Tx) error {
		var partnerID string
		err := tx.QueryRow(c.Request.Context(), `
			INSERT INTO delivery_partners (id, user_id, service_zone_id, vehicle_type, vehicle_make_model, license_plate, verification_status, availability_status)
			VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_REVIEW', 'OFFLINE')
			ON CONFLICT (user_id) DO UPDATE SET
				service_zone_id = EXCLUDED.service_zone_id,
				vehicle_type = EXCLUDED.vehicle_type,
				vehicle_make_model = EXCLUDED.vehicle_make_model,
				license_plate = EXCLUDED.license_plate,
				verification_status = CASE WHEN delivery_partners.verification_status = 'APPROVED' THEN 'APPROVED' ELSE 'PENDING_REVIEW' END
			RETURNING id
		`, uuid.NewString(), userID, req.ServiceZoneID, req.VehicleType, req.VehicleMakeModel, req.LicensePlate).Scan(&partnerID)
		if err != nil {
			return err
		}

		_, err = tx.Exec(c.Request.Context(), `
			INSERT INTO delivery_partner_documents (id, partner_id, document_type, file_key, status)
			VALUES ($1, $2, $3, $4, 'PENDING')
		`, uuid.NewString(), partnerID, docType, fileKey)
		return err
	})
	if err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	p, err := h.fetchPartnerProfile(c, userID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Onboarding saved but reload failed.", nil)
		return
	}
	if h.mailer != nil {
		var uEmail, uName string
		if qErr := h.pool.QueryRow(c.Request.Context(), `SELECT email, full_name FROM users WHERE id = $1`, userID).Scan(&uEmail, &uName); qErr == nil && uEmail != "" {
			mailer.DispatchAsyncOrSync(c.Request.Context(), h.mailer, "failed to send delivery onboarding KYC email", func(sendCtx context.Context) error {
				return h.mailer.SendOnboardingKYCStatusEmail(sendCtx, uEmail, uName, "DELIVERY_PARTNER", uName, p.VerificationStatus, "")
			})
		}
	}
	httputil.Created(c, p)
}

func (h *Handler) setAvailability(c *gin.Context) {
	var req struct {
		Status string `json:"status" binding:"required,oneof=OFFLINE ONLINE_AVAILABLE"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.Fail(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	userID := auth.CurrentUserID(c)
	p, err := h.fetchPartnerProfile(c, userID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load courier profile.", nil)
		return
	}
	if req.Status == "ONLINE_AVAILABLE" && !p.CanReceiveOrders {
		httputil.Fail(c, http.StatusForbidden, "PARTNER_NOT_VERIFIED", PendingOnboardingWarning, gin.H{
			"verification_status": p.VerificationStatus,
			"onboarded":           p.Onboarded,
		})
		return
	}
	if p.Onboarded {
		if _, err := h.pool.Exec(c.Request.Context(), `
			UPDATE delivery_partners SET availability_status = $2 WHERE user_id = $1
		`, userID, req.Status); err != nil {
			httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not update availability.", nil)
			return
		}
	}
	updated, err := h.fetchPartnerProfile(c, userID)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not reload availability.", nil)
		return
	}
	httputil.OK(c, updated)
}
