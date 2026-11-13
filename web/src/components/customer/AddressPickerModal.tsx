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
import { GoogleMapPicker } from "@/components/shared/GoogleMapPicker";

type AddressFormValues = z.infer<typeof addressSchema>;

export function AddressPickerModal() {
  const isOpen = useAppStore((s) => s.isAddressModalOpen);
  const setOpen = useAppStore((s) => s.setAddressModalOpen);
  const activeAddressId = useAppStore((s) => s.activeAddressId);
  const activePoint = useAppStore((s) => s.activePoint);
  const setActiveLocation = useAppStore((s) => s.setActiveLocation);
  const pushToast = useAppStore((s) => s.pushToast);

  const { data: user } = useSessionUser();
  const { data: addresses = [] } = useAddresses(Boolean(user));
  const qc = useQueryClient();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showBrowsePin, setShowBrowsePin] = useState(false);
  const [pickedPoint, setPickedPoint] = useState(activePoint);
  const [hasSelectedOnMap, setHasSelectedOnMap] = useState(false);
  const [browseAddress, setBrowseAddress] = useState({
    label: "",
    addressLine1: "",
    city: "Bengaluru",
    state: "KA",
    postalCode: "560038",
  });
  const [savingBrowse, setSavingBrowse] = useState(false);

  const normalizedExistingTags = new Set(
    addresses.map((a) => a.label.trim().toLowerCase())
  );
  const isTagDuplicate = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    return trimmed.length > 0 && normalizedExistingTags.has(trimmed);
  };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      label: "",
      recipientName: user?.fullName?.trim() || "Goodly Customer",
      recipientPhone: user?.phone?.trim() || "+91-9876543201",
      city: "Bengaluru",
      state: "KA",
      postalCode: "560038",
    },
  });
  const enteredFormLabel = watch("label") ?? "";
  const formTagDuplicate = isTagDuplicate(enteredFormLabel);
  const browseTagDuplicate = Boolean(user) && isTagDuplicate(browseAddress.label);

  if (!isOpen) return null;

  async function onCreateAddress(values: AddressFormValues) {
    const trimmedLabel = values.label.trim();
    if (isTagDuplicate(trimmedLabel)) {
      pushToast(
        "error",
        `You already have a location tagged "${trimmedLabel}". Two tags cannot be the same.`
      );
      return;
    }
    try {
      const saved = await services.auth.saveAddress({
        ...values,
        label: trimmedLabel,
        recipientName:
          values.recipientName?.trim() || user?.fullName?.trim() || "Goodly Customer",
        recipientPhone:
          values.recipientPhone?.trim() || user?.phone?.trim() || "+91-9876543201",
        countryCode: "IN",
        location: pickedPoint,
        isDefault: true,
      });
      await qc.invalidateQueries({ queryKey: ["addresses"] });
      setActiveLocation({
        addressId: saved.id,
        cityLabel: `${saved.label} · ${saved.city}, ${saved.state}`,
        point: saved.location,
      });
      pushToast("success", `Saved "${saved.label}" address: ${saved.addressLine1}`);
      reset();
      setHasSelectedOnMap(false);
      setShowAddForm(false);
      setOpen(false);
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Could not save address."
      );
    }
  }

  async function onConfirmBrowseLocation() {
    const trimmedLabel = browseAddress.label.trim();
    if (
      !hasSelectedOnMap ||
      trimmedLabel.length === 0 ||
      browseAddress.addressLine1.trim().length < 4 ||
      browseAddress.city.trim().length < 2
    ) {
      return;
    }

    if (user && isTagDuplicate(trimmedLabel)) {
      pushToast(
        "error",
        `You already have a location tagged "${trimmedLabel}". Two tags cannot be the same.`
      );
      return;
    }

    // If signed in, persist the location + spatial coordinates to PostgreSQL.
    if (user) {
      setSavingBrowse(true);
      try {
        const saved = await services.auth.saveAddress({
          label: trimmedLabel,
          recipientName: user.fullName?.trim() || "Goodly Customer",
          recipientPhone: user.phone?.trim() || "+91-9876543201",
          addressLine1: browseAddress.addressLine1.trim(),
          city: browseAddress.city.trim(),
          state: browseAddress.state.trim() || "KA",
          postalCode: browseAddress.postalCode.trim() || "560038",
          countryCode: "IN",
          location: pickedPoint,
          isDefault: true,
        });
        await qc.invalidateQueries({ queryKey: ["addresses"] });
        setActiveLocation({
          addressId: saved.id,
          cityLabel: `${saved.label} · ${saved.city}, ${saved.state}`,
          point: saved.location,
        });
        pushToast("success", `Saved "${saved.label}" (${saved.addressLine1})`);
        setShowBrowsePin(false);
        setHasSelectedOnMap(false);
        setOpen(false);
      } catch (err) {
        pushToast(
          "error",
          err instanceof Error ? err.message : "Could not save location."
        );
      } finally {
        setSavingBrowse(false);
      }
      return;
    }

    // Guest browsing: apply temporary pin + address label in store.
    setActiveLocation({
      addressId: "custom-map-pin",
      cityLabel: `${browseAddress.label} · ${browseAddress.addressLine1.trim()}, ${browseAddress.city.trim()}`,
      point: pickedPoint,
    });
    setShowBrowsePin(false);
    setHasSelectedOnMap(false);
    setOpen(false);
    pushToast(
      "success",
      `Browsing as "${browseAddress.label}": ${browseAddress.addressLine1.trim()}, ${browseAddress.city.trim()}`
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose delivery address"
    >
      <div className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden transition-all duration-200 ease-out animate-in fade-in zoom-in-95">
        <div className="px-7 py-5 border-b border-[#E8E3D5] flex items-center justify-between bg-white shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[#1E1F1C]">
              Delivering to
            </h2>
            <p className="text-xs text-[#8A8880]">
              Choose a saved address or pin a new location with a unique tag
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

        <div className="p-6 sm:p-7 space-y-4 flex-1 overflow-y-auto">
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
                  onClick={() => {
                    setPickedPoint(activePoint);
                    setHasSelectedOnMap(false);
                    setShowBrowsePin(false);
                    setShowAddForm(true);
                  }}
                  className="w-full py-3 rounded-xl border border-dashed border-[#8A8880] text-sm font-semibold text-[#1E1F1C] hover:bg-white transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add new delivery address</span>
                </button>
              )}

              <div className="pt-1 border-t border-[#E8E3D5]">
                {!showBrowsePin ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPickedPoint(activePoint);
                      setHasSelectedOnMap(false);
                      setShowBrowsePin(true);
                    }}
                    className="w-full py-2.5 rounded-xl bg-white border border-[#E8E3D5] hover:border-[#8A8880] text-xs font-semibold text-[#1E1F1C] flex items-center justify-center gap-2"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#5F8E63]" />
                    <span>Pick browsing location on interactive map</span>
                  </button>
                ) : (
                  <div className="space-y-3 pt-1">
                    <GoogleMapPicker
                      value={pickedPoint}
                      onChange={(pt) => {
                        setPickedPoint(pt);
                        setHasSelectedOnMap(true);
                      }}
                      onAddressResolved={(fields) => {
                        setBrowseAddress((prev) => ({
                          ...prev,
                          addressLine1: fields.addressLine1 ?? prev.addressLine1,
                          city: fields.city ?? prev.city,
                          state: fields.state ?? prev.state,
                          postalCode: fields.postalCode ?? prev.postalCode,
                        }));
                      }}
                      label="Step 1: Pin your location on the map"
                      helperText="Search, click the map, or drag the custom pin to select your spot."
                      heightClassName="h-[300px]"
                      mapStyle="minimal"
                    />
                    {!hasSelectedOnMap ? (
                      <p className="text-xs text-[#8A8880] bg-white border border-[#E8E3D5] rounded-lg px-3 py-2">
                        Select a location on the map above to tag and enter your complete address.
                      </p>
                    ) : (
                      <div className="space-y-3 bg-white border border-[#E8E3D5] rounded-xl p-4 transition-all duration-200 ease-out">
                        <div className="text-xs font-bold text-[#1E1F1C]">
                          Step 2: Tag & complete address
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                            Location Tag *
                          </label>
                          <input
                            type="text"
                            maxLength={50}
                            value={browseAddress.label}
                            onChange={(e) =>
                              setBrowseAddress((s) => ({ ...s, label: e.target.value }))
                            }
                            placeholder="e.g. Home, Office, Mom's House, Studio"
                            className={`w-full bg-white border rounded-lg px-3 py-2 text-xs ${
                              browseTagDuplicate
                                ? "border-[#C62828] focus:outline-none focus:ring-1 focus:ring-[#C62828]"
                                : "border-[#E8E3D5]"
                            }`}
                          />
                          {browseTagDuplicate && (
                            <p className="text-[11px] text-[#C62828] mt-1">
                              You already have a location tagged &ldquo;{browseAddress.label.trim()}&rdquo;. Two tags cannot be the same.
                            </p>
                          )}
                        </div>
                        <input
                          type="text"
                          value={browseAddress.addressLine1}
                          onChange={(e) =>
                            setBrowseAddress((s) => ({ ...s, addressLine1: e.target.value }))
                          }
                          placeholder="House / Flat / Building & Street (required)"
                          className="w-full bg-white border border-[#E8E3D5] rounded-lg px-3 py-2 text-xs"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={browseAddress.city}
                            onChange={(e) =>
                              setBrowseAddress((s) => ({ ...s, city: e.target.value }))
                            }
                            placeholder="City"
                            className="w-full bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 text-xs"
                          />
                          <input
                            type="text"
                            value={browseAddress.state}
                            onChange={(e) =>
                              setBrowseAddress((s) => ({ ...s, state: e.target.value }))
                            }
                            placeholder="State"
                            className="w-full bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 text-xs"
                          />
                          <input
                            type="text"
                            value={browseAddress.postalCode}
                            onChange={(e) =>
                              setBrowseAddress((s) => ({ ...s, postalCode: e.target.value }))
                            }
                            placeholder="PIN Code"
                            className="w-full bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 text-xs"
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowBrowsePin(false);
                          setHasSelectedOnMap(false);
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#5E5D57] hover:bg-[#F5F0E2]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={
                          savingBrowse ||
                          !hasSelectedOnMap ||
                          browseTagDuplicate ||
                          browseAddress.label.trim().length === 0 ||
                          browseAddress.addressLine1.trim().length < 4 ||
                          browseAddress.city.trim().length < 2
                        }
                        onClick={() => void onConfirmBrowseLocation()}
                        className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] disabled:opacity-40"
                      >
                        {savingBrowse
                          ? "Saving..."
                          : user
                          ? "Save & use location"
                          : "Confirm location"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit(onCreateAddress)} className="space-y-3">
              <GoogleMapPicker
                value={pickedPoint}
                onChange={(pt) => {
                  setPickedPoint(pt);
                  setHasSelectedOnMap(true);
                }}
                onAddressResolved={(fields) => {
                  if (fields.addressLine1) {
                    setValue("addressLine1", fields.addressLine1, { shouldValidate: true });
                  }
                  if (fields.city) {
                    setValue("city", fields.city, { shouldValidate: true });
                  }
                  if (fields.state) {
                    setValue("state", fields.state, { shouldValidate: true });
                  }
                  if (fields.postalCode) {
                    setValue("postalCode", fields.postalCode, { shouldValidate: true });
                  }
                }}
                heightClassName="h-[300px]"
                mapStyle="minimal"
                label="Step 1: Pin delivery address on map"
              />
              {!hasSelectedOnMap ? (
                <div className="space-y-2">
                  <p className="text-xs text-[#8A8880] bg-white border border-[#E8E3D5] rounded-lg px-3 py-2">
                    Select a location on the map above (search, click, drag pin, or use current location) to enter your complete address.
                  </p>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="px-4 py-2 rounded-lg text-sm font-semibold text-[#5E5D57] hover:bg-[#F5F0E2]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#5E5D57] mb-1">
                    Location Tag *
                  </label>
                  <input
                    {...register("label")}
                    maxLength={50}
                    placeholder="e.g. Home, Office, Mom's House"
                    className={`w-full bg-white border rounded-lg px-3 py-2 text-sm ${
                      formTagDuplicate || errors.label
                        ? "border-[#C62828] focus:outline-none focus:ring-1 focus:ring-[#C62828]"
                        : "border-[#E8E3D5]"
                    }`}
                  />
                  {formTagDuplicate ? (
                    <p className="text-xs text-[#C62828] mt-1">
                      You already have a location tagged &ldquo;{enteredFormLabel.trim()}&rdquo;. Two tags cannot be the same.
                    </p>
                  ) : errors.label ? (
                    <p className="text-xs text-[#C62828] mt-1">
                      {errors.label.message}
                    </p>
                  ) : null}
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
                  disabled={isSubmitting || formTagDuplicate}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] disabled:opacity-40"
                >
                  {isSubmitting ? "Saving..." : "Save address"}
                </button>
              </div>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
