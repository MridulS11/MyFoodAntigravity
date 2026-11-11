import { Suspense } from "react";
import { PortalAuthCard } from "@/components/shared/PortalAuthCard";

export default function RestaurantRegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FCF9F0]" />}>
      <PortalAuthCard portal="restaurant" initialMode="register" />
    </Suspense>
  );
}
