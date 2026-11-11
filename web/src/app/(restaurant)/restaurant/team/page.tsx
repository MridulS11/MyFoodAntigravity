"use client";

import { Check, ChevronDown, Plus, Search, Shield, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { services } from "@/services";
import type { OutletPermission } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

const ALL_OUTLET_PERMISSIONS: { slug: OutletPermission; label: string }[] = [
  { slug: "outlet:orders:manage", label: "Manage Live KDS Orders" },
  { slug: "outlet:menu:edit", label: "Create & Edit Menu Items" },
  { slug: "outlet:inventory:toggle", label: "Toggle Item Availability & Stock" },
  { slug: "outlet:hours:manage", label: "Manage Operating Hours & Kitchen Pause" },
  { slug: "outlet:capacity:configure", label: "Configure Prep Time & Concurrency Cap" },
  { slug: "outlet:reports:view", label: "View Sales & Settlements" },
  { slug: "outlet:staff:manage", label: "Manage Team & Roles" },
  { slug: "outlet:locations:manage", label: "Manage Branch Locations" },
];

export default function RestaurantTeamPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [rolePerms, setRolePerms] = useState<OutletPermission[]>([
    "outlet:orders:manage",
    "outlet:inventory:toggle",
  ]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("BRANCH_MANAGER");
  const [selectedOutletIds, setSelectedOutletIds] = useState<string[] | null>(null);
  const [scopeOverlayOpen, setScopeOverlayOpen] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");

  const { data: restaurantData } = useQuery({
    queryKey: ["myRestaurant"],
    queryFn: () => services.restaurantPortal.getMyRestaurant(),
    retry: false,
  });

  const { data: allOutlets = [] } = useQuery({
    queryKey: ["myOutlets"],
    queryFn: () => services.restaurantPortal.listMyOutlets(),
    retry: false,
  });

  const activeOutlet = restaurantData?.restaurant;
  const outletsForScope = allOutlets.length > 0 ? allOutlets : activeOutlet ? [activeOutlet] : [];
  const effectiveSelectedOutletIds =
    selectedOutletIds ?? (activeOutlet ? [activeOutlet.id] : []);

  const outletGroups = Object.entries(
    outletsForScope.reduce<Record<string, typeof outletsForScope>>((acc, o) => {
      const brand = (o.brandName || o.name).trim();
      if (!acc[brand]) acc[brand] = [];
      acc[brand].push(o);
      return acc;
    }, {})
  );

  function toggleBranchScope(outletId: string) {
    setSelectedOutletIds((prev) => {
      const base = prev ?? effectiveSelectedOutletIds;
      return base.includes(outletId)
        ? base.filter((id) => id !== outletId)
        : [...base, outletId];
    });
  }

  function toggleBrandGroupScope(branchIds: string[]) {
    setSelectedOutletIds((prev) => {
      const base = prev ?? effectiveSelectedOutletIds;
      const allChecked = branchIds.every((id) => base.includes(id));
      if (allChecked) {
        return base.filter((id) => !branchIds.includes(id));
      }
      return Array.from(new Set([...base, ...branchIds]));
    });
  }

  const { data: staff = [] } = useQuery({
    queryKey: ["branchStaff", allOutlets.length > 1 ? "all" : activeOutlet?.id],
    queryFn: async () => {
      if (allOutlets.length > 1) {
        try {
          return await services.restaurantPortal.listBranchStaff("all");
        } catch {
          return services.restaurantPortal.listBranchStaff(activeOutlet?.id);
        }
      }
      return services.restaurantPortal.listBranchStaff(activeOutlet?.id);
    },
    enabled: Boolean(activeOutlet?.id),
  });

  const { data: customRoles = [] } = useQuery({
    queryKey: ["outletRoles"],
    queryFn: () => services.restaurantPortal.listOutletRoles(),
  });

  function togglePerm(perm: OutletPermission) {
    setRolePerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  async function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    if (!roleName.trim() || rolePerms.length === 0) {
      pushToast("error", "Enter a role name and choose at least one permission.");
      return;
    }
    try {
      await services.restaurantPortal.createOutletRole({
        name: roleName.trim(),
        description: roleDesc.trim(),
        permissions: rolePerms,
      });
      setRoleName("");
      setRoleDesc("");
      await qc.invalidateQueries({ queryKey: ["outletRoles"] });
      pushToast("success", "Custom outlet role created.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to create role.");
    }
  }

  async function handleInviteStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOutlet) return;
    if (effectiveSelectedOutletIds.length === 0) {
      pushToast("error", "Select at least one outlet or branch for this team member.");
      return;
    }
    if (!inviteEmail.trim() && !invitePhone.trim()) {
      pushToast("error", "Enter either an Email ID or Contact Number.");
      return;
    }
    try {
      const isStandard =
        selectedRoleId === "BRANCH_MANAGER" || selectedRoleId === "OUTLET_STAFF";
      await services.restaurantPortal.inviteBranchStaff({
        outletId: effectiveSelectedOutletIds[0],
        outletIds: effectiveSelectedOutletIds,
        email: inviteEmail.trim() || undefined,
        phone: invitePhone.trim() || undefined,
        roleCode: isStandard ? selectedRoleId : "CUSTOM",
        outletRoleId: isStandard ? undefined : selectedRoleId,
        permissions:
          selectedRoleId === "BRANCH_MANAGER"
            ? [
                "outlet:orders:manage",
                "outlet:menu:edit",
                "outlet:inventory:toggle",
                "outlet:hours:manage",
                "outlet:reports:view",
              ]
            : selectedRoleId === "OUTLET_STAFF"
              ? ["outlet:orders:manage", "outlet:inventory:toggle"]
              : undefined,
      });
      setInviteEmail("");
      setInvitePhone("");
      await qc.invalidateQueries({ queryKey: ["branchStaff"] });
      pushToast(
        "success",
        `Invitation sent for ${effectiveSelectedOutletIds.length} outlet location(s)! Member must accept on login, then await your approval.`
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Failed to invite staff.");
    }
  }

  async function handleApprove(outletId: string, assignmentId: string) {
    try {
      await services.restaurantPortal.approveBranchStaff(outletId, assignmentId);
      await qc.invalidateQueries({ queryKey: ["branchStaff"] });
      pushToast("success", "Outlet member approved and activated!");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Approval failed.");
    }
  }

  async function handleRevoke(outletId: string, assignmentId: string) {
    await services.restaurantPortal.revokeBranchStaff(outletId, assignmentId);
    await qc.invalidateQueries({ queryKey: ["branchStaff"] });
    pushToast("info", "Access revoked.");
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          OUTLET USERS &amp; ROLES
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Team invitations, approvals &amp; custom business roles
        </h1>
        <p className="text-xs text-[#5E5D57] mt-1">
          Map team members by Email ID or Phone. Users can log in beforehand, must accept their
          invitation, and only receive outlet access after approval.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invite Staff Member */}
        <form
          onSubmit={handleInviteStaff}
          className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-[#1E1F1C]">
            <UserPlus className="w-4 h-4 text-[#5F8E63]" />
            <span>Invite Team Member Across Outlets &amp; Branches</span>
          </div>
          {outletGroups.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold">
                Outlet &amp; Branch Access Scope
              </label>
              <button
                type="button"
                data-testid="scope-overlay-trigger"
                aria-expanded={scopeOverlayOpen}
                onClick={() => setScopeOverlayOpen(true)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] hover:border-[#1E1F1C]/40 text-left text-xs transition-colors"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[#1E1F1C]">
                    {effectiveSelectedOutletIds.length} outlet{" "}
                    {effectiveSelectedOutletIds.length === 1 ? "location" : "locations"} selected
                  </div>
                  <div className="text-[11px] text-[#5E5D57] truncate">
                    {effectiveSelectedOutletIds.length === 0
                      ? "Click to choose outlets & branches"
                      : outletsForScope
                          .filter((o) => effectiveSelectedOutletIds.includes(o.id))
                          .map((o) =>
                            o.branchName ? `${o.brandName || o.name} · ${o.branchName}` : o.name
                          )
                          .join(", ")}
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-[#5E5D57] shrink-0" />
              </button>

              {scopeOverlayOpen && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Outlet and Branch Access Scope"
                  className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                  onClick={() => setScopeOverlayOpen(false)}
                >
                  <div
                    data-testid="outlet-scope-overlay"
                    className="w-full max-w-lg bg-white border border-[#E8E3D5] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[82vh]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-5 py-4 border-b border-[#E8E3D5] flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
                          ACCESS SCOPE
                        </div>
                        <h3 className="text-sm font-extrabold text-[#1E1F1C]">
                          Outlet &amp; Branch Access Scope
                        </h3>
                      </div>
                      <button
                        type="button"
                        aria-label="Close overlay"
                        onClick={() => setScopeOverlayOpen(false)}
                        className="p-1.5 rounded-lg border border-[#E8E3D5] hover:bg-[#F5F0E2]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="px-5 py-3 border-b border-[#E8E3D5] bg-[#FCF9F0] flex flex-wrap items-center justify-between gap-2">
                      <div className="relative flex-1 min-w-[180px]">
                        <Search className="w-3.5 h-3.5 text-[#8A8880] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={scopeSearch}
                          onChange={(e) => setScopeSearch(e.target.value)}
                          placeholder="Search outlets or branches..."
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#E8E3D5] bg-white text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedOutletIds(outletsForScope.map((o) => o.id))
                          }
                          className="px-2.5 py-1 rounded-lg border border-[#E8E3D5] bg-white font-semibold hover:bg-[#F5F0E2]"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedOutletIds([])}
                          className="px-2.5 py-1 rounded-lg border border-[#E8E3D5] bg-white font-semibold hover:bg-[#F5F0E2]"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="p-5 overflow-y-auto space-y-3">
                      {outletGroups
                        .filter(([brand, branches]) => {
                          const term = scopeSearch.trim().toLowerCase();
                          if (!term) return true;
                          return (
                            brand.toLowerCase().includes(term) ||
                            branches.some((b) =>
                              (b.branchName || b.name).toLowerCase().includes(term)
                            )
                          );
                        })
                        .map(([brand, branches]) => {
                          const branchIds = branches.map((b) => b.id);
                          const allChecked = branchIds.every((id) =>
                            effectiveSelectedOutletIds.includes(id)
                          );
                          return (
                            <div
                              key={brand}
                              className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl p-3 space-y-2"
                            >
                              <label className="flex items-center gap-2 text-xs font-bold text-[#1E1F1C] cursor-pointer">
                                <input
                                  type="checkbox"
                                  data-testid={`scope-outlet-${brand}`}
                                  checked={allChecked}
                                  onChange={() => toggleBrandGroupScope(branchIds)}
                                />
                                <span>{brand}</span>
                                <span className="text-[10px] font-semibold text-[#8A8880]">
                                  ({branches.length} {branches.length === 1 ? "branch" : "branches"})
                                </span>
                              </label>
                              <div className="pl-5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                {branches.map((branch) => (
                                  <label
                                    key={branch.id}
                                    className="flex items-center gap-2 text-[11px] text-[#5E5D57] bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      data-testid={`scope-branch-${branch.id}`}
                                      checked={effectiveSelectedOutletIds.includes(branch.id)}
                                      onChange={() => toggleBranchScope(branch.id)}
                                    />
                                    <span className="truncate font-semibold text-[#1E1F1C]">
                                      {branch.branchName || branch.name}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    <div className="px-5 py-3.5 border-t border-[#E8E3D5] flex items-center justify-between bg-white">
                      <span className="text-xs font-semibold text-[#5E5D57]">
                        {effectiveSelectedOutletIds.length} location(s) selected
                      </span>
                      <button
                        type="button"
                        data-testid="scope-overlay-done-btn"
                        onClick={() => setScopeOverlayOpen(false)}
                        className="px-4 py-2 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] text-xs font-bold"
                      >
                        Apply Scope
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold mb-1">Email ID (optional if phone set)</label>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="manager@outlet.in"
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">
              Contact Phone Number (optional if email set)
            </label>
            <input
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
              placeholder="+91-98450-12345"
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Role</label>
            <select
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
            >
              <option value="BRANCH_MANAGER">Branch Manager (Orders, Menu, Hours, Reports)</option>
              <option value="OUTLET_STAFF">Outlet Staff (KDS Orders &amp; Stock only)</option>
              {customRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  Custom: {r.name} ({r.permissions.length} perms)
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={!activeOutlet}
            className="px-4 py-2.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs disabled:opacity-50"
          >
            Send Invitation
          </button>
        </form>

        {/* Create Custom Outlet Role */}
        <form
          onSubmit={handleCreateRole}
          className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 font-bold text-sm text-[#1E1F1C]">
            <Shield className="w-4 h-4 text-[#5F8E63]" />
            <span>Create Custom Outlet Role</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Role Name</label>
              <input
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="e.g. Shift Cashier"
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Description</label>
              <input
                value={roleDesc}
                onChange={(e) => setRoleDesc(e.target.value)}
                placeholder="Scope summary"
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_OUTLET_PERMISSIONS.map((perm) => (
              <label
                key={perm.slug}
                className="flex items-center gap-2 p-2 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] text-[11px] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={rolePerms.includes(perm.slug)}
                  onChange={() => togglePerm(perm.slug)}
                />
                <span className="font-semibold text-[#1E1F1C]">{perm.label}</span>
              </label>
            ))}
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] font-bold text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Save Custom Role
          </button>
        </form>
      </div>

      {/* Staff Roster & Approvals Table */}
      <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E8E3D5] font-bold text-sm">
          Team Roster &amp; Invitation Status
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Outlet &amp; Branch</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Role &amp; Permissions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E3D5]">
              {staff.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-bold">{m.fullName}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#1E1F1C]">
                      {m.brandName || m.outletName || activeOutlet?.name || "Outlet"}
                    </div>
                    {m.branchName && (
                      <div className="text-[10px] text-[#5E5D57]">{m.branchName}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>{m.email || "—"}</div>
                    <div className="text-[#8A8880]">{m.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{m.outletRoleName || m.roleCode}</div>
                    <div className="text-[10px] text-[#8A8880]">{m.permissions.join(", ")}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {m.status === "PENDING_APPROVAL" && (
                        <button
                          type="button"
                          data-testid={`approve-staff-${m.id}`}
                          onClick={() => handleApprove(m.outletId, m.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#5F8E63] text-white font-bold"
                        >
                          <Check className="w-3 h-3" />
                          Approve
                        </button>
                      )}
                      {(m.status === "PENDING_ACCEPTANCE" || m.status === "INVITED") && (
                        <span className="text-[11px] text-[#8A8880]">Awaiting invitee accept</span>
                      )}
                      {m.status !== "REVOKED" && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(m.outletId, m.id)}
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
              {staff.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[#8A8880]">
                    No staff members or invitations across your outlets yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
