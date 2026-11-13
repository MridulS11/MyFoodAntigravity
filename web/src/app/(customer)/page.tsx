"use client";

import {
  ArrowRight,
  Clock,
  Heart,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Star,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  useDiscoveryFeed,
  useFavorites,
  useToggleFavorite,
} from "@/hooks/useGoodlyQueries";
import { formatDeliveryFeeLabel } from "@/lib/format";
import { formatDistance, haversineDistanceMeters } from "@/lib/geo";
import { CATEGORY_PILLS } from "@/services/mocks/seedData";
import { useAppStore } from "@/stores/useAppStore";

export default function CustomerDiscoveryPage() {
  const activePoint = useAppStore((s) => s.activePoint);
  const setAddressModalOpen = useAppStore((s) => s.setAddressModalOpen);

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [freeDeliveryOnly, setFreeDeliveryOnly] = useState(false);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState<"featured" | "rating" | "fastest">(
    "featured"
  );

  const { data: feed, isLoading, isError, refetch } = useDiscoveryFeed({
    lat: activePoint.lat,
    lng: activePoint.lng,
    category: selectedCategory,
    freeDeliveryOnly,
    minRating,
    sortBy,
  });

  const { data: favorites = [] } = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const favoriteIds = new Set(favorites.map((r) => r.id));

  const spotlight = feed?.spotlightRestaurant;
  const restaurants = feed?.restaurants ?? [];

  return (
    <div>
      {/* Announcement Strip matching Screenshot 11.13.32 PM */}
      <div className="bg-[#CBEAD0] border-b border-[#B7DFBD] text-[#1E1F1C]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 font-extrabold tracking-wider uppercase text-[11px]">
              <span className="w-2 h-2 rounded-full bg-[#5F8E63]" />
              GOOD FOOD, GOOD MOOD
            </span>
            <span className="text-[#2E4230]">
              Something delicious is just around the corner.
            </span>
          </div>
          <a
            href="#nearby-spots"
            className="inline-flex items-center gap-1 font-bold text-[#1E1F1C] hover:underline shrink-0"
          >
            <span>Explore nearby</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
        {/* Out-of-zone notice if selected address is unserviceable */}
        {feed && !feed.serviceable && (
          <div
            data-testid="out-of-zone-banner"
            className="bg-white border border-[#E8E3D5] rounded-2xl p-8 text-center shadow-xs"
          >
            <h2 className="text-xl font-bold text-[#1E1F1C]">
              We aren&apos;t delivering to this block yet
            </h2>
            <p className="text-sm text-[#5E5D57] mt-2 max-w-md mx-auto">
              Switch back to Bengaluru, KA or choose another saved address to browse active neighborhood kitchens.
            </p>
            <button
              type="button"
              onClick={() => setAddressModalOpen(true)}
              className="mt-5 inline-flex items-center gap-2 bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-semibold text-sm px-5 py-2.5 rounded-lg"
            >
              <span>Change delivery address</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoading && (
          <div className="space-y-10 animate-pulse">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-7 h-[360px] rounded-2xl bg-[#EFE9D8]" />
              <div className="lg:col-span-5 space-y-4">
                <div className="h-4 w-36 bg-[#EFE9D8] rounded" />
                <div className="h-12 w-72 bg-[#EFE9D8] rounded" />
                <div className="h-16 w-full bg-[#EFE9D8] rounded" />
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-center">
            <p className="text-sm font-semibold text-[#C62828]">
              Unable to load neighborhood kitchens right now.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 px-4 py-2 rounded-lg bg-[#DEC146] text-sm font-semibold"
            >
              Try again
            </button>
          </div>
        )}

        {/* Editorial Hero Spotlight (Screenshot 11.13.32 PM) */}
        {spotlight && feed?.serviceable && (
          <section
            aria-label="Featured neighborhood restaurant"
            className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center"
          >
            <div className="lg:col-span-7 relative">
              <Link
                href={`/restaurants/${spotlight.slug}`}
                className="block relative overflow-hidden rounded-2xl border border-[#E8E3D5] shadow-sm group"
              >
                <img
                  src={spotlight.heroImageUrl}
                  alt={spotlight.name}
                  className="w-full h-[300px] sm:h-[380px] object-cover group-hover:scale-[1.015] transition-transform duration-500"
                />
                <div className="absolute bottom-4 right-4 bg-[#FCF9F0]/95 backdrop-blur border border-[#E8E3D5] rounded-lg px-3.5 py-2 flex items-center gap-2 text-[11px] font-bold tracking-wider uppercase text-[#1E1F1C] shadow-xs">
                  <Sparkles className="w-3.5 h-3.5 text-[#5F8E63]" />
                  <span>THE NEIGHBORHOOD FAVORITE</span>
                </div>
              </Link>
            </div>

            <div className="lg:col-span-5 space-y-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8A8880]">
                {spotlight.tagline}
              </div>

              <h1 className="text-4xl sm:text-[52px] font-extrabold tracking-tight leading-[1.06] text-[#1E1F1C]">
                A little taste
                <br />
                of <span className="text-[#5F8E63]">Italy.</span>
              </h1>

              <p className="text-[15px] leading-relaxed text-[#5E5D57] max-w-md">
                {spotlight.description}
              </p>

              <div className="flex flex-wrap items-center gap-2.5 text-[13px] font-semibold text-[#1E1F1C]">
                <span className="inline-flex items-center gap-1">
                  <Star className="w-4 h-4 fill-[#DEC146] text-[#DEC146]" />
                  <span>{spotlight.ratingAverage.toFixed(1)}</span>
                  <span className="text-[#8A8880] font-normal">(1.2k+)</span>
                </span>
                <span className="text-[#D5CEBC]">·</span>
                <span className="inline-flex items-center gap-1 text-[#5E5D57]">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {spotlight.estimatedDeliveryMin}–{spotlight.estimatedDeliveryMax} min
                  </span>
                </span>
                <span className="text-[#D5CEBC]">·</span>
                <span className="text-[#5E5D57]">{spotlight.cuisines[0]}</span>
                {formatDistance(
                  spotlight.distanceMeters ??
                    haversineDistanceMeters(activePoint, spotlight.location)
                ) && (
                  <>
                    <span className="text-[#D5CEBC]">·</span>
                    <span className="inline-flex items-center gap-1 text-[#5E5D57]">
                      <MapPin className="w-3.5 h-3.5 text-[#5F8E63]" />
                      <span>
                        {formatDistance(
                          spotlight.distanceMeters ??
                            haversineDistanceMeters(activePoint, spotlight.location)
                        )}
                      </span>
                    </span>
                  </>
                )}
              </div>

              <div className="pt-1 space-y-2.5">
                <Link
                  href={`/restaurants/${spotlight.slug}`}
                  data-testid="hero-cta-button"
                  className="inline-flex items-center gap-3 bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-semibold text-sm px-6 py-3.5 rounded-lg shadow-xs transition-colors"
                >
                  <span>Order from {spotlight.name}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <div className="flex items-center gap-2 text-xs text-[#8A8880]">
                  <Truck className="w-3.5 h-3.5" />
                  <span>Free delivery on your first order</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Section Divider + Angled Script Callout */}
        {feed?.serviceable && (
          <div className="relative border-t border-[#E8E3D5] pt-10">
            <div className="hidden sm:block absolute -top-9 right-4 font-script text-lg text-[#5F8E63] -rotate-6 select-none pointer-events-none">
              good things
              <br />
              are cooking ↘
            </div>

            {/* Category Header + Filter Toggle */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8A8880]">
                  A GOOD PLACE TO START
                </div>
                <h2 className="text-3xl font-extrabold tracking-tight text-[#1E1F1C] mt-1">
                  What sounds <span className="text-[#5F8E63]">good?</span>
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  showFilters || freeDeliveryOnly || minRating
                    ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                    : "bg-white text-[#1E1F1C] border-[#E8E3D5] hover:border-[#8A8880]"
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Filters</span>
              </button>
            </div>

            {/* Expandable Filters Bar */}
            {showFilters && (
              <div className="mt-4 p-4 bg-white border border-[#E8E3D5] rounded-xl flex flex-wrap items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-[#1E1F1C]">
                  <input
                    type="checkbox"
                    checked={freeDeliveryOnly}
                    onChange={(e) => setFreeDeliveryOnly(e.target.checked)}
                    className="accent-[#5F8E63]"
                  />
                  <span>Free delivery (₹0)</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-[#1E1F1C]">
                  <input
                    type="checkbox"
                    checked={minRating === 4.8}
                    onChange={(e) =>
                      setMinRating(e.target.checked ? 4.8 : undefined)
                    }
                    className="accent-[#5F8E63]"
                  />
                  <span>Top rated (4.8+)</span>
                </label>

                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-[#8A8880]">Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as "featured" | "rating" | "fastest"
                      )
                    }
                    className="bg-[#FCF9F0] border border-[#E8E3D5] rounded-lg px-2.5 py-1.5 font-semibold text-[#1E1F1C]"
                  >
                    <option value="featured">Recommended</option>
                    <option value="rating">Highest rated</option>
                    <option value="fastest">Fastest delivery</option>
                  </select>
                </div>
              </div>
            )}

            {/* Category Emoji Pills */}
            <div className="mt-5 flex items-center gap-2.5 overflow-x-auto pb-2">
              {CATEGORY_PILLS.map((pill) => {
                const active = selectedCategory === pill.key;
                return (
                  <button
                    key={pill.key}
                    type="button"
                    data-testid={`category-pill-${pill.key}`}
                    onClick={() => setSelectedCategory(pill.key)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap transition-colors ${
                      active
                        ? "bg-[#DEC146] border-[#DEC146] text-[#1E1F1C]"
                        : "bg-white border-[#E8E3D5] text-[#1E1F1C] hover:border-[#8A8880]"
                    }`}
                  >
                    {pill.emoji && <span>{pill.emoji}</span>}
                    <span>{pill.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Good Things Nearby Grid */}
        {feed?.serviceable && (
          <section id="nearby-spots" aria-label="Good things nearby">
            <div className="flex items-baseline gap-3 mb-5">
              <h3 className="text-xl font-bold text-[#1E1F1C]">
                Good things nearby
              </h3>
              <span className="text-xs text-[#8A8880]">
                {restaurants.length}{" "}
                {restaurants.length === 1 ? "spot" : "spots"} worth a bite
              </span>
            </div>

            {restaurants.length === 0 ? (
              <div className="bg-white border border-[#E8E3D5] rounded-2xl p-10 text-center">
                <p className="text-base font-bold text-[#1E1F1C]">
                  No neighborhood spots match those exact filters
                </p>
                <p className="text-xs text-[#8A8880] mt-1">
                  Try clearing your category or rating filters to explore more kitchens nearby.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("all");
                    setFreeDeliveryOnly(false);
                    setMinRating(undefined);
                  }}
                  className="mt-4 px-4 py-2 rounded-lg bg-[#DEC146] hover:bg-[#CFAF32] text-xs font-semibold text-[#1E1F1C]"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
                {restaurants.map((rest) => {
                  const isFav = favoriteIds.has(rest.id);
                  return (
                    <article
                      key={rest.id}
                      data-testid={`restaurant-card-${rest.slug}`}
                      className="group"
                    >
                      <div className="relative overflow-hidden rounded-xl border border-[#E8E3D5] bg-white">
                        <Link href={`/restaurants/${rest.slug}`}>
                          <img
                            src={rest.cardImageUrl}
                            alt={rest.name}
                            className="w-full h-[210px] object-cover group-hover:scale-[1.02] transition-transform duration-300"
                          />
                        </Link>

                        {/* Favorite Heart Button (Top Right) */}
                        <button
                          type="button"
                          onClick={() => toggleFavorite.mutate(rest.id)}
                          aria-label={`Favorite ${rest.name}`}
                          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[#CBEAD0]/95 hover:bg-[#CBEAD0] flex items-center justify-center shadow-xs transition-transform active:scale-95"
                        >
                          <Heart
                            className={`w-4 h-4 ${
                              isFav
                                ? "fill-[#1E1F1C] text-[#1E1F1C]"
                                : "text-[#1E1F1C]"
                            }`}
                          />
                        </button>

                        {/* Promo Badge (Bottom Left) */}
                        {rest.cardBadge && (
                          <span className="absolute bottom-3 left-3 bg-[#DEC146] text-[#1E1F1C] text-[11px] font-bold px-2.5 py-1 rounded-md shadow-xs">
                            {rest.cardBadge}
                          </span>
                        )}

                        {!rest.isAcceptingOrders && (
                          <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                            <span className="bg-white text-[#1E1F1C] text-xs font-bold px-3 py-1.5 rounded-full">
                              Currently paused
                            </span>
                          </div>
                        )}
                      </div>

                      <Link
                        href={`/restaurants/${rest.slug}`}
                        className="block pt-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-[16px] font-bold text-[#1E1F1C] group-hover:text-[#5F8E63] transition-colors">
                            {rest.name}
                          </h4>
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1E1F1C] tabular-nums">
                            <Star className="w-3.5 h-3.5 fill-[#DEC146] text-[#DEC146]" />
                            {rest.ratingAverage.toFixed(1)}
                          </span>
                        </div>
                        <p className="text-xs text-[#8A8880] mt-0.5">
                          {rest.cuisines.join(" · ")}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-[#5E5D57] mt-1.5">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-[#8A8880]" />
                            {rest.estimatedDeliveryMin}–{rest.estimatedDeliveryMax} min
                          </span>
                          <span>
                            {formatDeliveryFeeLabel(
                              rest.deliveryFeeMinor,
                              rest.currency
                            )}
                          </span>
                          {formatDistance(
                            rest.distanceMeters ??
                              haversineDistanceMeters(activePoint, rest.location)
                          ) && (
                            <span className="inline-flex items-center gap-1 text-[#5E5D57]">
                              <MapPin className="w-3 h-3 text-[#5F8E63]" />
                              {formatDistance(
                                rest.distanceMeters ??
                                  haversineDistanceMeters(activePoint, rest.location)
                              )}
                            </span>
                          )}
                        </div>
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
