"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import type { OperatingHourSlot } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function RestaurantHoursPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data } = useQuery({
    queryKey: ["myRestaurant"],
    queryFn: () => services.restaurantPortal.getMyRestaurant(),
  });

  const [slots, setSlots] = useState<OperatingHourSlot[] | null>(null);
  const rawSlots = slots ?? data?.restaurant.operatingHours ?? [];
  const currentSlots =
    rawSlots.length > 0
      ? rawSlots
      : DAY_NAMES.map((_, day) => ({
          dayOfWeek: day,
          slotNumber: 1,
          openTime: "09:00",
          closeTime: "22:00",
          isClosed: false,
        }));

  function updateSlot(day: number, patch: Partial<OperatingHourSlot>) {
    setSlots(
      currentSlots.map((s) => (s.dayOfWeek === day ? { ...s, ...patch } : s))
    );
  }

  async function handleSave() {
    for (const slot of currentSlots) {
      if (!slot.isClosed && slot.openTime >= slot.closeTime) {
        pushToast(
          "error",
          `${DAY_NAMES[slot.dayOfWeek]}: closing time must be after opening time.`
        );
        return;
      }
    }
    await services.restaurantPortal.updateOperatingHours(currentSlots);
    await qc.invalidateQueries({ queryKey: ["myRestaurant"] });
    pushToast("success", "Operating hours updated.");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          SCHEDULE
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Weekly operating hours
        </h1>
      </div>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl divide-y divide-[#E8E3D5]">
        {currentSlots.map((slot) => (
          <div
            key={slot.dayOfWeek}
            className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs"
          >
            <div className="w-28 font-bold text-[#1E1F1C]">
              {DAY_NAMES[slot.dayOfWeek]}
            </div>
            <label className="inline-flex items-center gap-2 font-medium text-[#5E5D57]">
              <input
                type="checkbox"
                checked={slot.isClosed}
                onChange={(e) =>
                  updateSlot(slot.dayOfWeek, { isClosed: e.target.checked })
                }
              />
              <span>Closed</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                disabled={slot.isClosed}
                value={slot.openTime}
                onChange={(e) =>
                  updateSlot(slot.dayOfWeek, { openTime: e.target.value })
                }
                className="border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 disabled:opacity-40"
              />
              <span>to</span>
              <input
                type="time"
                disabled={slot.isClosed}
                value={slot.closeTime}
                onChange={(e) =>
                  updateSlot(slot.dayOfWeek, { closeTime: e.target.value })
                }
                className="border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 disabled:opacity-40"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSave}
        className="px-5 py-2.5 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs"
      >
        Save schedule
      </button>

      {/* Outlet Capacity, Menu Schedules & Branch Staff Permissions */}
      {data?.restaurant && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-[#E8E3D5]">
          <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-[#1E1F1C]">
              Kitchen Capacity &amp; Menu Schedules
            </h2>
            <p className="text-xs text-[#5E5D57]">
              Max Concurrent Orders:{" "}
              <strong>{data.restaurant.maxConcurrentOrders ?? 15}</strong>{" "}
              (Active now: {data.restaurant.activeOrdersCount ?? 0})
            </p>
            {data.restaurant.menuSchedules &&
              data.restaurant.menuSchedules.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-bold uppercase text-[#8A8880]">
                    Configured Menu Windows
                  </div>
                  {data.restaurant.menuSchedules.map((ms) => (
                    <div
                      key={ms.id}
                      className="text-xs bg-[#FCF9F0] border border-[#E8E3D5] rounded-lg px-3 py-1.5 flex justify-between"
                    >
                      <span className="font-semibold">{ms.label}</span>
                      <span className="text-[#5E5D57]">
                        {ms.startTime} – {ms.endTime}
                      </span>
                    </div>
                  ))}
                </div>
              )}
          </div>

          <div className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-[#1E1F1C]">
              Branch Manager &amp; Staff Access
            </h2>
            <p className="text-xs text-[#5E5D57]">
              Outlet Owners can assign Branch Managers with granular operational permissions per outlet.
            </p>
            <div className="space-y-2">
              {(data.restaurant.staffMembers ?? []).map((staff) => (
                <div
                  key={staff.id}
                  className="text-xs bg-[#FCF9F0] border border-[#E8E3D5] rounded-lg p-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>{staff.fullName}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[#CBEAD0] text-[#1E1F1C]">
                      {staff.roleCode}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#8A8880]">
                    Permissions: {staff.permissions.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
