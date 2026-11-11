"use client";

import {
  ChefHat,
  Clock,
  DollarSign,
  FileCheck,
  LogOut,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InvitationBanner } from "@/components/shared/InvitationBanner";
import { PortalSwitcher } from "@/components/shared/PortalSwitcher";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePortalSession } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

const NAV_ITEMS = [
  { label: "Live Orders (KDS)", href: "/restaurant/orders", icon: ChefHat },
  { label: "Menu & Stock", href: "/restaurant/menu", icon: UtensilsCrossed },
  { label: "Operating Hours", href: "/restaurant/hours", icon: Clock },
  { label: "Sales & Settlements", href: "/restaurant/earnings", icon: DollarSign },
  { label: "Users & Roles", href: "/restaurant/team", icon: Users },
  { label: "Onboarding & Locations", href: "/restaurant/onboarding", icon: FileCheck },
];

export default function RestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const isAuthPage =
    pathname === "/restaurant/login" || pathname === "/restaurant/register";
  const { data: session, isLoading: sessionLoading, isFetching: sessionFetching } =
    usePortalSession("restaurant");
  const authed = Boolean(session?.user);

  useEffect(() => {
    if (!isAuthPage && !sessionLoading && !sessionFetching && !authed) {
      router.replace(`/restaurant/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isAuthPage, sessionLoading, sessionFetching, authed, pathname, router]);

  const { data: outlets = [], isLoading: outletsLoading } = useQuery({
    queryKey: ["myOutlets", session?.user?.id],
    queryFn: () => services.restaurantPortal.listMyOutlets(),
    enabled: !isAuthPage && authed,
  });

  const hasOutletAccess = outlets.length > 0;
  const allowOnboardingPage = pathname === "/restaurant/onboarding";

  const { data } = useQuery({
    queryKey: ["myRestaurant", session?.user?.id],
    queryFn: () => services.restaurantPortal.getMyRestaurant(),
    enabled: !isAuthPage && authed && hasOutletAccess,
    retry: false,
  });

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (sessionLoading || (sessionFetching && !authed) || !authed) {
    return (
      <div className="min-h-screen bg-[#FCF9F0] flex items-center justify-center p-6 text-xs font-semibold text-[#5E5D57]">
        Checking Restaurant Partner session...
      </div>
    );
  }

  async function handleLogout() {
    await services.auth.logout("restaurant");
    qc.removeQueries({ queryKey: ["portalSession", "restaurant"] });
    qc.removeQueries({ queryKey: ["sessionUser", "restaurant"] });
    await qc.invalidateQueries();
    pushToast("info", "Signed out of Restaurant Portal.");
    router.replace("/restaurant/login");
  }

  const restaurant = data?.restaurant;

  const outletGroups = Object.entries(
    outlets.reduce<Record<string, typeof outlets>>((acc, o) => {
      const groupName = (o.brandName || o.name).trim();
      if (!acc[groupName]) acc[groupName] = [];
      acc[groupName].push(o);
      return acc;
    }, {})
  );
  const activeGroupEntry = restaurant
    ? outletGroups.find(([, branches]) =>
        branches.some((b) => b.id === restaurant.id)
      ) ?? outletGroups[0]
    : outletGroups[0];
  const activeGroupName = activeGroupEntry?.[0] ?? "";
  const activeGroupBranches = activeGroupEntry?.[1] ?? [];

  async function handleSwitchOutlet(outletId: string) {
    try {
      await services.restaurantPortal.switchActiveOutlet(outletId);
      await qc.invalidateQueries();
      pushToast("info", "Switched active restaurant outlet.");
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Failed to switch outlet."
      );
    }
  }

  async function handleToggleKitchen() {
    if (!restaurant) return;
    try {
      await services.restaurantPortal.toggleAcceptingOrders(
        !restaurant.isAcceptingOrders
      );
      await qc.invalidateQueries({ queryKey: ["myRestaurant"] });
      pushToast(
        "info",
        !restaurant.isAcceptingOrders
          ? `${restaurant.name} is now accepting orders.`
          : `${restaurant.name} kitchen is paused.`
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Action blocked.");
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FCF9F0]">
      {/* Sidebar */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-[#E8E3D5] p-5 flex flex-col justify-between shrink-0">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-[#DEC146] text-[#1E1F1C] font-extrabold text-sm flex items-center justify-center">
                g
              </span>
              <span className="font-extrabold text-base text-[#1E1F1C]">
                goodly kitchen
              </span>
            </Link>
          </div>

          {restaurant && (
            <div className="p-3.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] space-y-2.5">
              {outlets.length > 0 && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A8880] mb-1">
                      Active Outlet {outletGroups.length > 1 ? `(${outletGroups.length})` : ""}
                    </label>
                    <select
                      data-testid="outlet-group-select"
                      value={activeGroupName}
                      onChange={(e) => {
                        const targetGroup = outletGroups.find(
                          ([gName]) => gName === e.target.value
                        );
                        const firstBranch = targetGroup?.[1]?.[0];
                        if (firstBranch) handleSwitchOutlet(firstBranch.id);
                      }}
                      className="w-full bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#1E1F1C]"
                    >
                      {outletGroups.map(([gName]) => (
                        <option key={gName} value={gName}>
                          {gName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {activeGroupBranches.length > 1 && (
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#8A8880] mb-1">
                        Location ({activeGroupBranches.length} branches)
                      </label>
                      <select
                        data-testid="outlet-branch-select"
                        value={restaurant.id}
                        onChange={(e) => handleSwitchOutlet(e.target.value)}
                        className="w-full bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#1E1F1C]"
                      >
                        {activeGroupBranches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.branchName || branch.addressLine1 || branch.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#1E1F1C] truncate">
                    {activeGroupName || restaurant.name}
                  </div>
                  {restaurant.branchName && (
                    <div className="text-[11px] text-[#5E5D57] truncate">
                      {restaurant.branchName}
                    </div>
                  )}
                </div>
                <StatusBadge status={restaurant.verificationStatus} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#5E5D57] bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1">
                <span>Kitchen Load:</span>
                <span className="font-bold text-[#1E1F1C] tabular-nums">
                  {restaurant.activeOrdersCount ?? 0} /{" "}
                  {restaurant.maxConcurrentOrders ?? 15} active
                </span>
              </div>
              <button
                type="button"
                data-testid="kitchen-online-toggle"
                onClick={handleToggleKitchen}
                className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                  restaurant.isAcceptingOrders
                    ? "bg-[#CBEAD0] text-[#1E1F1C]"
                    : "bg-[#FDECEA] text-[#C62828]"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    restaurant.isAcceptingOrders ? "bg-[#2E7D32]" : "bg-[#C62828]"
                  }`}
                />
                <span>
                  {restaurant.isAcceptingOrders
                    ? "Accepting Orders"
                    : "Kitchen Paused"}
                </span>
              </button>
            </div>
          )}

          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              const locked =
                !outletsLoading && !hasOutletAccess && item.href !== "/restaurant/onboarding";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                    active
                      ? "bg-[#DEC146] text-[#1E1F1C]"
                      : locked
                        ? "text-[#8A8880]/70 hover:bg-[#F5F0E2]/50"
                        : "text-[#5E5D57] hover:bg-[#F5F0E2]"
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {locked && (
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#EFE9D8] text-[#8A8880]">
                      Locked
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden lg:block pt-6 border-t border-[#E8E3D5] space-y-3">
          {session?.user && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="font-bold text-[#1E1F1C] truncate">
                  {session.user.fullName}
                </div>
                <div className="text-[10px] text-[#8A8880] truncate">
                  {session.user.email}
                </div>
              </div>
              <button
                type="button"
                data-testid="restaurant-logout-btn"
                onClick={handleLogout}
                title="Sign out of Restaurant Portal"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E8E3D5] hover:bg-[#FDECEA] hover:text-[#C62828] font-semibold shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </div>
          )}
          <PortalSwitcher />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-5">
          <InvitationBanner filterKind="OUTLET" />
          {!outletsLoading && !hasOutletAccess && !allowOnboardingPage ? (
            <div
              data-testid="restaurant-no-access-panel"
              className="max-w-2xl bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#C62828]">
                RESTAURANT PORTAL LOCKED · NO ACTIVE OUTLET MEMBERSHIP
              </div>
              <h1 className="text-xl font-extrabold text-[#1E1F1C]">
                Accept an outlet invitation (with approval) to unlock workspace access
              </h1>
              <p className="text-xs text-[#5E5D57] leading-relaxed">
                Signed in as <strong>{session?.user?.fullName}</strong> (
                <strong>{session?.user?.email}</strong> · <strong>{session?.user?.phone}</strong>).
                You are locked out of Live KDS Orders, Menu &amp; Stock, Operating Hours, Payouts,
                and Team management until you accept an outlet invitation above and receive
                Owner/Admin approval.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/restaurant/onboarding?mode=staff"
                  className="px-4 py-2 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] font-bold text-xs"
                >
                  View Invitations &amp; Onboarding →
                </Link>
              </div>
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
