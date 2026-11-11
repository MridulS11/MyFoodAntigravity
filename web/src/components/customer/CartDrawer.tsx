"use client";

import { ArrowRight, Clock, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCart, useUpdateCartItemQuantity } from "@/hooks/useGoodlyQueries";
import { formatMinor } from "@/lib/format";
import { services } from "@/services";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/useAppStore";

export function CartDrawer() {
  const isOpen = useAppStore((s) => s.isCartDrawerOpen);
  const setOpen = useAppStore((s) => s.setCartDrawerOpen);
  const { data: cart } = useCart();
  const updateQty = useUpdateCartItemQuantity();
  const qc = useQueryClient();

  if (!isOpen) return null;

  const items = cart?.items ?? [];
  const totalCount = items.reduce((s, i) => s + i.quantity, 0);

  async function handleClear() {
    const cleared = await services.cart.clearCart();
    qc.setQueryData(["cart"], cleared);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[1px]">
      <div
        className="w-full max-w-md bg-[#FCF9F0] h-full border-l border-[#E8E3D5] flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Your order bag"
      >
        <div className="px-6 py-4 bg-white border-b border-[#E8E3D5] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-4 h-4 text-[#5F8E63]" />
            <h2 className="font-bold text-base text-[#1E1F1C]">
              Your bag {totalCount > 0 ? `(${totalCount})` : ""}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-[#F5F0E2]"
            aria-label="Close bag drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="bg-white border border-[#E8E3D5] rounded-2xl p-6 text-center mt-8">
              <p className="text-base font-bold text-[#1E1F1C]">
                A little room for delicious.
              </p>
              <p className="text-xs text-[#8A8880] mt-1.5">
                Add a dish from any neighborhood spot and we&apos;ll save it right here.
              </p>
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-2 mt-5 bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-semibold text-sm px-4 py-2.5 rounded-lg"
              >
                <span>Explore restaurants</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#5F8E63]">
                    ORDERING FROM
                  </div>
                  <Link
                    href={`/restaurants/${cart?.restaurantSlug}`}
                    onClick={() => setOpen(false)}
                    className="text-sm font-bold text-[#1E1F1C] hover:underline"
                  >
                    {cart?.restaurantName}
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs text-[#8A8880] hover:text-[#C62828] flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </div>

              <div className="bg-white border border-[#E8E3D5] rounded-xl divide-y divide-[#E8E3D5]">
                {items.map((item) => (
                  <div key={item.id} className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#1E1F1C]">
                        {item.name}
                      </div>
                      {item.customizations.length > 0 && (
                        <div className="text-xs text-[#8A8880] mt-0.5">
                          {item.customizations.map((c) => c.optionName).join(", ")}
                        </div>
                      )}
                      <div className="text-xs font-semibold text-[#5E5D57] mt-1 tabular-nums">
                        {formatMinor(item.lineTotalMinor, cart?.currency)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          updateQty.mutate({
                            cartItemId: item.id,
                            quantity: item.quantity - 1,
                          })
                        }
                        className="w-7 h-7 rounded-full border border-[#E8E3D5] flex items-center justify-center hover:bg-[#F5F0E2]"
                        aria-label={`Decrease quantity of ${item.name}`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-bold w-4 text-center tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateQty.mutate({
                            cartItemId: item.id,
                            quantity: item.quantity + 1,
                          })
                        }
                        className="w-7 h-7 rounded-full bg-[#CBEAD0] flex items-center justify-center hover:bg-[#B8E2BF]"
                        aria-label={`Increase quantity of ${item.name}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {items.length > 0 && cart && (
          <div className="p-6 bg-white border-t border-[#E8E3D5] space-y-3">
            <div className="flex items-center justify-between text-sm font-bold text-[#1E1F1C]">
              <span>Subtotal</span>
              <span className="tabular-nums">
                {formatMinor(cart.breakdown.itemSubtotalMinor, cart.currency)}
              </span>
            </div>
            {(cart.breakdown.smallCartFeeMinor ?? 0) > 0 && (
              <div className="flex items-center justify-between text-xs text-[#92400E] bg-[#FEF3C7] px-3 py-1.5 rounded-lg">
                <span>Small-cart fee (below min cart threshold)</span>
                <span className="font-bold tabular-nums">
                  +{formatMinor(cart.breakdown.smallCartFeeMinor!, cart.currency)}
                </span>
              </div>
            )}
            <Link
              href="/checkout"
              onClick={() => setOpen(false)}
              className="w-full bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-semibold text-sm py-3 px-4 rounded-xl flex items-center justify-between transition-colors"
            >
              <span>Go to checkout</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="flex items-center justify-center gap-1.5 text-xs text-[#8A8880]">
              <Clock className="w-3.5 h-3.5" />
              <span>
                Estimated delivery {cart.estimatedDeliveryMin}–{cart.estimatedDeliveryMax} min
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
