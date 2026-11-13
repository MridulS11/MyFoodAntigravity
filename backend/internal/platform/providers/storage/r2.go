package storage

import (
	"context"
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

// Category defines the top-level key prefix in the single R2 media bucket.
type Category string

const (
	CategoryMenu         Category = "Menu"
	CategoryVerification Category = "Verification"
)

// VerificationScope partitions Verification objects into Outlet and Rider sub-keys.
type VerificationScope string

const (
	VerificationOutlet VerificationScope = "Outlet"
	VerificationRider  VerificationScope = "Rider"
)

var (
	ErrNotConfigured    = errors.New("r2 object storage is not configured")
	ErrInvalidCategory  = errors.New("category must be Menu or Verification")
	ErrInvalidScope     = errors.New("verification scope must be Outlet or Rider")
	ErrInvalidKey       = errors.New("invalid object key")
	ErrInvalidOutletKey = errors.New("invalid entity scope")

	unsafeSegmentChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)
)

// R2Config holds Cloudflare R2 S3-compatible credentials and bucket settings.
type R2Config struct {
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	PublicURL       string
}

// R2Client signs upload (PUT) and view (GET) presigned URLs against a single R2 bucket.
type R2Client struct {
	bucket        string
	publicURL     string
	presignClient *s3.PresignClient
}

// NewR2Client constructs a Cloudflare R2 presigning client. Returns nil if credentials are missing.
func NewR2Client(cfg R2Config) *R2Client {
	if cfg.AccountID == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" || cfg.Bucket == "" {
		return nil
	}
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.AccountID)
	awsCfg := aws.Config{
		Region:      "auto",
		Credentials: credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = true
	})
	return &R2Client{
		bucket:        cfg.Bucket,
		publicURL:     strings.TrimRight(cfg.PublicURL, "/"),
		presignClient: s3.NewPresignClient(client),
	}
}

// Bucket returns the configured R2 bucket name.
func (c *R2Client) Bucket() string {
	if c == nil {
		return ""
	}
	return c.bucket
}

// ParseCategory normalizes a category string into CategoryMenu or CategoryVerification.
func ParseCategory(raw string) (Category, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "menu":
		return CategoryMenu, nil
	case "verification":
		return CategoryVerification, nil
	default:
		return "", ErrInvalidCategory
	}
}

// ParseVerificationScope normalizes a verification sub-key into Outlet or Rider.
func ParseVerificationScope(raw string) (VerificationScope, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "outlet":
		return VerificationOutlet, nil
	case "rider":
		return VerificationRider, nil
	default:
		return "", ErrInvalidScope
	}
}

// BuildMenuObjectKey builds: Menu/<outletScope>/<uuid>-<sanitizedFilename>.
func BuildMenuObjectKey(outletScope, filename string) (string, error) {
	cleanScope, cleanFile, err := sanitizeScopeAndFile(outletScope, filename)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s/%s-%s", CategoryMenu, cleanScope, uuid.NewString(), cleanFile), nil
}

// BuildVerificationObjectKey builds: Verification/<Outlet|Rider>/<entityScope>/<uuid>-<sanitizedFilename>.
func BuildVerificationObjectKey(subScope VerificationScope, entityScope, filename string) (string, error) {
	if subScope != VerificationOutlet && subScope != VerificationRider {
		return "", ErrInvalidScope
	}
	cleanScope, cleanFile, err := sanitizeScopeAndFile(entityScope, filename)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s/%s/%s-%s", CategoryVerification, subScope, cleanScope, uuid.NewString(), cleanFile), nil
}

// ParseObjectKey validates a bucket key and returns (Category, VerificationScope, entityScope).
func ParseObjectKey(key string) (Category, VerificationScope, string, error) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(key), "/")
	if trimmed == "" || strings.Contains(trimmed, "..") {
		return "", "", "", ErrInvalidKey
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) < 3 {
		return "", "", "", ErrInvalidKey
	}
	cat, err := ParseCategory(parts[0])
	if err != nil {
		return "", "", "", ErrInvalidKey
	}
	if cat == CategoryMenu {
		if len(parts) != 3 || parts[1] == "" || parts[2] == "" {
			return "", "", "", ErrInvalidKey
		}
		return CategoryMenu, "", parts[1], nil
	}
	// Verification/<Outlet|Rider>/<entityScope>/<file>
	if len(parts) != 4 || parts[2] == "" || parts[3] == "" {
		return "", "", "", ErrInvalidKey
	}
	subScope, err := ParseVerificationScope(parts[1])
	if err != nil {
		return "", "", "", ErrInvalidKey
	}
	return CategoryVerification, subScope, parts[2], nil
}

// PresignUpload generates a short-lived presigned PUT URL for direct browser-to-R2 uploads.
func (c *R2Client) PresignUpload(ctx context.Context, key, contentType string, ttl time.Duration) (string, error) {
	if c == nil || c.presignClient == nil {
		return "", ErrNotConfigured
	}
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	out, err := c.presignClient.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign put %q: %w", key, err)
	}
	return out.URL, nil
}

// PresignView returns a CDN public URL (for Menu assets when R2_PUBLIC_URL is set) or a presigned GET URL.
func (c *R2Client) PresignView(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if c == nil || c.presignClient == nil {
		return "", ErrNotConfigured
	}
	cat, _, _, err := ParseObjectKey(key)
	if err != nil {
		return "", err
	}
	if cat == CategoryMenu && c.publicURL != "" {
		return c.publicURL + "/" + strings.TrimPrefix(key, "/"), nil
	}
	if ttl <= 0 {
		if cat == CategoryVerification {
			ttl = 15 * time.Minute
		} else {
			ttl = time.Hour
		}
	}
	out, err := c.presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign get %q: %w", key, err)
	}
	return out.URL, nil
}

func sanitizeScopeAndFile(scope, filename string) (string, string, error) {
	cleanScope := sanitizeSegment(scope)
	if cleanScope == "" || cleanScope == "." || cleanScope == ".." {
		return "", "", ErrInvalidOutletKey
	}
	base := path.Base(strings.TrimSpace(filename))
	cleanFile := sanitizeSegment(base)
	if cleanFile == "" || cleanFile == "." || cleanFile == ".." {
		cleanFile = "upload.bin"
	}
	return cleanScope, cleanFile, nil
}

func sanitizeSegment(s string) string {
	s = strings.TrimSpace(s)
	s = unsafeSegmentChars.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}
