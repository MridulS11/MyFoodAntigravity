"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistance, formatMinor } from "@/lib/format";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

export default function AdminServiceAreasPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: zones = [], isError, error } = useQuery({
    queryKey: ["adminZones"],
    queryFn: () => services.adminPortal.listServiceZones(),
  });

  if (isError) {
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {error instanceof Error ? error.message : "Permission zones:manage required."}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          POSTGIS BOUNDARIES
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Service zones &amp; coverage
        </h1>
      </div>

      <div className="space-y-3">
        {zones.map((z) => (
          <div
            key={z.id}
            className="bg-white border border-[#E8E3D5] rounded-2xl p-5 flex items-center justify-between gap-4"
          >
            <div>
              <h2 className="font-bold text-base">{z.name}</h2>
              <p className="text-xs text-[#5E5D57]">
                {z.city} · {z.timezone} · {z.currency} · Radius{" "}
                {formatDistance(z.radiusMeters)} · Base fee{" "}
                {formatMinor(z.baseDeliveryFeeMinor, z.currency)}
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await services.adminPortal.updateServiceZone(z.id, !z.isActive);
                await qc.invalidateQueries();
                pushToast("info", `Zone ${z.name} updated.`);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold ${
                z.isActive
                  ? "bg-[#E8F5E9] text-[#1B5E20]"
                  : "bg-[#FDECEA] text-[#C62828]"
              }`}
            >
              {z.isActive ? "Active" : "Disabled"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
