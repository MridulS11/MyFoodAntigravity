"use client";

import { Check, Clock, Volume2, VolumeX, X } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMinor, formatShortTime } from "@/lib/format";
import { services } from "@/services";
import type { Order } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function RestaurantOrdersKdsPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState("ITEM_OUT_OF_STOCK");
  const [prepChoice, setPrepChoice] = useState<Record<string, number>>({});

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["restaurantOrders"],
    queryFn: () => services.restaurantPortal.listRestaurantOrders(),
    refetchInterval: 2500,
  });

  const incoming = orders.filter((o) => o.orderStatus === "CONFIRMED");
  const preparing = orders.filter((o) =>
    ["RESTAURANT_ACCEPTED", "PREPARING"].includes(o.orderStatus)
  );
  const ready = orders.filter((o) => o.orderStatus === "READY_FOR_PICKUP");
  const completed = orders.filter((o) =>
    ["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].includes(o.orderStatus)
  );

  async function handleAccept(order: Order) {
    try {
      const prep = prepChoice[order.id] ?? 20;
      await services.restaurantPortal.acceptOrder(order.id, prep);
      await qc.invalidateQueries({ queryKey: ["restaurantOrders"] });
      pushToast("success", `Accepted ${order.orderNumber} (${prep}m prep).`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to accept.");
    }
  }

  async function handleReject() {
    if (!rejectingOrder) return;
    try {
      await services.restaurantPortal.rejectOrder(rejectingOrder.id, rejectReason);
      await qc.invalidateQueries({ queryKey: ["restaurantOrders"] });
      pushToast("info", `Rejected ${rejectingOrder.orderNumber} & initiated refund.`);
      setRejectingOrder(null);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to reject.");
    }
  }

  async function handleAdvance(
    orderId: string,
    nextStatus: "PREPARING" | "READY_FOR_PICKUP"
  ) {
    try {
      await services.restaurantPortal.advanceOrderStatus(orderId, nextStatus);
      await qc.invalidateQueries({ queryKey: ["restaurantOrders"] });
      pushToast("success", `Order updated to ${nextStatus.replaceAll("_", " ")}.`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to update.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
            LIVE KITCHEN DISPLAY SYSTEM
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1E1F1C] mt-1">
            Incoming &amp; active orders
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setSoundEnabled((v) => !v)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[#E8E3D5] text-xs font-semibold"
        >
          {soundEnabled ? (
            <Volume2 className="w-4 h-4 text-[#5F8E63]" />
          ) : (
            <VolumeX className="w-4 h-4 text-[#8A8880]" />
          )}
          <span>{soundEnabled ? "Chime Alerts On" : "Muted"}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-[#8A8880]">Loading kitchen queue...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-start">
          {/* Column 1: Incoming */}
          <KdsColumn title="New Incoming" count={incoming.length} accent="bg-[#DEC146]">
            {incoming.map((order) => (
              <div
                key={order.id}
                data-testid={`kds-order-${order.id}`}
                className="bg-white border-2 border-[#DEC146] rounded-2xl p-4 space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-extrabold text-[#1E1F1C]">
                    {order.orderNumber}
                  </span>
                  <span className="text-[#8A8880]">
                    {formatShortTime(order.createdAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] px-2.5 py-1 rounded-lg font-semibold">
                  <span>5m Acceptance SLA</span>
                  <span>
                    {order.customerCareAlertedAt
                      ? "Customer Care Alerted (Grace Active)"
                      : "Escalates to Customer Care at 5m"}
                  </span>
                </div>
                <div className="text-xs font-semibold text-[#5E5D57]">
                  {order.customerName}
                </div>
                <ul className="space-y-1 text-xs border-t border-b border-[#E8E3D5] py-2">
                  {order.items.map((i) => (
                    <li key={i.id}>
                      <strong>{i.quantity}×</strong> {i.name}
                    </li>
                  ))}
                </ul>
                {order.specialInstructions && (
                  <p className="text-[11px] bg-[#FCF9F0] p-2 rounded-lg text-[#5E5D57]">
                    Note: {order.specialInstructions}
                  </p>
                )}

                <div className="flex items-center gap-2 text-[11px]">
                  <Clock className="w-3.5 h-3.5 text-[#8A8880]" />
                  <span>Prep:</span>
                  {[15, 20, 30].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setPrepChoice((p) => ({ ...p, [order.id]: m }))
                      }
                      className={`px-2 py-0.5 rounded font-bold border ${
                        (prepChoice[order.id] ?? 20) === m
                          ? "bg-[#1E1F1C] text-white border-[#1E1F1C]"
                          : "border-[#E8E3D5]"
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    data-testid={`kds-reject-${order.id}`}
                    onClick={() => setRejectingOrder(order)}
                    className="px-3 py-2 rounded-xl border border-[#FAC8C3] text-[#C62828] text-xs font-bold hover:bg-[#FDECEA]"
                    aria-label="Reject order"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    data-testid={`kds-accept-${order.id}`}
                    onClick={() => handleAccept(order)}
                    className="flex-1 py-2 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>Accept Order</span>
                  </button>
                </div>
              </div>
            ))}
          </KdsColumn>

          {/* Column 2: Preparing */}
          <KdsColumn title="Accepted & Preparing" count={preparing.length} accent="bg-[#5F8E63]">
            {preparing.map((order) => (
              <div
                key={order.id}
                data-testid={`kds-order-${order.id}`}
                className="bg-white border border-[#E8E3D5] rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold">{order.orderNumber}</span>
                  <StatusBadge status={order.orderStatus} />
                </div>
                <ul className="space-y-1 text-xs border-t border-b border-[#E8E3D5] py-2">
                  {order.items.map((i) => (
                    <li key={i.id}>
                      <strong>{i.quantity}×</strong> {i.name}
                    </li>
                  ))}
                </ul>
                <div className="text-[11px] text-[#5E5D57]">
                  Rider: {order.partnerName ?? "Matching nearby courier..."}
                </div>
                {order.orderStatus === "RESTAURANT_ACCEPTED" ? (
                  <button
                    type="button"
                    data-testid={`kds-start-prep-${order.id}`}
                    onClick={() => handleAdvance(order.id, "PREPARING")}
                    className="w-full py-2 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] text-xs font-bold"
                  >
                    Start Preparing
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid={`kds-mark-ready-${order.id}`}
                    onClick={() => handleAdvance(order.id, "READY_FOR_PICKUP")}
                    className="w-full py-2 rounded-xl bg-[#CBEAD0] hover:bg-[#B7DFBD] text-[#1E1F1C] text-xs font-bold"
                  >
                    Mark Ready for Pickup
                  </button>
                )}
              </div>
            ))}
          </KdsColumn>

          {/* Column 3: Ready for Pickup */}
          <KdsColumn title="Ready for Pickup" count={ready.length} accent="bg-[#2563EB]">
            {ready.map((order) => (
              <div
                key={order.id}
                className="bg-white border border-[#E8E3D5] rounded-2xl p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold">{order.orderNumber}</span>
                  <StatusBadge status={order.deliveryStatus} />
                </div>
                <p className="text-xs text-[#5E5D57]">
                  {order.items.length} item(s) packed ·{" "}
                  {formatMinor(order.breakdown.itemSubtotalMinor, order.currency)}
                </p>
                <div className="text-[11px] font-semibold text-[#1D4ED8]">
                  Courier: {order.partnerName ?? "Awaiting partner pickup"}
                </div>
              </div>
            ))}
          </KdsColumn>

          {/* Column 4: Dispatched / Completed */}
          <KdsColumn title="In Transit & Past" count={completed.length} accent="bg-[#8A8880]">
            {completed.slice(0, 6).map((order) => (
              <div
                key={order.id}
                className="bg-white/70 border border-[#E8E3D5] rounded-2xl p-4 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{order.orderNumber}</span>
                  <StatusBadge status={order.orderStatus} />
                </div>
                <p className="text-xs text-[#5E5D57]">{order.customerName}</p>
                <p className="text-xs font-bold tabular-nums">
                  {formatMinor(order.breakdown.totalPayableMinor, order.currency)}
                </p>
              </div>
            ))}
          </KdsColumn>
        </div>
      )}

      {rejectingOrder && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E8E3D5] rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base">
              Reject Order {rejectingOrder.orderNumber}?
            </h3>
            <p className="text-xs text-[#5E5D57]">
              Customer payment will be automatically refunded in full. Select a reason:
            </p>
            <select
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
            >
              <option value="ITEM_OUT_OF_STOCK">Key ingredient out of stock</option>
              <option value="KITCHEN_OVERLOADED">Kitchen overloaded</option>
              <option value="CLOSING_SOON">Kitchen closing soon</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectingOrder(null)}
                className="px-4 py-2 text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="px-4 py-2 rounded-lg bg-[#C62828] text-white text-xs font-bold"
              >
                Confirm Rejection &amp; Refund
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KdsColumn({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#F5F0E2]/70 border border-[#E8E3D5] rounded-2xl p-3.5 space-y-3 min-h-[260px]">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${accent}`} />
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-[#1E1F1C]">
            {title}
          </h2>
        </div>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white border border-[#E8E3D5]">
          {count}
        </span>
      </div>
      <div className="space-y-3">
        {count === 0 ? (
          <div className="text-xs text-[#8A8880] text-center py-10">
            No orders in this stage
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
