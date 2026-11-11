"use client";

import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMinor, formatOrderDate } from "@/lib/format";
import { services } from "@/services";

export default function DeliveryEarningsPage() {
  const { data } = useQuery({
    queryKey: ["deliveryHistoryEarnings"],
    queryFn: () => services.deliveryPortal.getHistoryAndEarnings(),
  });

  const earnings = data?.earnings ?? [];
  const totalMinor = earnings.reduce((s, e) => s + e.totalEarningMinor, 0);
  const tipsMinor = earnings.reduce((s, e) => s + e.tipAmountMinor, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          PAYOUTS &amp; TIPS
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Courier earnings
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5">
          <div className="text-xs text-[#8A8880] font-semibold">Total Earned</div>
          <div className="text-2xl font-extrabold text-[#2E7D32] mt-1 tabular-nums">
            {formatMinor(totalMinor)}
          </div>
        </div>
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5">
          <div className="text-xs text-[#8A8880] font-semibold">Customer Tips (100%)</div>
          <div className="text-2xl font-extrabold text-[#1E1F1C] mt-1 tabular-nums">
            {formatMinor(tipsMinor)}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl divide-y divide-[#E8E3D5]">
        {earnings.map((e) => (
          <div key={e.id} className="p-4 flex items-center justify-between text-xs">
            <div>
              <div className="font-bold text-sm">{e.orderNumber}</div>
              <div className="text-[#8A8880]">
                Base {formatMinor(e.basePayoutMinor)} + Distance{" "}
                {formatMinor(e.distancePayoutMinor)} + Tip{" "}
                {formatMinor(e.tipAmountMinor)}
              </div>
              <div className="text-[11px] text-[#8A8880] mt-0.5">
                {formatOrderDate(e.createdAt)}
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-base font-extrabold text-[#2E7D32] tabular-nums">
                {formatMinor(e.totalEarningMinor, e.currency)}
              </div>
              <StatusBadge status={e.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
