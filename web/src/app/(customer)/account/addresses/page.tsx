"use client";

import { MapPin, Trash2 } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useAddresses, useSessionUser } from "@/hooks/useGoodlyQueries";
import { services } from "@/services";
import { useAppStore } from "@/stores/useAppStore";

export default function AccountAddressesPage() {
  const { data: user } = useSessionUser();
  const { data: addresses = [] } = useAddresses(Boolean(user));
  const setAddressModalOpen = useAppStore((s) => s.setAddressModalOpen);
  const qc = useQueryClient();

  async function handleDelete(id: string) {
    await services.auth.deleteAddress(id);
    qc.invalidateQueries({ queryKey: ["addresses"] });
  }

  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/account/profile" className="text-xs text-[#5F8E63] hover:underline">
            ← Back to account
          </Link>
          <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
            Saved addresses
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setAddressModalOpen(true)}
          className="px-4 py-2 rounded-lg bg-[#DEC146] text-xs font-bold text-[#1E1F1C]"
        >
          Add / Switch address
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {addresses.map((addr) => (
          <div
            key={addr.id}
            className="bg-white border border-[#E8E3D5] rounded-2xl p-5 flex justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-[#5F8E63] mt-1 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">{addr.label}</span>
                  {addr.isDefault && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#CBEAD0]">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#5E5D57] mt-1">
                  {addr.addressLine1}, {addr.city}, {addr.state} {addr.postalCode}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(addr.id)}
              className="text-[#8A8880] hover:text-[#C62828] self-start"
              aria-label={`Delete ${addr.label}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
