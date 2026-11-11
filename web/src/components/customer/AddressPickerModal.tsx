"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, MapPin, Plus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useAddresses, useSessionUser } from "@/hooks/useGoodlyQueries";
import { addressSchema } from "@/lib/validators/schemas";
import { services } from "@/services";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/useAppStore";

type AddressFormValues = z.infer<typeof addressSchema>;

export function AddressPickerModal() {
  const isOpen = useAppStore((s) => s.isAddressModalOpen);
  const setOpen = useAppStore((s) => s.setAddressModalOpen);
  const activeAddressId = useAppStore((s) => s.activeAddressId);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: user } = useSessionUser();
  const { data: addresses = [] } = useAddresses(Boolean(user));
  const qc = useQueryClient();

  const [showAddForm, setShowAddForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: "Home",
      recipientName: user?.fullName ?? "Aarav Sharma",
      recipientPhone: user?.phone ?? "+91-9876543201",
      city: "Bengaluru",
      state: "KA",
      postalCode: "560038",
    },
  });

  if (!isOpen) return null;

  async function onCreateAddress(values: AddressFormValues) {
    try {
      const saved = await services.auth.saveAddress({
        ...values,
        countryCode: "IN",
        location: { lat: 12.9784, lng: 77.6408 },
        isDefault: true,
      });
      await qc.invalidateQueries({ queryKey: ["addresses"] });
      setActiveLocation({
        addressId: saved.id,
        cityLabel: `${saved.city}, ${saved.state}`,
        point: saved.location,
      });
      pushToast("success", `Delivering to ${saved.addressLine1}`);
      reset();
      setShowAddForm(false);
      setOpen(false);
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Could not save address."
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose delivery address"
    >
      <div className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E8E3D5] flex items-center justify-between bg-white">
          <div>
            <h2 className="text-base font-bold text-[#1E1F1C]">
              Delivering to
            </h2>
            <p className="text-xs text-[#8A8880]">
              Choose a saved address to verify neighborhood delivery availability
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[#F5F0E2] text-[#5E5D57]"
            aria-label="Close address modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
          {!showAddForm ? (
            <>
              {addresses.map((addr) => {
                const selected = addr.id === activeAddressId;
                return (
                  <button
                    key={addr.id}
                    type="button"
                    data-testid={`select-address-${addr.id}`}
                    onClick={() => {
                      setActiveLocation({
                        addressId: addr.id,
                        cityLabel: `${addr.city}, ${addr.state}`,
                        point: addr.location,
                      });
                      setOpen(false);
                    }}
                    className={`w-full text-left p-4 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                      selected
                        ? "bg-white border-[#1E1F1C] shadow-xs"
                        : "bg-white border-[#E8E3D5] hover:border-[#8A8880]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <MapPin className="w-4 h-4 text-[#5F8E63] mt-0.5 shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#1E1F1C]">
                            {addr.label}
                          </span>
                          {!addr.isServiceable && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#FDECEA] text-[#C62828]">
                              Outside delivery zone
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#5E5D57] mt-0.5">
                          {addr.addressLine1}, {addr.city}, {addr.state}{" "}
                          {addr.postalCode}
                        </div>
                      </div>
                    </div>
                    {selected && <Check className="w-4 h-4 text-[#5F8E63] shrink-0" />}
                  </button>
                );
              })}

              {user && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-3 rounded-xl border border-dashed border-[#8A8880] text-sm font-semibold text-[#1E1F1C] hover:bg-white transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add new delivery address</span>
                </button>
              )}
            </>
          ) : (
            <form onSubmit={handleSubmit(onCreateAddress)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                    Label
                  </label>
                  <select
                    {...register("label")}
                    className="w-full bg-white border border-[#E8E3D5] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="Home">Home</option>
                    <option value="Work">Work</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                    Postal Code
                  </label>
                  <input
                    {...register("postalCode")}
                    className="w-full bg-white border border-[#E8E3D5] rounded-lg px-3 py-2 text-sm"
                  />
                  {errors.postalCode && (
                    <p className="text-xs text-[#C62828] mt-1">
                      {errors.postalCode.message}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                  Street Address
                </label>
                <input
                  {...register("addressLine1")}
                  placeholder="e.g. 285 Carroll St, Apt 2"
                  className="w-full bg-white border border-[#E8E3D5] rounded-lg px-3 py-2 text-sm"
                />
                {errors.addressLine1 && (
                  <p className="text-xs text-[#C62828] mt-1">
                    {errors.addressLine1.message}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                    City
                  </label>
                  <input
                    {...register("city")}
                    className="w-full bg-white border border-[#E8E3D5] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                    State
                  </label>
                  <input
                    {...register("state")}
                    className="w-full bg-white border border-[#E8E3D5] rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                  Delivery Instructions
                </label>
                <input
                  {...register("deliveryInstructions")}
                  placeholder="Buzzer code, leave at door..."
                  className="w-full bg-white border border-[#E8E3D5] rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-[#5E5D57] hover:bg-[#F5F0E2]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C]"
                >
                  Save address
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
