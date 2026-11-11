"use client";

import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDistance, formatOrderDate } from "@/lib/format";
import { services } from "@/services";

export default function DeliveryHistoryPage() {
  const { data } = useQuery({
    queryKey: ["deliveryHistoryEarnings"],
    queryFn: () => services.deliveryPortal.getHistoryAndEarnings(),
  });

  const deliveries = data?.deliveries ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          COMPLETED TRIPS
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Delivery history
        </h1>
      </div>

      {deliveries.length === 0 ? (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-10 text-center text-sm text-[#8A8880]">
          No completed deliveries yet.
        </div>
      ) : (
        <div className="space-y-3">
          {deliveries.map((d) => (
            <div
              key={d.id}
              className="bg-white border border-[#E8E3D5] rounded-2xl p-5 flex items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{d.orderNumber}</span>
                  <StatusBadge status={d.orderStatus} />
                </div>
                <div className="font-bold text-sm">{d.restaurantName}</div>
                <div className="text-xs text-[#5E5D57]">
                  Dropoff: {d.deliveryAddressSnapshot.addressLine1} ·{" "}
                  {formatDistance(d.roadDistanceMeters)}
                </div>
              </div>
              <div className="text-xs text-[#8A8880]">
                {formatOrderDate(d.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
