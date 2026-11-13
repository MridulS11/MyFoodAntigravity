"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMinor, formatOrderDate, formatPaymentMode } from "@/lib/format";
import { services } from "@/services";
import type { Order } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function AdminOrdersPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: orders = [], isError, error } = useQuery({
    queryKey: ["adminOrders"],
    queryFn: () => services.adminPortal.listAllOrders(),
    refetchInterval: 3000,
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["adminPartners"],
    queryFn: () => services.adminPortal.listDeliveryPartners(),
  });

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [reason, setReason] = useState("");
  const [partnerId, setPartnerId] = useState("partner-devon");

  if (isError) {
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {error instanceof Error ? error.message : "Unauthorized."}
      </div>
    );
  }

  async function handleIntervention(
    action: "MANUAL_ASSIGN_PARTNER" | "FORCE_CANCEL_REFUND"
  ) {
    if (!selectedOrder) return;
    if (!reason.trim()) {
      pushToast("error", "Audit reason is required for administrative intervention.");
      return;
    }
    try {
      await services.adminPortal.interveneOrder(selectedOrder.id, action, {
        reason: reason.trim(),
        partnerId: action === "MANUAL_ASSIGN_PARTNER" ? partnerId : undefined,
      });
      await qc.invalidateQueries();
      pushToast("success", "Order intervention recorded in audit log.");
      setSelectedOrder(null);
      setReason("");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Action denied.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          ORDER &amp; DISPATCH MONITOR
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          All platform orders
        </h1>
      </div>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
              <tr>
                <th className="px-4 py-3">Order #</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Restaurant</th>
                <th className="px-4 py-3">Order State</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Delivery</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E3D5]">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-3 font-bold">
                    <div>{o.orderNumber}</div>
                    <div className="text-[10px] text-[#8A8880] font-normal">
                      {formatOrderDate(o.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">{o.customerName}</td>
                  <td className="px-4 py-3 font-semibold">{o.restaurantName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.orderStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <StatusBadge status={o.paymentStatus} />
                      <div className="text-[11px] font-medium text-[#5E5D57]">
                        {formatPaymentMode(o.paymentMethod)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.deliveryStatus} />
                  </td>
                  <td className="px-4 py-3 font-bold tabular-nums">
                    {formatMinor(o.breakdown.totalPayableMinor, o.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(o)}
                      className="px-3 py-1.5 rounded-lg border border-[#E8E3D5] hover:bg-[#F5F0E2] font-semibold"
                    >
                      Intervene
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E8E3D5] rounded-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-base">
              Intervene · {selectedOrder.orderNumber}
            </h3>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Assign Approved Delivery Partner
              </label>
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              >
                {partners
                  .filter((p) => p.verificationStatus === "APPROVED")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({p.vehicleType})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">
                Mandatory Audit Reason
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why admin intervention is required..."
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleIntervention("MANUAL_ASSIGN_PARTNER")}
                className="w-full py-2.5 rounded-xl bg-[#DEC146] font-bold text-xs"
              >
                Manually Assign Selected Partner
              </button>
              <button
                type="button"
                onClick={() => handleIntervention("FORCE_CANCEL_REFUND")}
                className="w-full py-2.5 rounded-xl bg-[#FDECEA] text-[#C62828] font-bold text-xs"
              >
                Force Cancel &amp; Issue Full Refund
              </button>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="w-full py-2 text-xs text-[#8A8880] font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
