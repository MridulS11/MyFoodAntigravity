"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { services } from "@/services";
import type { VerificationStatus } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

function AdminRestaurantsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const activeTab: "owners" | "outlets" =
    searchParams.get("tab") === "outlets" ? "outlets" : "owners";
  const [notes, setNotes] = useState<Record<string, string>>({});

  function selectTab(tab: "owners" | "outlets") {
    router.replace(`/admin/restaurants?tab=${tab}`);
  }

  const { data: ownerProfiles = [], isError: ownersError, error: ownersErr } = useQuery({
    queryKey: ["adminRestaurantOwners"],
    queryFn: () => services.adminPortal.listRestaurantOwners(),
  });

  const { data: restaurants = [], isError, error } = useQuery({
    queryKey: ["adminRestaurants"],
    queryFn: () => services.adminPortal.listRestaurants(),
  });

  if (isError || ownersError) {
    const err = error ?? ownersErr;
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {err instanceof Error ? err.message : "Unauthorized."}
      </div>
    );
  }

  async function decideOwner(ownerId: string, decision: VerificationStatus) {
    try {
      await services.adminPortal.decideRestaurantOwnerVerification(
        ownerId,
        decision,
        notes[ownerId] || `Admin set Owner KYC status to ${decision}`
      );
      await qc.invalidateQueries();
      pushToast("success", `Owner KYC updated to ${decision}.`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Permission denied.");
    }
  }

  async function decide(id: string, decision: VerificationStatus) {
    try {
      await services.adminPortal.decideRestaurantVerification(
        id,
        decision,
        notes[id] || `Admin set status to ${decision}`
      );
      await qc.invalidateQueries();
      pushToast("success", `Restaurant verification updated to ${decision}.`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Permission denied.");
    }
  }

  const pendingOwnersCount = ownerProfiles.filter(
    (o) => o.verificationStatus === "PENDING_REVIEW"
  ).length;
  const pendingOutletsCount = restaurants.filter(
    (r) => r.verificationStatus === "PENDING_REVIEW"
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          MERCHANT GOVERNANCE
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Restaurant verification &amp; onboarding queue
        </h1>
      </div>

      {/* Sub-options: Owner KYC & Outlet KYC */}
      <div className="inline-flex rounded-xl bg-white border border-[#E8E3D5] p-1 gap-1">
        <button
          type="button"
          data-testid="tab-owner-kyc"
          onClick={() => selectTab("owners")}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
            activeTab === "owners"
              ? "bg-[#DEC146] text-[#1E1F1C]"
              : "text-[#5E5D57] hover:bg-[#FCF9F0]"
          }`}
        >
          Owner KYC ({ownerProfiles.length}
          {pendingOwnersCount > 0 ? ` · ${pendingOwnersCount} pending` : ""})
        </button>
        <button
          type="button"
          data-testid="tab-outlet-kyc"
          onClick={() => selectTab("outlets")}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
            activeTab === "outlets"
              ? "bg-[#DEC146] text-[#1E1F1C]"
              : "text-[#5E5D57] hover:bg-[#FCF9F0]"
          }`}
        >
          Outlet KYC ({restaurants.length}
          {pendingOutletsCount > 0 ? ` · ${pendingOutletsCount} pending` : ""})
        </button>
      </div>

      {activeTab === "owners" ? (
        <div className="space-y-4">
          {ownerProfiles.length === 0 && (
            <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 text-xs text-[#8A8880]">
              No restaurant owner KYC profiles submitted yet.
            </div>
          )}
          {ownerProfiles.map((owner) => (
            <div
              key={owner.userId || owner.id}
              data-testid={`admin-owner-${owner.userId || owner.id}`}
              className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-bold">
                      {owner.fullName || "Restaurant Owner"}
                    </h2>
                    <StatusBadge status={owner.verificationStatus} />
                  </div>
                  <p className="text-xs text-[#5E5D57] mt-0.5">
                    Organization:{" "}
                    <strong>{owner.organizationName || "Independent Owner"}</strong> ·{" "}
                    {owner.email} · {owner.phone}
                  </p>
                </div>
                <div className="text-xs text-[#5E5D57]">
                  Submitted ID: <strong>{owner.idDocumentType}</strong>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] flex justify-between gap-2">
                  <span>
                    <strong>ID Number:</strong> {owner.idDocumentNumber || "—"}
                  </span>
                  <StatusBadge status={owner.verificationStatus} />
                </div>
                <div className="p-2.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] flex justify-between gap-2">
                  <span className="truncate">
                    <strong>Demo ID Upload:</strong>{" "}
                    {owner.idDocumentFilename || "demo-id-uploaded.pdf"}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-[#5F8E63] shrink-0">
                    Attached
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="text"
                  value={notes[owner.userId || owner.id] ?? ""}
                  onChange={(e) =>
                    setNotes((p) => ({
                      ...p,
                      [owner.userId || owner.id]: e.target.value,
                    }))
                  }
                  placeholder="Owner KYC review notes..."
                  className="flex-1 min-w-[200px] border border-[#E8E3D5] rounded-xl px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  data-testid={`approve-owner-${owner.userId || owner.id}`}
                  onClick={() => decideOwner(owner.userId || owner.id, "APPROVED")}
                  className="px-3.5 py-2 rounded-xl bg-[#CBEAD0] hover:bg-[#B7DFBD] text-xs font-bold"
                >
                  Approve Owner KYC
                </button>
                <button
                  type="button"
                  onClick={() => decideOwner(owner.userId || owner.id, "REJECTED")}
                  className="px-3.5 py-2 rounded-xl bg-[#FDECEA] text-[#C62828] text-xs font-bold"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => decideOwner(owner.userId || owner.id, "SUSPENDED")}
                  className="px-3.5 py-2 rounded-xl border border-[#E8E3D5] text-xs font-semibold"
                >
                  Suspend
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {restaurants.map((rest) => (
            <div
              key={rest.id}
              data-testid={`admin-rest-${rest.id}`}
              className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-bold">
                      {rest.brandName || rest.name}
                      {rest.branchName ? ` · ${rest.branchName}` : ""}
                    </h2>
                    <StatusBadge status={rest.verificationStatus} />
                  </div>
                  <p className="text-xs text-[#5E5D57] mt-0.5">
                    {rest.addressLine1}, {rest.city}, {rest.state} · {rest.email}
                  </p>
                </div>
                <div className="text-xs text-[#8A8880]">
                  Cuisines: {rest.cuisines.join(", ")}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {(rest.documents ?? []).map((doc) => (
                  <div
                    key={doc.id}
                    className="p-2.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] flex justify-between"
                  >
                    <span>
                      <strong>{doc.documentType}</strong> ({doc.documentNumber})
                    </span>
                    <StatusBadge status={doc.status} />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="text"
                  value={notes[rest.id] ?? ""}
                  onChange={(e) =>
                    setNotes((p) => ({ ...p, [rest.id]: e.target.value }))
                  }
                  placeholder="Verification review notes..."
                  className="flex-1 min-w-[200px] border border-[#E8E3D5] rounded-xl px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  data-testid={`approve-rest-${rest.id}`}
                  onClick={() => decide(rest.id, "APPROVED")}
                  className="px-3.5 py-2 rounded-xl bg-[#CBEAD0] hover:bg-[#B7DFBD] text-xs font-bold"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => decide(rest.id, "REJECTED")}
                  className="px-3.5 py-2 rounded-xl bg-[#FDECEA] text-[#C62828] text-xs font-bold"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => decide(rest.id, "SUSPENDED")}
                  className="px-3.5 py-2 rounded-xl border border-[#E8E3D5] text-xs font-semibold"
                >
                  Suspend
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminRestaurantsPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 text-xs text-[#5E5D57]">
          Loading Restaurant KYC Queue...
        </div>
      }
    >
      <AdminRestaurantsContent />
    </Suspense>
  );
}
