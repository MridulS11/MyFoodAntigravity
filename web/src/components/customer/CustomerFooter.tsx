"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PortalSwitcher } from "@/components/shared/PortalSwitcher";
import { useAppStore } from "@/stores/useAppStore";

export function CustomerFooter() {
  const pathname = usePathname();
  const isRestaurantPage = pathname.startsWith("/restaurants/");
  const activeCityLabel = useAppStore((s) => s.activeCityLabel);

  return (
    <footer className="mt-auto border-t border-[#E8E3D5] bg-[#FCF9F0]">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-7 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#DEC146] text-[#1E1F1C] font-extrabold text-xs flex items-center justify-center">
              g
            </span>
            <span className="font-extrabold text-[15px] text-[#1E1F1C]">
              goodly
            </span>
          </Link>
          <span className="text-xs text-[#8A8880]">
            Good food. Good neighbors. Always.
          </span>
        </div>

        <PortalSwitcher />

        {isRestaurantPage ? (
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5E5D57] hover:text-[#1E1F1C]"
          >
            <span>Back to all restaurants</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        ) : (
          <div className="text-xs text-[#8A8880]">
            {activeCityLabel} · Made with care
          </div>
        )}
      </div>
    </footer>
  );
}
