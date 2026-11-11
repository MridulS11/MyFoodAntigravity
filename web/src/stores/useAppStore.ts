"use client";

import { create } from "zustand";

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  text: string;
}

export interface ConflictModalState {
  isOpen: boolean;
  existingRestaurantName: string;
  incomingRestaurantName: string;
  pendingPayload: {
    restaurantId: string;
    menuItemId: string;
    quantity: number;
    selectedOptionIds: string[];
  } | null;
}

interface AppUiState {
  activeAddressId: string;
  activeCityLabel: string;
  activePoint: { lat: number; lng: number };
  isAddressModalOpen: boolean;
  isCartDrawerOpen: boolean;
  menuSearchQuery: string;
  toasts: ToastMessage[];
  conflictModal: ConflictModalState;
  setActiveLocation: (payload: {
    addressId: string;
    cityLabel: string;
    point: { lat: number; lng: number };
  }) => void;
  setAddressModalOpen: (open: boolean) => void;
  setCartDrawerOpen: (open: boolean) => void;
  setMenuSearchQuery: (q: string) => void;
  pushToast: (type: ToastMessage["type"], text: string) => void;
  dismissToast: (id: string) => void;
  openConflictModal: (
    existingRestaurantName: string,
    incomingRestaurantName: string,
    pendingPayload: ConflictModalState["pendingPayload"]
  ) => void;
  closeConflictModal: () => void;
}

export const useAppStore = create<AppUiState>((set) => ({
  activeAddressId: "addr-brooklyn-home",
  activeCityLabel: "Bengaluru, KA",
  activePoint: { lat: 12.9784, lng: 77.6408 },
  isAddressModalOpen: false,
  isCartDrawerOpen: false,
  menuSearchQuery: "",
  toasts: [],
  conflictModal: {
    isOpen: false,
    existingRestaurantName: "",
    incomingRestaurantName: "",
    pendingPayload: null,
  },
  setActiveLocation: (payload) =>
    set({
      activeAddressId: payload.addressId,
      activeCityLabel: payload.cityLabel,
      activePoint: payload.point,
    }),
  setAddressModalOpen: (open) => set({ isAddressModalOpen: open }),
  setCartDrawerOpen: (open) => set({ isCartDrawerOpen: open }),
  setMenuSearchQuery: (q) => set({ menuSearchQuery: q }),
  pushToast: (type, text) => {
    const id = Math.random().toString(36).slice(2, 9);
    set((s) => ({ toasts: [...s.toasts, { id, type, text }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4200);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openConflictModal: (
    existingRestaurantName,
    incomingRestaurantName,
    pendingPayload
  ) =>
    set({
      conflictModal: {
        isOpen: true,
        existingRestaurantName,
        incomingRestaurantName,
        pendingPayload,
      },
    }),
  closeConflictModal: () =>
    set({
      conflictModal: {
        isOpen: false,
        existingRestaurantName: "",
        incomingRestaurantName: "",
        pendingPayload: null,
      },
    }),
}));
