"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatOrderDate } from "@/lib/format";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

export default function AdminComplaintsPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: complaints = [], isError, error } = useQuery({
    queryKey: ["adminComplaints"],
    queryFn: () => services.adminPortal.listComplaints(),
  });

  if (isError) {
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {error instanceof Error ? error.message : "Permission complaints:resolve required."}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          CUSTOMER SUPPORT
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Complaints &amp; resolution queue
        </h1>
      </div>

      <div className="space-y-4">
        {complaints.map((c) => (
          <div
            key={c.id}
            className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-3"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold">
                {c.ticketNumber} · {c.orderNumber} · {c.customerName}
              </span>
              <StatusBadge status={c.status} />
            </div>
            <p className="text-sm text-[#1E1F1C]">{c.description}</p>
            <div className="text-[11px] text-[#8A8880]">
              Category: {c.category} · {formatOrderDate(c.createdAt)}
            </div>
            {c.status === "OPEN" && (
              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={notes[c.id] ?? ""}
                  onChange={(e) =>
                    setNotes((p) => ({ ...p, [c.id]: e.target.value }))
                  }
                  placeholder="Resolution notes..."
                  className="flex-1 border border-[#E8E3D5] rounded-xl px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await services.adminPortal.resolveComplaint(c.id, {
                      status: "RESOLVED",
                      resolutionNotes:
                        notes[c.id] || "Resolved by Support Admin.",
                    });
                    await qc.invalidateQueries();
                    pushToast("success", `Ticket ${c.ticketNumber} resolved.`);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-[#DEC146] text-xs font-bold"
                >
                  Mark Resolved
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
