"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSessionUser } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

export default function AccountProfilePage() {
  const { data: user } = useSessionUser();
  const qc = useQueryClient();
  const router = useRouter();
  const pushToast = useAppStore((s) => s.pushToast);

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <Link
          href="/auth/login"
          className="inline-flex bg-[#DEC146] px-5 py-2.5 rounded-lg text-sm font-semibold"
        >
          Sign in
        </Link>
      </div>
    );
  }

  async function handleLogout() {
    await services.auth.logout();
    qc.setQueryData(["sessionUser"], null);
    pushToast("info", "Signed out.");
    router.push("/");
  }

  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 md:grid-cols-12 gap-8">
      <aside className="md:col-span-4 space-y-1">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#8A8880] mb-3">
          ACCOUNT
        </div>
        {[
          { label: "Profile & Security", href: "/account/profile", active: true },
          { label: "Saved Addresses", href: "/account/addresses", active: false },
          { label: "Favorite Kitchens", href: "/account/favorites", active: false },
          { label: "Support & Complaints", href: "/support/complaints", active: false },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-4 py-2.5 rounded-xl text-sm font-semibold ${
              item.active
                ? "bg-[#DEC146] text-[#1E1F1C]"
                : "text-[#5E5D57] hover:bg-white"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </aside>

      <section className="md:col-span-8 bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-5">
        <div>
          <h1 className="text-xl font-extrabold text-[#1E1F1C]">
            Profile &amp; Account
          </h1>
          <p className="text-xs text-[#8A8880] mt-0.5">
            Personal details and verified contact channels
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="p-4 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]">
            <div className="text-[11px] font-bold uppercase text-[#8A8880]">
              Full name
            </div>
            <div className="font-bold text-[#1E1F1C] mt-1">{user.fullName}</div>
          </div>
          <div className="p-4 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]">
            <div className="text-[11px] font-bold uppercase text-[#8A8880]">
              Role
            </div>
            <div className="font-bold text-[#1E1F1C] mt-1">
              {user.roles.join(", ")}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]">
            <div className="text-[11px] font-bold uppercase text-[#8A8880]">
              Email
            </div>
            <div className="font-bold text-[#1E1F1C] mt-1">{user.email}</div>
          </div>
          <div className="p-4 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5]">
            <div className="text-[11px] font-bold uppercase text-[#8A8880]">
              Phone
            </div>
            <div className="font-bold text-[#1E1F1C] mt-1">{user.phone}</div>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg border border-[#FAC8C3] text-[#C62828] text-xs font-bold hover:bg-[#FDECEA]"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
