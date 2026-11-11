"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMinor, formatOrderDate } from "@/lib/format";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

export default function RestaurantEarningsPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const { data } = useQuery({
    queryKey: ["restaurantSettlements"],
    queryFn: () => services.restaurantPortal.getSettlementsAndReviews(),
  });

  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const settlements = data?.settlements ?? [];
  const reviews = data?.reviews ?? [];
  const penalties = data?.penalties ?? [];
  const grossTotal = settlements.reduce((s, x) => s + x.grossFoodAmountMinor, 0);
  const netTotal = settlements.reduce((s, x) => s + x.netPayoutMinor, 0);

  async function handleReply(reviewId: string) {
    const text = replyText[reviewId]?.trim();
    if (!text) return;
    await services.restaurantPortal.replyToReview(reviewId, text);
    await qc.invalidateQueries({ queryKey: ["restaurantSettlements"] });
    pushToast("success", "Reply posted.");
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          FINANCE &amp; FEEDBACK
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Sales, settlements &amp; customer reviews
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5">
          <div className="text-xs text-[#8A8880] font-semibold">Gross Food Sales</div>
          <div className="text-2xl font-extrabold mt-1 tabular-nums">
            {formatMinor(grossTotal)}
          </div>
        </div>
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5">
          <div className="text-xs text-[#8A8880] font-semibold">Net Kitchen Payout</div>
          <div className="text-2xl font-extrabold mt-1 text-[#2E7D32] tabular-nums">
            {formatMinor(netTotal)}
          </div>
        </div>
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5">
          <div className="text-xs text-[#8A8880] font-semibold">Settled Orders</div>
          <div className="text-2xl font-extrabold mt-1 tabular-nums">
            {settlements.length}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E8E3D5] font-bold text-sm">
          Per-Order Settlement Ledger
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
              <tr>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Gross Food</th>
                <th className="px-5 py-3">Commission</th>
                <th className="px-5 py-3">Net Payout</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E3D5]">
              {settlements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[#8A8880]">
                    No settled orders yet. Completed deliveries accrue here automatically.
                  </td>
                </tr>
              ) : (
                settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-bold">{s.orderNumber}</td>
                    <td className="px-5 py-3 tabular-nums">
                      {formatMinor(s.grossFoodAmountMinor, s.currency)}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-[#C62828]">
                      −{formatMinor(s.platformCommissionMinor, s.currency)} (
                      {(s.platformCommissionBps / 100).toFixed(0)}%)
                    </td>
                    <td className="px-5 py-3 font-bold tabular-nums text-[#2E7D32]">
                      {formatMinor(s.netPayoutMinor, s.currency)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={s.settlementStatus} />
                    </td>
                    <td className="px-5 py-3 text-[#8A8880]">
                      {formatOrderDate(s.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {penalties.length > 0 && (
        <div className="bg-white border border-[#FAC8C3] rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 bg-[#FDECEA] border-b border-[#FAC8C3] font-bold text-xs text-[#C62828]">
            Non-Acceptance Timeout Penalties (5-Minute SLA + Customer Care Grace Expired)
          </div>
          <div className="divide-y divide-[#E8E3D5] text-xs">
            {penalties.map((p) => (
              <div
                key={p.id}
                className="px-5 py-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className="font-bold text-[#1E1F1C]">{p.orderNumber}</span>{" "}
                  — <span className="text-[#5E5D57]">{p.penaltyModeSnapshot}</span>
                </div>
                <span className="font-bold text-[#C62828] tabular-nums">
                  −{formatMinor(p.penaltyAmountMinor, p.currency)} ({p.status})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-bold">Customer Reviews (3-Category Feedback)</h2>
        {reviews.map((rev) => (
          <div
            key={rev.id}
            className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold">{rev.customerName}</span>
              <span className="font-bold text-[#DEC146]">
                Restaurant: {"★".repeat(rev.foodRating)}
                {rev.deliveryRating
                  ? ` · Delivery: ${"★".repeat(rev.deliveryRating)}`
                  : ""}
              </span>
            </div>
            {rev.itemRatings && rev.itemRatings.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {rev.itemRatings.map((ir) => (
                  <span
                    key={ir.menuItemId}
                    className="text-[11px] bg-[#FCF9F0] border border-[#E8E3D5] rounded-full px-2.5 py-0.5 font-medium"
                  >
                    {ir.itemName}: {"★".repeat(ir.rating)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-[#5E5D57]">{rev.comment}</p>
            {rev.restaurantReply ? (
              <div className="text-xs bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl p-3">
                <strong>Your reply:</strong> {rev.restaurantReply}
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={replyText[rev.id] ?? ""}
                  onChange={(e) =>
                    setReplyText((p) => ({ ...p, [rev.id]: e.target.value }))
                  }
                  placeholder="Write a warm reply..."
                  className="flex-1 border border-[#E8E3D5] rounded-lg px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleReply(rev.id)}
                  className="px-3 py-1.5 rounded-lg bg-[#DEC146] text-xs font-bold"
                >
                  Reply
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
