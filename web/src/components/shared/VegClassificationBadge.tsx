"use client";

import type { VegClassification } from "@/services/contracts/types";

const CONFIG: Record<
  VegClassification,
  { label: string; border: string; dot: string; text: string; bg: string }
> = {
  VEG: {
    label: "Veg",
    border: "border-[#2E7D32]",
    dot: "bg-[#2E7D32]",
    text: "text-[#1B5E20]",
    bg: "bg-[#E8F5E9]",
  },
  NON_VEG: {
    label: "Non-Veg",
    border: "border-[#C62828]",
    dot: "bg-[#C62828]",
    text: "text-[#C62828]",
    bg: "bg-[#FDECEA]",
  },
  EGG_ONLY: {
    label: "Non-Veg (Only Egg)",
    border: "border-[#B45309]",
    dot: "bg-[#D97706]",
    text: "text-[#92400E]",
    bg: "bg-[#FEF3C7]",
  },
};

export function VegClassificationBadge({
  classification = "VEG",
}: {
  classification?: VegClassification;
}) {
  const cfg = CONFIG[classification] ?? CONFIG.VEG;
  return (
    <span
      data-testid={`veg-badge-${classification}`}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold ${cfg.bg} ${cfg.text}`}
    >
      <span
        className={`w-3 h-3 rounded-[2px] border ${cfg.border} bg-white flex items-center justify-center shrink-0`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      </span>
      <span>{cfg.label}</span>
    </span>
  );
}
