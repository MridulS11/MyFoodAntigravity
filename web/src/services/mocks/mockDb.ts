import type {
  AuditLogEntry,
  CartItem,
  CommissionConfig,
  ComplaintRecord,
  CouponRecord,
  CustomerAddress,
  DeliveryEarningRecord,
  DeliveryOffer,
  DeliveryPartner,
  GeoPoint,
  MenuCategory,
  NotificationItem,
  Order,
  OutletPenaltyRecord,
  OutletRoleDefinition,
  PaymentRecord,
  PortalScope,
  RefundRecord,
  Restaurant,
  RestaurantOwnerProfile,
  RestaurantSettlement,
  ReviewRecord,
  RoleDefinition,
  ServiceZone,
  User,
  InvitationItem,
} from "@/services/contracts/types";
import {
  SEED_ADDRESSES,
  SEED_ADMIN_ROLES,
  SEED_AUDIT_LOGS,
  SEED_COMMISSION_CONFIG,
  SEED_COMPLAINTS,
  SEED_COUPONS,
  SEED_MENU_CATEGORIES,
  SEED_NOTIFICATIONS,
  SEED_OFFERS,
  SEED_ORDERS,
  SEED_OUTLET_PENALTIES,
  SEED_OUTLET_ROLES,
  SEED_PARTNERS,
  SEED_PARTNER_EARNINGS,
  SEED_PAYMENTS,
  SEED_PLATFORM_INVITATIONS,
  SEED_REFUNDS,
  SEED_RESTAURANTS,
  SEED_REVIEWS,
  SEED_SETTLEMENTS,
  SEED_USERS,
  SEED_ZONES,
} from "./seedData";

export interface PendingMockRegistration {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: User["roles"][number];
  targetPortal: PortalScope;
  otp: string;
  createdAt: string;
}

export interface PortalSessionEntry {
  userId: string;
  expiresAt: string;
}

export interface MockDatabaseState {
  currentUserId: string | null; // legacy fallback reference
  portalSessions: Record<PortalScope, PortalSessionEntry | null>;
  pendingRegistrations?: PendingMockRegistration[];
  activeOutletId: string | null;
  selectedAddressId: string | null;
  customPoint: GeoPoint | null;
  favoriteRestaurantIds: string[];
  users: User[];
  ownerProfiles?: RestaurantOwnerProfile[];
  addresses: CustomerAddress[];
  zones: ServiceZone[];
  restaurants: Restaurant[];
  categories: MenuCategory[];
  cart: {
    restaurantId: string | null;
    items: CartItem[];
    appliedCouponCode: string | null;
    tipAmountMinor: number;
    specialInstructions: string;
  };
  orders: Order[];
  payments: PaymentRecord[];
  refunds: RefundRecord[];
  settlements: RestaurantSettlement[];
  penalties: OutletPenaltyRecord[];
  partnerEarnings: DeliveryEarningRecord[];
  partners: DeliveryPartner[];
  offers: DeliveryOffer[];
  reviews: ReviewRecord[];
  complaints: ComplaintRecord[];
  coupons: CouponRecord[];
  commissionConfig: CommissionConfig;
  auditLogs: AuditLogEntry[];
  notifications: NotificationItem[];
  roles: RoleDefinition[];
  outletRoles: OutletRoleDefinition[];
  platformInvitations: InvitationItem[];
  idempotencyCache: Record<string, { orderId: string; paymentId: string }>;
  trackingLocations: Record<
    string,
    { location: GeoPoint; bearingDegrees: number; progress: number; updatedAt: string }
  >;
}

const STORAGE_KEY = "goodly_phase1_mock_db_v4";
const CHANNEL_NAME = "goodly_mock_sync";
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function portalCookieName(portal: PortalScope): string {
  return `goodly_${portal}_session`;
}

export function setPortalCookie(portal: PortalScope, userId: string, ttlMs = DEFAULT_SESSION_TTL_MS): string {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  if (typeof document !== "undefined") {
    const payload = encodeURIComponent(JSON.stringify({ userId, expiresAt }));
    const maxAgeSec = Math.max(1, Math.floor(ttlMs / 1000));
    document.cookie = `${portalCookieName(portal)}=${payload}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
  }
  return expiresAt;
}

export function clearPortalCookie(portal: PortalScope): void {
  if (typeof document !== "undefined") {
    document.cookie = `${portalCookieName(portal)}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}

export function readPortalCookie(portal: PortalScope): PortalSessionEntry | null {
  if (typeof document === "undefined") return null;
  const target = `${portalCookieName(portal)}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      const raw = trimmed.slice(target.length);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(decodeURIComponent(raw)) as PortalSessionEntry;
        if (!parsed.userId || !parsed.expiresAt) return null;
        if (Date.now() > Date.parse(parsed.expiresAt)) {
          clearPortalCookie(portal);
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function getPortalSessionUserId(db: MockDatabaseState, portal: PortalScope): string | null {
  if (typeof document !== "undefined") {
    const ck = readPortalCookie(portal);
    if (!ck) return null;
    if (Date.now() > Date.parse(ck.expiresAt)) {
      clearPortalCookie(portal);
      return null;
    }
    return ck.userId;
  }
  const sess = db.portalSessions?.[portal];
  if (!sess) return null;
  if (Date.now() > Date.parse(sess.expiresAt)) return null;
  return sess.userId;
}

function clone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T;
}

export function createInitialState(): MockDatabaseState {
  return clone({
    currentUserId: null,
    portalSessions: {
      customer: null,
      restaurant: null,
      delivery: null,
      admin: null,
    },
    activeOutletId: "rest-sunday-table",
    selectedAddressId: "addr-brooklyn-home",
    customPoint: null,
    favoriteRestaurantIds: ["rest-sunday-table"],
    users: SEED_USERS,
    ownerProfiles: [
      {
        id: "owner-prof-user-rest-1",
        userId: "user-rest-1",
        fullName: "Vikram Malhotra (Outlet Owner — Sunday Table Group)",
        email: "marco@sundaytable.local",
        phone: "+91-98450-20202",
        organizationName: "Sunday Table Group",
        idDocumentType: "PAN_CARD",
        idDocumentNumber: "ABCDE1234F",
        idDocumentFilename: "demo-pan-verified.pdf",
        verificationStatus: "APPROVED",
        createdAt: "2026-01-10T10:00:00Z",
      },
    ],
    addresses: SEED_ADDRESSES,
    zones: SEED_ZONES,
    restaurants: SEED_RESTAURANTS,
    categories: SEED_MENU_CATEGORIES,
    cart: {
      restaurantId: null,
      items: [],
      appliedCouponCode: null,
      tipAmountMinor: 0,
      specialInstructions: "",
    },
    orders: SEED_ORDERS,
    payments: SEED_PAYMENTS,
    refunds: SEED_REFUNDS,
    settlements: SEED_SETTLEMENTS,
    penalties: SEED_OUTLET_PENALTIES,
    partnerEarnings: SEED_PARTNER_EARNINGS,
    partners: SEED_PARTNERS,
    offers: SEED_OFFERS,
    reviews: SEED_REVIEWS,
    complaints: SEED_COMPLAINTS,
    coupons: SEED_COUPONS,
    commissionConfig: SEED_COMMISSION_CONFIG,
    auditLogs: SEED_AUDIT_LOGS,
    notifications: SEED_NOTIFICATIONS,
    roles: SEED_ADMIN_ROLES,
    outletRoles: SEED_OUTLET_ROLES,
    platformInvitations: SEED_PLATFORM_INVITATIONS,
    idempotencyCache: {},
    trackingLocations: {},
  });
}

let memoryFallback: MockDatabaseState | null = null;
const listeners = new Set<() => void>();

export function subscribeMockDb(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach((fn) => fn());
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      ch.postMessage({ type: "DB_UPDATED" });
      ch.close();
    } catch {
      // Ignore in restricted environments
    }
  }
}

export function readMockDb(): MockDatabaseState {
  if (typeof window === "undefined" || !window.localStorage) {
    if (!memoryFallback) memoryFallback = createInitialState();
    return memoryFallback;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const init = createInitialState();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(init));
      return init;
    }
    return JSON.parse(raw) as MockDatabaseState;
  } catch {
    if (!memoryFallback) memoryFallback = createInitialState();
    return memoryFallback;
  }
}

export function writeMockDb(updater: (draft: MockDatabaseState) => void): MockDatabaseState {
  const current = readMockDb();
  const next = clone(current);
  updater(next);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      memoryFallback = next;
    }
  } else {
    memoryFallback = next;
  }
  notifyListeners();
  return next;
}

export function resetMockDb(): MockDatabaseState {
  const init = createInitialState();
  memoryFallback = init;
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(init));
  }
  notifyListeners();
  return init;
}
