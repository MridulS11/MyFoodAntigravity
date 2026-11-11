"use client";

import {
  Bike,
  Building2,
  KeyRound,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSessionUser } from "@/hooks/useGoodlyQueries";
import { formatMinor, formatOrderDate } from "@/lib/format";
import { services } from "@/services";
import type {
  AdminDirectoryCategory,
  AdminPermission,
  User,
} from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

const DIRECTORY_TABS: {
  key: AdminDirectoryCategory;
  label: string;
  viewPerms: AdminPermission[];
  managePerms: AdminPermission[];
}[] = [
  {
    key: "all",
    label: "All Users",
    viewPerms: ["users:manage"],
    managePerms: ["users:manage"],
  },
  {
    key: "customers",
    label: "Customer",
    viewPerms: ["users:manage", "users:customers:view", "users:customers:manage"],
    managePerms: ["users:manage", "users:customers:manage"],
  },
  {
    key: "owners",
    label: "Owners",
    viewPerms: ["users:manage", "users:owners:view", "users:owners:manage"],
    managePerms: ["users:manage", "users:owners:manage"],
  },
  {
    key: "outlets",
    label: "Outlets",
    viewPerms: ["users:manage", "users:outlets:view", "users:outlets:manage"],
    managePerms: ["users:manage", "users:outlets:manage"],
  },
  {
    key: "management",
    label: "Management",
    viewPerms: ["users:manage", "users:management:view", "users:management:manage"],
    managePerms: ["users:manage", "users:management:manage"],
  },
  {
    key: "delivery",
    label: "Delivery",
    viewPerms: ["users:manage", "users:delivery:view", "users:delivery:manage"],
    managePerms: ["users:manage", "users:delivery:manage"],
  },
];

const EXTRA_GRANULAR_PERMISSIONS: { slug: AdminPermission; label: string }[] = [
  { slug: "users:customers:view", label: "Customer View" },
  { slug: "users:customers:manage", label: "Customer Manage" },
  { slug: "users:owners:view", label: "Owners View" },
  { slug: "users:owners:manage", label: "Owners Manage" },
  { slug: "users:outlets:view", label: "Outlets View" },
  { slug: "users:outlets:manage", label: "Outlets Manage" },
  { slug: "users:management:view", label: "Management View" },
  { slug: "users:management:manage", label: "Management Manage" },
  { slug: "users:delivery:view", label: "Delivery View" },
  { slug: "users:delivery:manage", label: "Delivery Manage" },
  { slug: "users:manage", label: "Users Super Access" },
  { slug: "roles:manage", label: "Roles Governance" },
  { slug: "restaurants:verify", label: "Restaurant KYC" },
  { slug: "partners:verify", label: "Courier KYC" },
  { slug: "orders:monitor", label: "Orders Monitor" },
  { slug: "orders:intervene", label: "Orders Intervene" },
  { slug: "refunds:approve", label: "Refunds Approve" },
  { slug: "complaints:resolve", label: "Complaints Resolve" },
  { slug: "audit_logs:view", label: "Audit Logs" },
  { slug: "settings:manage", label: "Platform Settings" },
];

const NON_ADMIN_ROLES = new Set([
  "CUSTOMER",
  "OUTLET_OWNER",
  "RESTAURANT_OWNER",
  "BRANCH_MANAGER",
  "OUTLET_STAFF",
  "DELIVERY_PARTNER",
]);

function AdminUsersDirectoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const { data: currentAdmin } = useSessionUser("admin");

  const adminPerms = useMemo(
    () => new Set<AdminPermission>(currentAdmin?.permissions ?? []),
    [currentAdmin?.permissions]
  );

  const requestedCat = (searchParams.get("category") ?? "") as AdminDirectoryCategory;
  const isValidRequested = DIRECTORY_TABS.some((t) => t.key === requestedCat);
  const defaultCategory = useMemo<AdminDirectoryCategory>(() => {
    if (adminPerms.has("users:manage")) return "all";
    const firstAllowed = DIRECTORY_TABS.find(
      (t) => t.key !== "all" && t.viewPerms.some((p) => adminPerms.has(p))
    );
    return firstAllowed?.key ?? "all";
  }, [adminPerms]);

  const activeCategory: AdminDirectoryCategory = isValidRequested
    ? requestedCat
    : defaultCategory;

  const activeTabMeta = DIRECTORY_TABS.find((t) => t.key === activeCategory) ?? DIRECTORY_TABS[0];
  const canViewActive = activeTabMeta.viewPerms.some((p) => adminPerms.has(p));
  const canManageActive = activeTabMeta.managePerms.some((p) => adminPerms.has(p));
  const canManageUsersGlobal = adminPerms.has("users:manage");

  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<
    { kind: "user"; id: string; section: AdminDirectoryCategory } | { kind: "outlet"; id: string } | null
  >(null);

  // Management role editor draft overrides keyed by target user ID (avoids setState in useEffect)
  const [roleDrafts, setRoleDrafts] = useState<
    Record<string, { roleId?: string; customPerms?: AdminPermission[] }>
  >({});
  const [savingRole, setSavingRole] = useState(false);

  const { data: allUsers = [], isError: errAll, error: allErrObj } = useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => services.adminPortal.listAllUsers(),
    enabled: activeCategory === "all" && canViewActive,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["adminDirCustomers"],
    queryFn: () => services.adminPortal.listDirectoryCustomers(),
    enabled: activeCategory === "customers" && canViewActive,
  });

  const { data: owners = [] } = useQuery({
    queryKey: ["adminDirOwners"],
    queryFn: () => services.adminPortal.listDirectoryOwners(),
    enabled: activeCategory === "owners" && canViewActive,
  });

  const { data: outletsDir } = useQuery({
    queryKey: ["adminDirOutlets"],
    queryFn: () => services.adminPortal.listDirectoryOutlets(),
    enabled: activeCategory === "outlets" && canViewActive,
  });

  const { data: managementUsers = [] } = useQuery({
    queryKey: ["adminDirManagement"],
    queryFn: () => services.adminPortal.listDirectoryManagement(),
    enabled: activeCategory === "management" && canViewActive,
  });

  const { data: deliveryUsers = [] } = useQuery({
    queryKey: ["adminDirDelivery"],
    queryFn: () => services.adminPortal.listDirectoryDelivery(),
    enabled: activeCategory === "delivery" && canViewActive,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["adminRoles"],
    queryFn: () => services.adminPortal.listRoles(),
    enabled:
      activeCategory === "management" ||
      selectedTarget?.kind === "user" ||
      canManageUsersGlobal ||
      adminPerms.has("users:management:manage") ||
      adminPerms.has("roles:manage"),
    retry: false,
  });

  const { data: userDetail, isLoading: loadingUserDetail } = useQuery({
    queryKey: ["adminUserDetail", selectedTarget?.kind === "user" ? selectedTarget.id : null],
    queryFn: () =>
      services.adminPortal.getAdminUserDetail(
        selectedTarget?.kind === "user" ? selectedTarget.id : ""
      ),
    enabled: selectedTarget?.kind === "user",
  });

  const { data: outletDetail, isLoading: loadingOutletDetail } = useQuery({
    queryKey: ["adminOutletDetail", selectedTarget?.kind === "outlet" ? selectedTarget.id : null],
    queryFn: () =>
      services.adminPortal.getAdminOutletDetail(
        selectedTarget?.kind === "outlet" ? selectedTarget.id : ""
      ),
    enabled: selectedTarget?.kind === "outlet",
  });

  const assignableManagementRoles = useMemo(
    () => roles.filter((r) => !NON_ADMIN_ROLES.has(r.code)),
    [roles]
  );

  const inspectedUser = selectedTarget?.kind === "user" ? userDetail?.user : undefined;
  const currentDraft = inspectedUser ? roleDrafts[inspectedUser.id] : undefined;
  const matchedAdminRole = useMemo(() => {
    if (!inspectedUser) return undefined;
    const code = inspectedUser.roles.find((rc) => !NON_ADMIN_ROLES.has(rc));
    return assignableManagementRoles.find((r) => r.code === code);
  }, [inspectedUser, assignableManagementRoles]);

  const effectiveRoleId =
    currentDraft?.roleId ?? matchedAdminRole?.id ?? assignableManagementRoles[0]?.id ?? "";

  const effectiveCustomPerms = useMemo<AdminPermission[]>(() => {
    if (!inspectedUser) return [];
    if (currentDraft?.customPerms !== undefined) return currentDraft.customPerms;
    const base = new Set(matchedAdminRole?.permissions ?? []);
    return inspectedUser.permissions.filter((p) => !base.has(p));
  }, [inspectedUser, currentDraft, matchedAdminRole]);

  function selectTab(cat: AdminDirectoryCategory) {
    setSelectedTarget(null);
    setConfirmDeleteId(null);
    setActionError(null);
    router.push(cat === "all" ? "/admin/users" : `/admin/users?category=${cat}`);
  }

  async function toggleStatus(userId: string, current: User["status"]) {
    setActionError(null);
    const next = current === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      await services.adminPortal.updateUserStatus(
        userId,
        next,
        `Admin toggled status to ${next}`
      );
      await qc.invalidateQueries();
      pushToast("info", `Account status updated to ${next}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update status.";
      setActionError(msg);
      pushToast("error", msg);
    }
  }

  async function handleDeleteUser(userId: string) {
    setActionError(null);
    setDeletingId(userId);
    try {
      await services.adminPortal.deleteUser(userId);
      setConfirmDeleteId(null);
      if (selectedTarget?.kind === "user" && selectedTarget.id === userId) {
        setSelectedTarget(null);
      }
      await qc.invalidateQueries();
      pushToast("info", "User account deleted permanently.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete user.";
      setActionError(msg);
      pushToast("error", msg);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveManagementRoles(targetUserId: string) {
    if (!effectiveRoleId) {
      pushToast("error", "Select a management role.");
      return;
    }
    setSavingRole(true);
    setActionError(null);
    try {
      await services.adminPortal.updateManagementUserRoles(targetUserId, {
        roleId: effectiveRoleId,
        customPermissions: effectiveCustomPerms,
      });
      setRoleDrafts((prev) => {
        const next = { ...prev };
        delete next[targetUserId];
        return next;
      });
      await qc.invalidateQueries();
      pushToast("success", "Management user role & granular permissions updated.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update user roles.";
      setActionError(msg);
      pushToast("error", msg);
    } finally {
      setSavingRole(false);
    }
  }

  function renderUserActionButtons(userId: string, status: User["status"], canManage: boolean) {
    if (!canManage) {
      return <span className="text-[11px] text-[#8A8880]">View only</span>;
    }
    return (
      <div
        className="flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => toggleStatus(userId, status)}
          className="px-2.5 py-1 rounded-lg border border-[#E8E3D5] hover:bg-[#F5F0E2] font-semibold"
        >
          {status === "ACTIVE" ? "Suspend" : "Reactivate"}
        </button>
        {currentAdmin?.id !== userId &&
          (confirmDeleteId === userId ? (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                data-testid={`confirm-delete-user-${userId}`}
                disabled={deletingId === userId}
                onClick={() => handleDeleteUser(userId)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#C62828] text-white font-bold disabled:opacity-50"
              >
                {deletingId === userId ? "Deleting..." : "Confirm Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-2 py-1 rounded-lg border border-[#E8E3D5] text-[#5E5D57] font-semibold"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid={`delete-user-${userId}`}
              onClick={() => setConfirmDeleteId(userId)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#FAC8C3] text-[#C62828] hover:bg-[#FDECEA] font-semibold"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          ))}
      </div>
    );
  }

  const q = search.trim().toLowerCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
            USERS &amp; ACCOUNTS DIRECTORY
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
            Customer, Owners, Outlets, Management &amp; Delivery
          </h1>
          <p className="text-xs text-[#5E5D57] mt-1">
            Select a sub-section or click any row to inspect section-specific details and manage access.
          </p>
        </div>
        {(canManageUsersGlobal ||
          adminPerms.has("roles:manage") ||
          adminPerms.has("users:management:manage")) && (
          <Link
            href="/admin/roles"
            className="px-4 py-2 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs"
          >
            Manage Admin Roles, Invitations &amp; Approvals →
          </Link>
        )}
      </div>

      {/* Category Sub-Menus Bar + Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#E8E3D5] rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {DIRECTORY_TABS.map((tab) => {
            const allowed = tab.viewPerms.some((p) => adminPerms.has(p));
            const active = activeCategory === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                data-testid={`dir-tab-${tab.key}`}
                onClick={() => selectTab(tab.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                  active
                    ? "bg-[#1E1F1C] text-[#FCF9F0]"
                    : allowed
                      ? "bg-[#FCF9F0] text-[#5E5D57] hover:bg-[#F5F0E2] border border-[#E8E3D5]"
                      : "bg-[#FCF9F0] text-[#8A8880]/60 border border-[#E8E3D5]/70"
                }`}
              >
                {tab.label}
                {!allowed && " (Locked)"}
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-[#8A8880] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, email, city..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-[#E8E3D5] bg-[#FCF9F0] text-xs"
          />
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl bg-[#FDECEA] border border-[#FAC8C3] px-4 py-2.5 text-xs font-medium text-[#C62828]">
          {actionError}
        </div>
      )}

      {!canViewActive || errAll ? (
        <div
          data-testid="directory-rbac-denied"
          className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]"
        >
          {allErrObj instanceof Error
            ? allErrObj.message
            : `403 Forbidden: Missing granular permission to view "${activeTabMeta.label}".`}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Directory Table Column */}
          <div className={selectedTarget ? "xl:col-span-7 space-y-5" : "xl:col-span-12 space-y-5"}>
            {/* ALL USERS */}
            {activeCategory === "all" && (
              <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#E8E3D5] flex items-center gap-2 font-bold text-xs text-[#1E1F1C]">
                  <Users className="w-4 h-4 text-[#5F8E63]" />
                  <span>All Platform Accounts ({allUsers.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
                      <tr>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Roles</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E3D5]">
                      {allUsers
                        .filter(
                          (u) =>
                            !q ||
                            u.fullName.toLowerCase().includes(q) ||
                            u.email.toLowerCase().includes(q) ||
                            u.roles.some((r) => r.toLowerCase().includes(q))
                        )
                        .map((u) => (
                          <tr
                            key={u.id}
                            data-testid={`dir-row-${u.id}`}
                            onClick={() => setSelectedTarget({ kind: "user", id: u.id, section: "all" })}
                            className="hover:bg-[#FCF9F0] cursor-pointer"
                          >
                            <td className="px-4 py-3 font-bold text-[#1E1F1C]">{u.fullName}</td>
                            <td className="px-4 py-3">{u.email}</td>
                            <td className="px-4 py-3">{u.roles.join(", ")}</td>
                            <td className="px-4 py-3">
                              <StatusBadge status={u.status} />
                            </td>
                            <td className="px-4 py-3">
                              {renderUserActionButtons(u.id, u.status, canManageActive)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* CUSTOMERS */}
            {activeCategory === "customers" && (
              <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#E8E3D5] flex items-center gap-2 font-bold text-xs text-[#1E1F1C]">
                  <UserCheck className="w-4 h-4 text-[#5F8E63]" />
                  <span>Customers Directory ({customers.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
                      <tr>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Contact</th>
                        <th className="px-4 py-3">Addresses / Orders</th>
                        <th className="px-4 py-3">Total Spend</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E3D5]">
                      {customers
                        .filter(
                          (c) =>
                            !q ||
                            c.fullName.toLowerCase().includes(q) ||
                            c.email.toLowerCase().includes(q) ||
                            c.phone.toLowerCase().includes(q)
                        )
                        .map((c) => (
                          <tr
                            key={c.id}
                            data-testid={`dir-row-${c.id}`}
                            onClick={() =>
                              setSelectedTarget({ kind: "user", id: c.id, section: "customers" })
                            }
                            className="hover:bg-[#FCF9F0] cursor-pointer"
                          >
                            <td className="px-4 py-3">
                              <div className="font-bold text-[#1E1F1C]">{c.fullName}</div>
                              <div className="text-[11px] text-[#8A8880]">
                                {c.isEmailVerified ? "Email Verified" : "Unverified"}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div>{c.email}</div>
                              <div className="text-[11px] text-[#8A8880]">{c.phone || "—"}</div>
                            </td>
                            <td className="px-4 py-3 font-semibold">
                              {c.addressesCount} addr · {c.ordersCount} orders
                            </td>
                            <td className="px-4 py-3 font-bold">
                              {formatMinor(c.totalSpentMinor)}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={c.status} />
                            </td>
                            <td className="px-4 py-3">
                              {renderUserActionButtons(c.id, c.status, canManageActive)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* OWNERS */}
            {activeCategory === "owners" && (
              <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#E8E3D5] flex items-center gap-2 font-bold text-xs text-[#1E1F1C]">
                  <Building2 className="w-4 h-4 text-[#5F8E63]" />
                  <span>Restaurant Owners Directory ({owners.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
                      <tr>
                        <th className="px-4 py-3">Owner</th>
                        <th className="px-4 py-3">Organization</th>
                        <th className="px-4 py-3">Owner KYC</th>
                        <th className="px-4 py-3">Outlets</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E3D5]">
                      {owners
                        .filter(
                          (o) =>
                            !q ||
                            o.fullName.toLowerCase().includes(q) ||
                            o.email.toLowerCase().includes(q) ||
                            (o.organizationName ?? "").toLowerCase().includes(q)
                        )
                        .map((o) => (
                          <tr
                            key={o.id}
                            data-testid={`dir-row-${o.id}`}
                            onClick={() =>
                              setSelectedTarget({ kind: "user", id: o.id, section: "owners" })
                            }
                            className="hover:bg-[#FCF9F0] cursor-pointer"
                          >
                            <td className="px-4 py-3">
                              <div className="font-bold text-[#1E1F1C]">{o.fullName}</div>
                              <div className="text-[11px] text-[#8A8880]">{o.email}</div>
                            </td>
                            <td className="px-4 py-3 font-semibold">
                              {o.organizationName || "Independent Owner"}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={o.kycStatus} />
                            </td>
                            <td className="px-4 py-3 font-semibold">
                              {o.approvedOutletsCount} / {o.outletsCount} approved
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={o.status} />
                            </td>
                            <td className="px-4 py-3">
                              {renderUserActionButtons(o.id, o.status, canManageActive)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* OUTLETS & BRANCH STAFF */}
            {activeCategory === "outlets" && (
              <div className="space-y-5">
                <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#E8E3D5] flex items-center gap-2 font-bold text-xs text-[#1E1F1C]">
                    <Store className="w-4 h-4 text-[#5F8E63]" />
                    <span>Registered Outlets &amp; Branches ({outletsDir?.outlets.length ?? 0})</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
                        <tr>
                          <th className="px-4 py-3">Outlet / Branch</th>
                          <th className="px-4 py-3">Owner</th>
                          <th className="px-4 py-3">Menu / Orders / Staff</th>
                          <th className="px-4 py-3">KYC Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E3D5]">
                        {(outletsDir?.outlets ?? [])
                          .filter(
                            (o) =>
                              !q ||
                              o.name.toLowerCase().includes(q) ||
                              (o.branchName ?? "").toLowerCase().includes(q) ||
                              o.city.toLowerCase().includes(q) ||
                              o.ownerName.toLowerCase().includes(q)
                          )
                          .map((o) => (
                            <tr
                              key={o.id}
                              data-testid={`dir-outlet-row-${o.id}`}
                              onClick={() => setSelectedTarget({ kind: "outlet", id: o.id })}
                              className="hover:bg-[#FCF9F0] cursor-pointer"
                            >
                              <td className="px-4 py-3">
                                <div className="font-bold text-[#1E1F1C]">
                                  {o.brandName || o.name}
                                  {o.branchName ? ` · ${o.branchName}` : ""}
                                </div>
                                <div className="text-[11px] text-[#8A8880]">{o.city}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-semibold">{o.ownerName}</div>
                                <div className="text-[11px] text-[#8A8880]">{o.ownerEmail}</div>
                              </td>
                              <td className="px-4 py-3 font-semibold">
                                {o.menuItemsCount} items · {o.ordersCount} orders · {o.staffCount} staff
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={o.verificationStatus} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#E8E3D5] font-bold text-xs text-[#1E1F1C]">
                    Outlet Managers &amp; Branch Staff ({outletsDir?.staff.length ?? 0})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
                        <tr>
                          <th className="px-4 py-3">Staff Member</th>
                          <th className="px-4 py-3">Outlets</th>
                          <th className="px-4 py-3">Roles</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E3D5]">
                        {(outletsDir?.staff ?? [])
                          .filter(
                            (s) =>
                              !q ||
                              s.fullName.toLowerCase().includes(q) ||
                              s.email.toLowerCase().includes(q) ||
                              s.outletNames.some((n) => n.toLowerCase().includes(q))
                          )
                          .map((s) => (
                            <tr
                              key={s.id}
                              data-testid={`dir-row-${s.id}`}
                              onClick={() =>
                                setSelectedTarget({ kind: "user", id: s.id, section: "outlets" })
                              }
                              className="hover:bg-[#FCF9F0] cursor-pointer"
                            >
                              <td className="px-4 py-3">
                                <div className="font-bold text-[#1E1F1C]">{s.fullName}</div>
                                <div className="text-[11px] text-[#8A8880]">{s.email}</div>
                              </td>
                              <td className="px-4 py-3 text-[11px]">
                                {s.outletNames.length > 0 ? s.outletNames.join(", ") : "Unassigned"}
                              </td>
                              <td className="px-4 py-3 font-semibold">
                                {s.staffRoles.join(", ") || "OUTLET_STAFF"}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={s.status} />
                              </td>
                              <td className="px-4 py-3">
                                {renderUserActionButtons(s.id, s.status, canManageActive)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* MANAGEMENT */}
            {activeCategory === "management" && (
              <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#E8E3D5] flex items-center gap-2 font-bold text-xs text-[#1E1F1C]">
                  <ShieldCheck className="w-4 h-4 text-[#5F8E63]" />
                  <span>Management &amp; Platform Admins ({managementUsers.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
                      <tr>
                        <th className="px-4 py-3">Admin / Manager</th>
                        <th className="px-4 py-3">Assigned Roles</th>
                        <th className="px-4 py-3">Granular Permissions</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E3D5]">
                      {managementUsers
                        .filter(
                          (m) =>
                            !q ||
                            m.fullName.toLowerCase().includes(q) ||
                            m.email.toLowerCase().includes(q) ||
                            m.roles.some((r) => r.toLowerCase().includes(q))
                        )
                        .map((m) => (
                          <tr
                            key={m.id}
                            data-testid={`dir-row-${m.id}`}
                            onClick={() =>
                              setSelectedTarget({
                                kind: "user",
                                id: m.id,
                                section: "management",
                              })
                            }
                            className="hover:bg-[#FCF9F0] cursor-pointer"
                          >
                            <td className="px-4 py-3">
                              <div className="font-bold text-[#1E1F1C]">{m.fullName}</div>
                              <div className="text-[11px] text-[#8A8880]">{m.email}</div>
                            </td>
                            <td className="px-4 py-3 font-semibold">{m.roles.join(", ")}</td>
                            <td className="px-4 py-3">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#FCF9F0] border border-[#E8E3D5]">
                                {m.permissions.length} perms
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={m.status} />
                            </td>
                            <td className="px-4 py-3">
                              <div
                                className="flex flex-wrap items-center gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {canManageActive && currentAdmin?.id !== m.id && (
                                  <button
                                    type="button"
                                    data-testid={`edit-mgmt-role-${m.id}`}
                                    onClick={() =>
                                      setSelectedTarget({
                                        kind: "user",
                                        id: m.id,
                                        section: "management",
                                      })
                                    }
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#DEC146] text-[#1E1F1C] font-bold"
                                  >
                                    <KeyRound className="w-3 h-3" />
                                    Change Role
                                  </button>
                                )}
                                {renderUserActionButtons(m.id, m.status, canManageActive)}
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* DELIVERY */}
            {activeCategory === "delivery" && (
              <div className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#E8E3D5] flex items-center gap-2 font-bold text-xs text-[#1E1F1C]">
                  <Bike className="w-4 h-4 text-[#5F8E63]" />
                  <span>Delivery Fleet Partners ({deliveryUsers.length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FCF9F0] text-[#8A8880] uppercase">
                      <tr>
                        <th className="px-4 py-3">Courier</th>
                        <th className="px-4 py-3">Vehicle &amp; Plate</th>
                        <th className="px-4 py-3">Deliveries / Rating</th>
                        <th className="px-4 py-3">KYC / Availability</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E3D5]">
                      {deliveryUsers
                        .filter(
                          (d) =>
                            !q ||
                            d.fullName.toLowerCase().includes(q) ||
                            d.email.toLowerCase().includes(q) ||
                            (d.licensePlate ?? "").toLowerCase().includes(q)
                        )
                        .map((d) => (
                          <tr
                            key={d.id}
                            data-testid={`dir-row-${d.id}`}
                            onClick={() =>
                              setSelectedTarget({ kind: "user", id: d.id, section: "delivery" })
                            }
                            className="hover:bg-[#FCF9F0] cursor-pointer"
                          >
                            <td className="px-4 py-3">
                              <div className="font-bold text-[#1E1F1C]">{d.fullName}</div>
                              <div className="text-[11px] text-[#8A8880]">{d.email}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-semibold">
                                {d.vehicleType || "—"} {d.vehicleModel ? `· ${d.vehicleModel}` : ""}
                              </div>
                              <div className="text-[11px] font-mono text-[#8A8880]">
                                {d.licensePlate || "—"}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-semibold">
                              {d.totalDeliveriesCount} trips · ★ {d.ratingAverage.toFixed(1)}
                            </td>
                            <td className="px-4 py-3 space-y-1">
                              <StatusBadge status={d.verificationStatus} />
                              <div className="text-[10px] font-bold text-[#5E5D57]">
                                {d.availabilityStatus}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {renderUserActionButtons(d.id, d.status, canManageActive)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Rich Section-Aware Detail Inspector */}
          {selectedTarget && (
            <div
              data-testid="directory-detail-drawer"
              className="xl:col-span-5 bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-4 sticky top-6"
            >
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#E8E3D5]">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
                    {selectedTarget.kind === "outlet"
                      ? "OUTLET INSPECTOR"
                      : `${selectedTarget.section.toUpperCase()} ACCOUNT DETAILS`}
                  </div>
                  <h2 className="text-base font-extrabold text-[#1E1F1C] mt-0.5">
                    {selectedTarget.kind === "outlet"
                      ? outletDetail?.outlet.name || "Loading outlet..."
                      : userDetail?.user.fullName || "Loading account..."}
                  </h2>
                </div>
                <button
                  type="button"
                  data-testid="close-detail-drawer"
                  onClick={() => setSelectedTarget(null)}
                  className="p-1.5 rounded-lg border border-[#E8E3D5] hover:bg-[#F5F0E2]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {selectedTarget.kind === "user" && (
                <>
                  {loadingUserDetail || !userDetail ? (
                    <div className="text-xs text-[#8A8880]">Loading account details...</div>
                  ) : (
                    <div className="space-y-4 text-xs">
                      <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]">
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Email</div>
                          <div className="font-semibold break-all">{userDetail.user.email}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Phone</div>
                          <div className="font-semibold">{userDetail.user.phone || "—"}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Roles</div>
                          <div className="font-semibold">{userDetail.user.roles.join(", ")}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Status</div>
                          <StatusBadge status={userDetail.user.status} />
                        </div>
                      </div>

                      {/* Customer-relevant section */}
                      {(selectedTarget.section === "customers" ||
                        userDetail.addresses.length > 0 ||
                        userDetail.orders.length > 0) && (
                        <div className="space-y-2 border-t border-[#E8E3D5] pt-3">
                          <div className="font-bold text-[#1E1F1C]">
                            Customer Activity ({userDetail.orders.length} recent orders ·{" "}
                            {userDetail.complaintsCount} complaints)
                          </div>
                          {userDetail.addresses.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-[#5E5D57]">
                                Saved Addresses ({userDetail.addresses.length})
                              </div>
                              {userDetail.addresses.map((a) => (
                                <div
                                  key={a.id}
                                  className="px-2.5 py-1.5 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] text-[11px]"
                                >
                                  <span className="font-bold">{a.label}:</span> {a.addressLine1},{" "}
                                  {a.city} {a.postalCode}
                                </div>
                              ))}
                            </div>
                          )}
                          {userDetail.orders.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-[#5E5D57]">
                                Recent Orders
                              </div>
                              {userDetail.orders.map((o) => (
                                <div
                                  key={o.id}
                                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] text-[11px]"
                                >
                                  <div>
                                    <span className="font-bold">{o.orderNumber}</span> ·{" "}
                                    {o.restaurantName}
                                  </div>
                                  <div className="font-bold">
                                    {formatMinor(o.totalPayableMinor)} ({o.orderStatus})
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Owner-relevant section */}
                      {(selectedTarget.section === "owners" || userDetail.ownerProfile) && (
                        <div className="space-y-2 border-t border-[#E8E3D5] pt-3">
                          <div className="font-bold text-[#1E1F1C]">Owner KYC &amp; Outlets</div>
                          {userDetail.ownerProfile ? (
                            <div className="p-2.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] space-y-1 text-[11px]">
                              <div>
                                <span className="font-semibold">Organization:</span>{" "}
                                {userDetail.ownerProfile.organizationName || "Independent"}
                              </div>
                              <div>
                                <span className="font-semibold">ID Document:</span>{" "}
                                {userDetail.ownerProfile.idDocumentType} ·{" "}
                                {userDetail.ownerProfile.idDocumentNumber}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">KYC Status:</span>
                                <StatusBadge status={userDetail.ownerProfile.verificationStatus} />
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-[#8A8880]">
                              No Owner KYC profile submitted yet.
                            </div>
                          )}
                          {userDetail.ownedOutlets.length > 0 && (
                            <div className="space-y-1">
                              {userDetail.ownedOutlets.map((o) => (
                                <div
                                  key={o.id}
                                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] text-[11px]"
                                >
                                  <span>
                                    <strong>{o.brandName || o.name}</strong>
                                    {o.branchName ? ` · ${o.branchName}` : ""} ({o.city})
                                  </span>
                                  <StatusBadge status={o.verificationStatus} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Outlet staff assignments */}
                      {userDetail.staffAssignments.length > 0 && (
                        <div className="space-y-2 border-t border-[#E8E3D5] pt-3">
                          <div className="font-bold text-[#1E1F1C]">
                            Outlet Branch Assignments ({userDetail.staffAssignments.length})
                          </div>
                          {userDetail.staffAssignments.map((s) => (
                            <div
                              key={s.id}
                              className="p-2.5 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] text-[11px] space-y-1"
                            >
                              <div className="flex items-center justify-between font-bold">
                                <span>
                                  {s.outletName}
                                  {s.branchName ? ` · ${s.branchName}` : ""}
                                </span>
                                <StatusBadge status={s.status} />
                              </div>
                              <div>
                                Role: {s.outletRoleName || s.roleCode} · Perms:{" "}
                                {s.permissions.join(", ") || "Inherited"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Delivery partner section */}
                      {(selectedTarget.section === "delivery" || userDetail.partnerProfile) && (
                        <div className="space-y-2 border-t border-[#E8E3D5] pt-3">
                          <div className="font-bold text-[#1E1F1C]">
                            Courier Profile &amp; Recent Deliveries
                          </div>
                          {userDetail.partnerProfile ? (
                            <div className="p-2.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] space-y-1 text-[11px]">
                              <div>
                                <span className="font-semibold">Vehicle:</span>{" "}
                                {userDetail.partnerProfile.vehicleType}{" "}
                                {userDetail.partnerProfile.vehicleModel
                                  ? `· ${userDetail.partnerProfile.vehicleModel}`
                                  : ""}{" "}
                                ({userDetail.partnerProfile.licensePlate || "No plate"})
                              </div>
                              <div>
                                <span className="font-semibold">Stats:</span>{" "}
                                {userDetail.partnerProfile.totalDeliveriesCount} deliveries · ★{" "}
                                {userDetail.partnerProfile.ratingAverage.toFixed(1)} ·{" "}
                                {userDetail.partnerProfile.availabilityStatus}
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-[#8A8880]">
                              No courier vehicle profile registered yet.
                            </div>
                          )}
                          {userDetail.recentDeliveries.map((d, idx) => (
                            <div
                              key={`${d.orderNumber}-${idx}`}
                              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] text-[11px]"
                            >
                              <span>
                                <strong>{d.orderNumber}</strong> · {d.restaurantName}
                              </span>
                              <span>
                                {d.status} · {formatOrderDate(d.createdAt)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Management Role & Granular Permissions Editor */}
                      {(selectedTarget.section === "management" ||
                        userDetail.user.roles.some((r) => !NON_ADMIN_ROLES.has(r))) && (
                        <div
                          data-testid="mgmt-role-editor"
                          className="space-y-3 border-t border-[#E8E3D5] pt-3"
                        >
                          <div className="font-bold text-[#1E1F1C] flex items-center gap-1.5">
                            <KeyRound className="w-3.5 h-3.5 text-[#5F8E63]" />
                            <span>Management Role &amp; Granular Permissions</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {userDetail.user.permissions.map((p) => (
                              <span
                                key={p}
                                className="px-2 py-0.5 rounded bg-[#FCF9F0] border border-[#E8E3D5] font-mono text-[10px]"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                          {canManageUsersGlobal || adminPerms.has("users:management:manage") ? (
                            currentAdmin?.id === userDetail.user.id ? (
                              <div className="text-[11px] text-[#8A8880] italic">
                                You cannot change your own active admin role here.
                              </div>
                            ) : (
                              <div className="space-y-3 p-3 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]">
                                <div>
                                  <label className="block text-[11px] font-bold mb-1">
                                    Assign Management Role
                                  </label>
                                  <select
                                    data-testid="mgmt-role-select"
                                    value={effectiveRoleId}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const uid = userDetail.user.id;
                                      setRoleDrafts((prev) => ({
                                        ...prev,
                                        [uid]: { ...prev[uid], roleId: val },
                                      }));
                                    }}
                                    className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs bg-white"
                                  >
                                    {assignableManagementRoles.map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {r.name} ({r.code})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <div className="text-[11px] font-bold mb-1.5">
                                    Additional Granular Permission Overrides
                                  </div>
                                  <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto p-2 rounded-lg bg-white border border-[#E8E3D5]">
                                    {EXTRA_GRANULAR_PERMISSIONS.map((perm) => (
                                      <label
                                        key={perm.slug}
                                        className="flex items-center gap-1.5 text-[10px] cursor-pointer"
                                      >
                                        <input
                                          type="checkbox"
                                          data-testid={`mgmt-perm-${perm.slug}`}
                                          checked={effectiveCustomPerms.includes(perm.slug)}
                                          onChange={() => {
                                            const uid = userDetail.user.id;
                                            const next = effectiveCustomPerms.includes(perm.slug)
                                              ? effectiveCustomPerms.filter((x) => x !== perm.slug)
                                              : [...effectiveCustomPerms, perm.slug];
                                            setRoleDrafts((prev) => ({
                                              ...prev,
                                              [uid]: { ...prev[uid], customPerms: next },
                                            }));
                                          }}
                                        />
                                        <span className="truncate font-mono">{perm.slug}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  data-testid="save-mgmt-role-btn"
                                  disabled={savingRole}
                                  onClick={() => handleSaveManagementRoles(userDetail.user.id)}
                                  className="w-full py-2 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] font-bold text-xs disabled:opacity-50"
                                >
                                  {savingRole ? "Saving..." : "Save Role & Granular Permissions"}
                                </button>
                              </div>
                            )
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {selectedTarget.kind === "outlet" && (
                <>
                  {loadingOutletDetail || !outletDetail ? (
                    <div className="text-xs text-[#8A8880]">Loading outlet details...</div>
                  ) : (
                    <div className="space-y-4 text-xs">
                      <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]">
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Branch / City</div>
                          <div className="font-semibold">
                            {outletDetail.outlet.branchName || "Main"} · {outletDetail.outlet.city}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Owner</div>
                          <div className="font-semibold">{outletDetail.outlet.ownerName}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Menu / Orders</div>
                          <div className="font-semibold">
                            {outletDetail.outlet.menuItemsCount} items ·{" "}
                            {outletDetail.outlet.ordersCount} orders
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[#8A8880] uppercase">Total GMV</div>
                          <div className="font-bold">
                            {formatMinor(outletDetail.outlet.totalGmvMinor)}
                          </div>
                        </div>
                      </div>
                      <div className="text-[11px] text-[#5E5D57]">
                        {outletDetail.outlet.addressLine1}, {outletDetail.outlet.city},{" "}
                        {outletDetail.outlet.state} {outletDetail.outlet.postalCode}
                      </div>
                      <div className="space-y-1.5 border-t border-[#E8E3D5] pt-3">
                        <div className="font-bold text-[#1E1F1C]">
                          Branch Team ({outletDetail.staff.length})
                        </div>
                        {outletDetail.staff.length === 0 ? (
                          <div className="text-[11px] text-[#8A8880]">No branch staff assigned.</div>
                        ) : (
                          outletDetail.staff.map((st) => (
                            <div
                              key={st.id}
                              className="p-2 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] flex items-center justify-between text-[11px]"
                            >
                              <div>
                                <div className="font-bold">{st.fullName}</div>
                                <div className="text-[#8A8880]">
                                  {st.email} · {st.role}
                                </div>
                              </div>
                              <StatusBadge status={st.status} />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 text-xs text-[#5E5D57]">
          Loading Admin Directory...
        </div>
      }
    >
      <AdminUsersDirectoryContent />
    </Suspense>
  );
}
