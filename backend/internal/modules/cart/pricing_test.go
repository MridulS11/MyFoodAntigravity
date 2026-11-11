package cart

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestComputeBreakdownSmallCartFeeAndCoupons(t *testing.T) {
	rules := PricingRules{
		MinCartThresholdMinor:      29900, // ₹299.00
		SmallCartFeeMinor:          2900,  // ₹29.00
		BaseDeliveryFeeMinor:       2900,  // ₹29.00
		BaseDistanceMeters:         2000,
		PerKmDeliveryFeeMinor:      800,
		FreeDeliveryThresholdMinor: 59900, // ₹599.00
		PlatformFeeMinor:           900,
		TaxRateBps:                 500, // 5% GST
	}

	// Below ₹299 threshold -> small_cart_fee_minor = 2900
	small := ComputeBreakdown(
		[]PricingLineItem{{MenuItemID: "item-1", LineTotal: 24000}},
		2000,
		1500,
		nil,
		rules,
		0,
	)
	assert.Equal(t, int64(24000), small.ItemSubtotalMinor)
	assert.Equal(t, int64(2900), small.SmallCartFeeMinor)
	assert.Equal(t, int64(2900), small.DeliveryFeeMinor)
	assert.Equal(t, int64(1200), small.TaxAmountMinor) // 5% of 24000
	assert.Equal(t, int64(24000+2900+2000+2900+900+1200), small.TotalPayableMinor)

	// Above ₹599 threshold + percentage coupon capped at ₹150
	maxCap := int64(15000)
	coupon := &CouponRule{
		ID:                    "cpn-1",
		Code:                  "WELCOMEGOODLY",
		DiscountType:          "PERCENTAGE",
		DiscountValue:         2000,
		MaxDiscountMinor:      &maxCap,
		MinOrderSubtotalMinor: 24900,
	}
	large := ComputeBreakdown(
		[]PricingLineItem{{MenuItemID: "item-2", LineTotal: 90000}},
		2000,
		2500,
		coupon,
		rules,
		3000,
	)
	assert.Equal(t, int64(0), large.SmallCartFeeMinor)
	assert.Equal(t, int64(0), large.DeliveryFeeMinor)
	assert.Equal(t, int64(15000), large.DiscountAmountMinor)
	assert.Equal(t, int64(3750), large.TaxAmountMinor) // 5% of (90000 - 15000)
	assert.Equal(t, int64(90000+2000+900+3750+3000-15000), large.TotalPayableMinor)
}
