"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Building2, CheckCircle2, Lock, PlusCircle, ShieldCheck, Store, Upload, Users } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useSessionUser } from "@/hooks/useGoodlyQueries";
import { restaurantOnboardingSchema } from "@/lib/validators/schemas";
import { services } from "@/services";
import type { RestaurantOwnerProfile } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

type OnboardingValues = z.infer<typeof restaurantOnboardingSchema>;

function RestaurantOnboardingInner() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const searchParams = useSearchParams();
  const { data: user } = useSessionUser("restaurant");
  const isOwnerRole = Boolean(
    user?.roles.some((r) => r === "OUTLET_OWNER" || r === "RESTAURANT_OWNER")
  );
  const paramMode = searchParams.get("mode");
  const initialMode =
    paramMode === "staff"
      ? "staff"
      : paramMode === "create"
        ? "create"
        : isOwnerRole
          ? "create"
          : "staff";
  const [mode, setMode] = useState<"create" | "staff">(initialMode);
  const [createMode, setCreateMode] = useState<"new_outlet" | "existing_branch">("new_outlet");
  const [selectedExistingBrand, setSelectedExistingBrand] = useState("");
  const [outletNameInput, setOutletNameInput] = useState("");
  const [branchName, setBranchName] = useState("");
  const [serviceZoneId, setServiceZoneId] = useState("");

  // Owner Profile & Demo KYC state
  const [orgName, setOrgName] = useState("");
  const [idDocType, setIdDocType] =
    useState<RestaurantOwnerProfile["idDocumentType"]>("PAN_CARD");
  const [idDocNumber, setIdDocNumber] = useState("");
  const [idDocFilename, setIdDocFilename] = useState("");

  const { data: ownerProfile } = useQuery({
    queryKey: ["ownerProfile", user?.id],
    queryFn: () => services.restaurantPortal.getOwnerProfile(),
    enabled: Boolean(user),
  });

  const isOwnerApproved = ownerProfile?.verificationStatus === "APPROVED";

  const { data: outlets = [] } = useQuery({
    queryKey: ["myOutlets", user?.id],
    queryFn: () => services.restaurantPortal.listMyOutlets(),
    enabled: Boolean(user),
  });

  const existingBrands = Array.from(
    new Set(outlets.map((o) => (o.brandName || o.name).trim()).filter(Boolean))
  );
  const effectiveExistingBrand = selectedExistingBrand || existingBrands[0] || "";
  const duplicateMatchedBrand =
    createMode === "new_outlet" && outletNameInput.trim().length > 0
      ? existingBrands.find(
          (b) => b.toLowerCase() === outletNameInput.trim().toLowerCase()
        )
      : undefined;

  const { data: zones = [] } = useQuery({
    queryKey: ["serviceZones"],
    queryFn: () => services.restaurantPortal.listServiceZones(),
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ["myInvitations", "restaurant", user?.id],
    queryFn: () => services.auth.listMyInvitations("restaurant"),
    enabled: Boolean(user),
  });

  const outletInvites = invitations.filter((i) => i.kind === "OUTLET");

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(restaurantOnboardingSchema),
    defaultValues: {
      name: "",
      cuisines: "North Indian, Tandoor",
      phone: "+91-80-4120-8899",
      email: user?.email ?? "owner@newkitchen.in",
      addressLine1: "100 Feet Road, Indiranagar",
      city: "Bengaluru",
      state: "KA",
      postalCode: "560038",
      licenseNumber: "FSSAI-21226190009911",
    },
  });

  async function handleSubmitOwnerKyc(e: React.FormEvent) {
    e.preventDefault();
    if (!idDocNumber.trim() || idDocNumber.trim().length < 4) {
      pushToast("error", "Enter a valid ID number (minimum 4 characters).");
      return;
    }
    if (!idDocFilename.trim()) {
      pushToast("error", "Please select or attach a valid ID document (demo upload).");
      return;
    }
    try {
      await services.restaurantPortal.submitOwnerProfile({
        organizationName: orgName.trim() || undefined,
        idDocumentType: idDocType,
        idDocumentNumber: idDocNumber.trim(),
        idDocumentFilename: idDocFilename.trim(),
      });
      await qc.invalidateQueries({ queryKey: ["ownerProfile"] });
      pushToast(
        "success",
        "Owner profile & KYC ID submitted! Admin will review it under Restaurant KYC → Owner KYC."
      );
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Could not submit owner profile."
      );
    }
  }

  async function onSubmit(values: OnboardingValues) {
    if (!isOwnerApproved) {
      pushToast(
        "error",
        "Your Owner Profile & ID KYC must be approved by Admin before adding outlets."
      );
      return;
    }
    if (createMode === "new_outlet" && duplicateMatchedBrand) {
      pushToast(
        "error",
        `Outlet "${duplicateMatchedBrand}" already exists. Switch to "Add Branch to Existing Outlet" instead.`
      );
      return;
    }
    try {
      const resolvedOutletName =
        createMode === "existing_branch"
          ? effectiveExistingBrand
          : outletNameInput.trim() || values.name;
      const resolvedBranch = branchName.trim() || "Main Branch";
      const displayName =
        createMode === "existing_branch"
          ? `${resolvedOutletName} · ${resolvedBranch}`
          : resolvedOutletName;
      await services.restaurantPortal.submitOnboarding({
        ...values,
        setupType: createMode === "existing_branch" ? "ADD_BRANCH" : "NEW_OUTLET",
        name: displayName,
        brandName: resolvedOutletName,
        branchName: resolvedBranch,
        serviceZoneId: serviceZoneId || zones[0]?.id,
        cuisines: values.cuisines.split(",").map((s) => s.trim()),
      });
      await qc.invalidateQueries();
      form.reset();
      setOutletNameInput("");
      setBranchName("");
      pushToast(
        "success",
        createMode === "existing_branch"
          ? `New branch (${resolvedBranch}) under ${resolvedOutletName} submitted for Outlet KYC review!`
          : `New outlet "${resolvedOutletName}" submitted for Outlet KYC review!`
      );
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Could not submit outlet location."
      );
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          OUTLET ONBOARDING &amp; MULTI-LOCATION SETUP
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Onboard your restaurant or join an outlet team
        </h1>
        <p className="text-xs text-[#5E5D57] mt-1">
          Owners can register one brand and add multiple branch locations, plus invite managers &amp; staff
          with custom roles. Staff who work at an existing outlet wait for an invitation to accept.
        </p>
      </div>

      {/* Choice Prompt: Onboard Outlet vs. I Work at an Outlet */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          data-testid="choice-onboard-outlet"
          onClick={() => setMode("create")}
          className={`p-5 rounded-2xl border text-left transition-all ${
            mode === "create"
              ? "bg-white border-[#1E1F1C] ring-2 ring-[#DEC146]"
              : "bg-white border-[#E8E3D5] hover:border-[#1E1F1C]/40"
          }`}
        >
          <div className="flex items-center gap-2 font-extrabold text-sm text-[#1E1F1C]">
            <PlusCircle className="w-4 h-4 text-[#5F8E63]" />
            <span>Onboard Outlet / Add Branch Location</span>
          </div>
          <p className="text-xs text-[#5E5D57] mt-1.5">
            Register a restaurant outlet or add multiple branch locations under your ownership.
          </p>
        </button>

        <button
          type="button"
          data-testid="choice-work-at-outlet"
          onClick={() => setMode("staff")}
          className={`p-5 rounded-2xl border text-left transition-all ${
            mode === "staff"
              ? "bg-white border-[#1E1F1C] ring-2 ring-[#DEC146]"
              : "bg-white border-[#E8E3D5] hover:border-[#1E1F1C]/40"
          }`}
        >
          <div className="flex items-center gap-2 font-extrabold text-sm text-[#1E1F1C]">
            <Users className="w-4 h-4 text-[#5F8E63]" />
            <span>I Work at an Outlet</span>
          </div>
          <p className="text-xs text-[#5E5D57] mt-1.5">
            View &amp; accept invitations sent to your email or phone by an Outlet Owner, then await approval.
          </p>
        </button>
      </div>

      {/* Existing Active/Owned Locations */}
      {outlets.length > 0 && (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold text-sm">
              <Building2 className="w-4 h-4 text-[#5F8E63]" />
              <span>Your Outlets &amp; Locations ({outlets.length})</span>
            </div>
            <Link
              href="/restaurant/team"
              className="text-xs font-bold text-[#5F8E63] hover:underline"
            >
              Manage Users &amp; Roles →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {outlets.map((o) => (
              <div
                key={o.id}
                className="p-3.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-bold text-xs text-[#1E1F1C] truncate">
                    {o.name}
                  </div>
                  <div className="text-[11px] text-[#5E5D57] truncate">
                    {o.branchName ? `${o.branchName} · ` : ""}
                    {o.addressLine1}, {o.city}
                  </div>
                </div>
                <StatusBadge status={o.verificationStatus} />
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === "staff" ? (
        <div
          data-testid="work-at-outlet-panel"
          className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2 font-bold text-base text-[#1E1F1C]">
            <Store className="w-4 h-4 text-[#5F8E63]" />
            <span>Working at an Existing Outlet</span>
          </div>
          <div className="p-3.5 rounded-xl bg-[#FCF9F0] border border-[#E8E3D5] text-xs space-y-1">
            <div>
              Signed in as <strong>{user?.fullName ?? "Guest"}</strong>
            </div>
            <div>
              Share your Email ID (<strong>{user?.email ?? "—"}</strong>) or Contact Number (
              <strong>{user?.phone ?? "—"}</strong>) with your Outlet Owner so they can send you a
              role invitation.
            </div>
          </div>

          {outletInvites.length === 0 ? (
            <div className="text-xs text-[#5E5D57] py-4">
              No outlet invitations matched your email or phone yet. Once your Outlet Owner invites
              you, your invitation will appear right here and in{" "}
              <Link href="/account/invitations" className="font-bold text-[#5F8E63] hover:underline">
                Invitations
              </Link>
              .
            </div>
          ) : (
            <div className="space-y-2.5">
              {outletInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="p-4 rounded-xl border border-[#E8E3D5] flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-sm text-[#1E1F1C]">{inv.targetName}</div>
                    <div className="text-[#5E5D57]">
                      Assigned Role: <strong>{inv.roleName}</strong> · Permissions:{" "}
                      {inv.permissions.join(", ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={inv.status} />
                    {inv.status === "ACTIVE" && (
                      <Link
                        href="/restaurant/orders"
                        className="px-3 py-1.5 rounded-lg bg-[#DEC146] font-bold text-[#1E1F1C]"
                      >
                        Enter KDS →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Step 1: Owner Profile Creation & Valid ID KYC (Required before adding outlets) */}
          <div
            data-testid="owner-kyc-card"
            className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-extrabold text-sm text-[#1E1F1C]">
                <ShieldCheck className="w-4 h-4 text-[#5F8E63]" />
                <span>Step 1 · Restaurant Owner Profile &amp; ID KYC</span>
              </div>
              <StatusBadge status={ownerProfile?.verificationStatus ?? "NOT_SUBMITTED"} />
            </div>

            {ownerProfile?.verificationStatus === "APPROVED" ? (
              <div
                data-testid="owner-kyc-approved-badge"
                className="flex flex-wrap items-center gap-2 p-3.5 rounded-xl bg-[#CBEAD0]/40 border border-[#5F8E63]/30 text-xs text-[#1E1F1C]"
              >
                <CheckCircle2 className="w-4 h-4 text-[#2E7D32] shrink-0" />
                <span>
                  Verified Owner:{" "}
                  <strong>{ownerProfile.organizationName || "Independent Owner"}</strong> (
                  {ownerProfile.idDocumentType} · {ownerProfile.idDocumentNumber}). You are
                  authorized to onboard outlets and add branch locations.
                </span>
              </div>
            ) : ownerProfile?.verificationStatus === "PENDING_REVIEW" ? (
              <div
                data-testid="owner-kyc-pending-banner"
                className="p-4 rounded-xl bg-[#FFF8E1] border border-[#DEC146] text-xs text-[#1E1F1C] space-y-1"
              >
                <div className="font-bold">Owner KYC awaiting Admin Verification</div>
                <p className="text-[#5E5D57]">
                  Submitted as{" "}
                  <strong>{ownerProfile.organizationName || "Independent Owner"}</strong> with{" "}
                  <strong>{ownerProfile.idDocumentType}</strong> ({ownerProfile.idDocumentNumber} ·{" "}
                  {ownerProfile.idDocumentFilename || "demo-id-uploaded"}). Only verified owners
                  can create outlets.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmitOwnerKyc} className="space-y-4">
                {ownerProfile?.reviewNotes && (
                  <div className="p-3 rounded-xl bg-[#FDECEA] text-[#C62828] text-xs font-medium">
                    Previous review note: {ownerProfile.reviewNotes}
                  </div>
                )}
                <p className="text-xs text-[#5E5D57]">
                  Create your Owner Profile with a valid government/business ID (demo upload) first.
                  Organization name is optional for independent owners.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Organization / Business Name{" "}
                      <span className="text-[#8A8880] font-normal">(Optional for independent owners)</span>
                    </label>
                    <input
                      data-testid="owner-org-input"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Leave blank if independent owner"
                      className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Valid ID Type</label>
                    <select
                      data-testid="owner-id-type-select"
                      value={idDocType}
                      onChange={(e) =>
                        setIdDocType(
                          e.target.value as RestaurantOwnerProfile["idDocumentType"]
                        )
                      }
                      className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs bg-white"
                    >
                      <option value="PAN_CARD">PAN Card</option>
                      <option value="AADHAAR">Aadhaar / National ID</option>
                      <option value="PASSPORT">Passport</option>
                      <option value="DRIVING_LICENSE">Driver License</option>
                      <option value="BUSINESS_REG">Business Registration ID</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">ID Number</label>
                    <input
                      data-testid="owner-id-number-input"
                      value={idDocNumber}
                      onChange={(e) => setIdDocNumber(e.target.value)}
                      placeholder="e.g. ABCDE1234F"
                      className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Valid ID Upload (Demo Only)
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 inline-flex items-center gap-2 border border-dashed border-[#C7C1B2] rounded-xl px-3 py-2 text-xs cursor-pointer hover:bg-[#FCF9F0]">
                        <Upload className="w-3.5 h-3.5 text-[#5F8E63] shrink-0" />
                        <span className="truncate text-[#5E5D57]">
                          {idDocFilename || "Choose ID image / PDF..."}
                        </span>
                        <input
                          type="file"
                          data-testid="owner-id-file-input"
                          className="hidden"
                          accept=".pdf,.png,.jpg,.jpeg"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) setIdDocFilename(f.name);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        data-testid="attach-demo-id-btn"
                        onClick={() => setIdDocFilename("demo-owner-gov-id.pdf")}
                        className="px-2.5 py-2 rounded-xl border border-[#E8E3D5] text-[11px] font-bold hover:bg-[#FCF9F0] shrink-0"
                      >
                        Use Demo ID
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  data-testid="submit-owner-kyc-btn"
                  className="px-5 py-2.5 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] font-bold text-xs"
                >
                  Submit Owner Profile &amp; ID for KYC
                </button>
              </form>
            )}
          </div>

          {/* Step 2: Outlet & Branch Creation (Gated on Owner KYC Approval) */}
          {!isOwnerApproved ? (
            <div
              data-testid="outlet-setup-locked-banner"
              className="bg-white border border-[#E8E3D5] rounded-2xl p-6 flex items-start gap-3 text-xs text-[#5E5D57]"
            >
              <Lock className="w-4 h-4 text-[#C62828] shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-[#1E1F1C]">
                  Step 2 · Add Outlets &amp; Branches (Locked until Owner KYC Approval)
                </div>
                <p className="mt-1">
                  Only verified owners can create outlets. Once Admin approves your Owner Profile
                  under <strong>Restaurant KYC → Owner KYC</strong>, you will be able to add
                  outlets and multiple branch locations here.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-5">
              {/* Two-branch sub-choice: Add New Outlet vs Add Branch in Existing Outlet */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#8A8880]">
                  Step 2 · Choose Outlet Setup Type
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    data-testid="subchoice-new-outlet"
                    onClick={() => setCreateMode("new_outlet")}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      createMode === "new_outlet"
                        ? "bg-[#FCF9F0] border-[#1E1F1C] ring-2 ring-[#DEC146]"
                        : "bg-white border-[#E8E3D5] hover:border-[#1E1F1C]/40"
                    }`}
                  >
                    <div className="font-bold text-xs text-[#1E1F1C]">Add New Outlet</div>
                    <div className="text-[11px] text-[#5E5D57] mt-0.5">
                      Register a distinct restaurant outlet name and its primary location.
                    </div>
                  </button>

                  <button
                    type="button"
                    data-testid="subchoice-existing-branch"
                    onClick={() => {
                      setCreateMode("existing_branch");
                      if (effectiveExistingBrand) {
                        form.setValue("name", effectiveExistingBrand, { shouldValidate: true });
                      }
                    }}
                    disabled={existingBrands.length === 0}
                    className={`p-3.5 rounded-xl border text-left transition-all disabled:opacity-50 ${
                      createMode === "existing_branch"
                        ? "bg-[#FCF9F0] border-[#1E1F1C] ring-2 ring-[#DEC146]"
                        : "bg-white border-[#E8E3D5] hover:border-[#1E1F1C]/40"
                    }`}
                  >
                    <div className="font-bold text-xs text-[#1E1F1C]">
                      Add Branch to Existing Outlet
                    </div>
                    <div className="text-[11px] text-[#5E5D57] mt-0.5">
                      {existingBrands.length > 0
                        ? `Add another location under one of your ${existingBrands.length} existing outlet(s).`
                        : "Register your first outlet before adding extra branches."}
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">
                  {createMode === "existing_branch"
                    ? "Add Branch to Existing Outlet"
                    : outlets.length > 0
                      ? "Add New Outlet"
                      : "Register Your First Outlet"}
                </h2>
                {zones.length > 0 && (
                  <span className="text-[11px] text-[#5F8E63] font-semibold">
                    Multiple outlets &amp; branches supported
                  </span>
                )}
              </div>

              {duplicateMatchedBrand && (
                <div
                  data-testid="duplicate-outlet-prompt"
                  className="p-4 rounded-xl bg-[#FFF8E1] border border-[#DEC146] flex flex-wrap items-center justify-between gap-3 text-xs text-[#1E1F1C]"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#B7791F] shrink-0 mt-0.5" />
                    <div>
                      <strong>Outlet name already exists:</strong> &ldquo;{duplicateMatchedBrand}&rdquo;
                      is already registered under your account. Add a branch location instead of
                      creating another outlet with the same name.
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="switch-to-add-branch-btn"
                    onClick={() => {
                      setSelectedExistingBrand(duplicateMatchedBrand);
                      setCreateMode("existing_branch");
                      form.setValue("name", duplicateMatchedBrand, { shouldValidate: true });
                    }}
                    className="px-3.5 py-2 rounded-lg bg-[#1E1F1C] text-[#FCF9F0] font-bold text-xs shrink-0"
                  >
                    Add Branch under &ldquo;{duplicateMatchedBrand}&rdquo;
                  </button>
                </div>
              )}

              <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {createMode === "existing_branch" && existingBrands.length > 0 ? (
                  <div>
                    <label className="block text-xs font-semibold mb-1">Existing Outlet</label>
                    <select
                      data-testid="existing-outlet-select"
                      value={effectiveExistingBrand}
                      onChange={(e) => {
                        setSelectedExistingBrand(e.target.value);
                        form.setValue("name", e.target.value, { shouldValidate: true });
                      }}
                      className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs bg-white"
                    >
                      {existingBrands.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold mb-1">Outlet Name</label>
                    <input
                      data-testid="new-outlet-name-input"
                      value={outletNameInput}
                      onChange={(e) => {
                        setOutletNameInput(e.target.value);
                        form.setValue("name", e.target.value, { shouldValidate: true });
                      }}
                      placeholder="e.g. Copper Bowl"
                      className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                    />
                    {form.formState.errors.name && (
                      <p className="text-xs text-[#C62828] mt-1">
                        {form.formState.errors.name.message}
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold mb-1">Branch / Location Name</label>
                  <input
                    data-testid="branch-name-input"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="e.g. HSR Layout Sector 2 Branch"
                    className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  />
                </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Service Zone</label>
              <select
                value={serviceZoneId || zones[0]?.id || ""}
                onChange={(e) => setServiceZoneId(e.target.value)}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Cuisines (comma separated)
              </label>
              <input
                {...form.register("cuisines")}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Business Phone</label>
              <input
                {...form.register("phone")}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Business Email</label>
              <input
                {...form.register("email")}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                FSSAI / Food Safety License #
              </label>
              <input
                {...form.register("licenseNumber")}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Street Address</label>
              <input
                {...form.register("addressLine1")}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">City</label>
              <input
                {...form.register("city")}
                className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-1">State</label>
                <input
                  {...form.register("state")}
                  className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">PIN Code</label>
                <input
                  {...form.register("postalCode")}
                  className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={Boolean(duplicateMatchedBrand)}
                className="px-5 py-2.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs disabled:opacity-50"
              >
                {createMode === "existing_branch"
                  ? "Add Branch Location"
                  : "Submit Outlet for Review"}
              </button>
            </div>
          </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RestaurantOnboardingPage() {
  return (
    <Suspense fallback={<div className="text-xs text-[#8A8880]">Loading onboarding...</div>}>
      <RestaurantOnboardingInner />
    </Suspense>
  );
}
