"use client";

import { CheckCircle2, KeyRound, MapPin, Navigation } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrooklynMap } from "@/components/shared/BrooklynMap";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useTrackingSnapshot } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import type { Order } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function ActiveDeliveryPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: order, isLoading } = useQuery({
    queryKey: ["deliveryOrder", orderId],
    queryFn: () =>
      services.deliveryPortal.getDeliveryOrder
        ? services.deliveryPortal.getDeliveryOrder(orderId)
        : services.orders.getOrderById(orderId),
    enabled: Boolean(orderId),
    refetchInterval: 3000,
  });
  const { data: tracking } = useTrackingSnapshot(orderId);
  const [pinInput, setPinInput] = useState("");
  const [simStep, setSimStep] = useState(0);
  const [updatingStage, setUpdatingStage] = useState(false);

  if (isLoading || !order) {
    return <div className="text-sm text-[#8A8880]">Loading active delivery...</div>;
  }

  async function handleStage(
    nextStatus:
      | "ARRIVED_AT_RESTAURANT"
      | "PICKED_UP"
      | "OUT_FOR_DELIVERY"
      | "ARRIVED_AT_CUSTOMER"
      | "DELIVERED"
  ) {
    if (!order || updatingStage) return;
    const previousOrder = qc.getQueryData<Order>(["deliveryOrder", order.id]);
    setUpdatingStage(true);

    // Optimistic transition for non-OTP stages; DELIVERED waits for server OTP verification.
    if (nextStatus !== "DELIVERED") {
      qc.setQueryData<Order>(["deliveryOrder", order.id], (old) =>
        old ? { ...old, deliveryStatus: nextStatus } : old
      );
    }

    try {
      const updated = await services.deliveryPortal.updateDeliveryProgress(
        order.id,
        nextStatus,
        nextStatus === "DELIVERED" ? pinInput.trim() : undefined
      );
      qc.setQueryData<Order>(["deliveryOrder", order.id], updated);
      if (nextStatus === "DELIVERED") {
        void qc.invalidateQueries({ queryKey: ["deliveryHistoryEarnings"] });
        void qc.invalidateQueries({ queryKey: ["activeDelivery"] });
        pushToast("success", "Delivery confirmed and earnings credited!");
        router.push("/delivery/earnings");
      } else {
        void qc.invalidateQueries({ queryKey: ["deliveryOrder", order.id] });
        pushToast("success", `Updated status to ${nextStatus.replaceAll("_", " ")}`);
      }
    } catch (err) {
      if (previousOrder !== undefined) {
        qc.setQueryData(["deliveryOrder", order.id], previousOrder);
      }
      void qc.invalidateQueries({ queryKey: ["deliveryOrder", order.id] });
      pushToast("error", err instanceof Error ? err.message : "Update failed.");
    } finally {
      setUpdatingStage(false);
    }
  }

  async function handleSimulateGpsStep() {
    if (!order) return;
    const nextStep = Math.min(4, simStep + 1);
    setSimStep(nextStep);
    const ratio = nextStep / 4;
    const lat =
      order.pickupLocation.lat +
      (order.deliveryLocation.lat - order.pickupLocation.lat) * ratio;
    const lng =
      order.pickupLocation.lng +
      (order.deliveryLocation.lng - order.pickupLocation.lng) * ratio;
    await services.deliveryPortal.pingLocation(order.id, { lat, lng }, 140);
    await qc.invalidateQueries({ queryKey: ["tracking", order.id] });
    pushToast("info", "GPS coordinates broadcasted to customer map.");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/delivery/dashboard" className="text-xs text-[#5F8E63] hover:underline">
            ← Back to dispatch
          </Link>
          <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
            Delivery {order.orderNumber}
          </h1>
        </div>
        <StatusBadge status={order.deliveryStatus} />
      </div>

      <BrooklynMap
        pickup={order.pickupLocation}
        dropoff={order.deliveryLocation}
        partnerLocation={tracking?.partnerLocation}
        restaurantName={order.restaurantName}
        customerLabel={order.deliveryAddressSnapshot.addressLine1}
        partnerName={order.partnerName ?? "You"}
        heightClass="h-[280px]"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#F5F0E2] border border-[#E8E3D5] rounded-xl px-4 py-3 text-xs">
        <span className="font-medium text-[#5E5D57]">
          Screen Wake Lock &amp; Live GPS Broadcast active during delivery
        </span>
        <button
          type="button"
          onClick={handleSimulateGpsStep}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E8E3D5] font-bold hover:border-[#1E1F1C]"
        >
          <Navigation className="w-3.5 h-3.5 text-[#5F8E63]" />
          <span>Ping Live GPS Step</span>
        </button>
      </div>

      {/* Pickup & Dropoff Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-1.5">
          <div className="text-[11px] font-bold uppercase text-[#8A8880]">
            1. PICKUP KITCHEN
          </div>
          <div className="text-sm font-bold text-[#1E1F1C]">
            {order.restaurantName}
          </div>
          <div className="text-[#5E5D57]">{order.restaurantAddress}</div>
          <div className="pt-2 font-semibold text-[#1E1F1C]">
            Items: {order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
          </div>
        </div>

        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-1.5">
          <div className="text-[11px] font-bold uppercase text-[#8A8880]">
            2. CUSTOMER DROPOFF
          </div>
          <div className="text-sm font-bold text-[#1E1F1C]">
            {order.customerName}
          </div>
          <div className="text-[#5E5D57] flex items-start gap-1">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#5F8E63]" />
            <span>
              {order.deliveryAddressSnapshot.addressLine1},{" "}
              {order.deliveryAddressSnapshot.city}
            </span>
          </div>
          {order.deliveryAddressSnapshot.deliveryInstructions && (
            <div className="text-[#92400E] bg-[#FEF3C7] px-2.5 py-1.5 rounded-lg mt-2">
              Note: {order.deliveryAddressSnapshot.deliveryInstructions}
            </div>
          )}
        </div>
      </div>

      {/* Stage Action Controls */}
      <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#8A8880]">
          STEP-BY-STEP PROGRESSION
        </h2>

        {order.deliveryStatus === "PARTNER_ASSIGNED" && (
          <button
            type="button"
            data-testid="btn-arrived-restaurant"
            disabled={updatingStage}
            onClick={() => handleStage("ARRIVED_AT_RESTAURANT")}
            className="w-full py-3.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] font-extrabold text-sm disabled:opacity-50"
          >
            {updatingStage ? "Updating..." : "Confirm Arrived at Restaurant"}
          </button>
        )}

        {order.deliveryStatus === "ARRIVED_AT_RESTAURANT" && (
          <button
            type="button"
            data-testid="btn-picked-up"
            disabled={updatingStage}
            onClick={() => handleStage("PICKED_UP")}
            className="w-full py-3.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] font-extrabold text-sm disabled:opacity-50"
          >
            {updatingStage ? "Updating..." : "Confirm Order Picked Up"}
          </button>
        )}

        {order.deliveryStatus === "PICKED_UP" && (
          <button
            type="button"
            data-testid="btn-out-for-delivery"
            disabled={updatingStage}
            onClick={() => handleStage("OUT_FOR_DELIVERY")}
            className="w-full py-3.5 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] font-extrabold text-sm disabled:opacity-50"
          >
            {updatingStage ? "Updating..." : "Start Navigation to Customer"}
          </button>
        )}

        {order.deliveryStatus === "OUT_FOR_DELIVERY" && (
          <button
            type="button"
            data-testid="btn-arrived-customer"
            disabled={updatingStage}
            onClick={() => handleStage("ARRIVED_AT_CUSTOMER")}
            className="w-full py-3.5 rounded-xl bg-[#CBEAD0] font-extrabold text-sm disabled:opacity-50"
          >
            {updatingStage ? "Updating..." : "Confirm Arrived at Customer Location"}
          </button>
        )}

        {order.deliveryStatus === "ARRIVED_AT_CUSTOMER" && (
          <div className="space-y-3">
            {order.paymentMethod === "ONLINE" && order.deliveryPin ? (
              <>
                <div className="flex items-center justify-between text-xs text-[#5E5D57]">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <KeyRound className="w-4 h-4 text-[#5F8E63]" />
                    Ask customer for 4-digit single-use Delivery OTP (Online Paid order)
                  </span>
                  <span className="text-[11px] text-[#8A8880]">
                    (Hint: {order.deliveryPin})
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={4}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="Enter 4-digit PIN"
                  data-testid="delivery-pin-input"
                  className="w-full border border-[#E8E3D5] rounded-xl px-4 py-3 text-center text-lg font-extrabold tracking-widest"
                />
              </>
            ) : (
              <div className="p-3.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] text-xs text-[#5E5D57]">
                <strong>Cash on Delivery:</strong> Collect cash / UPI at doorstep (No delivery OTP required).
              </div>
            )}
            <button
              type="button"
              data-testid="btn-complete-delivery"
              disabled={updatingStage}
              onClick={() => handleStage("DELIVERED")}
              className="w-full py-3.5 rounded-xl bg-[#5F8E63] hover:bg-[#4e7a52] text-white font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{updatingStage ? "Verifying & completing..." : "Complete Delivery"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
