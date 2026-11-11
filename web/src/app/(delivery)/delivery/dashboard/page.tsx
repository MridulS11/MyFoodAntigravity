"use client";

import { ArrowRight, Clock, MapPin, Navigation, Radio } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDistance, formatMinor } from "@/lib/format";
import { services } from "@/services";
import type { DeliveryOffer } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function DeliveryDashboardPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { data: partner } = useQuery({
    queryKey: ["myPartnerProfile"],
    queryFn: () => services.deliveryPortal.getMyPartnerProfile(),
  });

  const { data: offers = [] } = useQuery({
    queryKey: ["deliveryOffers"],
    queryFn: () => services.deliveryPortal.getPendingOffers(),
    refetchInterval: 2000,
  });

  const { data: activeDelivery } = useQuery({
    queryKey: ["activeDelivery"],
    queryFn: () => services.deliveryPortal.getActiveDelivery(),
    refetchInterval: 2500,
  });

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function handleToggleOnline() {
    if (!partner) return;
    const target =
      partner.availabilityStatus === "OFFLINE" ? "ONLINE_AVAILABLE" : "OFFLINE";

    if (target === "ONLINE_AVAILABLE" && !partner.canReceiveOrders) {
      pushToast("error", "You are not receiving orders due to onboarding verification pending.");
      return;
    }

    if (target === "ONLINE_AVAILABLE" && typeof navigator !== "undefined" && "geolocation" in navigator) {
      setGpsNotice(null);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await services.deliveryPortal.toggleAvailability(target, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
            qc.invalidateQueries({ queryKey: ["myPartnerProfile"] });
          } catch (err) {
            pushToast("error", err instanceof Error ? err.message : "Action blocked.");
          }
        },
        async () => {
          // Graceful browser fallback for desktop testing
          try {
            setGpsNotice(
              "Browser geolocation unavailable or denied; using Bengaluru simulation coordinates."
            );
            await services.deliveryPortal.toggleAvailability(
              target,
              partner.lastKnownLocation
            );
            qc.invalidateQueries({ queryKey: ["myPartnerProfile"] });
          } catch (err) {
            pushToast("error", err instanceof Error ? err.message : "Action blocked.");
          }
        },
        { timeout: 3000 }
      );
      return;
    }

    try {
      await services.deliveryPortal.toggleAvailability(target);
      qc.invalidateQueries({ queryKey: ["myPartnerProfile"] });
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Action blocked.");
    }
  }

  async function handleAcceptOffer(offer: DeliveryOffer) {
    try {
      const order = await services.deliveryPortal.acceptOffer(offer.assignmentId);
      await qc.invalidateQueries();
      pushToast("success", `Assigned to ${order.orderNumber}!`);
      router.push(`/delivery/active/${order.id}`);
    } catch (err) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Offer no longer available."
      );
    }
  }

  async function handleDeclineOffer(offer: DeliveryOffer) {
    await services.deliveryPortal.rejectOffer(offer.assignmentId, "PARTNER_BUSY");
    await qc.invalidateQueries({ queryKey: ["deliveryOffers"] });
    pushToast("info", "Offer declined.");
  }

  return (
    <div className="space-y-6">
      {/* Availability Card */}
      {partner && (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-[#1E1F1C]">
                {partner.fullName}
              </h1>
              <StatusBadge status={partner.verificationStatus} />
            </div>
            <p className="text-xs text-[#5E5D57]">
              {partner.vehicleModel} ({partner.vehicleType}) · ★{" "}
              {partner.ratingAverage.toFixed(2)} · {partner.totalDeliveriesCount}{" "}
              deliveries
            </p>
          </div>

          <button
            type="button"
            data-testid="partner-availability-toggle"
            disabled={partner.availabilityStatus === "ON_DELIVERY" || !partner.canReceiveOrders}
            onClick={handleToggleOnline}
            className={`px-5 py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-50 ${
              partner.availabilityStatus === "ONLINE_AVAILABLE"
                ? "bg-[#CBEAD0] text-[#1E1F1C]"
                : partner.availabilityStatus === "ON_DELIVERY"
                  ? "bg-[#EFF6FF] text-[#1D4ED8]"
                  : "bg-[#1E1F1C] text-[#FCF9F0]"
            }`}
          >
            {partner.availabilityStatus === "ONLINE_AVAILABLE"
              ? "Go Offline"
              : partner.availabilityStatus === "ON_DELIVERY"
                ? "On Active Delivery"
                : "Go Online"}
          </button>
        </div>
      )}

      {gpsNotice && (
        <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-3 text-xs text-[#92400E]">
          {gpsNotice}
        </div>
      )}

      {/* Active Delivery Jump Card */}
      {activeDelivery && (
        <div className="bg-[#DEC146] rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4 text-[#1E1F1C] shadow-xs">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider">
              ACTIVE DELIVERY · {activeDelivery.orderNumber}
            </div>
            <h2 className="text-xl font-extrabold mt-0.5">
              {activeDelivery.restaurantName} →{" "}
              {activeDelivery.deliveryAddressSnapshot.addressLine1}
            </h2>
            <p className="text-xs font-medium mt-1">
              Current stage: {activeDelivery.deliveryStatus.replaceAll("_", " ")}
            </p>
          </div>
          <Link
            href={`/delivery/active/${activeDelivery.id}`}
            className="inline-flex items-center gap-2 bg-[#1E1F1C] text-[#FCF9F0] font-bold text-xs px-5 py-3 rounded-xl"
          >
            <span>Open Navigation &amp; Steps</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      {/* Incoming Offer Queue */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#8A8880]">
          INCOMING DELIVERY OFFERS ({offers.length})
        </h2>

        {offers.length === 0 ? (
          <div className="bg-white border border-[#E8E3D5] rounded-2xl p-10 text-center space-y-2">
            <Radio className="w-7 h-7 text-[#5F8E63] mx-auto animate-pulse" />
            <p className="font-bold text-sm text-[#1E1F1C]">
              {partner?.availabilityStatus === "OFFLINE"
                ? "You are currently offline"
                : "Listening for nearby restaurant pickups in Bengaluru..."}
            </p>
            <p className="text-xs text-[#8A8880]">
              When a restaurant accepts an order, the simultaneous broadcast offer is sent to all eligible nearby partners — first accept claims the order.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {offers.map((offer) => {
              const remainingSec = Math.max(
                0,
                Math.round((new Date(offer.expiresAt).getTime() - nowMs) / 1000)
              );
              return (
                <div
                  key={offer.assignmentId}
                  data-testid={`delivery-offer-${offer.assignmentId}`}
                  className="bg-white border-2 border-[#DEC146] rounded-2xl p-6 space-y-4 shadow-md"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#5F8E63]">
                        NEW OFFER · {offer.orderNumber}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#CBEAD0] text-[#1E1F1C]">
                        Simultaneous Broadcast · First Accept Claims
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#92400E] tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      {remainingSec}s left
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-extrabold text-[#1E1F1C]">
                        {offer.restaurantName}
                      </h3>
                      <p className="text-xs text-[#5E5D57] flex items-center gap-1 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-[#8A8880]" />
                        Pickup: {offer.pickupAddress} (
                        {formatDistance(offer.distanceToPickupMeters)} away)
                      </p>
                      <p className="text-xs text-[#5E5D57] flex items-center gap-1 mt-0.5">
                        <Navigation className="w-3.5 h-3.5 text-[#5F8E63]" />
                        Dropoff: {offer.dropoffNeighborhood} · Total trip{" "}
                        {formatDistance(offer.totalTripMeters)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-[#8A8880]">Est. Payout</div>
                      <div className="text-2xl font-extrabold text-[#2E7D32] tabular-nums">
                        {formatMinor(offer.estimatedPayoutMinor, offer.currency)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleDeclineOffer(offer)}
                      className="py-3 rounded-xl border border-[#E8E3D5] text-xs font-bold text-[#5E5D57] hover:bg-[#F5F0E2]"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      data-testid={`accept-offer-${offer.assignmentId}`}
                      onClick={() => handleAcceptOffer(offer)}
                      className="col-span-2 py-3 rounded-xl bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] text-sm font-extrabold"
                    >
                      Accept Delivery
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
