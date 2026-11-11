"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/services/contracts/errors";
import type { PortalScope, UserRole } from "@/services/contracts/types";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

interface DummyCred {
  id: string;
  label: string;
  sublabel: string;
  email: string;
  phone: string;
  defaultPath: string;
}

const PORTAL_META: Record<
  PortalScope,
  {
    badge: string;
    title: string;
    subtitle: string;
    brandSuffix: string;
    allowRegister: boolean;
    onboardingPath: string;
    defaultHome: string;
    dummyCreds: DummyCred[];
  }
> = {
  customer: {
    badge: "CUSTOMER PORTAL",
    title: "Sign in to Goodly",
    subtitle: "Order from neighborhood kitchens, track live courier ETAs, and manage addresses.",
    brandSuffix: "",
    allowRegister: true,
    onboardingPath: "/account/addresses?onboarding=1",
    defaultHome: "/",
    dummyCreds: [
      {
        id: "user-cust-1",
        label: "Customer (Alice)",
        sublabel: "Ananya Sharma · Bengaluru",
        email: "alice@goodly.local",
        phone: "+91-98450-10101",
        defaultPath: "/",
      },
    ],
  },
  restaurant: {
    badge: "RESTAURANT PARTNER PORTAL",
    title: "Kitchen & Outlet Sign In",
    subtitle: "Isolated outlet session. Onboard locations, configure KDS, or accept team invites.",
    brandSuffix: "kitchen",
    allowRegister: true,
    onboardingPath: "/restaurant/onboarding",
    defaultHome: "/restaurant/orders",
    dummyCreds: [
      {
        id: "RESTAURANT_OWNER",
        label: "Restaurant (Sunday Table)",
        sublabel: "Multi-location Owner (2 branches)",
        email: "marco@sundaytable.local",
        phone: "+91-98450-20202",
        defaultPath: "/restaurant/orders",
      },
      {
        id: "user-branch-mgr-1",
        label: "Branch Manager (Karan)",
        sublabel: "Indiranagar scoped manager",
        email: "branch.indiranagar@sundaytable.local",
        phone: "+91-98450-20299",
        defaultPath: "/restaurant/orders",
      },
      {
        id: "user-staff-invited",
        label: "Invited Outlet Staff (Meera)",
        sublabel: "Pending invite — needs accept + approval",
        email: "staff.invited@goodly.local",
        phone: "+91-98450-20311",
        defaultPath: "/restaurant/onboarding?mode=staff",
      },
    ],
  },
  delivery: {
    badge: "DELIVERY COURIER PORTAL",
    title: "Courier Partner Sign In",
    subtitle: "Isolated courier session. Complete KYC onboarding or skip and check dispatch status.",
    brandSuffix: "courier",
    allowRegister: true,
    onboardingPath: "/delivery/onboarding",
    defaultHome: "/delivery/dashboard",
    dummyCreds: [
      {
        id: "DELIVERY_PARTNER",
        label: "Delivery Partner (Devon)",
        sublabel: "Verified Courier · Online ready",
        email: "devon@goodly.local",
        phone: "+91-98450-30303",
        defaultPath: "/delivery/dashboard",
      },
      {
        id: "user-deliv-pending",
        label: "Pending Courier (Arjun)",
        sublabel: "Skipped onboarding — warning sign shown",
        email: "rider.pending@goodly.local",
        phone: "+91-98450-30311",
        defaultPath: "/delivery/dashboard",
      },
    ],
  },
  admin: {
    badge: "PLATFORM ADMIN GOVERNANCE",
    title: "Operations & Super Admin Sign In",
    subtitle:
      "Open account registration & sign-in. New users start with zero admin access until invited by an eligible Admin and accepted.",
    brandSuffix: "ops",
    allowRegister: true,
    onboardingPath: "/admin/dashboard",
    defaultHome: "/admin/dashboard",
    dummyCreds: [
      {
        id: "SUPER_ADMIN",
        label: "Super Admin (Elena)",
        sublabel: "Full platform, roles & finance control",
        email: "elena@goodly.local",
        phone: "+91-98450-90001",
        defaultPath: "/admin/dashboard",
      },
      {
        id: "SUPPORT_ADMIN",
        label: "Customer Care (Samira)",
        sublabel: "Orders, escalations & complaints only",
        email: "priya@goodly.local",
        phone: "+91-98450-90004",
        defaultPath: "/admin/dashboard",
      },
      {
        id: "user-admin-invited",
        label: "Invited Ops Admin (Vikramaditya)",
        sublabel: "Pending invite — needs accept + approval",
        email: "admin.invited@goodly.local",
        phone: "+91-98450-40511",
        defaultPath: "/admin/dashboard",
      },
    ],
  },
};

export function PortalAuthCard({
  portal,
  initialMode = "login",
}: {
  portal: PortalScope;
  initialMode?: "login" | "register";
}) {
  const meta = PORTAL_META[portal];
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const [mode, setMode] = useState<"login" | "register" | "otp">(
    meta.allowRegister ? initialMode : "login"
  );
  const [emailOrPhone, setEmailOrPhone] = useState(meta.dummyCreds[0]?.email ?? "");
  const [password, setPassword] = useState("password123");
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPhone, setRegPhone] = useState("+91-98450-");
  const [regRole, setRegRole] = useState<UserRole>(
    portal === "restaurant"
      ? "OUTLET_OWNER"
      : portal === "delivery"
        ? "DELIVERY_PARTNER"
        : "CUSTOMER"
  );
  const [otpCode, setOtpCode] = useState("");
  const [otpTarget, setOtpTarget] = useState("");
  const [uniqueEmailPrompt, setUniqueEmailPrompt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function afterAuthNavigate(onboardingRequired: boolean, defaultTarget: string) {
    await qc.invalidateQueries();
    if (onboardingRequired) {
      router.push(meta.onboardingPath);
      return;
    }
    router.push(nextPath || defaultTarget);
  }

  function primePortalSessionCache(res: {
    user: import("@/services/contracts/types").User;
    portal?: PortalScope;
    onboardingRequired?: boolean;
    onboardingHint?: string;
  }) {
    qc.setQueryData(["sessionUser", portal], res.user);
    qc.setQueryData(["portalSession", portal], {
      user: res.user,
      portal: res.portal ?? portal,
      onboardingRequired: Boolean(res.onboardingRequired),
      onboardingHint: res.onboardingHint,
    });
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUniqueEmailPrompt(null);
    setBusy(true);
    try {
      const check = await services.auth.checkEmailAvailability(portal, emailOrPhone);
      if (!check.exists) {
        setUniqueEmailPrompt(emailOrPhone.trim());
        setBusy(false);
        return;
      }

      const res = await services.auth.loginForPortal(portal, emailOrPhone, password);
      primePortalSessionCache(res);
      pushToast("success", `Signed in to ${meta.badge} as ${res.user.fullName}.`);
      await afterAuthNavigate(res.onboardingRequired, meta.defaultHome);
    } catch (err) {
      if (err instanceof ApiError && err.details?.uniqueEmail) {
        setUniqueEmailPrompt(emailOrPhone.trim());
      } else {
        pushToast("error", err instanceof Error ? err.message : "Sign in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function startUniqueEmailOnboarding() {
    if (!uniqueEmailPrompt) return;
    if (uniqueEmailPrompt.includes("@")) {
      setRegEmail(uniqueEmailPrompt);
    } else {
      setRegPhone(uniqueEmailPrompt);
    }
    setUniqueEmailPrompt(null);
    setMode("register");
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await services.auth.register(
        {
          fullName: fullName.trim(),
          email: regEmail.trim(),
          phone: regPhone.trim(),
          password,
          role: regRole,
        },
        portal
      );
      if (res.otpRequired) {
        // Do NOT store or prime session yet — credentials are only stored once OTP verification succeeds
        setOtpTarget(regEmail.trim() || regPhone.trim());
        setOtpCode("");
        setMode("otp");
        pushToast("info", "Verification OTP sent to your email. Account will only be created after OTP check.");
      } else {
        primePortalSessionCache({ user: res.user, portal, onboardingRequired: res.onboardingRequired });
        await afterAuthNavigate(true, meta.onboardingPath);
      }
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await services.auth.verifyOtp(otpTarget, otpCode.trim(), portal);
      if (password) {
        try {
          const loginRes = await services.auth.loginForPortal(portal, otpTarget, password);
          primePortalSessionCache(loginRes);
        } catch {
          primePortalSessionCache({ user, portal, onboardingRequired: true });
        }
      } else {
        primePortalSessionCache({ user, portal, onboardingRequired: true });
      }
      await qc.invalidateQueries();
      pushToast("success", `Verified ${user.fullName}! Account created and signed in.`);
      if (portal === "restaurant") {
        router.push(
          regRole === "OUTLET_STAFF"
            ? "/restaurant/onboarding?mode=staff"
            : "/restaurant/onboarding?mode=create"
        );
      } else if (portal === "delivery") {
        router.push("/delivery/onboarding");
      } else {
        router.push(nextPath || meta.onboardingPath);
      }
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Invalid OTP.");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickDemo(cred: DummyCred) {
    setUniqueEmailPrompt(null);
    try {
      const user = await services.auth.switchDemoPersona(cred.id, portal);
      primePortalSessionCache({ user, portal, onboardingRequired: false });
      await qc.invalidateQueries();
      pushToast("info", `Signed in (${portal}): ${user.fullName}`);
      router.push(nextPath || cred.defaultPath);
    } catch {
      setEmailOrPhone(cred.email);
      setPassword("password123");
      try {
        const res = await services.auth.loginForPortal(portal, cred.email, "password123");
        primePortalSessionCache(res);
        await afterAuthNavigate(res.onboardingRequired, cred.defaultPath);
      } catch (err) {
        pushToast("error", err instanceof Error ? err.message : "Could not sign in.");
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#FCF9F0] flex flex-col justify-center items-center px-4 py-10">
      <Link href="/" className="flex items-center gap-2.5 mb-5">
        <span className="w-9 h-9 rounded-full bg-[#DEC146] text-[#1E1F1C] font-extrabold text-lg flex items-center justify-center">
          g
        </span>
        <span className="text-2xl font-extrabold text-[#1E1F1C]">
          goodly {meta.brandSuffix}
        </span>
      </Link>

      <div className="w-full max-w-xl bg-white border border-[#E8E3D5] rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
            {meta.badge} · ISOLATED SESSION
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1F1C]">{meta.title}</h1>
          <p className="text-xs text-[#5E5D57]">{meta.subtitle}</p>
        </div>

        {meta.allowRegister && mode !== "otp" && (
          <div className="flex rounded-xl bg-[#FCF9F0] p-1 border border-[#E8E3D5] text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setUniqueEmailPrompt(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === "login"
                  ? "bg-[#DEC146] text-[#1E1F1C]"
                  : "text-[#5E5D57] hover:text-[#1E1F1C]"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setUniqueEmailPrompt(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === "register"
                  ? "bg-[#DEC146] text-[#1E1F1C]"
                  : "text-[#5E5D57] hover:text-[#1E1F1C]"
              }`}
            >
              New Account &amp; Onboard
            </button>
          </div>
        )}

        {uniqueEmailPrompt && (
          <div
            data-testid="unique-email-onboarding-banner"
            className="bg-[#FFF9E6] border border-[#DEC146] rounded-xl p-4 space-y-2.5 text-xs"
          >
            <div className="flex items-center gap-1.5 font-extrabold text-[#1E1F1C]">
              <Sparkles className="w-4 h-4 text-[#5F8E63]" />
              <span>Unique email detected — welcome to Goodly!</span>
            </div>
            <p className="text-[#5E5D57]">
              No account exists yet for <strong>{uniqueEmailPrompt}</strong>. Start quick signup &amp;{" "}
              {portal} onboarding with this email right now.
            </p>
            <button
              type="button"
              data-testid="unique-email-onboarding-cta"
              onClick={startUniqueEmailOnboarding}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E1F1C] text-[#FCF9F0] font-bold"
            >
              <span>Create Account &amp; Start Onboarding</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {mode === "login" && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                  Email ID or Phone
                </label>
                <input
                  value={emailOrPhone}
                  onChange={(e) => setEmailOrPhone(e.target.value)}
                  required
                  className="w-full border border-[#E8E3D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full border border-[#E8E3D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-sm py-3 rounded-xl transition-colors"
            >
              {busy ? "Signing in..." : `Sign in to ${portal} portal`}
            </button>
          </form>
        )}

        {mode === "register" && (
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
            {portal === "restaurant" && (
              <div>
                <label className="block text-xs font-semibold mb-1">Role on Restaurant Portal</label>
                <select
                  value={regRole}
                  onChange={(e) => setRegRole(e.target.value as UserRole)}
                  className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2.5 text-xs font-semibold"
                >
                  <option value="OUTLET_OWNER">Outlet Owner (Onboard Outlet / Multiple Locations)</option>
                  <option value="OUTLET_STAFF">Team Member (I work at an Outlet)</option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Full Name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="Your full name"
                  className="w-full border border-[#E8E3D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Contact Phone</label>
                <input
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  required
                  className="w-full border border-[#E8E3D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Email ID</label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  required
                  placeholder="you@domain.in"
                  className="w-full border border-[#E8E3D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full border border-[#E8E3D5] rounded-xl px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-sm py-3 rounded-xl"
            >
              {busy ? "Creating account..." : "Create Account & Continue"}
            </button>
          </form>
        )}

        {mode === "otp" && (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div className="text-sm font-bold text-[#1E1F1C]">
              Verify OTP sent to {otpTarget}
            </div>
            <p className="text-xs text-[#5E5D57]">
              Enter the 6-digit OTP sent to your email (demo/dev fallback:{" "}
              <strong>123456</strong>) to verify and continue into <strong>{portal}</strong>.
            </p>
            <input
              data-testid="otp-code-input"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              maxLength={6}
              required
              placeholder="123456"
              className="w-full border border-[#E8E3D5] rounded-xl px-4 py-3 text-center text-lg font-bold tracking-widest"
            />
            <button
              type="submit"
              disabled={busy || otpCode.trim().length !== 6}
              className="w-full bg-[#DEC146] hover:bg-[#CFAF32] disabled:opacity-50 text-[#1E1F1C] font-bold text-sm py-3 rounded-xl"
            >
              Verify &amp; Start Onboarding →
            </button>
            <button
              type="button"
              data-testid="cancel-otp-to-login-btn"
              onClick={() => {
                setOtpCode("");
                setOtpTarget("");
                setMode("login");
              }}
              className="w-full text-xs font-semibold text-[#5E5D57] hover:text-[#1E1F1C] py-1.5"
            >
              Cancel &amp; Back to Sign In
            </button>
          </form>
        )}

        {/* Portal-Specific Dummy Credentials */}
        <div className="border-t border-[#E8E3D5] pt-4 space-y-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold uppercase tracking-wider text-[#8A8880]">
              {portal} Dummy Credentials (1-Click)
            </span>
            <span className="text-[#5E5D57]">
              Password: <code className="bg-[#FCF9F0] px-1.5 py-0.5 rounded font-bold">password123</code>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {meta.dummyCreds.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleQuickDemo(c)}
                className="p-2.5 rounded-xl border border-[#E8E3D5] hover:bg-[#FCF9F0] text-left transition-colors"
              >
                <div className="font-bold text-[#1E1F1C]">{c.label}</div>
                <div className="text-[11px] text-[#5F8E63] font-semibold">{c.sublabel}</div>
                <div className="text-[10px] text-[#8A8880] truncate mt-0.5">
                  {c.email} · {c.phone}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Isolated Portal Auth Switcher */}
        <div className="border-t border-[#E8E3D5] pt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5E5D57]">
          <span className="font-semibold">Other isolated portals:</span>
          <div className="flex flex-wrap gap-3 font-bold">
            <Link href="/auth/login" className={portal === "customer" ? "text-[#1E1F1C]" : "text-[#5F8E63] hover:underline"}>
              Customer Login
            </Link>
            <Link href="/restaurant/login" className={portal === "restaurant" ? "text-[#1E1F1C]" : "text-[#5F8E63] hover:underline"}>
              Restaurant Login
            </Link>
            <Link href="/delivery/login" className={portal === "delivery" ? "text-[#1E1F1C]" : "text-[#5F8E63] hover:underline"}>
              Delivery Login
            </Link>
            <Link href="/admin/login" className={portal === "admin" ? "text-[#1E1F1C]" : "text-[#5F8E63] hover:underline"}>
              Admin Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
