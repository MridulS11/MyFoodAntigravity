"use client";

import { AlertTriangle, Bike, ClipboardList, DollarSign, LogOut, Navigation, UserCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalSwitcher } from "@/components/shared/PortalSwitcher";
import { usePortalSession } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

const TABS = [
  { label: "Dispatch", href: "/delivery/dashboard", icon: Navigation },
  { label: "History", href: "/delivery/history", icon: ClipboardList },
  { label: "Earnings", href: "/delivery/earnings", icon: DollarSign },
  { label: "Profile", href: "/delivery/onboarding", icon: UserCheck },
];

export default function DeliveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const isAuthPage =
    pathname === "/delivery/login" || pathname === "/delivery/register";
  const { data: session, isLoading: sessionLoading } = usePortalSession("delivery");
  const authed = Boolean(session?.user);

  useEffect(() => {
    if (!isAuthPage && !sessionLoading && !authed) {
      router.replace(`/delivery/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isAuthPage, sessionLoading, authed, pathname, router]);

  const { data: partner } = useQuery({
    queryKey: ["myPartnerProfile", session?.user?.id],
    queryFn: () => services.deliveryPortal.getMyPartnerProfile(),
    enabled: !isAuthPage && authed,
    retry: false,
  });

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (sessionLoading || !authed) {
    return (
      <div className="min-h-screen bg-[#FCF9F0] flex items-center justify-center p-6 text-xs font-semibold text-[#5E5D57]">
        Checking Delivery Partner session...
      </div>
    );
  }

  async function handleLogout() {
    await services.auth.logout("delivery");
    qc.setQueryData(["portalSession", "delivery"], null);
    qc.setQueryData(["sessionUser", "delivery"], null);
    await qc.invalidateQueries();
    pushToast("info", "Signed out of Delivery Portal.");
    router.replace("/delivery/login");
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#FCF9F0] pb-20 md:pb-8">
      <header className="sticky top-0 z-30 bg-white border-b border-[#E8E3D5]">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link href="/delivery/dashboard" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-[#DEC146] text-[#1E1F1C] font-extrabold text-sm flex items-center justify-center">
              g
            </span>
            <span className="font-extrabold text-base text-[#1E1F1C]">
              goodly courier
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-2">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  pathname.startsWith(t.href)
                    ? "bg-[#DEC146] text-[#1E1F1C]"
                    : "text-[#5E5D57] hover:bg-[#F5F0E2]"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {partner && (
            <div className="flex items-center gap-2">
              {!partner.canReceiveOrders && (
                <Link
                  href="/delivery/onboarding"
                  data-testid="header-onboarding-warning-pill"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#F59E0B] bg-[#FEF3C7] text-[#92400E] text-[11px] font-bold"
                  title={partner.warningMessage}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#D97706]" />
                  <span className="hidden sm:inline">Verification Pending</span>
                </Link>
              )}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#E8E3D5] bg-[#FCF9F0] text-xs font-bold">
                <Bike className="w-3.5 h-3.5 text-[#5F8E63]" />
                <span>
                  {partner.availabilityStatus === "ONLINE_AVAILABLE"
                    ? "Online"
                    : partner.availabilityStatus === "ON_DELIVERY"
                      ? "On Delivery"
                      : "Offline"}
                </span>
              </div>
              <button
                type="button"
                data-testid="delivery-logout-btn"
                onClick={handleLogout}
                title="Sign out of Delivery Portal"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E8E3D5] hover:bg-[#FDECEA] hover:text-[#C62828] text-xs font-semibold"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          )}
        </div>
        {partner && !partner.canReceiveOrders && (
          <div
            data-testid="delivery-pending-warning"
            className="bg-[#FEF3C7] border-t border-[#FDE68A] text-[#92400E]"
          >
            <div className="max-w-4xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0" />
                <span>
                  You are not receiving orders due to onboarding verification pending
                  {partner.verificationStatus === "NOT_SUBMITTED"
                    ? " (onboarding skipped — submit KYC to receive orders)."
                    : ` (status: ${partner.verificationStatus}).`}
                </span>
              </div>
              <Link
                href="/delivery/onboarding"
                className="px-3 py-1 rounded-lg bg-[#92400E] text-white font-bold hover:bg-[#78350F] transition-colors shrink-0"
              >
                {partner.onboarded ? "View Verification Status →" : "Complete Onboarding →"}
              </Link>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6">{children}</main>

      <footer className="max-w-4xl w-full mx-auto px-4 pt-4 border-t border-[#E8E3D5] hidden md:block">
        <PortalSwitcher />
      </footer>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#E8E3D5] grid grid-cols-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`py-2.5 flex flex-col items-center gap-1 text-[11px] font-semibold ${
                active ? "text-[#1E1F1C]" : "text-[#8A8880]"
              }`}
            >
              <Icon
                className={`w-4 h-4 ${active ? "text-[#5F8E63]" : "text-[#8A8880]"}`}
              />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
