package cart

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
)

// PricingLineItem holds minor-unit line totals for cart breakdown computation.
type PricingLineItem struct {
	MenuItemID string
	LineTotal  int64
}

// CouponRule encapsulates active discount logic read from PostgreSQL.
type CouponRule struct {
	ID                    string
	Code                  string
	DiscountType          string // PERCENTAGE, FLAT_AMOUNT, FREE_DELIVERY
	DiscountValue         int64  // bps for PERCENTAGE, minor units for FLAT_AMOUNT
	MaxDiscountMinor      *int64
	MinOrderSubtotalMinor int64
}

// PricingRules holds Admin/Zone-configured economic rules.
type PricingRules struct {
	MinCartThresholdMinor      int64
	SmallCartFeeMinor          int64
	BaseDeliveryFeeMinor       int64
	BaseDistanceMeters         int
	PerKmDeliveryFeeMinor      int64
	FreeDeliveryThresholdMinor int64
	PlatformFeeMinor           int64
	TaxRateBps                 int64
}

// Breakdown represents the authoritative minor-unit invoice preview.
type Breakdown struct {
	ItemSubtotalMinor     int64 `json:"item_subtotal_minor"`
	SmallCartFeeMinor     int64 `json:"small_cart_fee_minor"`
	MinCartThresholdMinor int64 `json:"min_cart_threshold_minor"`
	PackagingFeeMinor     int64 `json:"packaging_fee_minor"`
	DeliveryFeeMinor      int64 `json:"delivery_fee_minor"`
	PlatformFeeMinor      int64 `json:"platform_fee_minor"`
	DiscountAmountMinor   int64 `json:"discount_amount_minor"`
	TaxAmountMinor        int64 `json:"tax_amount_minor"`
	TipAmountMinor        int64 `json:"tip_amount_minor"`
	TotalPayableMinor     int64 `json:"total_payable_minor"`
}

// ComputeBreakdown calculates authoritative minor-unit totals using exact integer arithmetic.
func ComputeBreakdown(
	items []PricingLineItem,
	packagingFeeMinor int64,
	distanceMeters int,
	coupon *CouponRule,
	rules PricingRules,
	tipAmountMinor int64,
) Breakdown {
	if len(items) == 0 {
		return Breakdown{MinCartThresholdMinor: rules.MinCartThresholdMinor}
	}

	var itemSubtotal int64
	for _, it := range items {
		itemSubtotal += it.LineTotal
	}

	var smallCartFee int64
	if rules.MinCartThresholdMinor > 0 && itemSubtotal < rules.MinCartThresholdMinor {
		smallCartFee = rules.SmallCartFeeMinor
	}

	deliveryFee := rules.BaseDeliveryFeeMinor
	if distanceMeters > rules.BaseDistanceMeters && rules.PerKmDeliveryFeeMinor > 0 {
		extraKm := float64(distanceMeters-rules.BaseDistanceMeters) / 1000.0
		deliveryFee += int64(math.Round(extraKm * float64(rules.PerKmDeliveryFeeMinor)))
	}
	if rules.FreeDeliveryThresholdMinor > 0 && itemSubtotal >= rules.FreeDeliveryThresholdMinor {
		deliveryFee = 0
	}

	var discount int64
	if coupon != nil && itemSubtotal >= coupon.MinOrderSubtotalMinor {
		switch coupon.DiscountType {
		case "FREE_DELIVERY":
			deliveryFee = 0
		case "FLAT_AMOUNT":
			discount = coupon.DiscountValue
			if discount > itemSubtotal {
				discount = itemSubtotal
			}
		case "PERCENTAGE":
			raw := int64(math.Round(float64(itemSubtotal*coupon.DiscountValue) / 10000.0))
			if coupon.MaxDiscountMinor != nil && raw > *coupon.MaxDiscountMinor {
				raw = *coupon.MaxDiscountMinor
			}
			discount = raw
			if discount > itemSubtotal {
				discount = itemSubtotal
			}
		}
	}

	taxable := itemSubtotal - discount
	if taxable < 0 {
		taxable = 0
	}
	tax := int64(math.Round(float64(taxable*rules.TaxRateBps) / 10000.0))
	if tipAmountMinor < 0 {
		tipAmountMinor = 0
	}

	total := itemSubtotal + smallCartFee + packagingFeeMinor + deliveryFee + rules.PlatformFeeMinor + tax + tipAmountMinor - discount
	if total < 0 {
		total = 0
	}

	return Breakdown{
		ItemSubtotalMinor:     itemSubtotal,
		SmallCartFeeMinor:     smallCartFee,
		MinCartThresholdMinor: rules.MinCartThresholdMinor,
		PackagingFeeMinor:     packagingFeeMinor,
		DeliveryFeeMinor:      deliveryFee,
		PlatformFeeMinor:      rules.PlatformFeeMinor,
		DiscountAmountMinor:   discount,
		TaxAmountMinor:        tax,
		TipAmountMinor:        tipAmountMinor,
		TotalPayableMinor:     total,
	}
}

// SignPricingQuote produces a deterministic HMAC-SHA256 quote hash verifying checkout integrity.
func SignPricingQuote(secret, customerID, restaurantID string, b Breakdown) string {
	mac := hmac.New(sha256.New, []byte(secret))
	payload := fmt.Sprintf("%s:%s:%d:%d:%d:%d:%d", customerID, restaurantID, b.ItemSubtotalMinor, b.SmallCartFeeMinor, b.DeliveryFeeMinor, b.TaxAmountMinor, b.TotalPayableMinor)
	mac.Write([]byte(payload))
	return "sha256:" + hex.EncodeToString(mac.Sum(nil))
}
