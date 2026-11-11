package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// AccessClaims encodes identity, portal scope, RBAC roles, and granular admin permissions inside a 15-min JWT.
type AccessClaims struct {
	Portal      string   `json:"portal,omitempty"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
	jwt.RegisteredClaims
}

// TokenManager signs and validates short-lived JWT access tokens and opaque refresh tokens.
type TokenManager struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// NewTokenManager constructs a TokenManager from the configured HMAC secret and TTLs.
func NewTokenManager(secret string, accessTTL, refreshTTL time.Duration) *TokenManager {
	return &TokenManager{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

// IssueAccessToken mints a signed HS256 JWT with unique JTI (shared/legacy scope).
func (tm *TokenManager) IssueAccessToken(userID string, roles, permissions []string) (tokenString string, jti string, expiresAt time.Time, err error) {
	return tm.IssuePortalAccessToken(userID, "", roles, permissions)
}

// IssuePortalAccessToken mints a signed HS256 JWT scoped strictly to a specific portal ("customer" | "restaurant" | "delivery" | "admin").
func (tm *TokenManager) IssuePortalAccessToken(userID, portal string, roles, permissions []string) (tokenString string, jti string, expiresAt time.Time, err error) {
	now := time.Now().UTC()
	expiresAt = now.Add(tm.accessTTL)
	jti = uuid.NewString()

	claims := AccessClaims{
		Portal:      portal,
		Roles:       roles,
		Permissions: permissions,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			ID:        jti,
			Issuer:    "goodly-api",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(tm.secret)
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("sign access token: %w", err)
	}
	return signed, jti, expiresAt, nil
}

// ParseAccessToken validates the HMAC signature and expiration of an access token.
func (tm *TokenManager) ParseAccessToken(tokenString string) (*AccessClaims, error) {
	parsed, err := jwt.ParseWithClaims(tokenString, &AccessClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return tm.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*AccessClaims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token claims")
	}
	return claims, nil
}

// GenerateRefreshToken creates a high-entropy 32-byte random opaque token and its SHA-256 hash.
func GenerateRefreshToken() (raw string, hashHex string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", fmt.Errorf("generate refresh token: %w", err)
	}
	raw = hex.EncodeToString(buf)
	return raw, HashSHA256(raw), nil
}

// HashSHA256 returns the lowercase hex SHA-256 digest of a token or OTP string.
func HashSHA256(input string) string {
	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:])
}
