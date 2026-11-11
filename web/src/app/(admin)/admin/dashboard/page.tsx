"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatMinor } from "@/lib/format";
import { services } from "@/services";

export default function AdminDashboardPage() {
  const { data: stats, isError, error } = useQuery({
    queryKey: ["adminOverviewStats"],
    queryFn: () => services.adminPortal.getOverviewStats(),
    refetchInterval: 3000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["adminOrders"],
    queryFn: () => services.adminPortal.listAllOrders(),
    enabled: Boolean(stats),
  });

  if (isError) {
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {error instanceof Error ? error.message : "Admin permission required."}
      </div>
    );
  }

  const attentionOrders = orders.filter(
    (o) =>
      o.deliveryStatus === "UNASSIGNABLE" ||
      (o.orderStatus === "CONFIRMED" && !o.partnerId)
  );

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          OPERATIONS CONTROL TOWER
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1E1F1C] mt-1">
          Platform health &amp; live operations
        </h1>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard label="Active Orders" value={String(stats.activeOrdersCount)} />
          <KpiCard label="Online Riders" value={String(stats.onlinePartnersCount)} />
          <KpiCard
            label="Captured GMV"
            value={formatMinor(stats.todayGmvMinor)}
            accent="text-[#2E7D32]"
          />
          <KpiCard
            label="Pending KYC"
            value={String(stats.pendingVerificationsCount)}
            accent={stats.pendingVerificationsCount > 0 ? "text-[#D97706]" : undefined}
          />
          <KpiCard
            label="Open Complaints"
            value={String(stats.openComplaintsCount)}
          />
          <KpiCard
            label="Unassignable"
            value={String(stats.unassignableOrdersCount)}
            accent={stats.unassignableOrdersCount > 0 ? "text-[#C62828]" : undefined}
          />
        </div>
      )}

      <section className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#D97706]" />
            <span>Orders Requiring Dispatch Attention</span>
          </h2>
          <Link
            href="/admin/orders"
            className="text-xs font-bold text-[#5F8E63] hover:underline flex items-center gap-1"
          >
            <span>Open live order monitor</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {attentionOrders.length === 0 ? (
          <p className="text-xs text-[#8A8880]">
            All active orders are progressing within normal SLA.
          </p>
        ) : (
          <div className="divide-y divide-[#E8E3D5]">
            {attentionOrders.map((o) => (
              <div
                key={o.id}
                className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div>
                  <span className="font-bold">{o.orderNumber}</span> ·{" "}
                  <span>{o.restaurantName}</span> →{" "}
                  <span className="text-[#5E5D57]">{o.customerName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={o.orderStatus} />
                  <StatusBadge status={o.deliveryStatus} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent = "text-[#1E1F1C]",
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="bg-white border border-[#E8E3D5] rounded-2xl p-4">
      <div className="text-[11px] font-semibold text-[#8A8880]">{label}</div>
      <div className={`text-2xl font-extrabold mt-1 tabular-nums ${accent}`}>
        {value}
      </div>
    </div>
  );
}
