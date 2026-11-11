"use client";

import { CheckCircle2, MailCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSessionUser } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import type { InvitationItem, PortalScope } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export function InvitationBanner({ filterKind }: { filterKind?: "PLATFORM" | "OUTLET" }) {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const portalScope: PortalScope =
    filterKind === "OUTLET" ? "restaurant" : filterKind === "PLATFORM" ? "admin" : "customer";
  const { data: user } = useSessionUser(portalScope);

  const { data: invitations = [] } = useQuery({
    queryKey: ["myInvitations", portalScope, user?.id],
    queryFn: () => services.auth.listMyInvitations(portalScope),
    enabled: Boolean(user),
  });

  const relevant = invitations.filter((i) => {
    if (filterKind && i.kind !== filterKind) return false;
    return (
      i.status === "PENDING_ACCEPTANCE" ||
      i.status === "PENDING_ADMIN_APPROVAL" ||
      i.status === "PENDING_APPROVAL"
    );
  });

  if (!user || relevant.length === 0) return null;

  async function respond(inv: InvitationItem, action: "ACCEPT" | "DECLINE") {
    try {
      await services.auth.respondToInvitation(inv.kind, inv.id, action, portalScope);
      await qc.invalidateQueries();
      pushToast(
        action === "ACCEPT" ? "success" : "info",
        action === "ACCEPT"
          ? inv.preApproved
            ? "Invitation accepted! Workspace access unlocked."
            : "Invitation accepted! Access will unlock once the Admin approves."
          : "Invitation declined."
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to respond.");
    }
  }

  return (
    <div
      data-testid="pending-invitations-banner"
      className="bg-[#FFF9E6] border border-[#DEC146] rounded-2xl p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-extrabold text-[#1E1F1C]">
          <MailCheck className="w-4 h-4 text-[#5F8E63]" />
          <span>Workspace Invitations ({relevant.length})</span>
        </div>
        <Link
          href="/account/invitations"
          className="text-xs font-bold text-[#5F8E63] hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="space-y-2">
        {relevant.map((inv) => (
          <div
            key={inv.id}
            className="bg-white border border-[#E8E3D5] rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
          >
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-[#1E1F1C]">
                  {inv.kind === "OUTLET" ? "Outlet Invite" : "Platform Admin Invite"}: {inv.targetName}
                </span>
                <StatusBadge status={inv.status} />
              </div>
              <div className="text-[#5E5D57] mt-0.5">
                Role: <strong>{inv.roleName}</strong> · Invited by {inv.invitedByName}
              </div>
              {(inv.status === "PENDING_ADMIN_APPROVAL" || inv.status === "PENDING_APPROVAL") && (
                <div className="text-[11px] font-semibold text-[#856404] mt-1">
                  Accepted by you — awaiting Admin/Owner approval before workspace access unlocks.
                </div>
              )}
            </div>
            {inv.status === "PENDING_ACCEPTANCE" && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid={`accept-invite-${inv.id}`}
                  onClick={() => respond(inv, "ACCEPT")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#5F8E63] hover:bg-[#4E7752] text-white font-bold"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => respond(inv, "DECLINE")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E8E3D5] hover:bg-[#FCF9F0] text-[#5E5D57] font-semibold"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Decline
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
