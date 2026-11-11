package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/providers/mailer"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
)

var (
	ErrDisallowedRegistrationRole = errors.New("requested role cannot self-register")
	ErrAdminPortalForbidden       = errors.New("admin portal access requires a Super Admin invitation and approval")
)

var selfRegisterableRoles = []string{"CUSTOMER", "OUTLET_OWNER", "OUTLET_STAFF", "BRANCH_MANAGER", "DELIVERY_PARTNER"}

// TokenPair encapsulates issued JWT access and opaque refresh tokens scoped to an isolated portal.
type TokenPair struct {
	AccessToken        string      `json:"access_token"`
	RefreshToken       string      `json:"-"`
	AccessExpiresAt    time.Time   `json:"expires_at"`
	Portal             string      `json:"portal,omitempty"`
	OnboardingRequired bool        `json:"onboarding_required"`
	OnboardingHint     string      `json:"onboarding_hint,omitempty"`
	User               *UserRecord `json:"user"`
}

// Service implements authentication, OTP verification, refresh rotation, and WebSocket ticket issuance.
type Service struct {
	repo   *Repository
	tokens *TokenManager
	rdb    *platformredis.Client
	appEnv string
	mailer mailer.Mailer
}

// NewService constructs an auth Service.
func NewService(repo *Repository, tokens *TokenManager, rdb *platformredis.Client, appEnv string) *Service {
	return &Service{
		repo:   repo,
		tokens: tokens,
		rdb:    rdb,
		appEnv: appEnv,
	}
}

// SetMailer attaches a transactional mailer (e.g. BrevoMailer or MockMailer) for OTP delivery.
func (s *Service) SetMailer(m mailer.Mailer) {
	s.mailer = m
}

func (s *Service) generateOTPCode() string {
	if s.mailer != nil && s.mailer.IsLive() {
		n, err := rand.Int(rand.Reader, big.NewInt(900000))
		if err == nil {
			return fmt.Sprintf("%06d", n.Int64()+100000)
		}
	}
	return "123456"
}

// Register stages a pending registration and dispatches OTP verification without storing credentials in users yet.
// Accounts are only persisted once OTP verification succeeds in VerifyOTP.
func (s *Service) Register(ctx context.Context, fullName, email, phone, password, roleCode string) (*UserRecord, string, error) {
	if roleCode == "RESTAURANT_OWNER" {
		roleCode = "OUTLET_OWNER"
	}
	if !slices.Contains(selfRegisterableRoles, roleCode) {
		return nil, "", ErrDisallowedRegistrationRole
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, "", err
	}

	normEmail := strings.ToLower(strings.TrimSpace(email))
	normPhone := strings.TrimSpace(phone)
	otpCode := s.generateOTPCode()
	if err := s.repo.SavePendingRegistration(ctx, normEmail, normPhone, fullName, hash, roleCode, HashSHA256(otpCode), time.Now().UTC().Add(10*time.Minute)); err != nil {
		return nil, "", err
	}
	if s.mailer != nil && normEmail != "" {
		mailer.DispatchAsyncOrSync(ctx, s.mailer, "failed to send registration OTP email", func(sendCtx context.Context) error {
			return s.mailer.SendOTPEmail(sendCtx, normEmail, fullName, "REGISTER", otpCode)
		})
	}
	devOTP := otpCode
	if s.appEnv == "production" || (s.mailer != nil && s.mailer.IsLive()) {
		devOTP = ""
	}
	pendingUser := &UserRecord{
		Email:       normEmail,
		Phone:       normPhone,
		FullName:    strings.TrimSpace(fullName),
		Roles:       []string{roleCode},
		Permissions: []string{},
		Status:      "PENDING_OTP",
	}
	return pendingUser, devOTP, nil
}

// SendOTP records a fresh OTP challenge for registration, login, or password reset and emails it via mailer.
func (s *Service) SendOTP(ctx context.Context, target, purpose string) error {
	code := s.generateOTPCode()
	expiresAt := time.Now().UTC().Add(10 * time.Minute)
	if purpose == "REGISTER" {
		pEmail, pName, found, err := s.repo.RefreshPendingRegistrationOTP(ctx, target, HashSHA256(code), expiresAt)
		if err != nil {
			return err
		}
		if found {
			if s.mailer != nil && pEmail != "" {
				mailer.DispatchAsyncOrSync(ctx, s.mailer, "failed to resend registration OTP email", func(sendCtx context.Context) error {
					return s.mailer.SendOTPEmail(sendCtx, pEmail, pName, purpose, code)
				})
			}
			return nil
		}
	}

	var userID *string
	var toEmail, toName string
	if u, err := s.repo.GetUserByEmailOrPhone(ctx, target); err == nil {
		userID = &u.ID
		toEmail = u.Email
		toName = u.FullName
	} else if strings.Contains(target, "@") {
		toEmail = strings.TrimSpace(target)
		toName = toEmail
	}
	if err := s.repo.CreateOTP(ctx, userID, target, purpose, HashSHA256(code), expiresAt); err != nil {
		return err
	}
	if s.mailer != nil && toEmail != "" {
		mailer.DispatchAsyncOrSync(ctx, s.mailer, "failed to send OTP email", func(sendCtx context.Context) error {
			return s.mailer.SendOTPEmail(sendCtx, toEmail, toName, purpose, code)
		})
	}
	return nil
}

// VerifyOTP consumes an OTP code and finalizes pending registration or activates verification flags.
func (s *Service) VerifyOTP(ctx context.Context, target, purpose, code string) (*UserRecord, error) {
	otpHash := HashSHA256(code)
	if purpose == "REGISTER" {
		user, err := s.repo.CompletePendingRegistration(ctx, target, otpHash)
		if err == nil {
			return user, nil
		}
		if !errors.Is(err, ErrPendingNotFound) {
			return nil, err
		}
	}
	if err := s.repo.VerifyAndConsumeOTP(ctx, target, purpose, otpHash); err != nil {
		return nil, err
	}
	return s.repo.GetUserByEmailOrPhone(ctx, target)
}

// Login validates credentials and mints a fresh shared/legacy token pair + session family.
func (s *Service) Login(ctx context.Context, emailOrPhone, password, userAgent, ip string) (*TokenPair, error) {
	return s.LoginForPortal(ctx, "", emailOrPhone, password, userAgent, ip)
}

// LoginForPortal validates credentials and mints a portal-isolated session pair + onboarding hint.
func (s *Service) LoginForPortal(ctx context.Context, portal, emailOrPhone, password, userAgent, ip string) (*TokenPair, error) {
	user, err := s.repo.GetUserByEmailOrPhone(ctx, emailOrPhone)
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	if user.Status != "ACTIVE" {
		return nil, ErrAccountSuspended
	}
	ok, err := VerifyPassword(password, user.PasswordHash)
	if err != nil || !ok {
		return nil, ErrInvalidCredentials
	}

	pair, err := s.issuePortalSessionPair(ctx, user, portal, "", userAgent, ip)
	if err != nil {
		return nil, err
	}
	pair.OnboardingRequired, pair.OnboardingHint = s.repo.CheckPortalOnboardingStatus(ctx, portal, user.ID)
	return pair, nil
}

// CheckEmailExists checks whether an email/phone is unique (not yet registered).
func (s *Service) CheckEmailExists(ctx context.Context, emailOrPhone string) bool {
	_, err := s.repo.GetUserByEmailOrPhone(ctx, emailOrPhone)
	return err == nil
}

// Refresh rotates a valid refresh token (legacy scope).
func (s *Service) Refresh(ctx context.Context, rawRefreshToken, userAgent, ip string) (*TokenPair, error) {
	return s.RefreshForPortal(ctx, "", rawRefreshToken, userAgent, ip)
}

// RefreshForPortal rotates a portal-isolated refresh token or revokes the entire session family if reuse is detected.
func (s *Service) RefreshForPortal(ctx context.Context, portal, rawRefreshToken, userAgent, ip string) (*TokenPair, error) {
	if rawRefreshToken == "" {
		return nil, ErrInvalidRefresh
	}
	nextRaw, nextHash, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	nextSessionID := uuid.NewString()
	nextExp := time.Now().UTC().Add(s.tokens.refreshTTL)

	userID, err := s.repo.RotateRefreshToken(ctx, HashSHA256(rawRefreshToken), nextSessionID, nextHash, userAgent, ip, nextExp)
	if err != nil {
		return nil, err
	}

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user.Status != "ACTIVE" {
		return nil, ErrAccountSuspended
	}

	accessToken, _, accessExp, err := s.tokens.IssuePortalAccessToken(user.ID, portal, user.Roles, user.Permissions)
	if err != nil {
		return nil, err
	}
	onbReq, onbHint := s.repo.CheckPortalOnboardingStatus(ctx, portal, user.ID)
	return &TokenPair{
		AccessToken:        accessToken,
		RefreshToken:       nextRaw,
		AccessExpiresAt:    accessExp,
		Portal:             portal,
		OnboardingRequired: onbReq,
		OnboardingHint:     onbHint,
		User:               user,
	}, nil
}

// Logout revokes both the PostgreSQL session and Redis JTI blocklist entry.
func (s *Service) Logout(ctx context.Context, jti, rawRefreshToken string, remainingTTL time.Duration) error {
	if rawRefreshToken != "" {
		_ = s.repo.RevokeSessionByRefreshHash(ctx, HashSHA256(rawRefreshToken))
	}
	if jti != "" && s.rdb != nil {
		_ = s.rdb.RevokeSession(ctx, jti, remainingTTL)
	}
	return nil
}

// ResetPassword verifies an OTP code and replaces the user's password hash.
func (s *Service) ResetPassword(ctx context.Context, target, otpCode, newPassword string) error {
	if err := s.repo.VerifyAndConsumeOTP(ctx, target, "PASSWORD_RESET", HashSHA256(otpCode)); err != nil {
		return err
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	return s.repo.UpdatePasswordHash(ctx, target, hash)
}

// CreateWSTicket stores a single-use 30s WebSocket handshake ticket in Redis.
func (s *Service) CreateWSTicket(ctx context.Context, userID string) (string, error) {
	ticket := uuid.NewString()
	if s.rdb != nil {
		if err := s.rdb.Raw().Set(ctx, "ws:ticket:"+ticket, userID, 30*time.Second).Err(); err != nil {
			return "", err
		}
	}
	return ticket, nil
}

func (s *Service) issuePortalSessionPair(ctx context.Context, user *UserRecord, portal, existingFamilyID, userAgent, ip string) (*TokenPair, error) {
	accessToken, _, accessExp, err := s.tokens.IssuePortalAccessToken(user.ID, portal, user.Roles, user.Permissions)
	if err != nil {
		return nil, err
	}
	rawRefresh, hashRefresh, err := GenerateRefreshToken()
	if err != nil {
		return nil, err
	}
	familyID := existingFamilyID
	if familyID == "" {
		familyID = uuid.NewString()
	}
	sessID := uuid.NewString()
	if err := s.repo.CreateSession(ctx, sessID, user.ID, familyID, hashRefresh, userAgent, ip, time.Now().UTC().Add(s.tokens.refreshTTL)); err != nil {
		return nil, err
	}
	return &TokenPair{
		AccessToken:     accessToken,
		RefreshToken:    rawRefresh,
		AccessExpiresAt: accessExp,
		Portal:          portal,
		User:            user,
	}, nil
}
