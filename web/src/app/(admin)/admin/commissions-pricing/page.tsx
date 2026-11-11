"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMinor } from "@/lib/format";
import { commissionConfigSchema } from "@/lib/validators/schemas";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

type ConfigValues = z.infer<typeof commissionConfigSchema>;

export default function AdminCommissionsPricingPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: config, isError, error } = useQuery({
    queryKey: ["adminCommissionConfig"],
    queryFn: () => services.adminPortal.getCommissionConfig(),
  });

  const { data: coupons = [] } = useQuery({
    queryKey: ["adminCoupons"],
    queryFn: () => services.adminPortal.listCoupons(),
    enabled: Boolean(config),
  });

  const [newCode, setNewCode] = useState("");
  const [newDiscountMinor, setNewDiscountMinor] = useState(5000);

  const form = useForm<ConfigValues>({
    resolver: zodResolver(commissionConfigSchema),
  });

  useEffect(() => {
    if (config) form.reset(config);
  }, [config, form]);

  if (isError) {
    return (
      <div
        data-testid="admin-rbac-denied"
        className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]"
      >
        {error instanceof Error
          ? error.message
          : "Permission commissions:configure required."}
      </div>
    );
  }

  async function onSaveConfig(values: ConfigValues) {
    try {
      await services.adminPortal.updateCommissionConfig(
        values,
        "Updated via Admin pricing console"
      );
      await qc.invalidateQueries();
      pushToast("success", "Commission & pricing configuration saved.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function handleCreateCoupon() {
    if (!newCode.trim()) return;
    await services.adminPortal.createCoupon({
      code: newCode.trim().toUpperCase(),
      title: `${formatMinor(newDiscountMinor)} off neighborhood order`,
      discountType: "FLAT_AMOUNT",
      discountValue: newDiscountMinor,
      minOrderSubtotalMinor: 29900,
      firstOrderOnly: false,
      maxTotalUses: 200,
      isActive: true,
      endsAt: "2027-01-01T00:00:00Z",
    });
    setNewCode("");
    await qc.invalidateQueries({ queryKey: ["adminCoupons"] });
    pushToast("success", "Coupon created.");
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          PRICING &amp; PROMOTIONS
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Commissions, delivery charges &amp; coupons
        </h1>
      </div>

      <form
        onSubmit={form.handleSubmit(onSaveConfig)}
        className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-5"
      >
        <h2 className="font-bold text-base">
          Platform Economics, Small-Cart Fee &amp; Admin-Configurable Penalty / Payout Rules
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-semibold mb-1">
              Default Commission (bps, 2000 = 20%)
            </label>
            <input
              type="number"
              {...form.register("defaultCommissionBps", { valueAsNumber: true })}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">
              Commission Calculation Basis
            </label>
            <select
              {...form.register("commissionCalculationBasis")}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2 bg-white"
            >
              <option value="GROSS_FOOD_SUBTOTAL">Gross Food Subtotal</option>
              <option value="NET_AFTER_OUTLET_DISCOUNT">Net After Outlet Discount</option>
              <option value="SUBTOTAL_PLUS_PACKAGING">Subtotal + Packaging</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">
              GST / Tax Rate (bps, 500 = 5%)
            </label>
            <input
              type="number"
              {...form.register("taxRateBps", { valueAsNumber: true })}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">
              Min Cart Threshold (paise, 29900 = ₹299)
            </label>
            <input
              type="number"
              {...form.register("minCartThresholdMinor", { valueAsNumber: true })}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">
              Small-Cart Fee (paise, 2900 = ₹29)
            </label>
            <input
              type="number"
              {...form.register("smallCartFeeMinor", { valueAsNumber: true })}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">
              Platform Fee (paise, 1000 = ₹10)
            </label>
            <input
              type="number"
              {...form.register("platformFeeMinor", { valueAsNumber: true })}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">
              Base Delivery Fee (paise, 2900 = ₹29)
            </label>
            <input
              type="number"
              {...form.register("baseDeliveryFeeMinor", { valueAsNumber: true })}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">
              Partner Base Payout (paise, 3500 = ₹35)
            </label>
            <input
              type="number"
              {...form.register("partnerBasePayoutMinor", { valueAsNumber: true })}
              className="w-full border border-[#E8E3D5] rounded-xl px-3 py-2"
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 font-semibold">
              <input type="checkbox" {...form.register("codEnabled")} />
              <span>Enable Cash on Delivery (COD)</span>
            </label>
          </div>
        </div>

        {/* Section 9 Admin-Configurable Financial Rules */}
        <div className="border-t border-[#E8E3D5] pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl p-4 space-y-2">
            <div className="font-bold text-[#1E1F1C]">
              1. Restaurant Non-Acceptance Penalty (5m Timeout + Grace)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-[#5E5D57] mb-1">
                  Rule Type
                </label>
                <select
                  data-testid="penalty-rule-select"
                  {...form.register("nonAcceptancePenaltyMode")}
                  className="w-full border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 bg-white"
                >
                  <option value="PERCENTAGE_OF_SUBTOTAL">% of Subtotal (bps)</option>
                  <option value="FLAT_AMOUNT">Fixed Amount (paise)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#5E5D57] mb-1">
                  Penalty % (bps, 1000 = 10%)
                </label>
                <input
                  type="number"
                  {...form.register("nonAcceptancePenaltyBps", {
                    valueAsNumber: true,
                  })}
                  className="w-full border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 bg-white"
                />
              </div>
            </div>
          </div>

          <div className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl p-4 space-y-2">
            <div className="font-bold text-[#1E1F1C]">
              2. Daily Delivery Partner Payout Fee Calculation
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-[#5E5D57] mb-1">
                  Rule Type
                </label>
                <select
                  data-testid="payout-fee-rule-select"
                  {...form.register("partnerDailyPayoutFeeMode")}
                  className="w-full border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 bg-white"
                >
                  <option value="FREE_SCHEDULED_PAID_INSTANT">
                    Free Daily Scheduled · Paid Instant
                  </option>
                  <option value="FLAT_DAILY">Flat Daily Settlement Fee</option>
                  <option value="PERCENTAGE_CAPPED">% of Payout (Capped)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#5E5D57] mb-1">
                  Instant Cashout Fee (paise)
                </label>
                <input
                  type="number"
                  {...form.register("partnerInstantCashoutFeeMinor", {
                    valueAsNumber: true,
                  })}
                  className="w-full border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 bg-white"
                />
              </div>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] font-bold text-xs"
        >
          Save Configuration
        </button>
      </form>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 space-y-4">
        <h2 className="font-bold text-base">Active Promo Coupons</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="NEWCODE"
            className="border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs uppercase"
          />
          <input
            type="number"
            value={newDiscountMinor}
            onChange={(e) => setNewDiscountMinor(Number(e.target.value))}
            placeholder="500 ($5)"
            className="w-32 border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
          />
          <button
            type="button"
            onClick={handleCreateCoupon}
            className="px-4 py-2 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] text-xs font-bold"
          >
            Create Flat Coupon
          </button>
        </div>

        <div className="divide-y divide-[#E8E3D5]">
          {coupons.map((c) => (
            <div key={c.id} className="py-3 flex items-center justify-between text-xs">
              <div>
                <span className="font-extrabold text-[#1E1F1C]">{c.code}</span> —{" "}
                <span className="text-[#5E5D57]">{c.title}</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await services.adminPortal.toggleCoupon(c.id, !c.isActive);
                  qc.invalidateQueries({ queryKey: ["adminCoupons"] });
                }}
                className={`px-3 py-1 rounded-full font-bold ${
                  c.isActive
                    ? "bg-[#E8F5E9] text-[#1B5E20]"
                    : "bg-[#FDECEA] text-[#C62828]"
                }`}
              >
                {c.isActive ? "Active" : "Paused"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
