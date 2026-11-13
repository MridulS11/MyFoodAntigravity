import { formatMinor } from "@/lib/format";
import type { CartBreakdown } from "@/services/contracts/types";

interface OrderChargesBreakdownProps {
  breakdown: CartBreakdown;
  currency: string;
  totalLabel?: string;
  totalTestId?: string;
  compact?: boolean;
}

/**
 * Shared itemized charge breakdown rendered in both the pre-payment checkout
 * summary and the post-payment order receipt.
 */
export function OrderChargesBreakdown({
  breakdown,
  currency,
  totalLabel = "Total payable",
  totalTestId,
  compact = false,
}: OrderChargesBreakdownProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2 text-xs text-[#5E5D57]">
        <div className="flex justify-between">
          <span>Item subtotal</span>
          <span className="tabular-nums font-medium text-[#1E1F1C]">
            {formatMinor(breakdown.itemSubtotalMinor, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Packaging fee</span>
          <span className="tabular-nums">
            {formatMinor(breakdown.packagingFeeMinor, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Delivery fee</span>
          <span className="tabular-nums">
            {breakdown.deliveryFeeMinor === 0
              ? "FREE"
              : formatMinor(breakdown.deliveryFeeMinor, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Platform fee</span>
          <span className="tabular-nums">
            {formatMinor(breakdown.platformFeeMinor, currency)}
          </span>
        </div>
        {(breakdown.smallCartFeeMinor ?? 0) > 0 && (
          <div
            data-testid="small-cart-fee-row"
            className="flex justify-between text-[#92400E] font-medium"
          >
            <span>Small-cart fee (below min cart threshold)</span>
            <span className="tabular-nums">
              {formatMinor(breakdown.smallCartFeeMinor!, currency)}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>GST (5%)</span>
          <span className="tabular-nums">
            {formatMinor(breakdown.taxAmountMinor, currency)}
          </span>
        </div>
        {breakdown.tipAmountMinor > 0 && (
          <div className="flex justify-between">
            <span>Rider tip</span>
            <span className="tabular-nums">
              {formatMinor(breakdown.tipAmountMinor, currency)}
            </span>
          </div>
        )}
        {breakdown.discountAmountMinor > 0 && (
          <div className="flex justify-between text-[#2E7D32] font-semibold">
            <span>Promo discount</span>
            <span className="tabular-nums">
              −{formatMinor(breakdown.discountAmountMinor, currency)}
            </span>
          </div>
        )}
      </div>

      <div
        className={`border-t border-[#E8E3D5] ${
          compact ? "pt-3 text-sm" : "pt-4 text-base"
        } flex items-center justify-between font-extrabold text-[#1E1F1C]`}
      >
        <span>{totalLabel}</span>
        <span data-testid={totalTestId} className="tabular-nums">
          {formatMinor(breakdown.totalPayableMinor, currency)}
        </span>
      </div>
    </div>
  );
}
