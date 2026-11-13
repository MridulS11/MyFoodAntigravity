"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { services } from "@/services";
import type { VerificationStatus } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function AdminDeliveryPartnersPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: partners = [], isError, error } = useQuery({
    queryKey: ["adminPartners"],
    queryFn: () => services.adminPortal.listDeliveryPartners(),
  });

  if (isError) {
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {error instanceof Error ? error.message : "Unauthorized."}
      </div>
    );
  }

  async function decide(id: string, decision: VerificationStatus) {
    try {
      await services.adminPortal.decidePartnerVerification(
        id,
        decision,
        `Admin marked courier ${decision}`
      );
      await qc.invalidateQueries();
      pushToast("success", `Courier status updated to ${decision}.`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Permission denied.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          FLEET GOVERNANCE
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Delivery partner verification
        </h1>
      </div>

      <div className="space-y-4">
        {partners.map((p) => (
          <div
            key={p.id}
            className="bg-white border border-[#E8E3D5] rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base">{p.fullName}</h2>
                <StatusBadge status={p.verificationStatus} />
              </div>
              <p className="text-xs text-[#5E5D57]">
                {p.vehicleModel} ({p.vehicleType}) · Plate: {p.licensePlate} ·{" "}
                {p.phone}
              </p>
              {p.fileKey && (
                <div className="flex items-center gap-2 text-xs text-[#5E5D57]">
                  <span className="truncate max-w-xs">
                    Doc: <strong>{p.documentType || "DRIVING_LICENSE"}</strong> ({p.fileKey})
                  </span>
                  {p.fileKey.startsWith("Verification/") && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          if (!services.adminPortal.presignMediaView) return;
                          const res = await services.adminPortal.presignMediaView(p.fileKey!);
                          window.open(res.viewUrl, "_blank", "noopener,noreferrer");
                        } catch (err) {
                          pushToast(
                            "error",
                            err instanceof Error ? err.message : "Could not open document."
                          );
                        }
                      }}
                      className="text-[11px] font-bold text-[#2F5934] hover:underline shrink-0"
                    >
                      View Document
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => decide(p.id, "APPROVED")}
                className="px-3.5 py-2 rounded-xl bg-[#CBEAD0] text-xs font-bold"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => decide(p.id, "REJECTED")}
                className="px-3.5 py-2 rounded-xl bg-[#FDECEA] text-[#C62828] text-xs font-bold"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
