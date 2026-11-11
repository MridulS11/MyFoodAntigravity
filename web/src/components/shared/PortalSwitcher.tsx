"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PORTAL_LINKS = [
  { label: "Customer", href: "/" },
  { label: "Restaurant KDS", href: "/restaurant/orders" },
  { label: "Delivery Partner", href: "/delivery/dashboard" },
  { label: "Admin Ops", href: "/admin/dashboard" },
] as const;

export function PortalSwitcher() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-[#8A8880] mr-1">Portals:</span>
      {PORTAL_LINKS.map((item) => {
        const prefix = `/${item.href.split("/")[1]}`;
        const active =
          item.href === "/"
            ? pathname === "/" ||
              pathname.startsWith("/restaurants") ||
              pathname.startsWith("/orders") ||
              pathname.startsWith("/checkout") ||
              pathname.startsWith("/account") ||
              pathname.startsWith("/search")
            : pathname === prefix || pathname.startsWith(`${prefix}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                : "bg-white text-[#5E5D57] border-[#E8E3D5] hover:border-[#1E1F1C]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
