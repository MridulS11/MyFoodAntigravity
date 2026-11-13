"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import type { DiscoveryFeedFilters } from "@/services/contracts/interfaces";
import type { Cart, PortalScope } from "@/services/contracts/types";
import { ApiError } from "@/services/contracts/errors";
import { useAppStore } from "@/stores/useAppStore";

export function useSessionUser(portal: PortalScope = "customer") {
  return useQuery({
    queryKey: ["sessionUser", portal],
    queryFn: () => services.auth.getSessionUser(portal),
  });
}

export function usePortalSession(portal: PortalScope) {
  return useQuery({
    queryKey: ["portalSession", portal],
    queryFn: () => services.auth.getPortalSession(portal),
    retry: false,
  });
}

export function useAddresses(enabled = true) {
  return useQuery({
    queryKey: ["addresses"],
    queryFn: () => services.auth.getAddresses(),
    enabled,
  });
}

export function useFavorites() {
  return useQuery({
    queryKey: ["favorites"],
    queryFn: () => services.auth.getFavorites(),
  });
}

export function useDiscoveryFeed(filters: DiscoveryFeedFilters) {
  return useQuery({
    queryKey: ["discoveryFeed", filters],
    queryFn: () => services.discovery.getFeed(filters),
  });
}

export function useRestaurantMenu(
  slugOrId: string,
  lat: number,
  lng: number,
  query?: string
) {
  return useQuery({
    queryKey: ["restaurantMenu", slugOrId, lat, lng, query ?? ""],
    queryFn: () => services.discovery.getRestaurantMenu(slugOrId, lat, lng, query),
    enabled: Boolean(slugOrId),
  });
}

export function useCart() {
  return useQuery({
    queryKey: ["cart"],
    queryFn: () => services.cart.getCart(),
  });
}

export function useAddToCart() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  const openConflictModal = useAppStore((s) => s.openConflictModal);

  return useMutation({
    mutationFn: (payload: {
      restaurantId: string;
      menuItemId: string;
      quantity: number;
      selectedOptionIds: string[];
      replaceCart?: boolean;
    }) => services.cart.addItem(payload),
    onMutate: async (variables) => {
      await qc.cancelQueries({ queryKey: ["cart"] });
      const previousCart = qc.getQueryData<Cart>(["cart"]);
      if (
        previousCart &&
        (previousCart.restaurantId === null ||
          previousCart.restaurantId === variables.restaurantId)
      ) {
        const existingIdx = previousCart.items.findIndex(
          (ci) =>
            ci.menuItemId === variables.menuItemId &&
            variables.selectedOptionIds.length === 0 &&
            ci.customizations.length === 0
        );
        const nextItems = [...previousCart.items];
        let deltaMinor = 0;
        if (existingIdx >= 0) {
          const item = nextItems[existingIdx];
          const unitMinor =
            item.unitBasePriceMinor + item.unitCustomizationsPriceMinor;
          deltaMinor = unitMinor * variables.quantity;
          nextItems[existingIdx] = {
            ...item,
            quantity: item.quantity + variables.quantity,
            lineTotalMinor: item.lineTotalMinor + deltaMinor,
          };
        } else {
          nextItems.push({
            id: `optimistic-${Date.now()}`,
            menuItemId: variables.menuItemId,
            name: "Adding item...",
            imageUrl: "",
            quantity: variables.quantity,
            unitBasePriceMinor: 0,
            unitCustomizationsPriceMinor: 0,
            customizations: [],
            lineTotalMinor: 0,
          });
        }
        qc.setQueryData<Cart>(["cart"], {
          ...previousCart,
          restaurantId: variables.restaurantId,
          items: nextItems,
          breakdown: {
            ...previousCart.breakdown,
            itemSubtotalMinor:
              previousCart.breakdown.itemSubtotalMinor + deltaMinor,
            totalPayableMinor:
              previousCart.breakdown.totalPayableMinor + deltaMinor,
          },
        });
      }
      return { previousCart };
    },
    onSuccess: (cart) => {
      qc.setQueryData(["cart"], cart);
    },
    onError: (err, variables, context) => {
      if (context?.previousCart !== undefined) {
        qc.setQueryData(["cart"], context.previousCart);
      } else {
        void qc.invalidateQueries({ queryKey: ["cart"] });
      }
      if (
        err instanceof ApiError &&
        err.code === "MULTI_RESTAURANT_CART_CONFLICT"
      ) {
        openConflictModal(
          String(err.details?.existingRestaurantName ?? "another restaurant"),
          String(err.details?.incomingRestaurantName ?? "this restaurant"),
          {
            restaurantId: variables.restaurantId,
            menuItemId: variables.menuItemId,
            quantity: variables.quantity,
            selectedOptionIds: variables.selectedOptionIds,
          }
        );
        return;
      }
      pushToast(
        "error",
        err instanceof Error ? err.message : "Could not add item to your bag."
      );
    },
  });
}

export function useUpdateCartItemQuantity() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  return useMutation({
    mutationFn: ({
      cartItemId,
      quantity,
    }: {
      cartItemId: string;
      quantity: number;
    }) => services.cart.updateItemQuantity(cartItemId, quantity),
    onMutate: async ({ cartItemId, quantity }) => {
      await qc.cancelQueries({ queryKey: ["cart"] });
      const previousCart = qc.getQueryData<Cart>(["cart"]);
      if (previousCart) {
        let deltaMinor = 0;
        const nextItems = previousCart.items
          .map((ci) => {
            if (ci.id !== cartItemId) return ci;
            const unitMinor =
              ci.unitBasePriceMinor + ci.unitCustomizationsPriceMinor;
            const newTotal = unitMinor * Math.max(0, quantity);
            deltaMinor = newTotal - ci.lineTotalMinor;
            return {
              ...ci,
              quantity,
              lineTotalMinor: newTotal,
            };
          })
          .filter((ci) => ci.quantity > 0);
        qc.setQueryData<Cart>(["cart"], {
          ...previousCart,
          restaurantId: nextItems.length === 0 ? null : previousCart.restaurantId,
          items: nextItems,
          breakdown: {
            ...previousCart.breakdown,
            itemSubtotalMinor: Math.max(
              0,
              previousCart.breakdown.itemSubtotalMinor + deltaMinor
            ),
            totalPayableMinor: Math.max(
              0,
              previousCart.breakdown.totalPayableMinor + deltaMinor
            ),
          },
        });
      }
      return { previousCart };
    },
    onSuccess: (cart) => qc.setQueryData(["cart"], cart),
    onError: (err, _vars, context) => {
      if (context?.previousCart !== undefined) {
        qc.setQueryData(["cart"], context.previousCart);
      } else {
        void qc.invalidateQueries({ queryKey: ["cart"] });
      }
      pushToast(
        "error",
        err instanceof Error ? err.message : "Failed to update quantity."
      );
    },
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);
  return useMutation({
    mutationFn: (restaurantId: string) =>
      services.auth.toggleFavorite(restaurantId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
    onError: () => pushToast("error", "Could not update favorite."),
  });
}

export function useMyOrders(enabled = true) {
  return useQuery({
    queryKey: ["myOrders"],
    queryFn: () => services.orders.listMyOrders(),
    enabled,
  });
}

export function useOrderDetail(orderId: string) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () => services.orders.getOrderById(orderId),
    enabled: Boolean(orderId),
    refetchInterval: 3000,
  });
}

export function useTrackingSnapshot(orderId: string) {
  return useQuery({
    queryKey: ["tracking", orderId],
    queryFn: () => services.orders.getTrackingSnapshot(orderId),
    enabled: Boolean(orderId),
    refetchInterval: 2500,
  });
}
