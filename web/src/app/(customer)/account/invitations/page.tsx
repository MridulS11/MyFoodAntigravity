"use client";

import { CheckCircle2, MailCheck, ShieldCheck, Store, XCircle } from "lucide-react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSessionUser } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import type { InvitationItem } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function InvitationsInboxPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const { data: custUser } = useSessionUser("customer");
  const { data: adminUser } = useSessionUser("admin");
  const { data: restUser } = useSessionUser("restaurant");
  const activePortal = custUser
    ? ("customer" as const)
    : adminUser
      ? ("admin" as const)
      : restUser
        ? ("restaurant" as const)
        : ("customer" as const);
  const user = custUser ?? adminUser ?? restUser ?? null;

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ["myInvitations", activePortal, user?.id],
    queryFn: () => services.auth.listMyInvitations(activePortal),
    enabled: Boolean(user),
  });

  async function respond(inv: InvitationItem, action: "ACCEPT" | "DECLINE") {
    try {
      await services.auth.respondToInvitation(inv.kind, inv.id, action, activePortal);
      await qc.invalidateQueries();
      pushToast(
        action === "ACCEPT" ? "success" : "info",
        action === "ACCEPT"
          ? "Invitation accepted! Access unlocks after Admin approves."
          : "Invitation declined."
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Action failed.");
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          ACCOUNT INVITATIONS
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Outlet &amp; Admin Workspace Invitations
        </h1>
        <p className="text-xs text-[#5E5D57] mt-1">
          Invitations matched to <strong>{user?.email}</strong> ({user?.phone}). Accept an invitation
          below, then access unlocks as soon as the Admin approves your membership.
        </p>
      </div>

      {!user ? (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 text-sm space-y-3">
          <p>Sign in first to view invitations sent to your email ID or contact number.</p>
          <Link
            href="/auth/login"
            className="inline-block px-4 py-2 rounded-xl bg-[#DEC146] font-bold text-xs text-[#1E1F1C]"
          >
            Sign in
          </Link>
        </div>
      ) : isLoading ? (
        <div className="text-xs text-[#8A8880]">Checking invitations...</div>
      ) : invitations.length === 0 ? (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-8 text-center space-y-2">
          <MailCheck className="w-8 h-8 text-[#8A8880] mx-auto" />
          <div className="font-bold text-sm text-[#1E1F1C]">No workspace invitations yet</div>
          <p className="text-xs text-[#5E5D57]">
            Ask your Outlet Owner or Platform Admin to invite your email ID ({user.email}) or phone
            ({user.phone}).
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {invitations.map((inv) => (
            <div
              key={inv.id}
              className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] flex items-center justify-center shrink-0">
                    {inv.kind === "OUTLET" ? (
                      <Store className="w-4 h-4 text-[#5F8E63]" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 text-[#5F8E63]" />
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-sm text-[#1E1F1C]">{inv.targetName}</div>
                    <div className="text-xs text-[#5E5D57]">
                      Role: <strong>{inv.roleName}</strong> · Invited by {inv.invitedByName}
                    </div>
                  </div>
                </div>
                <StatusBadge status={inv.status} />
              </div>

              {inv.permissions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {inv.permissions.map((perm) => (
                    <span
                      key={perm}
                      className="px-2 py-0.5 rounded-full bg-[#FCF9F0] border border-[#E8E3D5] text-[10px] font-semibold text-[#5E5D57]"
                    >
                      {perm}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-[#E8E3D5]">
                <div className="text-xs text-[#5E5D57]">
                  {inv.status === "PENDING_ACCEPTANCE" && "Step 1 of 2: Accept this invitation."}
                  {(inv.status === "PENDING_ADMIN_APPROVAL" || inv.status === "PENDING_APPROVAL") &&
                    "Step 2 of 2: Accepted — waiting for Admin/Owner approval."}
                  {inv.status === "ACTIVE" && "Approved & active — you can now open this portal."}
                  {inv.status === "DECLINED" && "You declined this invitation."}
                  {inv.status === "REVOKED" && "This invitation was revoked."}
                </div>
                <div className="flex items-center gap-2">
                  {inv.status === "PENDING_ACCEPTANCE" && (
                    <>
                      <button
                        type="button"
                        onClick={() => respond(inv, "ACCEPT")}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#5F8E63] hover:bg-[#4E7752] text-white text-xs font-bold"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Accept Invitation
                      </button>
                      <button
                        type="button"
                        onClick={() => respond(inv, "DECLINE")}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E8E3D5] text-xs font-semibold"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Decline
                      </button>
                    </>
                  )}
                  {inv.status === "ACTIVE" && (
                    <Link
                      href={inv.kind === "OUTLET" ? "/restaurant/orders" : "/admin/dashboard"}
                      className="px-3.5 py-1.5 rounded-lg bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] text-xs font-bold"
                    >
                      Open {inv.kind === "OUTLET" ? "Outlet Portal" : "Admin Portal"} →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
