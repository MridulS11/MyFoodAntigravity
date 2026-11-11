"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import type { DiscoveryFeedFilters } from "@/services/contracts/interfaces";
import type { PortalScope } from "@/services/contracts/types";
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
    onSuccess: (cart) => {
      qc.setQueryData(["cart"], cart);
    },
    onError: (err, variables) => {
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
    onSuccess: (cart) => qc.setQueryData(["cart"], cart),
    onError: (err) =>
      pushToast(
        "error",
        err instanceof Error ? err.message : "Failed to update quantity."
      ),
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
