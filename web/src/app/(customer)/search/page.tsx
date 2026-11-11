"use client";

import { Clock, Plus, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { VegClassificationBadge } from "@/components/shared/VegClassificationBadge";
import { useAddToCart } from "@/hooks/useGoodlyQueries";
import { formatDeliveryFeeLabel, formatMinor } from "@/lib/format";
import { services } from "@/services";
import type { VegClassification } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const [tab, setTab] = useState<"all" | "restaurants" | "dishes">("all");
  const [vegFilter, setVegFilter] = useState<"" | VegClassification>("");
  const [veganOnly, setVeganOnly] = useState(false);
  const [glutenFreeOnly, setGlutenFreeOnly] = useState(false);

  const activePoint = useAppStore((s) => s.activePoint);
  const addToCart = useAddToCart();

  const { data, isLoading } = useQuery({
    queryKey: ["search", query, activePoint.lat, activePoint.lng],
    queryFn: () => services.discovery.search(query, activePoint.lat, activePoint.lng),
  });

  // Enforce mutually consistent filter relationships:
  // - Non-Veg and Non-Veg (Only Egg) are incompatible with Vegan (and clear Vegan).
  // - Vegan is strictly plant-based Veg (auto-switches vegFilter to VEG).
  function handleToggleVegFilter(next: VegClassification) {
    if (vegFilter === next) {
      setVegFilter("");
      return;
    }
    setVegFilter(next);
    if (next !== "VEG" && veganOnly) {
      setVeganOnly(false);
    }
  }

  function handleToggleVegan() {
    setVeganOnly((prev) => {
      const next = !prev;
      if (next && vegFilter !== "VEG") {
        setVegFilter("VEG");
      }
      return next;
    });
  }

  function clearAllFilters() {
    setVegFilter("");
    setVeganOnly(false);
    setGlutenFreeOnly(false);
  }

  const restaurants = data?.restaurants ?? [];
  const rawDishes = data?.dishes ?? [];
  const dishes = rawDishes.filter((d) => {
    const cls = d.item.vegClassification ?? "VEG";
    if (vegFilter && cls !== vegFilter) {
      return false;
    }
    if (
      veganOnly &&
      !d.item.dietaryTags.some((t) => t.toLowerCase() === "vegan")
    ) {
      return false;
    }
    if (
      glutenFreeOnly &&
      !d.item.dietaryTags.some((t) => t.toLowerCase() === "gluten-free")
    ) {
      return false;
    }
    return true;
  });

  const isNonPlantDiet = vegFilter === "NON_VEG" || vegFilter === "EGG_ONLY";
  const hasAnyFilter = Boolean(vegFilter || veganOnly || glutenFreeOnly);

  return (
    <div className="pb-12">
      {/* Top Filter Strip directly below Header (no duplicate search bar in main area) */}
      <div
        data-testid="search-top-filters"
        className="bg-white/95 border-b border-[#E8E3D5] sticky top-[68px] z-20 backdrop-blur"
      >
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold uppercase tracking-wider text-[#5F8E63]">
                {query ? `Search results for “${query}”` : "Explore dishes & kitchens"}
              </span>
              {query && (
                <button
                  type="button"
                  onClick={() => router.push("/search")}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FCF9F0] border border-[#E8E3D5] text-[11px] font-semibold text-[#5E5D57] hover:border-[#1E1F1C]"
                >
                  <X className="w-3 h-3" />
                  Clear query
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {["Pasta", "Pizza", "Salad", "Healthy", "Burrata"].map((chip) => {
                const active = query.toLowerCase() === chip.toLowerCase();
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() =>
                      router.push(`/search?q=${encodeURIComponent(chip.toLowerCase())}`)
                    }
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                      active
                        ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                        : "bg-[#FCF9F0] text-[#5E5D57] border-[#E8E3D5] hover:border-[#1E1F1C]"
                    }`}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Result Scope */}
            <div className="inline-flex items-center gap-1 pr-2 border-r border-[#E8E3D5]">
              {(["all", "restaurants", "dishes"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`search-tab-${t}`}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border capitalize transition-colors ${
                    tab === t
                      ? "bg-[#DEC146] border-[#DEC146] text-[#1E1F1C]"
                      : "bg-white border-[#E8E3D5] text-[#5E5D57] hover:bg-[#FCF9F0]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Connected Veg / Non-Veg / Non-Veg (Only Egg) Classification */}
            <div className="inline-flex flex-wrap items-center gap-1.5 pr-2 border-r border-[#E8E3D5]">
              {(
                [
                  { key: "VEG", label: "Veg" },
                  { key: "NON_VEG", label: "Non-Veg" },
                  { key: "EGG_ONLY", label: "Non-Veg (Only Egg)" },
                ] as const
              ).map((vf) => (
                <button
                  key={vf.key}
                  type="button"
                  data-testid={`filter-veg-${vf.key}`}
                  onClick={() => handleToggleVegFilter(vf.key)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    vegFilter === vf.key
                      ? "bg-[#1E1F1C] border-[#1E1F1C] text-[#FCF9F0]"
                      : "bg-white border-[#E8E3D5] text-[#5E5D57] hover:bg-[#FCF9F0]"
                  }`}
                >
                  {vf.label}
                </button>
              ))}
            </div>

            {/* Dietary Attributes Connected to Classification */}
            <div className="inline-flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="filter-diet-vegan"
                disabled={isNonPlantDiet}
                title={
                  isNonPlantDiet
                    ? "Vegan is unavailable while Non-Veg or Egg-Only is active"
                    : "Filter plant-based Vegan dishes"
                }
                onClick={handleToggleVegan}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  veganOnly
                    ? "bg-[#5F8E63] border-[#5F8E63] text-white"
                    : isNonPlantDiet
                      ? "bg-[#F5F0E2] border-[#E8E3D5] text-[#8A8880]/50 cursor-not-allowed line-through"
                      : "bg-white border-[#E8E3D5] text-[#5E5D57] hover:bg-[#FCF9F0]"
                }`}
              >
                Vegan
              </button>
              <button
                type="button"
                data-testid="filter-diet-gf"
                onClick={() => setGlutenFreeOnly((p) => !p)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  glutenFreeOnly
                    ? "bg-[#5F8E63] border-[#5F8E63] text-white"
                    : "bg-white border-[#E8E3D5] text-[#5E5D57] hover:bg-[#FCF9F0]"
                }`}
              >
                Gluten-Free
              </button>
              {hasAnyFilter && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-[#C62828] hover:bg-[#FDECEA]"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Results Body */}
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-56 bg-[#EFE9D8] rounded-xl" />
            ))}
          </div>
        ) : restaurants.length === 0 && dishes.length === 0 ? (
          <div className="bg-white border border-[#E8E3D5] rounded-2xl p-10 text-center">
            <p className="text-base font-bold text-[#1E1F1C]">
              Nothing found{query ? ` for “${query}”` : ""}
            </p>
            <p className="text-xs text-[#8A8880] mt-1">
              Try searching from the header bar for pasta, penne, burrata, salad, or clear active filters.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {(tab === "all" || tab === "restaurants") && restaurants.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-lg font-bold text-[#1E1F1C]">
                  Restaurants ({restaurants.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {restaurants.map((rest) => (
                    <Link
                      key={rest.id}
                      href={`/restaurants/${rest.slug}`}
                      className="bg-white border border-[#E8E3D5] rounded-xl overflow-hidden hover:border-[#1E1F1C] transition-colors"
                    >
                      <img
                        src={rest.cardImageUrl}
                        alt={rest.name}
                        className="w-full h-40 object-cover"
                      />
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-sm text-[#1E1F1C]">
                            {rest.name}
                          </h3>
                          <span className="inline-flex items-center gap-1 text-xs font-bold">
                            <Star className="w-3.5 h-3.5 fill-[#DEC146] text-[#DEC146]" />
                            {rest.ratingAverage.toFixed(1)}
                          </span>
                        </div>
                        <p className="text-xs text-[#8A8880] mt-0.5">
                          {rest.cuisines.join(" · ")}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-[#5E5D57] mt-2">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {rest.estimatedDeliveryMin}–{rest.estimatedDeliveryMax} min
                          </span>
                          <span>
                            {formatDeliveryFeeLabel(
                              rest.deliveryFeeMinor,
                              rest.currency
                            )}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {(tab === "all" || tab === "dishes") && dishes.length > 0 && (
              <section className="space-y-4">
                <h2 className="text-lg font-bold text-[#1E1F1C]">
                  Dishes ({dishes.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {dishes.map(({ item, restaurant }) => (
                    <div
                      key={item.id}
                      className="bg-white border border-[#E8E3D5] rounded-xl p-4 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-20 h-20 rounded-lg object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/restaurants/${restaurant.slug}`}
                            className="text-[11px] font-bold uppercase tracking-wider text-[#5F8E63] hover:underline"
                          >
                            {restaurant.name}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <VegClassificationBadge classification={item.vegClassification} />
                            <h3 className="font-bold text-sm text-[#1E1F1C] truncate">
                              {item.name}
                            </h3>
                          </div>
                          <p className="text-xs text-[#8A8880] line-clamp-1">
                            {item.description}
                          </p>
                          {item.dietaryTags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.dietaryTags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 rounded bg-[#E8F5E9] text-[#1B5E20] text-[10px] font-semibold"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="text-xs font-bold text-[#1E1F1C] mt-1 tabular-nums">
                            {formatMinor(item.basePriceMinor, item.currency)}
                            {item.servingSize ? ` · ${item.servingSize}` : ""}
                          </p>
                        </div>
                      </div>
                      {item.customizationGroups.length === 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            addToCart.mutate({
                              restaurantId: restaurant.id,
                              menuItemId: item.id,
                              quantity: 1,
                              selectedOptionIds: [],
                            })
                          }
                          className="w-9 h-9 rounded-full bg-[#CBEAD0] hover:bg-[#B7DFBD] flex items-center justify-center shrink-0"
                          aria-label={`Add ${item.name}`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      ) : (
                        <Link
                          href={`/restaurants/${restaurant.slug}`}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F5F0E2] hover:bg-[#DEC146]"
                        >
                          Customize
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm">Loading search...</div>}>
      <SearchContent />
    </Suspense>
  );
}
