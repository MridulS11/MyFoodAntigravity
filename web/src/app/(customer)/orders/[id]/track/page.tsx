"use client";

import {
  CheckCircle2,
  Clock,
  KeyRound,
  Phone,
  ShieldAlert,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OrderChargesBreakdown } from "@/components/customer/OrderChargesBreakdown";
import { BrooklynMap } from "@/components/shared/BrooklynMap";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useOrderDetail, useTrackingSnapshot } from "@/hooks/useGoodlyQueries";
import { formatDistance, formatMinor, formatOrderDate, formatPaymentMode } from "@/lib/format";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

const LIFECYCLE_STEPS = [
  { key: "CONFIRMED", label: "Order Confirmed" },
  { key: "RESTAURANT_ACCEPTED", label: "Restaurant Accepted" },
  { key: "PREPARING", label: "Kitchen Preparing" },
  { key: "READY_FOR_PICKUP", label: "Ready for Pickup" },
  { key: "OUT_FOR_DELIVERY", label: "Out for Delivery" },
  { key: "DELIVERED", label: "Delivered" },
] as const;

export default function TrackOrderPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: order, isLoading, isError } = useOrderDetail(orderId);
  const { data: tracking } = useTrackingSnapshot(orderId);

  const [cancelling, setCancelling] = useState(false);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12 text-sm text-[#5E5D57]">
        Loading live tracking...
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Order not found</h1>
        <Link href="/orders" className="text-sm text-[#5F8E63] underline mt-2 inline-block">
          View all orders
        </Link>
      </div>
    );
  }

  const currentIdx = LIFECYCLE_STEPS.findIndex(
    (s) => s.key === order.orderStatus
  );
  const canSelfCancel = ["PENDING_PAYMENT", "CONFIRMED", "RESTAURANT_ACCEPTED"].includes(
    order.orderStatus
  );

  async function handleCancelOrder() {
    if (!order) return;
    setCancelling(true);
    try {
      const updated = await services.orders.cancelOrder(
        order.id,
        "Customer requested cancellation before kitchen prep."
      );
      qc.setQueryData(["order", order.id], updated);
      pushToast("info", "Order cancelled and refund initiated.");
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Could not cancel order."
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
            LIVE TRACKING · {order.orderNumber}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1E1F1C] mt-1">
            {order.orderStatus === "CANCELLED"
              ? "Order cancelled"
              : order.orderStatus === "DELIVERED"
                ? `Delivered from ${order.restaurantName}`
                : `Your order from ${order.restaurantName}`}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={order.orderStatus} />
          <StatusBadge status={order.paymentStatus} />
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#F5F0E2] text-[#1E1F1C]">
            {formatPaymentMode(order.paymentMethod)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Live Map + Delivery Partner Card */}
        <div className="lg:col-span-7 space-y-5">
          <BrooklynMap
            pickup={order.pickupLocation}
            dropoff={order.deliveryLocation}
            partnerLocation={tracking?.partnerLocation}
            restaurantName={order.restaurantName}
            customerLabel={order.deliveryAddressSnapshot.label}
            partnerName={order.partnerName}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#8A8880]">
                  ESTIMATED ARRIVAL
                </div>
                <div className="text-xl font-extrabold text-[#1E1F1C] mt-1 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[#5F8E63]" />
                  <span>
                    {order.orderStatus === "DELIVERED"
                      ? "Arrived"
                      : `${tracking?.etaMinutes ?? 18} mins`}
                  </span>
                </div>
                {tracking && order.orderStatus !== "DELIVERED" && (
                  <p className="text-xs text-[#8A8880] mt-0.5">
                    {formatDistance(tracking.distanceRemainingMeters)} away
                  </p>
                )}
              </div>
              {order.paymentMethod === "ONLINE" && order.deliveryPin ? (
                <div className="bg-[#F7ECC1] border border-[#DEC146] rounded-xl px-3.5 py-2 text-center">
                  <div className="text-[10px] font-bold uppercase text-[#6B5400] flex items-center gap-1 justify-center">
                    <KeyRound className="w-3 h-3" />
                    <span>Delivery OTP</span>
                  </div>
                  <div
                    data-testid="delivery-pin-display"
                    className="text-lg font-extrabold tracking-widest text-[#1E1F1C] tabular-nums"
                  >
                    {order.deliveryPin}
                  </div>
                  <div className="text-[9px] text-[#6B5400]">
                    {order.otpVerifiedAt ? "Verified ✓" : "Single-use at handoff"}
                  </div>
                </div>
              ) : order.paymentMethod === "COD" ? (
                <div
                  data-testid="cod-payment-badge"
                  className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl px-3.5 py-2 text-center"
                >
                  <div className="text-[10px] font-bold uppercase text-[#5E5D57]">
                    Cash on Delivery
                  </div>
                  <div className="text-sm font-extrabold text-[#1E1F1C] tabular-nums mt-0.5">
                    {formatMinor(order.breakdown.totalPayableMinor, order.currency)}
                  </div>
                  <div className="text-[9px] text-[#8A8880]">
                    No OTP required for COD
                  </div>
                </div>
              ) : (
                <div
                  data-testid="awaiting-arrival-otp-badge"
                  className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl px-3.5 py-2 text-center max-w-[190px]"
                >
                  <div className="text-[10px] font-bold uppercase text-[#5E5D57] flex items-center gap-1 justify-center">
                    <KeyRound className="w-3 h-3 text-[#5F8E63]" />
                    <span>Delivery OTP</span>
                  </div>
                  <div className="text-[11px] font-semibold text-[#5E5D57] mt-0.5">
                    {order.paymentStatus === "CAPTURED"
                      ? "Generated when rider arrives at your location"
                      : "Complete online payment"}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 flex items-center justify-between">
              {order.partnerName ? (
                <>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#8A8880]">
                      DELIVERY PARTNER
                    </div>
                    <div className="text-sm font-bold text-[#1E1F1C] mt-1">
                      {order.partnerName}
                    </div>
                    <div className="text-xs text-[#5E5D57]">
                      {order.partnerVehicle}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-[#CBEAD0] flex items-center justify-center text-[#1E1F1C]">
                    <Phone className="w-4 h-4" />
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 text-xs text-[#5E5D57]">
                  <Truck className="w-5 h-5 text-[#8A8880] shrink-0" />
                  <span>
                    {order.deliveryStatus === "UNASSIGNABLE"
                      ? "Operations team is manually assigning a nearby partner."
                      : "Matching you with the nearest available delivery partner..."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Stepper + Receipt + Cancel */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#8A8880]">
              ORDER PROGRESS
            </h2>
            <ol className="space-y-3.5">
              {LIFECYCLE_STEPS.map((step, idx) => {
                const done = currentIdx >= idx;
                const isCurrent = currentIdx === idx;
                return (
                  <li key={step.key} className="flex items-center gap-3">
                    <CheckCircle2
                      className={`w-5 h-5 shrink-0 ${
                        done ? "text-[#5F8E63]" : "text-[#D5CEBC]"
                      }`}
                    />
                    <span
                      className={`text-sm ${
                        isCurrent
                          ? "font-bold text-[#1E1F1C]"
                          : done
                            ? "font-medium text-[#5E5D57]"
                            : "text-[#8A8880]"
                      }`}
                    >
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-[#1E1F1C]">Items &amp; Receipt</h2>
              <span className="text-xs text-[#8A8880]">
                {formatOrderDate(order.createdAt)}
              </span>
            </div>
            <div className="divide-y divide-[#E8E3D5] border-t border-b border-[#E8E3D5] text-xs">
              {order.items.map((item) => (
                <div key={item.id} className="py-2 flex justify-between gap-2">
                  <div>
                    <span>
                      <strong>{item.quantity} ×</strong> {item.name}
                    </span>
                    {item.customizations && item.customizations.length > 0 && (
                      <div className="text-[11px] text-[#8A8880]">
                        {item.customizations.map((c) => c.optionName).join(", ")}
                      </div>
                    )}
                  </div>
                  <span className="font-semibold tabular-nums shrink-0">
                    {formatMinor(item.lineTotalMinor, order.currency)}
                  </span>
                </div>
              ))}
            </div>
            <OrderChargesBreakdown
              breakdown={order.breakdown}
              currency={order.currency}
              totalLabel={
                order.paymentMethod === "COD" && order.paymentStatus !== "CAPTURED"
                  ? "Total payable (COD)"
                  : "Total paid"
              }
              totalTestId="receipt-total"
              compact
            />
            <div className="flex items-center justify-between text-xs text-[#5E5D57] pt-1">
              <span>Payment mode</span>
              <span className="font-semibold text-[#1E1F1C]">
                {formatPaymentMode(order.paymentMethod)} · {order.paymentStatus}
              </span>
            </div>

            {canSelfCancel && (
              <button
                type="button"
                onClick={handleCancelOrder}
                disabled={cancelling}
                className="w-full mt-2 py-2.5 rounded-xl border border-[#FAC8C3] text-[#C62828] hover:bg-[#FDECEA] text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>{cancelling ? "Cancelling..." : "Cancel order (Full refund)"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
