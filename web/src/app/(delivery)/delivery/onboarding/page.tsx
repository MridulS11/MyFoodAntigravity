"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { uploadMediaWithPresign } from "@/lib/mediaUpload";
import { deliveryOnboardingSchema } from "@/lib/validators/schemas";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

type DeliveryOnboardingValues = z.infer<typeof deliveryOnboardingSchema>;

export default function DeliveryOnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const [docFileKey, setDocFileKey] = useState("");
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const { data: partner } = useQuery({
    queryKey: ["myPartnerProfile"],
    queryFn: () => services.deliveryPortal.getMyPartnerProfile(),
  });

  const form = useForm<DeliveryOnboardingValues>({
    resolver: zodResolver(deliveryOnboardingSchema),
    defaultValues: {
      vehicleType: partner?.vehicleType ?? "SCOOTER",
      vehicleModel: partner?.vehicleModel ?? "",
      licensePlate: partner?.licensePlate ?? "",
    },
  });

  async function onSubmit(values: DeliveryOnboardingValues) {
    await services.deliveryPortal.submitOnboarding({
      ...values,
      documentType: "DRIVING_LICENSE",
      fileKey: docFileKey || undefined,
    });
    await qc.invalidateQueries({ queryKey: ["myPartnerProfile"] });
    pushToast("success", "Courier KYC application submitted for Admin review.");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
            COURIER PROFILE &amp; KYC
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
            Vehicle &amp; verification documents
          </h1>
          <p className="text-xs text-[#5E5D57] mt-1">
            Complete your courier KYC to start receiving live broadcast delivery orders, or skip for now.
          </p>
        </div>
        {(!partner || !partner.onboarded) && (
          <button
            type="button"
            data-testid="skip-delivery-onboarding"
            onClick={() => {
              pushToast(
                "info",
                "Skipped for now — remember to finish onboarding before going online."
              );
              router.push("/delivery/dashboard");
            }}
            className="px-4 py-2 rounded-xl border border-[#E8E3D5] bg-white hover:bg-[#F5F0E2] text-xs font-bold text-[#5E5D57]"
          >
            Skip onboarding for now →
          </button>
        )}
      </div>

      {partner && (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-base">{partner.fullName}</div>
            <div className="text-xs text-[#5E5D57]">
              {partner.onboarded
                ? `${partner.vehicleModel} (${partner.vehicleType}) · ${partner.licensePlate}`
                : "Onboarding not yet submitted"}
            </div>
            {!partner.canReceiveOrders && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#92400E] mt-1">
                <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" />
                <span>You are not receiving orders due to onboarding verification pending.</span>
              </div>
            )}
          </div>
          <StatusBadge status={partner.verificationStatus} />
        </div>
      )}

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4"
      >
        <h2 className="font-bold text-sm">Update or Apply as New Courier</h2>
        <div>
          <label className="block text-xs font-semibold mb-1">Vehicle Type</label>
          <select
            {...form.register("vehicleType")}
            className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
          >
            <option value="BICYCLE">Bicycle / E-Bike</option>
            <option value="SCOOTER">Electric Scooter</option>
            <option value="MOTORCYCLE">Motorcycle</option>
            <option value="CAR">Car</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Vehicle Make &amp; Model</label>
          <input
            {...form.register("vehicleModel")}
            placeholder="e.g. NIU NQi Sport"
            className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
          />
          {form.formState.errors.vehicleModel && (
            <p className="text-xs text-[#C62828] mt-1">
              {form.formState.errors.vehicleModel.message}
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">License Plate / ID</label>
          <input
            {...form.register("licensePlate")}
            placeholder="e.g. NY-EV-402"
            className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">
            Driving License / ID Document (Verification/Rider)
          </label>
          <label className="inline-flex w-full items-center gap-2 border border-dashed border-[#C7C1B2] rounded-xl px-3 py-2 text-xs cursor-pointer hover:bg-[#FCF9F0]">
            <Upload className="w-3.5 h-3.5 text-[#5F8E63] shrink-0" />
            <span className="truncate text-[#5E5D57]">
              {uploadingDoc
                ? "Uploading to R2..."
                : docFileKey || "Choose driving license / ID (PDF, PNG, JPG)..."}
            </span>
            <input
              type="file"
              data-testid="rider-id-file-input"
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              disabled={uploadingDoc}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploadingDoc(true);
                try {
                  const res = await uploadMediaWithPresign(services.deliveryPortal, {
                    category: "Verification",
                    file: f,
                  });
                  setDocFileKey(res.key);
                  pushToast("success", "Rider verification document uploaded to R2.");
                } catch (err) {
                  pushToast(
                    "error",
                    err instanceof Error ? err.message : "Document upload failed."
                  );
                } finally {
                  setUploadingDoc(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs"
          >
            Submit KYC Application
          </button>
          <Link
            href="/delivery/dashboard"
            className="text-xs font-bold text-[#5E5D57] hover:text-[#1E1F1C]"
          >
            Go to Courier Dashboard →
          </Link>
        </div>
      </form>
    </div>
  );
}
