"use client";

import {
  Activity,
  Bike,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileSearch,
  KeyRound,
  LogOut,
  Map,
  MessageSquareWarning,
  Percent,
  ShieldCheck,
  Store,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { InvitationBanner } from "@/components/shared/InvitationBanner";
import { PortalSwitcher } from "@/components/shared/PortalSwitcher";
import { usePortalSession } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import type { AdminPermission } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

const ADMIN_NAV: {
  label: string;
  href: string;
  permission: AdminPermission;
  anyOf?: AdminPermission[];
  icon: typeof Activity;
}[] = [
  { label: "Live Ops Overview", href: "/admin/dashboard", permission: "orders:monitor", icon: Activity },
  { label: "Live Orders & Dispatch", href: "/admin/orders", permission: "orders:monitor", icon: Truck },
  { label: "Restaurant KYC", href: "/admin/restaurants", permission: "restaurants:verify", icon: Store },
  { label: "Courier KYC", href: "/admin/delivery-partners", permission: "partners:verify", icon: Bike },
  {
    label: "Users & Accounts",
    href: "/admin/users",
    permission: "users:manage",
    anyOf: [
      "users:manage",
      "users:customers:view",
      "users:customers:manage",
      "users:owners:view",
      "users:owners:manage",
      "users:outlets:view",
      "users:outlets:manage",
      "users:management:view",
      "users:management:manage",
      "users:delivery:view",
      "users:delivery:manage",
    ],
    icon: Users,
  },
  {
    label: "Roles & Invitations",
    href: "/admin/roles",
    permission: "users:manage",
    anyOf: ["users:manage", "roles:manage", "users:management:manage"],
    icon: KeyRound,
  },
  { label: "Payments & Refunds", href: "/admin/payments", permission: "refunds:approve", icon: CreditCard },
  { label: "Commissions & Promos", href: "/admin/commissions-pricing", permission: "commissions:configure", icon: Percent },
  { label: "Service Zones", href: "/admin/service-areas", permission: "zones:manage", icon: Map },
  { label: "Complaints Desk", href: "/admin/complaints", permission: "complaints:resolve", icon: MessageSquareWarning },
  { label: "Audit Logs", href: "/admin/audit-logs", permission: "audit_logs:view", icon: FileSearch },
];

interface SidebarSubmenuItem {
  key: string;
  label: string;
  href: string;
  testId: string;
  paramName: "tab" | "category";
  defaultActiveWhenMissing?: boolean;
  anyOf: AdminPermission[];
}

const RESTAURANT_KYC_SUBMENUS: SidebarSubmenuItem[] = [
  {
    key: "owners",
    label: "Owner KYC",
    href: "/admin/restaurants?tab=owners",
    testId: "admin-subnav-owner-kyc",
    paramName: "tab",
    defaultActiveWhenMissing: true,
    anyOf: ["restaurants:verify"],
  },
  {
    key: "outlets",
    label: "Outlet KYC",
    href: "/admin/restaurants?tab=outlets",
    testId: "admin-subnav-outlet-kyc",
    paramName: "tab",
    anyOf: ["restaurants:verify"],
  },
];

const USER_SUBMENUS: SidebarSubmenuItem[] = [
  {
    key: "customers",
    label: "Customer",
    href: "/admin/users?category=customers",
    testId: "admin-subnav-customers",
    paramName: "category",
    anyOf: ["users:manage", "users:customers:view", "users:customers:manage"],
  },
  {
    key: "owners",
    label: "Owners",
    href: "/admin/users?category=owners",
    testId: "admin-subnav-owners",
    paramName: "category",
    anyOf: ["users:manage", "users:owners:view", "users:owners:manage"],
  },
  {
    key: "outlets",
    label: "Outlets",
    href: "/admin/users?category=outlets",
    testId: "admin-subnav-outlets",
    paramName: "category",
    anyOf: ["users:manage", "users:outlets:view", "users:outlets:manage"],
  },
  {
    key: "management",
    label: "Management",
    href: "/admin/users?category=management",
    testId: "admin-subnav-management",
    paramName: "category",
    anyOf: ["users:manage", "users:management:view", "users:management:manage"],
  },
  {
    key: "delivery",
    label: "Delivery",
    href: "/admin/users?category=delivery",
    testId: "admin-subnav-delivery",
    paramName: "category",
    anyOf: ["users:manage", "users:delivery:view", "users:delivery:manage"],
  },
];

const SUBMENUS_BY_PATH: Record<string, { toggleTestId: string; items: SidebarSubmenuItem[] }> = {
  "/admin/restaurants": {
    toggleTestId: "toggle-subnav-restaurants",
    items: RESTAURANT_KYC_SUBMENUS,
  },
  "/admin/users": {
    toggleTestId: "toggle-subnav-users",
    items: USER_SUBMENUS,
  },
};

function AdminSidebarSubNav({
  parentHref,
  items,
  permissions,
}: {
  parentHref: string;
  items: SidebarSubmenuItem[];
  permissions: Set<AdminPermission>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <div className="pl-5 ml-3 border-l border-[#E8E3D5] space-y-0.5 py-0.5">
      {items.map((sub) => {
        const allowed = sub.anyOf.some((p) => permissions.has(p));
        const currentParam = searchParams.get(sub.paramName) ?? "";
        const active =
          pathname === parentHref &&
          (currentParam === sub.key || (sub.defaultActiveWhenMissing && currentParam === ""));
        return (
          <Link
            key={sub.key}
            href={sub.href}
            data-testid={sub.testId}
            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
              active
                ? "bg-[#F5EBA8] text-[#1E1F1C]"
                : allowed
                  ? "text-[#5E5D57] hover:bg-[#F5F0E2]"
                  : "text-[#8A8880]/60 hover:bg-[#F5F0E2]/40"
            }`}
          >
            <span>{sub.label}</span>
            {!allowed && (
              <span className="text-[8px] uppercase px-1 py-0.5 rounded bg-[#EFE9D8] text-[#8A8880]">
                Locked
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const isAuthPage = pathname === "/admin/login" || pathname === "/admin/register";
  const { data: session, isLoading: sessionLoading, isFetching: sessionFetching } = usePortalSession("admin");
  const user = session?.user ?? null;
  const pushToast = useAppStore((s) => s.pushToast);
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAuthPage && !sessionLoading && !sessionFetching && !user) {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isAuthPage, sessionLoading, sessionFetching, user, pathname, router]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (sessionLoading || (sessionFetching && !user) || !user) {
    return (
      <div className="min-h-screen bg-[#FCF9F0] flex items-center justify-center p-6 text-xs font-semibold text-[#5E5D57]">
        Checking Admin Governance session...
      </div>
    );
  }

  const permissions = new Set(user?.permissions ?? []);
  const isAdmin = Boolean(
    user?.roles.some((r) => r.endsWith("_ADMIN") || r === "CUSTOMER_CARE" || r.startsWith("CUSTOM_"))
  );
  const hasAdminAccess = isAdmin && permissions.size > 0;

  async function switchAdminRole(role: "SUPER_ADMIN" | "SUPPORT_ADMIN") {
    const switched = await services.auth.switchDemoPersona(role, "admin");
    qc.setQueryData(["sessionUser", "admin"], switched);
    await qc.invalidateQueries();
    pushToast("info", `Switched to ${switched.fullName}`);
  }

  async function handleLogout() {
    await services.auth.logout("admin");
    qc.removeQueries({ queryKey: ["portalSession", "admin"] });
    qc.removeQueries({ queryKey: ["sessionUser", "admin"] });
    await qc.invalidateQueries();
    pushToast("info", "Signed out of Admin Portal.");
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FCF9F0]">
      <aside className="w-full lg:w-68 bg-white border-b lg:border-b-0 lg:border-r border-[#E8E3D5] p-5 flex flex-col justify-between shrink-0">
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Link href="/admin/dashboard" className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-[#DEC146] text-[#1E1F1C] font-extrabold text-sm flex items-center justify-center">
                g
              </span>
              <span className="font-extrabold text-base text-[#1E1F1C]">
                goodly ops
              </span>
            </Link>
            <ShieldCheck className="w-4 h-4 text-[#5F8E63]" />
          </div>

          {/* Role Switcher for RBAC verification */}
          <div className="p-3 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] space-y-2 text-xs">
            <div className="font-bold text-[#1E1F1C] truncate">
              {isAdmin ? user?.fullName : "Not signed in as Admin"}
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                data-testid="switch-super-admin"
                onClick={() => switchAdminRole("SUPER_ADMIN")}
                className={`flex-1 py-1 rounded-lg font-bold border ${
                  user?.roles.includes("SUPER_ADMIN") ||
                  user?.roles.includes("PLATFORM_ADMIN")
                    ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                    : "bg-white border-[#E8E3D5] text-[#5E5D57]"
                }`}
              >
                Platform Admin
              </button>
              <button
                type="button"
                data-testid="switch-support-admin"
                onClick={() => switchAdminRole("SUPPORT_ADMIN")}
                className={`flex-1 py-1 rounded-lg font-bold border ${
                  user?.roles.includes("SUPPORT_ADMIN") ||
                  user?.roles.includes("CUSTOMER_CARE")
                    ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                    : "bg-white border-[#E8E3D5] text-[#5E5D57]"
                }`}
              >
                Customer Care
              </button>
            </div>
          </div>

          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
            {ADMIN_NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              const allowed = item.anyOf
                ? item.anyOf.some((p) => permissions.has(p))
                : permissions.has(item.permission);
              const subConfig = SUBMENUS_BY_PATH[item.href];
              const isExpanded = subConfig ? (expandedOverrides[item.href] ?? active) : false;
              return (
                <div key={item.href} className="space-y-0.5 shrink-0">
                  <div
                    className={`flex items-center justify-between gap-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                      active
                        ? "bg-[#DEC146] text-[#1E1F1C]"
                        : allowed
                          ? "text-[#5E5D57] hover:bg-[#F5F0E2]"
                          : "text-[#8A8880]/60 hover:bg-[#F5F0E2]/50"
                    }`}
                  >
                    <Link
                      href={item.href}
                      onClick={() => {
                        if (subConfig) {
                          setExpandedOverrides((prev) => ({ ...prev, [item.href]: true }));
                        }
                      }}
                      className="flex-1 flex items-center justify-between gap-2 px-3 py-2 min-w-0"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {!allowed && (
                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#EFE9D8] text-[#8A8880] shrink-0">
                          Locked
                        </span>
                      )}
                    </Link>
                    {subConfig && (
                      <button
                        type="button"
                        aria-label={`Toggle ${item.label} sub-menus`}
                        aria-expanded={isExpanded}
                        data-testid={subConfig.toggleTestId}
                        onClick={() =>
                          setExpandedOverrides((prev) => ({
                            ...prev,
                            [item.href]: !isExpanded,
                          }))
                        }
                        className="p-2 rounded-r-xl hover:bg-black/5 shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  {subConfig && isExpanded && (
                    <div className="hidden lg:block">
                      <Suspense fallback={null}>
                        <AdminSidebarSubNav
                          parentHref={item.href}
                          items={subConfig.items}
                          permissions={permissions}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block pt-5 border-t border-[#E8E3D5] space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#5E5D57] truncate">{user.email}</span>
            <button
              type="button"
              data-testid="admin-logout-btn"
              onClick={handleLogout}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E8E3D5] hover:bg-[#FDECEA] hover:text-[#C62828] font-semibold shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
          <PortalSwitcher />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-5">
          <InvitationBanner filterKind="PLATFORM" />
          {!hasAdminAccess ? (
            <div
              data-testid="admin-no-access-panel"
              className="max-w-2xl bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-3"
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
                ACCOUNT SIGNED IN · ZERO ADMIN ACCESS
              </div>
              <h1 className="text-xl font-extrabold text-[#1E1F1C]">
                Waiting for an eligible Admin invitation
              </h1>
              <p className="text-xs text-[#5E5D57] leading-relaxed">
                Welcome, <strong>{user.fullName}</strong>. Your account is active on the portal
                with zero governance permissions. Share your registered email (
                <strong>{user.email}</strong>) or phone (<strong>{user.phone}</strong>) with an
                eligible Admin so they can invite you to a role. Any pending invitations will appear
                right above this card for you to accept.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
        <div className="lg:hidden p-4 border-t border-[#E8E3D5] bg-white">
          <PortalSwitcher />
        </div>
      </div>
    </div>
  );
}
