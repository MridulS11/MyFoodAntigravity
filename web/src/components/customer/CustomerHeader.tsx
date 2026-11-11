"use client";

import {
  ChevronDown,
  MapPin,
  Search,
  ShoppingBag,
  ArrowLeft,
  User as UserIcon,
  ClipboardList,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, MailCheck } from "lucide-react";
import { services } from "@/services";
import { useCart, useSessionUser } from "@/hooks/useGoodlyQueries";
import { useAppStore } from "@/stores/useAppStore";

function HeaderSearchBar({
  isRestaurantPage,
  menuSearchQuery,
  setMenuSearchQuery,
  mobile = false,
}: {
  isRestaurantPage: boolean;
  menuSearchQuery: string;
  setMenuSearchQuery: (q: string) => void;
  mobile?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQ = pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null);
  const globalQuery = draft && draft.base === urlQ ? draft.text : urlQ;

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    if (isRestaurantPage) return;
    const trimmed = globalQuery.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  }

  return (
    <form
      onSubmit={handleSearchSubmit}
      className={mobile ? "flex-1" : "flex-1 max-w-[480px] hidden md:block"}
    >
      <div className="relative flex items-center">
        <Search
          className={
            mobile
              ? "w-3.5 h-3.5 text-[#8A8880] absolute left-3 pointer-events-none"
              : "w-4 h-4 text-[#8A8880] absolute left-3.5 pointer-events-none"
          }
        />
        <input
          type="search"
          data-testid={mobile ? "header-search-input-mobile" : "header-search-input"}
          value={isRestaurantPage ? menuSearchQuery : globalQuery}
          onChange={(e) => {
            if (isRestaurantPage) {
              setMenuSearchQuery(e.target.value);
            } else {
              setDraft({ base: urlQ, text: e.target.value });
            }
          }}
          placeholder={
            isRestaurantPage
              ? mobile
                ? "Search menu..."
                : "Search this menu..."
              : mobile
                ? "Search dishes or spots..."
                : "Dishes, restaurants, cravings (e.g. pasta)..."
          }
          aria-label={
            isRestaurantPage ? "Search this menu" : "Search dishes and restaurants"
          }
          className={
            mobile
              ? "w-full bg-white border border-[#E8E3D5] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#1E1F1C]"
              : "w-full bg-white border border-[#E8E3D5] rounded-lg pl-10 pr-4 py-2 text-sm text-[#1E1F1C] placeholder:text-[#8A8880] focus:outline-none focus:border-[#1E1F1C] transition-colors"
          }
        />
      </div>
    </form>
  );
}

export function CustomerHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const isRestaurantPage = pathname.startsWith("/restaurants/");

  const { data: user } = useSessionUser("customer");
  const { data: invitations = [] } = useQuery({
    queryKey: ["myInvitations", "customer", user?.id],
    queryFn: () => services.auth.listMyInvitations("customer"),
    enabled: Boolean(user),
  });
  const pendingInvitesCount = invitations.filter(
    (i) => i.status === "PENDING_ACCEPTANCE"
  ).length;
  const { data: cart } = useCart();
  const activeCityLabel = useAppStore((s) => s.activeCityLabel);
  const setAddressModalOpen = useAppStore((s) => s.setAddressModalOpen);
  const setCartDrawerOpen = useAppStore((s) => s.setCartDrawerOpen);
  const menuSearchQuery = useAppStore((s) => s.menuSearchQuery);
  const setMenuSearchQuery = useAppStore((s) => s.setMenuSearchQuery);

  const itemCount =
    cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <header className="sticky top-0 z-30 bg-[#FCF9F0]/95 backdrop-blur border-b border-[#E8E3D5]">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-[68px] flex items-center justify-between gap-3 sm:gap-5">
        {/* Brand + Address */}
        <div className="flex items-center gap-4 sm:gap-6 shrink-0">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="w-8 h-8 rounded-full bg-[#DEC146] text-[#1E1F1C] font-extrabold text-base flex items-center justify-center shadow-xs group-hover:bg-[#CFAF32] transition-colors">
              g
            </span>
            <span className="text-[19px] font-extrabold tracking-tight text-[#1E1F1C]">
              goodly
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setAddressModalOpen(true)}
            data-testid="address-picker-trigger"
            className="hidden sm:flex items-center gap-2 text-left rounded-lg px-2 py-1 hover:bg-[#F5F0E2] transition-colors"
          >
            <MapPin className="w-4 h-4 text-[#5E5D57] shrink-0" />
            <div className="leading-tight">
              <div className="text-[10px] font-medium text-[#8A8880]">
                Delivering to
              </div>
              <div className="text-[13px] font-semibold text-[#1E1F1C] flex items-center gap-1">
                <span>{activeCityLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#5E5D57]" />
              </div>
            </div>
          </button>
        </div>

        {/* Search Bar */}
        <Suspense fallback={<div className="flex-1 max-w-[480px] hidden md:block" />}>
          <HeaderSearchBar
            isRestaurantPage={isRestaurantPage}
            menuSearchQuery={menuSearchQuery}
            setMenuSearchQuery={setMenuSearchQuery}
          />
        </Suspense>

        {/* Right Actions */}
        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          {isRestaurantPage ? (
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1E1F1C] hover:text-[#5F8E63] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Browse</span>
            </Link>
          ) : (
            <div className="flex items-center gap-4">
              {user && pendingInvitesCount > 0 && (
                <Link
                  href="/account/invitations"
                  data-testid="header-invitations-pill"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FFF9E6] border border-[#DEC146] text-[12px] font-bold text-[#1E1F1C]"
                >
                  <MailCheck className="w-3.5 h-3.5 text-[#5F8E63]" />
                  <span>{pendingInvitesCount} Invite</span>
                </Link>
              )}
              {user && (
                <Link
                  href="/orders"
                  className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-medium text-[#5E5D57] hover:text-[#1E1F1C]"
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span>Orders</span>
                </Link>
              )}
              <Link
                href={user ? "/account/profile" : "/auth/login"}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1E1F1C] hover:text-[#5F8E63] transition-colors"
              >
                {user ? (
                  <>
                    <UserIcon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {user.fullName.split(" ")[0]}
                    </span>
                  </>
                ) : (
                  <span>Sign in</span>
                )}
              </Link>
              {user && (
                <button
                  type="button"
                  data-testid="customer-logout-btn"
                  title="Sign out"
                  onClick={async () => {
                    await services.auth.logout("customer");
                    qc.setQueryData(["sessionUser", "customer"], null);
                    qc.setQueryData(["portalSession", "customer"], null);
                    await qc.invalidateQueries();
                    router.push("/auth/login");
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#8A8880] hover:text-[#C62828] transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            data-testid="header-bag-button"
            className="inline-flex items-center gap-2 bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-semibold text-[13px] rounded-lg px-3.5 py-2 transition-colors shadow-xs"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Your bag</span>
            <span
              data-testid="header-bag-count"
              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#1E1F1C]/12 text-[11px] font-bold tabular-nums"
            >
              {itemCount}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile location & search strip */}
      <div className="md:hidden px-4 pb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAddressModalOpen(true)}
          className="flex items-center gap-1 text-xs font-semibold text-[#1E1F1C] bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-2 shrink-0"
        >
          <MapPin className="w-3.5 h-3.5 text-[#5F8E63]" />
          <span className="truncate max-w-[100px]">{activeCityLabel}</span>
          <ChevronDown className="w-3 h-3" />
        </button>
        <Suspense fallback={<div className="flex-1" />}>
          <HeaderSearchBar
            isRestaurantPage={isRestaurantPage}
            menuSearchQuery={menuSearchQuery}
            setMenuSearchQuery={setMenuSearchQuery}
            mobile
          />
        </Suspense>
      </div>
    </header>
  );
}
