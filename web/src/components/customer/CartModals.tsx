"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useAddToCart } from "@/hooks/useGoodlyQueries";
import { formatMinor } from "@/lib/format";
import { validateCustomizationSelection } from "@/lib/validators/schemas";
import type { MenuItem } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export function MultiRestaurantConflictModal() {
  const conflict = useAppStore((s) => s.conflictModal);
  const closeConflictModal = useAppStore((s) => s.closeConflictModal);
  const addToCart = useAddToCart();

  if (!conflict.isOpen || !conflict.pendingPayload) return null;

  async function handleReplace() {
    if (!conflict.pendingPayload) return;
    await addToCart.mutateAsync({
      ...conflict.pendingPayload,
      replaceCart: true,
    });
    closeConflictModal();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Replace items in your bag"
    >
      <div className="bg-white border border-[#E8E3D5] rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-[#1E1F1C]">
          Start a new bag?
        </h3>
        <p className="text-sm text-[#5E5D57] mt-2 leading-relaxed">
          Your bag currently contains dishes from{" "}
          <strong className="text-[#1E1F1C]">{conflict.existingRestaurantName}</strong>.
          Replacing it will clear your current items and start fresh with{" "}
          <strong className="text-[#1E1F1C]">{conflict.incomingRestaurantName}</strong>.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={closeConflictModal}
            className="px-4 py-2.5 rounded-lg border border-[#E8E3D5] text-sm font-semibold text-[#5E5D57] hover:bg-[#F5F0E2]"
          >
            Keep current bag
          </button>
          <button
            type="button"
            onClick={handleReplace}
            disabled={addToCart.isPending}
            className="px-4 py-2.5 rounded-lg bg-[#DEC146] hover:bg-[#CFAF32] text-sm font-semibold text-[#1E1F1C]"
          >
            Replace bag
          </button>
        </div>
      </div>
    </div>
  );
}

export function ItemCustomizationModal({
  item,
  restaurantId,
  onClose,
}: {
  item: MenuItem | null;
  restaurantId: string;
  onClose: () => void;
}) {
  const addToCart = useAddToCart();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (!item) return [];
    const defaults: string[] = [];
    for (const g of item.customizationGroups) {
      for (const opt of g.options) {
        if (opt.isDefault) defaults.push(opt.id);
      }
    }
    return defaults;
  });
  const [quantity, setQuantity] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!item) return null;

  function toggleOption(groupId: string, optionId: string, maxSelections: number) {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    const group = item!.customizationGroups.find((g) => g.id === groupId);
    if (!group) return;

    if (maxSelections === 1) {
      const otherGroupOptionIds = selectedIds.filter(
        (id) => !group.options.some((o) => o.id === id)
      );
      setSelectedIds([...otherGroupOptionIds, optionId]);
    } else {
      if (selectedIds.includes(optionId)) {
        setSelectedIds(selectedIds.filter((id) => id !== optionId));
      } else {
        const currentGroupCount = group.options.filter((o) =>
          selectedIds.includes(o.id)
        ).length;
        if (currentGroupCount >= maxSelections) {
          setErrors((prev) => ({
            ...prev,
            [groupId]: `Maximum ${maxSelections} options allowed for ${group.name}.`,
          }));
          return;
        }
        setSelectedIds([...selectedIds, optionId]);
      }
    }
  }

  const optionsTotal = item.customizationGroups.reduce((sum, g) => {
    return (
      sum +
      g.options
        .filter((o) => selectedIds.includes(o.id))
        .reduce((s, o) => s + o.priceDeltaMinor, 0)
    );
  }, 0);

  const unitTotal = item.basePriceMinor + optionsTotal;

  async function handleConfirm() {
    if (!item) return;
    const validationErrors = validateCustomizationSelection(
      item.customizationGroups,
      selectedIds
    );
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    await addToCart.mutateAsync({
      restaurantId,
      menuItemId: item.id,
      quantity,
      selectedOptionIds: selectedIds,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Customize ${item.name}`}
    >
      <div className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        <div className="p-5 bg-white border-b border-[#E8E3D5] flex items-start justify-between gap-4">
          <div>
            {item.badgeLabel && (
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#5F8E63]">
                {item.badgeLabel}
              </div>
            )}
            <h3 className="text-lg font-bold text-[#1E1F1C] mt-0.5">
              {item.name}
            </h3>
            <p className="text-xs text-[#5E5D57] mt-1">{item.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#F5F0E2]"
            aria-label="Close customization modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {item.customizationGroups.map((group) => (
            <div
              key={group.id}
              className="bg-white border border-[#E8E3D5] rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-bold text-[#1E1F1C]">
                    {group.name}
                  </h4>
                  <p className="text-xs text-[#8A8880]">
                    {group.isRequired
                      ? `Required · Choose ${group.minSelections}`
                      : `Optional · Up to ${group.maxSelections}`}
                  </p>
                </div>
                {group.isRequired && (
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#F7ECC1] text-[#6B5400]">
                    Required
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {group.options.map((opt) => {
                  const checked = selectedIds.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        checked
                          ? "border-[#1E1F1C] bg-[#FCF9F0]"
                          : "border-[#E8E3D5] hover:bg-[#FCF9F0]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type={group.maxSelections === 1 ? "radio" : "checkbox"}
                          name={group.id}
                          checked={checked}
                          onChange={() =>
                            toggleOption(group.id, opt.id, group.maxSelections)
                          }
                          className="accent-[#1E1F1C]"
                        />
                        <span className="text-sm text-[#1E1F1C] font-medium">
                          {opt.name}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-[#5E5D57] tabular-nums">
                        {opt.priceDeltaMinor > 0
                          ? `+${formatMinor(opt.priceDeltaMinor, item.currency)}`
                          : "Included"}
                      </span>
                    </label>
                  );
                })}
              </div>

              {errors[group.id] && (
                <p className="text-xs text-[#C62828] font-medium mt-2">
                  {errors[group.id]}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="p-5 bg-white border-t border-[#E8E3D5] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 border border-[#E8E3D5] rounded-lg px-2 py-1">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="px-2 py-1 text-sm font-bold"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="text-sm font-bold w-6 text-center tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => q + 1)}
              className="px-2 py-1 text-sm font-bold"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={addToCart.isPending}
            className="flex-1 bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-semibold text-sm py-3 px-4 rounded-xl transition-colors tabular-nums"
          >
            Add to bag · {formatMinor(unitTotal * quantity, item.currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
