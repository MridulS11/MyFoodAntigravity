"use client";

import { Check, KeyRound, Plus, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSessionUser } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import type { AdminPermission } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

const CORE_PROTECTED_ROLES = new Set([
  "PLATFORM_ADMIN",
  "CUSTOMER",
  "OUTLET_OWNER",
  "BRANCH_MANAGER",
  "OUTLET_STAFF",
  "DELIVERY_PARTNER",
]);

const PERMISSION_GROUPS: {
  group: string;
  items: { slug: AdminPermission; label: string }[];
}[] = [
  {
    group: "Users & Accounts · Customers",
    items: [
      { slug: "users:customers:view", label: "View Customers Directory & Profiles" },
      { slug: "users:customers:manage", label: "Manage / Suspend / Delete Customers" },
    ],
  },
  {
    group: "Users & Accounts · Owners",
    items: [
      { slug: "users:owners:view", label: "View Owners Directory & KYC Details" },
      { slug: "users:owners:manage", label: "Manage / Suspend / Delete Owners" },
    ],
  },
  {
    group: "Users & Accounts · Outlets",
    items: [
      { slug: "users:outlets:view", label: "View Outlets & Branch Staff Directory" },
      { slug: "users:outlets:manage", label: "Manage Outlet Staff Accounts" },
    ],
  },
  {
    group: "Users & Accounts · Management",
    items: [
      { slug: "users:management:view", label: "View Management Team Directory" },
      { slug: "users:management:manage", label: "Manage Management Roles & Permissions" },
    ],
  },
  {
    group: "Users & Accounts · Delivery",
    items: [
      { slug: "users:delivery:view", label: "View Delivery Partners Directory" },
      { slug: "users:delivery:manage", label: "Manage / Suspend / Delete Delivery Partners" },
    ],
  },
  {
    group: "Users & Roles · Global Governance",
    items: [
      { slug: "users:manage", label: "Full Users, Accounts & Directory Access" },
      { slug: "roles:manage", label: "Create, Edit Roles & Invitations" },
    ],
  },
  {
    group: "KYC & Operations",
    items: [
      { slug: "restaurants:verify", label: "Approve / Verify Outlets & Owners" },
      { slug: "partners:verify", label: "Approve / Verify Delivery Partners" },
      { slug: "orders:monitor", label: "Monitor Live Orders & Queues" },
      { slug: "orders:intervene", label: "Intervene / Force Cancel / Reassign" },
      { slug: "orders:timeout_escalate", label: "Handle 5-Min Timeout Escalations" },
      { slug: "delivery:override_otp", label: "Override Delivery OTP" },
    ],
  },
  {
    group: "Finance, Zones & Platform",
    items: [
      { slug: "refunds:approve", label: "Approve & Issue Refunds" },
      { slug: "commissions:configure", label: "Configure Commissions & Fees" },
      { slug: "promotions:manage", label: "Manage Promos & Coupons" },
      { slug: "zones:manage", label: "Manage Service Zones" },
      { slug: "complaints:resolve", label: "Resolve Customer Complaints" },
      { slug: "reports:view", label: "View Financial & Ops Reports" },
      { slug: "audit_logs:view", label: "Inspect Admin Audit Logs" },
      { slug: "settings:manage", label: "Modify Global Platform Settings" },
    ],
  },
];

export default function AdminRolesAndInvitationsPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const { data: currentAdmin } = useSessionUser("admin");
  const isSuperAdmin = Boolean(
    currentAdmin?.roles.some((r) => r === "PLATFORM_ADMIN" || r === "SUPER_ADMIN")
  );

  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [newRolePerms, setNewRolePerms] = useState<AdminPermission[]>([
    "orders:monitor",
    "complaints:resolve",
  ]);
  const [confirmDeleteRoleId, setConfirmDeleteRoleId] = useState<string | null>(null);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [customInvitePerms, setCustomInvitePerms] = useState<AdminPermission[]>([]);
  const [preApproved, setPreApproved] = useState(true);

  const { data: roles = [], isError, error } = useQuery({
    queryKey: ["adminRoles"],
    queryFn: () => services.adminPortal.listRoles(),
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ["adminInvitations"],
    queryFn: () => services.adminPortal.listAdminInvitations(),
  });

  const { data: outletStaff = [] } = useQuery({
    queryKey: ["adminPendingOutletStaff"],
    queryFn: () => services.adminPortal.listAllPendingOutletStaff(),
    retry: false,
  });

  if (isError) {
    return (
      <div
        data-testid="admin-rbac-denied"
        className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]"
      >
        {error instanceof Error ? error.message : "403 Forbidden: Super Admin access required."}
      </div>
    );
  }

  function toggleNewRolePerm(p: AdminPermission) {
    setNewRolePerms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function toggleInviteOverridePerm(p: AdminPermission) {
    setCustomInvitePerms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    if (!roleName.trim() || newRolePerms.length === 0) {
      pushToast("error", "Provide a role name and select at least one granular permission.");
      return;
    }
    try {
      const created = await services.adminPortal.createRole({
        name: roleName.trim(),
        description: roleDesc.trim(),
        permissions: newRolePerms,
      });
      setRoleName("");
      setRoleDesc("");
      setSelectedRoleId(created.id);
      await qc.invalidateQueries();
      pushToast("success", `Custom role "${created.name}" created!`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to create role.");
    }
  }

  async function handleToggleExistingRolePerm(
    roleId: string,
    currentPerms: AdminPermission[],
    perm: AdminPermission
  ) {
    const next = currentPerms.includes(perm)
      ? currentPerms.filter((p) => p !== perm)
      : [...currentPerms, perm];
    try {
      await services.adminPortal.updateRolePermissions(roleId, next);
      await qc.invalidateQueries();
      pushToast("info", "Updated role permissions.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to update role.");
    }
  }

  async function handleSendAdminInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() && !invitePhone.trim()) {
      pushToast("error", "Enter an Email ID or Contact Number to invite.");
      return;
    }
    try {
      await services.adminPortal.createAdminInvitation({
        email: inviteEmail.trim() || undefined,
        phone: invitePhone.trim() || undefined,
        roleId: roles.some((r) => r.id === selectedRoleId) ? selectedRoleId : roles[0]?.id ?? "",
        customPermissions: customInvitePerms.length > 0 ? customInvitePerms : undefined,
        preApproved,
      });
      setInviteEmail("");
      setInvitePhone("");
      setCustomInvitePerms([]);
      await qc.invalidateQueries();
      pushToast(
        "success",
        preApproved
          ? "Pre-approved Admin invitation sent! User unlocks access as soon as they accept."
          : "Admin invitation issued! User must accept on login, then you approve to activate."
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to send invite.");
    }
  }

  async function handleApproveAdminInvite(invId: string) {
    try {
      await services.adminPortal.approveAdminInvitation(invId);
      await qc.invalidateQueries();
      pushToast("success", "Admin invitation approved & activated!");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Approval blocked.");
    }
  }

  async function handleRevokeAdminInvite(invId: string) {
    await services.adminPortal.revokeAdminInvitation(invId);
    await qc.invalidateQueries();
    pushToast("info", "Admin invitation revoked.");
  }

  async function handleApproveOutletStaff(outletId: string, assignmentId: string) {
    try {
      await services.adminPortal.approveOutletStaff(outletId, assignmentId);
      await qc.invalidateQueries();
      pushToast("success", "Outlet staff invitation approved!");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Approval blocked.");
    }
  }

  async function handleDeleteRole(roleId: string, name: string) {
    setDeletingRoleId(roleId);
    try {
      await services.adminPortal.deleteRole(roleId);
      setConfirmDeleteRoleId(null);
      await qc.invalidateQueries();
      pushToast("success", `Deleted role "${name}".`);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to delete role.");
    } finally {
      setDeletingRoleId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          SUPER ADMIN GOVERNANCE
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Custom Roles, Granular Permissions &amp; Invitation Approvals
        </h1>
        <p className="text-xs text-[#5E5D57] mt-1">
          Define roles with exact permissions, map users by Email ID or Contact Number, and approve
          workspace access only after the user accepts their invitation.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Invite Admin User */}
        <form
          onSubmit={handleSendAdminInvite}
          className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-[#1E1F1C]">
            <UserPlus className="w-4 h-4 text-[#5F8E63]" />
            <span>Invite Admin / Operations User (Email or Phone)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Email ID</label>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="ops.member@goodly.in"
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Contact Number</label>
              <input
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                placeholder="+91-98450-40511"
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Assign Role</label>
            <select
              value={roles.some((r) => r.id === selectedRoleId) ? selectedRoleId : roles[0]?.id ?? ""}
              onChange={(e) => setSelectedRoleId(e.target.value)}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code}) — {r.permissions.length} permissions
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-[11px] font-bold text-[#5E5D57] mb-1.5">
              Optional Per-User Granular Permission Overrides (leave unchecked to inherit Role):
            </div>
            <div
              data-testid="invite-perm-groups"
              className="space-y-2.5 max-h-56 overflow-y-auto p-3 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]"
            >
              {PERMISSION_GROUPS.map((grp) => (
                <div key={grp.group} className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#5F8E63]">
                    {grp.group}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {grp.items.map((perm) => (
                      <label
                        key={perm.slug}
                        className="flex items-center gap-1.5 text-[11px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          data-testid={`invite-perm-${perm.slug}`}
                          checked={customInvitePerms.includes(perm.slug)}
                          onChange={() => toggleInviteOverridePerm(perm.slug)}
                        />
                        <span className="truncate font-mono text-[10px]">{perm.slug}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#1E1F1C] cursor-pointer">
            <input
              type="checkbox"
              data-testid="invite-preapproved-checkbox"
              checked={preApproved}
              onChange={(e) => setPreApproved(e.target.checked)}
            />
            <span>Pre-approve upon acceptance (grant access immediately once invitee accepts)</span>
          </label>
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs"
          >
            Send Admin Invitation
          </button>
        </form>

        {/* Create Custom Admin Role */}
        <form
          onSubmit={handleCreateRole}
          className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-[#1E1F1C]">
            <KeyRound className="w-4 h-4 text-[#5F8E63]" />
            <span>Create Custom Admin Role with Granular Permissions</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Role Name</label>
              <input
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="e.g. Bengaluru Ops Lead"
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Description</label>
              <input
                value={roleDesc}
                onChange={(e) => setRoleDesc(e.target.value)}
                placeholder="City-level order & KYC desk"
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
          </div>
          <div
            data-testid="create-role-perm-groups"
            className="space-y-3 max-h-72 overflow-y-auto p-3 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]"
          >
            {PERMISSION_GROUPS.map((grp) => (
              <div key={grp.group} className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#5F8E63]">
                  {grp.group}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {grp.items.map((perm) => (
                    <label key={perm.slug} className="flex items-center gap-2 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid={`create-role-perm-${perm.slug}`}
                        checked={newRolePerms.includes(perm.slug)}
                        onChange={() => toggleNewRolePerm(perm.slug)}
                      />
                      <span className="font-semibold text-[#1E1F1C]">
                        {perm.label}{" "}
                        <span className="font-mono text-[10px] text-[#8A8880]">({perm.slug})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] font-bold text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Custom Role
          </button>
        </form>
      </div>

      {/* Admin Invitations Queue */}
      <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E8E3D5] font-bold text-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#5F8E63]" />
          <span>Platform Admin Invitations &amp; Approval Gate</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
              <tr>
                <th className="px-4 py-3">Invitee (Email / Phone)</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Permissions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E3D5]">
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3">
                    <div className="font-bold">{inv.invitedEmail || "—"}</div>
                    <div className="text-[#8A8880]">{inv.invitedPhone || "—"}</div>
                  </td>
                  <td className="px-4 py-3 font-semibold">{inv.roleName}</td>
                  <td className="px-4 py-3 max-w-xs">
                    <span className="text-[11px] text-[#5E5D57]">{inv.permissions.join(", ")}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {inv.status === "PENDING_ADMIN_APPROVAL" && (
                        <button
                          type="button"
                          data-testid={`approve-admin-inv-${inv.id}`}
                          onClick={() => handleApproveAdminInvite(inv.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#5F8E63] text-white font-bold"
                        >
                          <Check className="w-3 h-3" />
                          Approve Access
                        </button>
                      )}
                      {inv.status === "PENDING_ACCEPTANCE" && (
                        <span className="text-[11px] text-[#8A8880]">Awaiting user accept</span>
                      )}
                      {inv.status !== "REVOKED" && (
                        <button
                          type="button"
                          onClick={() => handleRevokeAdminInvite(inv.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#E8E3D5] text-[#C62828] font-semibold"
                        >
                          <X className="w-3 h-3" />
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Granular Role Permissions Matrix */}
      <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4">
        <h2 className="font-bold text-sm text-[#1E1F1C]">
          Platform Roles &amp; Granular Permission Controls
        </h2>
        <div className="space-y-4">
          {roles.map((r) => {
            const isProtected = CORE_PROTECTED_ROLES.has(r.code);
            return (
              <div
                key={r.id}
                data-testid={`role-card-${r.id}`}
                className="p-4 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-extrabold text-sm text-[#1E1F1C]">{r.name}</span>{" "}
                    <span className="text-[11px] font-mono text-[#8A8880]">({r.code})</span>
                    <div className="text-xs text-[#5E5D57]">{r.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-white border border-[#E8E3D5]">
                      {r.permissions.length} permissions
                    </span>
                    {isSuperAdmin && !isProtected && (
                      confirmDeleteRoleId === r.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            data-testid={`confirm-delete-role-${r.id}`}
                            disabled={deletingRoleId === r.id}
                            onClick={() => handleDeleteRole(r.id, r.name)}
                            className="px-2.5 py-1 rounded-lg bg-[#C62828] text-white text-[11px] font-bold disabled:opacity-50"
                          >
                            {deletingRoleId === r.id ? "Deleting..." : "Confirm Delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteRoleId(null)}
                            className="px-2 py-1 rounded-lg border border-[#E8E3D5] bg-white text-[11px] font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-testid={`delete-role-${r.id}`}
                          onClick={() => setConfirmDeleteRoleId(r.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#FAC8C3] text-[#C62828] bg-white text-[11px] font-bold hover:bg-[#FDECEA]"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete Role
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {PERMISSION_GROUPS.map((grp) => (
                    <div key={grp.group} className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#8A8880]">
                        {grp.group}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {grp.items.map((perm) => {
                          const active = r.permissions.includes(perm.slug);
                          const locked = r.code === "PLATFORM_ADMIN";
                          return (
                            <button
                              key={perm.slug}
                              type="button"
                              disabled={locked}
                              data-testid={`role-${r.id}-perm-${perm.slug}`}
                              onClick={() =>
                                handleToggleExistingRolePerm(r.id, r.permissions, perm.slug)
                              }
                              className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                                active
                                  ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                                  : "bg-white text-[#8A8880] border-[#E8E3D5]"
                              } disabled:opacity-75`}
                            >
                              {perm.slug}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Outlet Staff Approvals (Admin Oversight) */}
      {outletStaff.some((s) => s.status === "PENDING_APPROVAL" || s.status === "PENDING_ACCEPTANCE") && (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E8E3D5] font-bold text-sm">
            Outlet Team Invitations Awaiting Approval
          </div>
          <div className="divide-y divide-[#E8E3D5]">
            {outletStaff
              .filter((s) => s.status === "PENDING_APPROVAL" || s.status === "PENDING_ACCEPTANCE")
              .map((s) => (
                <div
                  key={s.id}
                  className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold">
                      {s.fullName} — {s.outletName}
                    </div>
                    <div className="text-[#5E5D57]">
                      {s.email} · {s.phone} · Role: {s.outletRoleName || s.roleCode}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={s.status} />
                    {s.status === "PENDING_APPROVAL" && (
                      <button
                        type="button"
                        onClick={() => handleApproveOutletStaff(s.outletId, s.id)}
                        className="px-3 py-1 rounded-lg bg-[#5F8E63] text-white font-bold"
                      >
                        Approve Outlet Access
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
