"use client";

import {
  ArrowRight,
  Clock,
  Heart,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ItemCustomizationModal } from "@/components/customer/CartModals";
import { VegClassificationBadge } from "@/components/shared/VegClassificationBadge";
import {
  useAddToCart,
  useCart,
  useFavorites,
  useRestaurantMenu,
  useToggleFavorite,
  useUpdateCartItemQuantity,
} from "@/hooks/useGoodlyQueries";
import { formatDeliveryFeeLabel, formatMinor } from "@/lib/format";
import type { MenuItem } from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

export default function RestaurantMenuPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const activePoint = useAppStore((s) => s.activePoint);
  const menuSearchQuery = useAppStore((s) => s.menuSearchQuery);
  const setCartDrawerOpen = useAppStore((s) => s.setCartDrawerOpen);

  const { data, isLoading, isError } = useRestaurantMenu(
    slug,
    activePoint.lat,
    activePoint.lng,
    menuSearchQuery
  );
  const { data: cart } = useCart();
  const { data: favorites = [] } = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const addToCart = useAddToCart();
  const updateQty = useUpdateCartItemQuantity();

  const [activeCategoryId, setActiveCategoryId] = useState<string>("");
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);

  if (isLoading) {
    return (
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse space-y-6">
        <div className="h-4 w-48 bg-[#EFE9D8] rounded" />
        <div className="h-72 bg-[#EFE9D8] rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-[1280px] mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-[#1E1F1C]">
          Restaurant not found
        </h1>
        <Link
          href="/"
          className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-lg bg-[#DEC146] font-semibold text-sm"
        >
          Back to all restaurants
        </Link>
      </div>
    );
  }

  const { restaurant, categories } = data;
  const isFav = favorites.some((f) => f.id === restaurant.id);
  const isThisRestaurantInCart = cart?.restaurantId === restaurant.id;
  const bagItems = isThisRestaurantInCart ? (cart?.items ?? []) : [];
  const bagCount = bagItems.reduce((sum, i) => sum + i.quantity, 0);

  function getCartItemsForDish(menuItemId: string) {
    return bagItems.filter((ci) => ci.menuItemId === menuItemId);
  }

  function handleQuickAdd(item: MenuItem) {
    if (item.customizationGroups.length > 0) {
      setCustomizingItem(item);
      return;
    }
    addToCart.mutate({
      restaurantId: restaurant.id,
      menuItemId: item.id,
      quantity: 1,
      selectedOptionIds: [],
    });
  }

  const currentNavCatId = activeCategoryId || categories[0]?.id || "";

  return (
    <div className="pb-20 md:pb-12">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Breadcrumb (Screenshot 11.13.44 PM) */}
        <nav aria-label="Breadcrumb" className="text-xs text-[#8A8880] flex items-center gap-2">
          <Link href="/" className="hover:text-[#1E1F1C]">
            Restaurants
          </Link>
          <span>/</span>
          <span>{restaurant.cuisines[0]}</span>
          <span>/</span>
          <span className="font-semibold text-[#1E1F1C]">{restaurant.name}</span>
        </nav>

        {/* Hero Banner (Screenshot 11.13.44 PM) */}
        <section className="relative rounded-2xl overflow-hidden border border-[#E8E3D5] shadow-sm">
          <img
            src={restaurant.heroImageUrl}
            alt={restaurant.name}
            className="w-full h-[250px] sm:h-[300px] object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#1E1F1C]/85 via-[#1E1F1C]/55 to-transparent" />

          <button
            type="button"
            onClick={() => toggleFavorite.mutate(restaurant.id)}
            aria-label={`Favorite ${restaurant.name}`}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-[#CBEAD0]/95 hover:bg-[#CBEAD0] flex items-center justify-center shadow-sm"
          >
            <Heart
              className={`w-4 h-4 ${
                isFav ? "fill-[#1E1F1C] text-[#1E1F1C]" : "text-[#1E1F1C]"
              }`}
            />
          </button>

          <div className="absolute inset-0 p-6 sm:p-10 flex flex-col justify-end max-w-2xl text-white">
            <div className="text-[11px] font-bold tracking-[0.14em] uppercase text-[#DEC146]">
              {restaurant.eyebrow}
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-1.5">
              {restaurant.heroTitleStart ? (
                <>
                  {restaurant.heroTitleStart}{" "}
                  <span className="text-[#DEC146]">
                    {restaurant.heroTitleAccent}
                  </span>
                </>
              ) : (
                restaurant.name
              )}
            </h1>
            <p className="text-xs sm:text-sm text-[#FCF9F0]/90 mt-2 leading-relaxed max-w-lg">
              {restaurant.description}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold mt-4 text-[#FCF9F0]">
              <span className="inline-flex items-center gap-1">
                <Star className="w-3.5 h-3.5 fill-[#DEC146] text-[#DEC146]" />
                {restaurant.ratingAverage.toFixed(1)}
                <span className="text-white/70 font-normal">(1.2k+)</span>
              </span>
              <span className="text-white/50">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {restaurant.estimatedDeliveryMin}–{restaurant.estimatedDeliveryMax} min
              </span>
              <span className="text-white/50">·</span>
              <span>
                {formatDeliveryFeeLabel(
                  restaurant.deliveryFeeMinor,
                  restaurant.currency
                )}
              </span>
            </div>
          </div>
        </section>

        {/* Sub-promo strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-b border-[#E8E3D5] text-xs">
          <div className="flex items-center gap-2 font-semibold text-[#1E1F1C]">
            <Truck className="w-4 h-4 text-[#5E5D57]" />
            <span>
              {restaurant.promoBanner ?? "Freshly prepared for your neighborhood."}
            </span>
          </div>
          <span className="text-[#8A8880]">
            {restaurant.promoSubtext ?? "Made to order."}
          </span>
        </div>

        {!restaurant.isAcceptingOrders && (
          <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-3 text-xs font-semibold text-[#92400E]">
            This kitchen is currently paused and not accepting new orders right now.
          </div>
        )}

        {/* Mobile Sticky Category Rail */}
        <div className="lg:hidden flex items-center gap-2 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              onClick={() => setActiveCategoryId(cat.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap ${
                currentNavCatId === cat.id
                  ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                  : "bg-white text-[#5E5D57] border-[#E8E3D5]"
              }`}
            >
              {cat.name}
            </a>
          ))}
        </div>

        {/* 3-Column Menu Workspace (Matches 11.13.44 PM & 11.14.01 PM) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pt-2">
          {/* Left Sticky Category Nav */}
          <aside className="hidden lg:block lg:col-span-2 sticky top-24 space-y-6">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8A8880] mb-3">
                ON THE MENU
              </div>
              <nav className="space-y-1 border-l border-[#E8E3D5]">
                {categories.map((cat) => {
                  const active = currentNavCatId === cat.id;
                  return (
                    <a
                      key={cat.id}
                      href={`#cat-${cat.id}`}
                      onClick={() => setActiveCategoryId(cat.id)}
                      className={`flex items-center justify-between pl-3.5 py-1.5 text-xs transition-colors -ml-px border-l-2 ${
                        active
                          ? "border-[#1E1F1C] font-bold text-[#1E1F1C]"
                          : "border-transparent text-[#8A8880] hover:text-[#1E1F1C]"
                      }`}
                    >
                      <span>{cat.name}</span>
                      {active && <ArrowRight className="w-3 h-3" />}
                    </a>
                  );
                })}
              </nav>
            </div>

            <div className="border-t border-[#E8E3D5] pt-5 space-y-2 text-xs text-[#8A8880] leading-relaxed">
              <Sparkles className="w-3.5 h-3.5 text-[#5F8E63]" />
              <p>Good food tastes even better when it&apos;s shared.</p>
            </div>
          </aside>

          {/* Center Menu Categories & Dish Rows */}
          <div className="lg:col-span-7 space-y-10">
            {categories.length === 0 ? (
              <div className="bg-white border border-[#E8E3D5] rounded-2xl p-8 text-center">
                <p className="text-sm font-bold text-[#1E1F1C]">
                  No dishes matched &ldquo;{menuSearchQuery}&rdquo;
                </p>
              </div>
            ) : (
              categories.map((cat) => (
                <section
                  key={cat.id}
                  id={`cat-${cat.id}`}
                  className="scroll-mt-24"
                >
                  <div className="flex items-end justify-between border-b border-[#E8E3D5] pb-3 mb-2">
                    <div>
                      <h2 className="text-2xl font-bold text-[#1E1F1C]">
                        {cat.name}
                      </h2>
                      {cat.subtitle && (
                        <p className="text-xs text-[#8A8880] mt-0.5">
                          {cat.subtitle}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-[#8A8880]">
                      {cat.items.length}{" "}
                      {cat.items.length === 1 ? "dish" : "dishes"}
                    </span>
                  </div>

                  <div className="divide-y divide-[#E8E3D5]">
                    {cat.items.map((item) => {
                      const matchingCartItems = getCartItemsForDish(item.id);
                      const qtyInBag = matchingCartItems.reduce(
                        (s, ci) => s + ci.quantity,
                        0
                      );
                      const simpleCartItem =
                        item.customizationGroups.length === 0
                          ? matchingCartItems[0]
                          : null;
                      const soldOut =
                        !item.isAvailable ||
                        (item.trackInventory && item.availableQuantity <= 0);

                      return (
                        <div
                          key={item.id}
                          data-testid={`menu-item-${item.id}`}
                          className="py-5 flex items-center justify-between gap-4"
                        >
                          <div className="flex items-start gap-4 min-w-0">
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              className={`w-24 h-24 rounded-xl object-cover shrink-0 border border-[#E8E3D5] ${
                                soldOut ? "opacity-50 grayscale" : ""
                              }`}
                            />
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <VegClassificationBadge classification={item.vegClassification} />
                                {item.badgeLabel && (
                                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#5F8E63]">
                                    {item.badgeLabel}
                                  </span>
                                )}
                              </div>
                              <h3 className="text-[15px] font-bold text-[#1E1F1C]">
                                {item.name}
                              </h3>
                              <p className="text-xs text-[#8A8880] leading-relaxed line-clamp-2">
                                {item.description}
                              </p>
                              <div className="flex items-center gap-2.5 pt-1">
                                <span className="text-sm font-bold text-[#1E1F1C] tabular-nums">
                                  {formatMinor(item.basePriceMinor, item.currency)}
                                </span>
                                {item.trackInventory &&
                                  item.availableQuantity > 0 &&
                                  item.availableQuantity <= 8 && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E]">
                                      Only {item.availableQuantity} left
                                    </span>
                                  )}
                                {soldOut && (
                                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#FDECEA] text-[#C62828]">
                                    Sold out today
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Circular + or Inline Stepper [- 1 +] (Matches 11.13.44 PM & 11.14.01 PM) */}
                          <div className="shrink-0">
                            {soldOut || !restaurant.isAcceptingOrders ? (
                              <button
                                type="button"
                                disabled
                                className="w-9 h-9 rounded-full bg-[#EFE9D8] text-[#8A8880] flex items-center justify-center cursor-not-allowed"
                                aria-label={`${item.name} unavailable`}
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            ) : simpleCartItem && qtyInBag > 0 ? (
                              <div
                                data-testid={`stepper-${item.id}`}
                                className="inline-flex items-center gap-2.5"
                              >
                                <button
                                  type="button"
                                  data-testid={`dec-${item.id}`}
                                  onClick={() =>
                                    updateQty.mutate({
                                      cartItemId: simpleCartItem.id,
                                      quantity: simpleCartItem.quantity - 1,
                                    })
                                  }
                                  aria-label={`Remove one ${item.name}`}
                                  className="w-8 h-8 rounded-full border border-[#E8E3D5] bg-white hover:bg-[#F5F0E2] flex items-center justify-center text-[#1E1F1C]"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <span
                                  data-testid={`qty-${item.id}`}
                                  className="text-xs font-bold w-4 text-center tabular-nums"
                                >
                                  {qtyInBag}
                                </span>
                                <button
                                  type="button"
                                  data-testid={`inc-${item.id}`}
                                  onClick={() =>
                                    updateQty.mutate({
                                      cartItemId: simpleCartItem.id,
                                      quantity: simpleCartItem.quantity + 1,
                                    })
                                  }
                                  aria-label={`Add one more ${item.name}`}
                                  className="w-8 h-8 rounded-full bg-[#CBEAD0] hover:bg-[#B7DFBD] flex items-center justify-center text-[#1E1F1C]"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                data-testid={`add-dish-${item.id}`}
                                onClick={() => handleQuickAdd(item)}
                                aria-label={`Add ${item.name} to bag`}
                                className="w-9 h-9 rounded-full bg-[#CBEAD0] hover:bg-[#B7DFBD] flex items-center justify-center text-[#1E1F1C] transition-transform active:scale-95 relative"
                              >
                                <Plus className="w-4 h-4" />
                                {qtyInBag > 0 && (
                                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#1E1F1C] text-[#FCF9F0] text-[10px] font-bold flex items-center justify-center">
                                    {qtyInBag}
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>

          {/* Right Sticky YOUR ORDER Card (Matches 11.13.44 PM & 11.14.01 PM) */}
          <aside className="hidden lg:block lg:col-span-3 sticky top-24">
            <div
              data-testid="sticky-order-card"
              className="bg-white border border-[#E8E3D5] rounded-2xl p-6 shadow-xs space-y-4"
            >
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
                <span>YOUR ORDER</span>
                <ShoppingBag className="w-4 h-4" />
              </div>

              {bagItems.length === 0 ? (
                <div className="space-y-3">
                  <h3 className="text-lg font-bold text-[#1E1F1C] leading-snug">
                    A little room for delicious.
                  </h3>
                  <p className="text-xs text-[#8A8880] leading-relaxed">
                    Add a dish and we&apos;ll save it right here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-[#1E1F1C]">
                    {bagCount} {bagCount === 1 ? "lovely thing" : "lovely things"}
                  </h3>

                  <div className="divide-y divide-[#E8E3D5] border-t border-b border-[#E8E3D5]">
                    {bagItems.map((ci) => (
                      <div key={ci.id} className="py-2.5 flex items-start justify-between gap-2 text-xs">
                        <div>
                          <div className="font-medium text-[#1E1F1C]">
                            <span className="font-bold">{ci.quantity} ×</span> {ci.name}
                          </div>
                          {ci.customizations.length > 0 && (
                            <div className="text-[11px] text-[#8A8880] mt-0.5">
                              {ci.customizations.map((c) => c.optionName).join(", ")}
                            </div>
                          )}
                        </div>
                        <span className="font-bold text-[#1E1F1C] tabular-nums shrink-0">
                          {formatMinor(ci.lineTotalMinor, cart?.currency)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-xs font-bold text-[#1E1F1C]">
                    <span>Subtotal</span>
                    <span data-testid="sticky-bag-subtotal" className="tabular-nums">
                      {formatMinor(
                        cart?.breakdown.itemSubtotalMinor ?? 0,
                        cart?.currency
                      )}
                    </span>
                  </div>

                  <Link
                    href="/checkout"
                    data-testid="go-to-checkout-btn"
                    className="w-full bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-semibold text-xs py-3 px-4 rounded-xl flex items-center justify-between transition-colors"
                  >
                    <span>Go to checkout</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              )}

              <div className="pt-2 border-t border-[#E8E3D5] flex items-center gap-1.5 text-[11px] text-[#8A8880]">
                <Clock className="w-3.5 h-3.5" />
                <span>
                  Estimated delivery {restaurant.estimatedDeliveryMin}–
                  {restaurant.estimatedDeliveryMax} min
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile Sticky Bottom Bag Bar */}
      {bagCount > 0 && cart && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 p-3 bg-[#FCF9F0]/95 backdrop-blur border-t border-[#E8E3D5]">
          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            className="w-full bg-[#DEC146] text-[#1E1F1C] font-bold text-sm py-3 px-4 rounded-xl flex items-center justify-between shadow-md"
          >
            <span>
              {bagCount} {bagCount === 1 ? "lovely thing" : "lovely things"}
            </span>
            <span className="inline-flex items-center gap-2 tabular-nums">
              {formatMinor(cart.breakdown.itemSubtotalMinor, cart.currency)} · View bag
              <ArrowRight className="w-4 h-4" />
            </span>
          </button>
        </div>
      )}

      <ItemCustomizationModal
        key={customizingItem?.id ?? "closed"}
        item={customizingItem}
        restaurantId={restaurant.id}
        onClose={() => setCustomizingItem(null)}
      />
    </div>
  );
}
