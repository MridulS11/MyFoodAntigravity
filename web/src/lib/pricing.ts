import type {
  CartBreakdown,
  CartItem,
  CommissionConfig,
  CouponRecord,
} from "@/services/contracts/types";

export interface PricingInputs {
  items: CartItem[];
  packagingFeeMinor: number;
  baseDeliveryFeeMinor: number;
  coupon: CouponRecord | null;
  config: CommissionConfig;
  tipAmountMinor: number;
}

export function computeCartBreakdown(inputs: PricingInputs): CartBreakdown {
  const itemSubtotalMinor = inputs.items.reduce(
    (sum, item) => sum + item.lineTotalMinor,
    0
  );

  if (inputs.items.length === 0) {
    return {
      itemSubtotalMinor: 0,
      smallCartFeeMinor: 0,
      packagingFeeMinor: 0,
      deliveryFeeMinor: 0,
      platformFeeMinor: 0,
      discountAmountMinor: 0,
      taxAmountMinor: 0,
      tipAmountMinor: 0,
      totalPayableMinor: 0,
    };
  }

  const minThreshold = inputs.config.minCartThresholdMinor ?? 0;
  const configuredSmallCartFee = inputs.config.smallCartFeeMinor ?? 0;
  const smallCartFeeMinor =
    minThreshold > 0 && itemSubtotalMinor < minThreshold
      ? configuredSmallCartFee
      : 0;

  const packagingFeeMinor = inputs.packagingFeeMinor;
  let deliveryFeeMinor = inputs.baseDeliveryFeeMinor;

  if (
    inputs.config.freeDeliveryThresholdMinor > 0 &&
    itemSubtotalMinor >= inputs.config.freeDeliveryThresholdMinor
  ) {
    deliveryFeeMinor = 0;
  }

  let discountAmountMinor = 0;
  if (
    inputs.coupon &&
    inputs.coupon.isActive &&
    itemSubtotalMinor >= inputs.coupon.minOrderSubtotalMinor
  ) {
    if (inputs.coupon.discountType === "FREE_DELIVERY") {
      discountAmountMinor = deliveryFeeMinor;
      deliveryFeeMinor = 0;
    } else if (inputs.coupon.discountType === "FLAT_AMOUNT") {
      discountAmountMinor = Math.min(
        inputs.coupon.discountValue,
        itemSubtotalMinor
      );
    } else if (inputs.coupon.discountType === "PERCENTAGE") {
      const pct = Math.round(
        (itemSubtotalMinor * inputs.coupon.discountValue) / 10000
      );
      discountAmountMinor = inputs.coupon.maxDiscountMinor
        ? Math.min(pct, inputs.coupon.maxDiscountMinor, itemSubtotalMinor)
        : Math.min(pct, itemSubtotalMinor);
    }
  }

  const taxableBase = Math.max(0, itemSubtotalMinor - discountAmountMinor);
  const taxAmountMinor = Math.round(
    (taxableBase * inputs.config.taxRateBps) / 10000
  );
  const platformFeeMinor = inputs.config.platformFeeMinor;
  const tipAmountMinor = Math.max(0, inputs.tipAmountMinor);

  const totalPayableMinor = Math.max(
    0,
    itemSubtotalMinor +
      smallCartFeeMinor +
      packagingFeeMinor +
      deliveryFeeMinor +
      platformFeeMinor +
      taxAmountMinor +
      tipAmountMinor -
      discountAmountMinor
  );

  return {
    itemSubtotalMinor,
    smallCartFeeMinor,
    packagingFeeMinor,
    deliveryFeeMinor,
    platformFeeMinor,
    discountAmountMinor,
    taxAmountMinor,
    tipAmountMinor,
    totalPayableMinor,
  };
}
