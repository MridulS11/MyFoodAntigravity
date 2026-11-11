"use client";

import { AddressPickerModal } from "@/components/customer/AddressPickerModal";
import { CartDrawer } from "@/components/customer/CartDrawer";
import { MultiRestaurantConflictModal } from "@/components/customer/CartModals";
import { CustomerFooter } from "@/components/customer/CustomerFooter";
import { CustomerHeader } from "@/components/customer/CustomerHeader";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[#FCF9F0]">
      <CustomerHeader />
      <main className="flex-1">{children}</main>
      <CustomerFooter />
      <AddressPickerModal />
      <CartDrawer />
      <MultiRestaurantConflictModal />
    </div>
  );
}
