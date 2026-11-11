"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatOrderDate } from "@/lib/format";
import { services } from "@/services";

export default function SupportComplaintsPage() {
  const { data: complaints = [] } = useQuery({
    queryKey: ["myComplaints"],
    queryFn: () => services.orders.listMyComplaints(),
  });

  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <Link href="/account/profile" className="text-xs text-[#5F8E63] hover:underline">
          ← Back to account
        </Link>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Support &amp; complaint tickets
        </h1>
      </div>

      {complaints.length === 0 ? (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-10 text-center text-sm text-[#8A8880]">
          No support tickets open.
        </div>
      ) : (
        <div className="space-y-4">
          {complaints.map((c) => (
            <div
              key={c.id}
              className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#8A8880]">
                  {c.ticketNumber} · Order {c.orderNumber}
                </span>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-sm font-semibold text-[#1E1F1C]">{c.description}</p>
              {c.resolutionNotes && (
                <p className="text-xs text-[#2E7D32] bg-[#E8F5E9] p-3 rounded-xl">
                  Resolution: {c.resolutionNotes}
                </p>
              )}
              <div className="text-[11px] text-[#8A8880]">
                Submitted {formatOrderDate(c.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
