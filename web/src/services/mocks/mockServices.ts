import {
  formatMinor,
  generateOrderNumber,
  haversineMeters,
} from "@/lib/format";
import { computeCartBreakdown } from "@/lib/pricing";
import { ApiError } from "@/services/contracts/errors";
import type {
  CheckoutValidationResponse,
  DiscoveryFeedFilters,
  DiscoveryFeedResponse,
  IAdminPortalService,
  IAuthService,
  ICartService,
  IDeliveryPortalService,
  IDiscoveryService,
  IOrderService,
  IRestaurantPortalService,
  SearchResultResponse,
  ServiceRegistry,
} from "@/services/contracts/interfaces";
import type {
  AdminDirectoryCustomer,
  AdminDirectoryDeliveryUser,
  AdminDirectoryManagementUser,
  AdminDirectoryOutlet,
  AdminDirectoryOwner,
  AdminDirectoryStaffUser,
  AdminOutletDetail,
  AdminPermission,
  AdminUserDetail,
  Cart,
  CartItemCustomization,
  ComplaintRecord,
  CouponRecord,
  CustomerAddress,
  DeliveryPartner,
  DeliveryPartnerWithStatus,
  InvitationItem,
  MenuCategory,
  MenuItem,
  Order,
  OutletRoleDefinition,
  OutletStaffMember,
  PaymentRecord,
  PortalAuthResult,
  PortalScope,
  RefundRecord,
  Restaurant,
  RestaurantOwnerProfile,
  RestaurantWithMenu,
  ReviewRecord,
  RoleDefinition,
  ServiceZone,
  TrackingSnapshot,
  User,
  UserRole,
} from "@/services/contracts/types";
import {
  clearPortalCookie,
  getPortalSessionUserId,
  readMockDb,
  setPortalCookie,
  writeMockDb,
  type MockDatabaseState,
} from "./mockDb";

function inferPortalFromUser(user: User, fallback: PortalScope = "customer"): PortalScope {
  if (user.roles.some((r) => r.endsWith("_ADMIN") || r === "CUSTOMER_CARE")) return "admin";
  if (user.roles.includes("DELIVERY_PARTNER")) return "delivery";
  if (
    user.roles.includes("OUTLET_OWNER") ||
    user.roles.includes("RESTAURANT_OWNER") ||
    user.roles.includes("BRANCH_MANAGER") ||
    user.roles.includes("OUTLET_STAFF")
  ) {
    return "restaurant";
  }
  return fallback;
}

function getPortalUser(db: MockDatabaseState, portal: PortalScope): User | null {
  const uid = getPortalSessionUserId(db, portal);
  if (!uid) return null;
  return db.users.find((u) => u.id === uid) ?? null;
}

function checkMockOnboardingNeeded(db: MockDatabaseState, portal: PortalScope, user: User): { required: boolean; hint?: string } {
  if (portal === "restaurant") {
    const ownedOrActive = db.restaurants.some(
      (r) =>
        r.ownerUserId === user.id ||
        r.staffMembers?.some(
          (s) =>
            (s.userId === user.id || s.email.toLowerCase() === user.email.toLowerCase() || (user.phone && s.phone === user.phone)) &&
            s.status === "ACTIVE"
        )
    );
    if (!ownedOrActive) {
      return { required: true, hint: "Onboard your outlet or accept an outlet invitation." };
    }
    return { required: false };
  }
  if (portal === "delivery") {
    const partner = user.partnerId
      ? db.partners.find((p) => p.id === user.partnerId)
      : db.partners.find((p) => p.userId === user.id);
    if (!partner || partner.verificationStatus !== "APPROVED") {
      return { required: true, hint: "You are not receiving orders due to onboarding verification pending" };
    }
    return { required: false };
  }
  if (portal === "customer") {
    const hasAddr = db.addresses.some((a) => a.userId === user.id);
    if (!hasAddr) {
      return { required: true, hint: "Add your delivery address to discover nearby spots." };
    }
    return { required: false };
  }
  if (portal === "admin") {
    const isAdmin =
      user.roles.some((r) => r.endsWith("_ADMIN") || r === "CUSTOMER_CARE" || r.startsWith("CUSTOM_")) &&
      user.permissions.length > 0;
    if (!isAdmin) {
      return {
        required: true,
        hint: "Account active with zero admin access. Accept an invitation from an eligible Admin to unlock dashboard access.",
      };
    }
    return { required: false };
  }
  return { required: false };
}

function uuid(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireUser(db: MockDatabaseState, portal: PortalScope = "customer"): User {
  const uid = getPortalSessionUserId(db, portal);
  if (!uid) {
    throw new ApiError("UNAUTHORIZED", "Session ended. Please sign in to continue.", 401);
  }
  const user = db.users.find((u) => u.id === uid);
  if (!user) {
    throw new ApiError("UNAUTHORIZED", "Session expired. Please sign in again.", 401);
  }
  if (user.status !== "ACTIVE") {
    throw new ApiError("FORBIDDEN", "Your account has been suspended.", 403);
  }
  return user;
}

function requireAdminAnyPermission(
  db: MockDatabaseState,
  permissions: AdminPermission[]
): User {
  const user = requireUser(db, "admin");
  const isAdminOrCare = user.roles.some(
    (r) => r.endsWith("_ADMIN") || r === "CUSTOMER_CARE" || r.startsWith("CUSTOM_")
  );
  if (!isAdminOrCare || !permissions.some((p) => user.permissions.includes(p))) {
    throw new ApiError(
      "FORBIDDEN",
      `Missing required permission: ${permissions.join(" or ")}`,
      403
    );
  }
  return user;
}

function requireAdminPermission(
  db: MockDatabaseState,
  permission: AdminPermission
): User {
  return requireAdminAnyPermission(db, [permission]);
}

function getUserAccessibleOutlets(db: MockDatabaseState, user: User): Restaurant[] {
  const email = user.email.toLowerCase();
  return db.restaurants.filter(
    (r) =>
      r.ownerUserId === user.id ||
      r.staffMembers?.some(
        (s) =>
          (s.userId === user.id ||
            s.email.toLowerCase() === email ||
            (user.phone && s.phone === user.phone)) &&
          s.status === "ACTIVE"
      )
  );
}

function resolveActiveOutletId(db: MockDatabaseState): string {
  const user = requireUser(db, "restaurant");
  const allowed = getUserAccessibleOutlets(db, user);
  if (allowed.length === 0) {
    throw new ApiError(
      "FORBIDDEN",
      "Restaurant portal access is locked until you accept an outlet invitation (and receive approval) or onboard your own outlet.",
      403
    );
  }
  if (db.activeOutletId && allowed.some((r) => r.id === db.activeOutletId)) {
    return db.activeOutletId;
  }
  return allowed[0].id;
}

function findCoveringZone(
  zones: ServiceZone[],
  lat: number,
  lng: number
): ServiceZone | null {
  for (const zone of zones) {
    if (!zone.isActive) continue;
    const dist = haversineMeters(zone.center, { lat, lng });
    if (dist <= zone.radiusMeters) return zone;
  }
  return null;
}

function buildCartResponse(db: MockDatabaseState): Cart {
  const restaurant = db.cart.restaurantId
    ? db.restaurants.find((r) => r.id === db.cart.restaurantId) ?? null
    : null;
  const coupon = db.cart.appliedCouponCode
    ? db.coupons.find(
        (c) =>
          c.code.toUpperCase() === db.cart.appliedCouponCode?.toUpperCase()
      ) ?? null
    : null;

  const breakdown = computeCartBreakdown({
    items: db.cart.items,
    packagingFeeMinor: restaurant?.packagingFeeMinor ?? 0,
    baseDeliveryFeeMinor: restaurant?.deliveryFeeMinor ?? 0,
    coupon,
    config: db.commissionConfig,
    tipAmountMinor: db.cart.tipAmountMinor,
  });

  return {
    restaurantId: restaurant?.id ?? null,
    restaurantName: restaurant?.name ?? null,
    restaurantSlug: restaurant?.slug ?? null,
    estimatedDeliveryMin: restaurant?.estimatedDeliveryMin ?? 20,
    estimatedDeliveryMax: restaurant?.estimatedDeliveryMax ?? 30,
    currency: restaurant?.currency ?? "INR",
    items: db.cart.items,
    appliedCouponCode: coupon?.code ?? null,
    tipAmountMinor: db.cart.tipAmountMinor,
    specialInstructions: db.cart.specialInstructions,
    breakdown,
  };
}

function findMenuItem(db: MockDatabaseState, itemId: string): MenuItem | null {
  for (const cat of db.categories) {
    const found = cat.items.find((i) => i.id === itemId);
    if (found) return found;
  }
  return null;
}

export const mockAuthService: IAuthService = {
  async getSessionUser(portal: PortalScope = "customer") {
    const db = readMockDb();
    return getPortalUser(db, portal);
  },

  async getPortalSession(portal) {
    const db = readMockDb();
    const user = getPortalUser(db, portal);
    if (!user) return null;
    const onb = checkMockOnboardingNeeded(db, portal, user);
    return {
      user,
      portal,
      onboardingRequired: onb.required,
      onboardingHint: onb.hint,
    };
  },

  async checkEmailAvailability(portal, emailOrPhone) {
    const db = readMockDb();
    const norm = emailOrPhone.trim().toLowerCase();
    const exists = db.users.some(
      (u) => u.email.toLowerCase() === norm || u.phone === emailOrPhone.trim()
    );
    return {
      exists,
      portal,
      onboardingRecommended: !exists && portal !== "admin",
    };
  },

  async login(emailOrPhone, password, portal = "customer") {
    const res = await this.loginForPortal(portal, emailOrPhone, password);
    return res.user;
  },

  async loginForPortal(portal, emailOrPhone, password): Promise<PortalAuthResult> {
    if (!password || password.length < 6) {
      throw new ApiError("VALIDATION_ERROR", "Invalid credentials.", 400);
    }
    const db = readMockDb();
    const norm = emailOrPhone.trim().toLowerCase();
    const found = db.users.find(
      (u) => u.email.toLowerCase() === norm || u.phone === emailOrPhone.trim()
    );
    if (!found) {
      throw new ApiError(
        "UNAUTHORIZED",
        "No account matched that email or phone.",
        401,
        { uniqueEmail: true, onboardingRecommended: portal !== "admin" }
      );
    }
    if (found.status !== "ACTIVE") {
      throw new ApiError("FORBIDDEN", "This account is currently suspended.", 403);
    }

    const expiresAt = setPortalCookie(portal, found.id);
    writeMockDb((draft) => {
      draft.currentUserId = found.id;
      draft.portalSessions[portal] = { userId: found.id, expiresAt };
      if (portal === "restaurant") {
        const ownedOrAssigned = draft.restaurants.find(
          (r) =>
            r.ownerUserId === found.id ||
            r.staffMembers?.some(
              (s) =>
                (s.userId === found.id ||
                  s.email.toLowerCase() === found.email.toLowerCase() ||
                  s.phone === found.phone) &&
                s.status === "ACTIVE"
            )
        );
        draft.activeOutletId = ownedOrAssigned?.id ?? null;
      }
    });
    const after = readMockDb();
    const onb = checkMockOnboardingNeeded(after, portal, found);
    return {
      user: found,
      portal,
      onboardingRequired: onb.required,
      onboardingHint: onb.hint,
    };
  },

  async register(payload, portal = "customer") {
    const db = readMockDb();
    const exists = db.users.some(
      (u) =>
        u.email.toLowerCase() === payload.email.toLowerCase() ||
        u.phone === payload.phone.trim()
    );
    if (exists) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "An account with this email or phone already exists.",
        409
      );
    }
    const targetPortal: PortalScope =
      portal !== "customer"
        ? portal
        : payload.role === "DELIVERY_PARTNER"
          ? "delivery"
          : payload.role === "OUTLET_OWNER" ||
              payload.role === "RESTAURANT_OWNER" ||
              payload.role === "OUTLET_STAFF" ||
              payload.role === "BRANCH_MANAGER"
            ? "restaurant"
            : "customer";

    const pendingUser: User = {
      id: `pending-${targetPortal}`,
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone.trim(),
      fullName: payload.fullName.trim(),
      roles: [payload.role],
      permissions: [],
      status: "ACTIVE",
      isEmailVerified: false,
      isPhoneVerified: false,
      createdAt: nowIso(),
    };
    writeMockDb((draft) => {
      if (!draft.pendingRegistrations) draft.pendingRegistrations = [];
      const normEmail = pendingUser.email;
      const normPhone = pendingUser.phone;
      draft.pendingRegistrations = draft.pendingRegistrations.filter(
        (p) => p.email.toLowerCase() !== normEmail && p.phone !== normPhone
      );
      draft.pendingRegistrations.push({
        fullName: pendingUser.fullName,
        email: normEmail,
        phone: normPhone,
        password: payload.password,
        role: payload.role,
        targetPortal,
        otp: "123456",
        createdAt: nowIso(),
      });
    });
    return { user: pendingUser, otpRequired: true, onboardingRequired: true };
  },

  async verifyOtp(target, code, portal) {
    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      throw new ApiError("VALIDATION_ERROR", "Enter a valid 6-digit OTP code.", 400);
    }
    let verifiedUser: User | null = null;
    writeMockDb((draft) => {
      const norm = target.trim().toLowerCase();
      const pendingList = draft.pendingRegistrations ?? [];
      const pendingIdx = pendingList.findIndex(
        (p) => p.email.toLowerCase() === norm || p.phone === target.trim()
      );
      if (pendingIdx >= 0) {
        const pending = pendingList[pendingIdx];
        if (cleanCode !== pending.otp) {
          throw new ApiError("VALIDATION_ERROR", "Invalid OTP code. Check your email or use 123456 in dev.", 400);
        }
        const alreadyExists = draft.users.some(
          (u) => u.email.toLowerCase() === pending.email.toLowerCase() || u.phone === pending.phone
        );
        if (alreadyExists) {
          draft.pendingRegistrations!.splice(pendingIdx, 1);
          throw new ApiError("VALIDATION_ERROR", "An account with this email or phone already exists.", 409);
        }
        const newUser: User = {
          id: uuid("user"),
          email: pending.email,
          phone: pending.phone,
          fullName: pending.fullName,
          roles: [pending.role],
          permissions: [],
          status: "ACTIVE",
          isEmailVerified: true,
          isPhoneVerified: true,
          createdAt: nowIso(),
        };
        draft.pendingRegistrations!.splice(pendingIdx, 1);
        draft.users.push(newUser);
        const targetPortal = portal ?? pending.targetPortal;
        const expiresAt = setPortalCookie(targetPortal, newUser.id);
        draft.currentUserId = newUser.id;
        draft.portalSessions[targetPortal] = { userId: newUser.id, expiresAt };
        if (targetPortal === "restaurant") {
          draft.activeOutletId = null;
        }
        verifiedUser = newUser;
        return;
      }

      if (cleanCode !== "123456") {
        throw new ApiError("VALIDATION_ERROR", "Invalid OTP code.", 400);
      }
      let user = draft.users.find(
        (u) => u.phone === target.trim() || u.email.toLowerCase() === norm
      );
      if (!user && portal) {
        user = getPortalUser(draft, portal) ?? undefined;
      }
      if (!user && draft.currentUserId) {
        user = draft.users.find((u) => u.id === draft.currentUserId);
      }
      if (user) {
        user.isPhoneVerified = true;
        user.isEmailVerified = true;
        verifiedUser = user;
      }
    });
    if (!verifiedUser) {
      throw new ApiError("VALIDATION_ERROR", "Invalid or expired OTP.", 400);
    }
    return verifiedUser;
  },

  async switchDemoPersona(roleOrUserId, portalOverride) {
    const db = readMockDb();
    const found = db.users.find(
      (u) =>
        u.id === roleOrUserId ||
        u.email.toLowerCase() === roleOrUserId.toLowerCase() ||
        u.roles.includes(roleOrUserId as UserRole)
    );
    if (!found) {
      throw new ApiError("NOT_FOUND", "Demo persona not found.", 404);
    }
    const targetPortal: PortalScope =
      portalOverride ?? inferPortalFromUser(found, "customer");
    const expiresAt = setPortalCookie(targetPortal, found.id);
    writeMockDb((draft) => {
      draft.currentUserId = found.id;
      draft.portalSessions[targetPortal] = { userId: found.id, expiresAt };
      if (targetPortal === "restaurant") {
        const ownedOrAssigned = draft.restaurants.find(
          (r) =>
            r.ownerUserId === found.id ||
            r.staffMembers?.some(
              (s) =>
                (s.userId === found.id ||
                  s.email.toLowerCase() === found.email.toLowerCase() ||
                  s.phone === found.phone) &&
                s.status === "ACTIVE"
            )
        );
        draft.activeOutletId = ownedOrAssigned?.id ?? null;
      }
    });
    return found;
  },

  async logout(portal: PortalScope = "customer") {
    clearPortalCookie(portal);
    writeMockDb((draft) => {
      draft.portalSessions[portal] = null;
      if (draft.currentUserId && getPortalSessionUserId(draft, portal) === null) {
        draft.currentUserId = null;
      }
    });
  },

  async getAddresses() {
    const db = readMockDb();
    const user = getPortalUser(db, "customer");
    if (!user) return [];
    return db.addresses.filter((a) => a.userId === user.id);
  },

  async saveAddress(input) {
    let saved!: CustomerAddress;
    writeMockDb((draft) => {
      const user = requireUser(draft);
      const zone = findCoveringZone(
        draft.zones,
        input.location.lat,
        input.location.lng
      );
      if (input.isDefault) {
        draft.addresses.forEach((a) => {
          if (a.userId === user.id) a.isDefault = false;
        });
      }
      saved = {
        ...input,
        id: uuid("addr"),
        userId: user.id,
        isServiceable: Boolean(zone),
      };
      draft.addresses.unshift(saved);
      if (saved.isDefault) {
        draft.selectedAddressId = saved.id;
      }
    });
    return saved;
  },

  async deleteAddress(addressId) {
    writeMockDb((draft) => {
      const user = requireUser(draft);
      draft.addresses = draft.addresses.filter(
        (a) => !(a.id === addressId && a.userId === user.id)
      );
    });
  },

  async setDefaultAddress(addressId) {
    writeMockDb((draft) => {
      const user = requireUser(draft);
      draft.addresses.forEach((a) => {
        if (a.userId === user.id) {
          a.isDefault = a.id === addressId;
        }
      });
      draft.selectedAddressId = addressId;
    });
  },

  async getFavorites() {
    const db = readMockDb();
    return db.restaurants.filter((r) =>
      db.favoriteRestaurantIds.includes(r.id)
    );
  },

  async toggleFavorite(restaurantId) {
    let nextIds: string[] = [];
    writeMockDb((draft) => {
      if (draft.favoriteRestaurantIds.includes(restaurantId)) {
        draft.favoriteRestaurantIds = draft.favoriteRestaurantIds.filter(
          (id) => id !== restaurantId
        );
      } else {
        draft.favoriteRestaurantIds.push(restaurantId);
      }
      nextIds = draft.favoriteRestaurantIds;
    });
    return nextIds;
  },

  async getNotifications() {
    const db = readMockDb();
    const user = getPortalUser(db, "customer");
    if (!user) return [];
    return db.notifications.filter((n) => n.userId === user.id);
  },

  async markNotificationRead(notificationId) {
    writeMockDb((draft) => {
      const target = draft.notifications.find((n) => n.id === notificationId);
      if (target) target.isRead = true;
    });
  },

  async listMyInvitations(portal) {
    const db = readMockDb();
    const user = portal
      ? getPortalUser(db, portal)
      : getPortalUser(db, "customer") ??
        getPortalUser(db, "restaurant") ??
        getPortalUser(db, "admin");
    if (!user) return [];
    const email = user.email.toLowerCase();
    const phone = user.phone;
    const out: InvitationItem[] = [];

    for (const inv of db.platformInvitations) {
      if (
        inv.invitedEmail?.toLowerCase() === email ||
        (phone && inv.invitedPhone === phone)
      ) {
        out.push(inv);
      }
    }

    for (const rest of db.restaurants) {
      for (const s of rest.staffMembers ?? []) {
        if (
          s.userId === user.id ||
          s.email.toLowerCase() === email ||
          (phone && s.phone === phone)
        ) {
          out.push({
            id: s.id,
            kind: "OUTLET",
            targetId: rest.id,
            targetName: rest.name,
            roleName: s.outletRoleName || s.roleCode,
            roleCode: s.roleCode,
            permissions: s.permissions,
            invitedByName: "Outlet Owner",
            status: s.status === "INVITED" ? "PENDING_ACCEPTANCE" : s.status,
            invitedEmail: s.email,
            invitedPhone: s.phone,
            acceptedAt: s.acceptedAt,
            approvedAt: s.approvedAt,
            createdAt: nowIso(),
          });
        }
      }
    }
    return out;
  },

  async respondToInvitation(kind, invitationId, action, portal) {
    writeMockDb((draft) => {
      const user = portal
        ? requireUser(draft, portal)
        : getPortalUser(draft, kind === "OUTLET" ? "restaurant" : "admin") ??
          getPortalUser(draft, "customer") ??
          requireUser(draft, "customer");
      const ts = nowIso();
      if (kind === "PLATFORM") {
        const inv = draft.platformInvitations.find((i) => i.id === invitationId);
        if (!inv || inv.status !== "PENDING_ACCEPTANCE") {
          throw new ApiError("VALIDATION_ERROR", "Invitation cannot be updated.", 400);
        }
        if (action === "ACCEPT") {
          inv.acceptedAt = ts;
          if (inv.preApproved) {
            inv.status = "ACTIVE";
            inv.approvedAt = ts;
            if (!user.roles.includes(inv.roleCode as UserRole)) {
              user.roles.push(inv.roleCode as UserRole);
            }
            const merged = new Set([...user.permissions, ...(inv.permissions as AdminPermission[])]);
            user.permissions = Array.from(merged);
          } else {
            inv.status = "PENDING_ADMIN_APPROVAL";
          }
        } else {
          inv.status = "DECLINED";
        }
        return;
      }

      for (const rest of draft.restaurants) {
        const s = rest.staffMembers?.find((m) => m.id === invitationId);
        if (s) {
          if (s.status !== "PENDING_ACCEPTANCE" && s.status !== "INVITED") {
            throw new ApiError("VALIDATION_ERROR", "Outlet invitation is not pending.", 400);
          }
          s.userId = user.id;
          s.fullName = user.fullName;
          s.status = action === "ACCEPT" ? "PENDING_APPROVAL" : "DECLINED";
          if (action === "ACCEPT") s.acceptedAt = ts;
          return;
        }
      }
      throw new ApiError("NOT_FOUND", "Invitation not found.", 404);
    });
  },
};

function hasActiveMenuItem(db: ReturnType<typeof readMockDb>, restaurantId: string): boolean {
  return db.categories.some(
    (c) => c.restaurantId === restaurantId && c.isActive && c.items.some((i) => i.isActive)
  );
}

export const mockDiscoveryService: IDiscoveryService = {
  async checkServiceability(lat, lng) {
    const db = readMockDb();
    const zone = findCoveringZone(db.zones, lat, lng);
    return {
      serviceable: Boolean(zone),
      zone,
    };
  },

  async getFeed(filters: DiscoveryFeedFilters): Promise<DiscoveryFeedResponse> {
    const db = readMockDb();
    const zone = findCoveringZone(db.zones, filters.lat, filters.lng);
    if (!zone) {
      return {
        serviceable: false,
        zone: null,
        spotlightRestaurant: null,
        restaurants: [],
      };
    }

    let list = db.restaurants.filter((r) => {
      if (r.verificationStatus !== "APPROVED" || !r.isActive || !hasActiveMenuItem(db, r.id)) {
        return false;
      }
      const dist = haversineMeters(r.location, {
        lat: filters.lat,
        lng: filters.lng,
      });
      return dist <= r.maxDeliveryRadiusMeters;
    });

    if (filters.category && filters.category !== "all") {
      list = list.filter((r) =>
        r.categoryFilterKeys.includes(filters.category!)
      );
    }
    if (filters.freeDeliveryOnly) {
      list = list.filter((r) => r.deliveryFeeMinor === 0);
    }
    if (filters.minRating) {
      list = list.filter((r) => r.ratingAverage >= filters.minRating!);
    }
    if (filters.maxEtaMinutes) {
      list = list.filter((r) => r.estimatedDeliveryMax <= filters.maxEtaMinutes!);
    }

    if (filters.sortBy === "rating") {
      list = [...list].sort((a, b) => b.ratingAverage - a.ratingAverage);
    } else if (filters.sortBy === "fastest") {
      list = [...list].sort(
        (a, b) => a.estimatedDeliveryMin - b.estimatedDeliveryMin
      );
    } else if (filters.sortBy === "delivery_fee") {
      list = [...list].sort((a, b) => a.deliveryFeeMinor - b.deliveryFeeMinor);
    }

    const spotlightRestaurant =
      db.restaurants.find(
        (r) =>
          r.slug === "sunday-table" &&
          r.verificationStatus === "APPROVED" &&
          r.isActive &&
          hasActiveMenuItem(db, r.id)
      ) ?? list[0] ?? null;

    return {
      serviceable: true,
      zone,
      spotlightRestaurant,
      restaurants: list,
    };
  },

  async search(query, lat, lng): Promise<SearchResultResponse> {
    const db = readMockDb();
    const q = query.trim().toLowerCase();
    const zone = findCoveringZone(db.zones, lat, lng);
    if (!zone) return { restaurants: [], dishes: [] };

    const approvedRestaurants = db.restaurants.filter(
      (r) => r.verificationStatus === "APPROVED" && r.isActive && hasActiveMenuItem(db, r.id)
    );

    if (!q) {
      return { restaurants: approvedRestaurants, dishes: [] };
    }

    const SYNONYM_GROUPS = [
      ["pasta", "penne", "spaghetti", "fettuccine", "rigatoni", "fusilli", "linguine", "macaroni", "ravioli", "lasagna", "tortellini", "gnocchi", "alfredo", "carbonara", "arrabbiata", "cacio e pepe"],
      ["pizza", "margherita", "pepperoni", "quattro formaggi", "napoletana", "sourdough pizza", "calzone"],
      ["burger", "cheeseburger", "veggie burger", "smash burger", "slider"],
      ["biryani", "pulao", "pilaf", "dum biryani"],
      ["curry", "masala", "tikka masala", "korma", "makhani", "butter chicken"],
      ["bread", "naan", "roti", "paratha", "focaccia", "sourdough"],
      ["noodles", "ramen", "udon", "hakka noodles", "chowmein", "pad thai"],
      ["bowl", "rice bowl", "grain bowl", "poke", "buddha bowl"],
      ["salad", "caesar", "caprese", "greens"],
      ["dessert", "cake", "tiramisu", "brownie", "cheesecake", "gelato", "ice cream"],
      ["coffee", "espresso", "latte", "cappuccino", "americano", "cold brew"],
      ["vegan", "plant based", "plant-based"],
      ["vegetarian", "veg"],
      ["gluten free", "gluten-free", "gf"],
    ];

    const expandedTerms = new Set<string>([q]);
    for (const grp of SYNONYM_GROUPS) {
      if (grp.some((syn) => q.includes(syn) || syn.includes(q))) {
        for (const syn of grp) expandedTerms.add(syn);
      }
    }
    const matchesQuery = (text: string) => {
      const lower = text.toLowerCase();
      for (const t of expandedTerms) {
        if (lower.includes(t)) return true;
      }
      return false;
    };

    const restaurants = approvedRestaurants.filter(
      (r) =>
        matchesQuery(r.name) ||
        matchesQuery(r.description) ||
        r.cuisines.some((c) => matchesQuery(c))
    );

    const dishes: SearchResultResponse["dishes"] = [];
    for (const cat of db.categories) {
      const rest = approvedRestaurants.find((r) => r.id === cat.restaurantId);
      if (!rest) continue;
      for (const item of cat.items) {
        if (!item.isActive) continue;
        const searchable = [
          item.name,
          item.description,
          cat.name,
          item.cuisineType ?? "",
          item.badgeLabel ?? "",
          ...(item.dietaryTags ?? []),
          ...(item.ingredients ?? []),
          ...(item.allergens ?? []),
          ...(item.searchKeywords ?? []),
          item.vegClassification === "NON_VEG"
            ? "non-veg non veg"
            : item.vegClassification === "EGG_ONLY"
              ? "non-veg (only egg) egg only eggitarian"
              : "veg vegetarian",
          ...item.customizationGroups.flatMap((g) => [g.name, ...g.options.map((o) => o.name)]),
        ].join(" ");
        if (matchesQuery(searchable)) {
          dishes.push({ item, restaurant: rest });
        }
      }
    }

    return { restaurants, dishes };
  },

  async getRestaurantMenu(slugOrId, _lat, _lng, query): Promise<RestaurantWithMenu> {
    const db = readMockDb();
    const restaurant = db.restaurants.find(
      (r) => r.slug === slugOrId || r.id === slugOrId
    );
    if (!restaurant) {
      throw new ApiError("NOT_FOUND", "Restaurant not found.", 404);
    }

    const q = query?.trim().toLowerCase() ?? "";
    const categories = db.categories
      .filter((c) => c.restaurantId === restaurant.id && c.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((item) => {
          if (!item.isActive) return false;
          if (!q) return true;
          return (
            item.name.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((cat) => cat.items.length > 0);

    return { restaurant, categories };
  },
};

export const mockCartService: ICartService = {
  async getCart() {
    const db = readMockDb();
    return buildCartResponse(db);
  },

  async addItem(payload) {
    let result!: Cart;
    writeMockDb((draft) => {
      const restaurant = draft.restaurants.find(
        (r) => r.id === payload.restaurantId
      );
      if (!restaurant) {
        throw new ApiError("NOT_FOUND", "Restaurant not found.", 404);
      }
      if (!restaurant.isAcceptingOrders) {
        throw new ApiError(
          "ORDER_STATE_CONFLICT",
          `${restaurant.name} is currently not accepting orders.`,
          409
        );
      }

      if (
        draft.cart.restaurantId &&
        draft.cart.restaurantId !== payload.restaurantId &&
        draft.cart.items.length > 0
      ) {
        if (!payload.replaceCart) {
          const existingRest = draft.restaurants.find(
            (r) => r.id === draft.cart.restaurantId
          );
          throw new ApiError(
            "MULTI_RESTAURANT_CART_CONFLICT",
            `Your bag contains items from ${existingRest?.name ?? "another restaurant"}. Replace your bag with ${restaurant.name}?`,
            409,
            {
              existingRestaurantName: existingRest?.name ?? "another restaurant",
              incomingRestaurantName: restaurant.name,
            }
          );
        }
        draft.cart.items = [];
        draft.cart.appliedCouponCode = null;
      }

      const menuItem = findMenuItem(draft, payload.menuItemId);
      if (!menuItem || !menuItem.isActive) {
        throw new ApiError("NOT_FOUND", "Menu item not found.", 404);
      }
      if (
        !menuItem.isAvailable ||
        (menuItem.trackInventory && menuItem.availableQuantity < payload.quantity)
      ) {
        throw new ApiError(
          "ITEM_OUT_OF_STOCK",
          `${menuItem.name} is currently sold out.`,
          409
        );
      }

      const selectedCustomizations: CartItemCustomization[] = [];
      let customizationsDelta = 0;
      for (const group of menuItem.customizationGroups) {
        const picked = group.options.filter((o) =>
          payload.selectedOptionIds.includes(o.id)
        );
        if (
          picked.length < group.minSelections ||
          picked.length > group.maxSelections
        ) {
          throw new ApiError(
            "VALIDATION_ERROR",
            `Invalid selection for ${group.name}.`,
            400
          );
        }
        for (const opt of picked) {
          customizationsDelta += opt.priceDeltaMinor;
          selectedCustomizations.push({
            groupId: group.id,
            groupName: group.name,
            optionId: opt.id,
            optionName: opt.name,
            priceDeltaMinor: opt.priceDeltaMinor,
          });
        }
      }

      const sortedOptKey = [...payload.selectedOptionIds].sort().join(",");
      const existing = draft.cart.items.find(
        (ci) =>
          ci.menuItemId === menuItem.id &&
          ci.customizations.map((c) => c.optionId).sort().join(",") === sortedOptKey
      );

      if (existing) {
        const nextQty = existing.quantity + payload.quantity;
        if (menuItem.trackInventory && nextQty > menuItem.availableQuantity) {
          throw new ApiError(
            "ITEM_OUT_OF_STOCK",
            `Only ${menuItem.availableQuantity} left of ${menuItem.name}.`,
            409
          );
        }
        existing.quantity = nextQty;
        existing.lineTotalMinor =
          (existing.unitBasePriceMinor + existing.unitCustomizationsPriceMinor) *
          nextQty;
      } else {
        draft.cart.items.push({
          id: uuid("ci"),
          menuItemId: menuItem.id,
          name: menuItem.name,
          imageUrl: menuItem.imageUrl,
          unitBasePriceMinor: menuItem.basePriceMinor,
          unitCustomizationsPriceMinor: customizationsDelta,
          quantity: payload.quantity,
          customizations: selectedCustomizations,
          lineTotalMinor:
            (menuItem.basePriceMinor + customizationsDelta) * payload.quantity,
        });
      }

      draft.cart.restaurantId = restaurant.id;
      result = buildCartResponse(draft);
    });
    return result;
  },

  async updateItemQuantity(cartItemId, quantity) {
    let result!: Cart;
    writeMockDb((draft) => {
      if (quantity <= 0) {
        draft.cart.items = draft.cart.items.filter((i) => i.id !== cartItemId);
      } else {
        const target = draft.cart.items.find((i) => i.id === cartItemId);
        if (target) {
          const menuItem = findMenuItem(draft, target.menuItemId);
          if (
            menuItem &&
            menuItem.trackInventory &&
            quantity > menuItem.availableQuantity
          ) {
            throw new ApiError(
              "ITEM_OUT_OF_STOCK",
              `Only ${menuItem.availableQuantity} left of ${menuItem.name}.`,
              409
            );
          }
          target.quantity = quantity;
          target.lineTotalMinor =
            (target.unitBasePriceMinor + target.unitCustomizationsPriceMinor) *
            quantity;
        }
      }
      if (draft.cart.items.length === 0) {
        draft.cart.restaurantId = null;
        draft.cart.appliedCouponCode = null;
      }
      result = buildCartResponse(draft);
    });
    return result;
  },

  async removeItem(cartItemId) {
    return this.updateItemQuantity(cartItemId, 0);
  },

  async clearCart() {
    let result!: Cart;
    writeMockDb((draft) => {
      draft.cart = {
        restaurantId: null,
        items: [],
        appliedCouponCode: null,
        tipAmountMinor: 0,
        specialInstructions: "",
      };
      result = buildCartResponse(draft);
    });
    return result;
  },

  async applyCoupon(code) {
    let result!: Cart;
    writeMockDb((draft) => {
      const normalized = code.trim().toUpperCase();
      const coupon = draft.coupons.find(
        (c) => c.code.toUpperCase() === normalized && c.isActive
      );
      if (!coupon) {
        throw new ApiError(
          "INVALID_COUPON",
          "Promo code is invalid or expired.",
          400
        );
      }
      const tempCart = buildCartResponse(draft);
      if (tempCart.breakdown.itemSubtotalMinor < coupon.minOrderSubtotalMinor) {
        throw new ApiError(
          "INVALID_COUPON",
          `Minimum subtotal of ${formatMinor(coupon.minOrderSubtotalMinor, tempCart.currency)} required for ${coupon.code}.`,
          400
        );
      }
      draft.cart.appliedCouponCode = coupon.code;
      result = buildCartResponse(draft);
    });
    return result;
  },

  async removeCoupon() {
    let result!: Cart;
    writeMockDb((draft) => {
      draft.cart.appliedCouponCode = null;
      result = buildCartResponse(draft);
    });
    return result;
  },

  async setTip(tipAmountMinor) {
    let result!: Cart;
    writeMockDb((draft) => {
      draft.cart.tipAmountMinor = Math.max(0, tipAmountMinor);
      result = buildCartResponse(draft);
    });
    return result;
  },

  async setSpecialInstructions(instructions) {
    let result!: Cart;
    writeMockDb((draft) => {
      draft.cart.specialInstructions = instructions;
      result = buildCartResponse(draft);
    });
    return result;
  },

  async validateCheckout(addressId): Promise<CheckoutValidationResponse> {
    const db = readMockDb();
    if (db.cart.items.length === 0 || !db.cart.restaurantId) {
      throw new ApiError("VALIDATION_ERROR", "Your bag is empty.", 400);
    }
    const addr = db.addresses.find((a) => a.id === addressId);
    if (!addr || !addr.isServiceable) {
      throw new ApiError(
        "OUT_OF_SERVICE_AREA",
        "Selected delivery address is outside our active delivery zone.",
        400
      );
    }
    const restaurant = db.restaurants.find(
      (r) => r.id === db.cart.restaurantId
    );
    if (!restaurant || !restaurant.isAcceptingOrders) {
      throw new ApiError(
        "ORDER_STATE_CONFLICT",
        "Restaurant is currently not accepting orders.",
        409
      );
    }

    for (const item of db.cart.items) {
      const liveItem = findMenuItem(db, item.menuItemId);
      if (
        !liveItem ||
        !liveItem.isAvailable ||
        (liveItem.trackInventory && liveItem.availableQuantity < item.quantity)
      ) {
        throw new ApiError(
          "CART_PRICE_OR_AVAILABILITY_CHANGED",
          `${item.name} is no longer available in the requested quantity.`,
          409,
          { itemId: item.menuItemId, name: item.name }
        );
      }
    }

    const cart = buildCartResponse(db);
    return {
      isValid: true,
      pricingQuoteHash: `quote-${cart.breakdown.totalPayableMinor}-${cart.items.length}`,
      cart,
    };
  },
};

export const mockOrderService: IOrderService = {
  async createOrder(payload) {
    let createdOrder!: Order;
    let createdPayment!: PaymentRecord;

    writeMockDb((draft) => {
      const user = requireUser(draft);
      const idempKey = `${user.id}:${payload.idempotencyKey}`;
      const cached = draft.idempotencyCache[idempKey];
      if (cached) {
        const existingOrder = draft.orders.find((o) => o.id === cached.orderId);
        const existingPay = draft.payments.find(
          (p) => p.id === cached.paymentId
        );
        if (existingOrder && existingPay) {
          createdOrder = existingOrder;
          createdPayment = existingPay;
          return;
        }
      }

      if (draft.cart.items.length === 0 || !draft.cart.restaurantId) {
        throw new ApiError("VALIDATION_ERROR", "Your bag is empty.", 400);
      }

      const addr = draft.addresses.find((a) => a.id === payload.deliveryAddressId);
      if (!addr || !addr.isServiceable) {
        throw new ApiError(
          "OUT_OF_SERVICE_AREA",
          "Delivery address is outside our service zone.",
          400
        );
      }

      const restaurant = draft.restaurants.find(
        (r) => r.id === draft.cart.restaurantId
      )!;
      if (!restaurant.isAcceptingOrders) {
        throw new ApiError(
          "ORDER_STATE_CONFLICT",
          `${restaurant.name} is not accepting orders right now.`,
          409
        );
      }
      if (
        restaurant.maxConcurrentOrders &&
        (restaurant.activeOrdersCount ?? 0) >= restaurant.maxConcurrentOrders
      ) {
        throw new ApiError(
          "ORDER_STATE_CONFLICT",
          `${restaurant.name} is currently at maximum kitchen capacity (${restaurant.maxConcurrentOrders} active orders). Please try again shortly.`,
          409
        );
      }

      // Lock & decrement inventory atomically
      for (const item of draft.cart.items) {
        const liveItem = findMenuItem(draft, item.menuItemId);
        if (
          !liveItem ||
          !liveItem.isAvailable ||
          (liveItem.trackInventory && liveItem.availableQuantity < item.quantity)
        ) {
          throw new ApiError(
            "ITEM_OUT_OF_STOCK",
            `${item.name} is sold out.`,
            409
          );
        }
        if (liveItem.trackInventory) {
          liveItem.availableQuantity -= item.quantity;
          if (liveItem.availableQuantity === 0) liveItem.isAvailable = false;
        }
      }

      const cart = buildCartResponse(draft);
      const orderId = uuid("ord");
      const paymentId = uuid("pay");
      const createdAt = nowIso();
      const deferred =
        payload.paymentMethod === "ONLINE" && Boolean(payload.deferOnlineCapture);
      const paymentSucceeded = !deferred && !payload.simulatePaymentFailure;
      const acceptTimeoutSec = draft.commissionConfig.acceptanceTimeoutSeconds || 300;
      const acceptDeadlineAt = new Date(Date.now() + acceptTimeoutSec * 1000).toISOString();

      if (paymentSucceeded) {
        restaurant.activeOrdersCount = (restaurant.activeOrdersCount ?? 0) + 1;
      }

      createdOrder = {
        id: orderId,
        orderNumber: generateOrderNumber(),
        customerId: user.id,
        customerName: user.fullName,
        customerPhone: user.phone,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        restaurantAddress: `${restaurant.addressLine1}, ${restaurant.city}, ${restaurant.state}`,
        pickupLocation: restaurant.location,
        deliveryAddressSnapshot: addr,
        deliveryLocation: addr.location,
        orderStatus: paymentSucceeded ? "CONFIRMED" : "PENDING_PAYMENT",
        paymentStatus: deferred
          ? "PENDING"
          : paymentSucceeded
            ? "CAPTURED"
            : "FAILED",
        deliveryStatus: "ASSIGNMENT_PENDING",
        paymentMethod: payload.paymentMethod,
        currency: cart.currency,
        breakdown: cart.breakdown,
        appliedCouponCode: cart.appliedCouponCode ?? undefined,
        specialInstructions: cart.specialInstructions || undefined,
        deliveryPin: "",
        otpFailedAttempts: 0,
        acceptDeadlineAt,
        ratingPromptStatus: "PENDING_DELIVERY",
        commissionRateBpsSnapshot:
          restaurant.commissionRateBps ?? draft.commissionConfig.defaultCommissionBps,
        commissionBasisSnapshot: draft.commissionConfig.commissionCalculationBasis,
        estimatedPrepMinutes: restaurant.avgPrepTimeMinutes,
        estimatedDeliveryAt: new Date(
          Date.now() + restaurant.estimatedDeliveryMax * 60000
        ).toISOString(),
        roadDistanceMeters: haversineMeters(restaurant.location, addr.location),
        items: cart.items.map((ci) => ({
          id: uuid("oi"),
          menuItemId: ci.menuItemId,
          name: ci.name,
          quantity: ci.quantity,
          unitBasePriceMinor: ci.unitBasePriceMinor,
          unitCustomizationsPriceMinor: ci.unitCustomizationsPriceMinor,
          customizations: ci.customizations,
          lineTotalMinor: ci.lineTotalMinor,
        })),
        statusHistory: [
          {
            id: uuid("hist"),
            toOrderStatus: "PENDING_PAYMENT",
            toPaymentStatus: "PENDING",
            toDeliveryStatus: "ASSIGNMENT_PENDING",
            actorRole: "CUSTOMER",
            createdAt,
          },
          ...(paymentSucceeded
            ? [
                {
                  id: uuid("hist"),
                  fromOrderStatus: "PENDING_PAYMENT" as const,
                  toOrderStatus: "CONFIRMED" as const,
                  toPaymentStatus: "CAPTURED" as const,
                  toDeliveryStatus: "ASSIGNMENT_PENDING" as const,
                  actorRole: "PAYMENT_GATEWAY",
                  createdAt,
                },
              ]
            : []),
        ],
        version: paymentSucceeded ? 2 : 1,
        createdAt,
        updatedAt: createdAt,
      };

      createdPayment = {
        id: paymentId,
        orderId,
        orderNumber: createdOrder.orderNumber,
        customerId: user.id,
        provider: payload.paymentMethod === "COD" ? "COD" : "RAZORPAY",
        providerOrderId: `order_rzp_${orderId}`,
        providerPaymentId: paymentSucceeded ? `pay_rzp_${orderId}` : undefined,
        amountMinor: cart.breakdown.totalPayableMinor,
        currency: cart.currency,
        status: deferred
          ? "INITIATED"
          : paymentSucceeded
            ? "CAPTURED"
            : "FAILED",
        paymentInstrument:
          payload.paymentMethod === "COD" ? "CASH ON DELIVERY" : "UPI / CARD ···· 4242",
        failureMessage:
          deferred || paymentSucceeded
            ? undefined
            : "Simulated UPI/card authorization declined by issuing bank.",
        reconciledAt: paymentSucceeded ? createdAt : undefined,
        createdAt,
      };

      draft.orders.unshift(createdOrder);
      draft.payments.unshift(createdPayment);
      draft.idempotencyCache[idempKey] = { orderId, paymentId };

      if (paymentSucceeded) {
        draft.cart = {
          restaurantId: null,
          items: [],
          appliedCouponCode: null,
          tipAmountMinor: 0,
          specialInstructions: "",
        };
        draft.notifications.unshift({
          id: uuid("notif"),
          userId: user.id,
          title: `Order ${createdOrder.orderNumber} Confirmed`,
          body: `${restaurant.name} has received your order.`,
          eventType: "order.confirmed",
          actionUrl: `/orders/${orderId}/track`,
          isRead: false,
          createdAt,
        });
      }
    });

    return { order: createdOrder, payment: createdPayment };
  },

  async simulateGatewayDecision(orderId, outcome, reason) {
    if (outcome === "CAPTURE") {
      return this.retryPayment(orderId);
    }
    let updatedOrder!: Order;
    let updatedPayment!: PaymentRecord;
    writeMockDb((draft) => {
      const order = draft.orders.find((o) => o.id === orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
      order.orderStatus = "PENDING_PAYMENT";
      order.paymentStatus = "FAILED";
      order.deliveryPin = "";
      order.updatedAt = nowIso();
      const payment = draft.payments.find((p) => p.orderId === orderId);
      if (payment) {
        payment.status = "FAILED";
        payment.failureMessage =
          reason ?? "Simulated UPI/card authorization declined by issuing bank.";
        updatedPayment = payment;
      }
      updatedOrder = order;
    });
    return { order: updatedOrder, payment: updatedPayment };
  },

  async retryPayment(orderId) {
    let updatedOrder!: Order;
    let updatedPayment!: PaymentRecord;

    writeMockDb((draft) => {
      const order = draft.orders.find((o) => o.id === orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
      if (order.orderStatus !== "PENDING_PAYMENT") {
        throw new ApiError(
          "ORDER_STATE_CONFLICT",
          "Order is no longer awaiting payment.",
          409
        );
      }
      const ts = nowIso();
      order.orderStatus = "CONFIRMED";
      order.paymentStatus = "CAPTURED";
      order.version += 1;
      order.updatedAt = ts;
      order.statusHistory.push({
        id: uuid("hist"),
        fromOrderStatus: "PENDING_PAYMENT",
        toOrderStatus: "CONFIRMED",
        toPaymentStatus: "CAPTURED",
        toDeliveryStatus: order.deliveryStatus,
        actorRole: "PAYMENT_GATEWAY",
        createdAt: ts,
      });

      const payment = draft.payments.find((p) => p.orderId === orderId);
      if (payment) {
        payment.status = "CAPTURED";
        payment.providerPaymentId = `ch_retry_${orderId}`;
        payment.failureMessage = undefined;
        payment.reconciledAt = ts;
        updatedPayment = payment;
      }
      draft.cart = {
        restaurantId: null,
        items: [],
        appliedCouponCode: null,
        tipAmountMinor: 0,
        specialInstructions: "",
      };
      updatedOrder = order;
    });

    return { order: updatedOrder, payment: updatedPayment };
  },

  async listMyOrders() {
    const db = readMockDb();
    const user = requireUser(db);
    return db.orders.filter((o) => o.customerId === user.id);
  },

  async getOrderById(orderId) {
    const db = readMockDb();
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
    return order;
  },

  async cancelOrder(orderId, reason) {
    let updated!: Order;
    writeMockDb((draft) => {
      const order = draft.orders.find((o) => o.id === orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
      if (
        !["PENDING_PAYMENT", "CONFIRMED", "RESTAURANT_ACCEPTED"].includes(
          order.orderStatus
        )
      ) {
        throw new ApiError(
          "CANCELLATION_NOT_ALLOWED",
          "Self-cancellation is unavailable once kitchen preparation has started. Please contact support.",
          409
        );
      }
      const ts = nowIso();
      const prev = order.orderStatus;
      order.orderStatus = "CANCELLED";
      order.deliveryStatus = "CANCELLED";
      order.version += 1;
      order.updatedAt = ts;

      // Restore inventory & decrement outlet active order count
      const rest = draft.restaurants.find((r) => r.id === order.restaurantId);
      if (rest && (rest.activeOrdersCount ?? 0) > 0) {
        rest.activeOrdersCount = Math.max(0, (rest.activeOrdersCount ?? 0) - 1);
      }
      for (const item of order.items) {
        const live = findMenuItem(draft, item.menuItemId);
        if (live && live.trackInventory) {
          live.availableQuantity += item.quantity;
          live.isAvailable = true;
        }
      }

      if (order.paymentStatus === "CAPTURED") {
        order.paymentStatus = "REFUNDED";
        const pay = draft.payments.find((p) => p.orderId === orderId);
        if (pay) {
          pay.status = "REFUNDED";
          draft.refunds.unshift({
            id: uuid("ref"),
            paymentId: pay.id,
            orderId: order.id,
            orderNumber: order.orderNumber,
            amountMinor: order.breakdown.totalPayableMinor,
            currency: order.currency,
            refundType: "FULL",
            reasonCode: "CUSTOMER_CANCELLED",
            notes: reason,
            status: "PROCESSED",
            initiatedByRole: "CUSTOMER",
            createdAt: ts,
          });
        }
      }

      order.statusHistory.push({
        id: uuid("hist"),
        fromOrderStatus: prev,
        toOrderStatus: "CANCELLED",
        toPaymentStatus: order.paymentStatus,
        toDeliveryStatus: "CANCELLED",
        actorRole: "CUSTOMER",
        reason,
        createdAt: ts,
      });
      updated = order;
    });
    return updated;
  },

  async getTrackingSnapshot(orderId): Promise<TrackingSnapshot> {
    const db = readMockDb();
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);

    const tracked = db.trackingLocations[orderId];
    const progress =
      tracked?.progress ??
      (order.deliveryStatus === "DELIVERED"
        ? 1
        : order.deliveryStatus === "OUT_FOR_DELIVERY"
          ? 0.65
          : order.deliveryStatus === "PICKED_UP"
            ? 0.45
            : order.deliveryStatus === "PARTNER_ASSIGNED"
              ? 0.2
              : 0);

    const partnerLocation = tracked?.location ?? {
      lat:
        order.pickupLocation.lat +
        (order.deliveryLocation.lat - order.pickupLocation.lat) * progress,
      lng:
        order.pickupLocation.lng +
        (order.deliveryLocation.lng - order.pickupLocation.lng) * progress,
    };

    const remaining = Math.max(
      0,
      Math.round(order.roadDistanceMeters * (1 - progress))
    );

    return {
      orderId: order.id,
      partnerId: order.partnerId,
      partnerName: order.partnerName,
      partnerLocation,
      bearingDegrees: tracked?.bearingDegrees ?? 135,
      etaMinutes: Math.max(1, Math.round((remaining / 1000) * 4)),
      distanceRemainingMeters: remaining,
      routeProgress: progress,
      updatedAt: tracked?.updatedAt ?? order.updatedAt,
    };
  },

  async submitReview(orderId, payload) {
    let created!: ReviewRecord;
    writeMockDb((draft) => {
      const user = requireUser(draft);
      const order = draft.orders.find((o) => o.id === orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
      const duplicate = draft.reviews.find((r) => r.orderId === order.id);
      if (duplicate) {
        throw new ApiError(
          "ORDER_STATE_CONFLICT",
          "You have already submitted a rating for this order.",
          409
        );
      }
      created = {
        id: uuid("rev"),
        orderId: order.id,
        restaurantId: order.restaurantId,
        customerName: user.fullName,
        foodRating: payload.foodRating,
        deliveryRating: payload.deliveryRating,
        itemRatings: payload.itemRatings,
        comment: payload.comment,
        deliveryComment: payload.deliveryComment,
        createdAt: nowIso(),
      };
      order.ratingPromptStatus = "RATED";
      draft.reviews.unshift(created);
    });
    return created;
  },

  async submitComplaint(orderId, payload) {
    let created!: ComplaintRecord;
    writeMockDb((draft) => {
      const user = requireUser(draft);
      const order = draft.orders.find((o) => o.id === orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
      created = {
        id: uuid("cmp"),
        ticketNumber: `TKT-2026-${String(draft.complaints.length + 20).padStart(3, "0")}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: user.id,
        customerName: user.fullName,
        category: payload.category,
        priority: "MEDIUM",
        status: "OPEN",
        description: payload.description,
        createdAt: nowIso(),
      };
      draft.complaints.unshift(created);
    });
    return created;
  },

  async listMyComplaints() {
    const db = readMockDb();
    const user = requireUser(db);
    return db.complaints.filter((c) => c.customerId === user.id);
  },
};

export const mockRestaurantPortalService: IRestaurantPortalService = {
  async getMyRestaurant() {
    const db = readMockDb();
    const outlets = await this.listMyOutlets();
    const activeId = db.activeOutletId;
    const restaurant =
      outlets.find((r) => r.id === activeId) ?? outlets[0];
    if (!restaurant) {
      throw new ApiError("NOT_FOUND", "No onboarded or approved outlet associated with your account.", 404);
    }
    const categories = db.categories
      .filter((c) => c.restaurantId === restaurant.id)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    return { restaurant, categories };
  },

  async listMyOutlets() {
    const db = readMockDb();
    const user = getPortalUser(db, "restaurant");
    if (!user) return [];
    return getUserAccessibleOutlets(db, user);
  },

  async switchActiveOutlet(outletId) {
    let result!: RestaurantWithMenu;
    writeMockDb((draft) => {
      const user = requireUser(draft, "restaurant");
      const allowed = getUserAccessibleOutlets(draft, user);
      const rest = allowed.find((r) => r.id === outletId);
      if (!rest) {
        throw new ApiError("FORBIDDEN", "You do not have active access to this outlet.", 403);
      }
      draft.activeOutletId = outletId;
      user.restaurantId = outletId;
      const categories = draft.categories
        .filter((c) => c.restaurantId === rest.id)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      result = { restaurant: rest, categories };
    });
    return result;
  },

  async updateOutletCapacity(maxConcurrentOrders) {
    let updated!: Restaurant;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const rest = draft.restaurants.find((r) => r.id === restId);
      if (!rest) throw new ApiError("NOT_FOUND", "Restaurant not found.", 404);
      rest.maxConcurrentOrders =
        maxConcurrentOrders === null ? null : Math.max(1, maxConcurrentOrders);
      updated = rest;
    });
    return updated;
  },

  async inviteBranchStaff(payload) {
    let created!: OutletStaffMember;
    writeMockDb((draft) => {
      const user = requireUser(draft, "restaurant");
      const targets =
        payload.outletIds && payload.outletIds.length > 0
          ? Array.from(new Set(payload.outletIds))
          : [payload.outletId || resolveActiveOutletId(draft)];
      const normEmail = payload.email?.trim().toLowerCase() ?? "";
      const normPhone = payload.phone?.trim() ?? "";
      if (!normEmail && !normPhone) {
        throw new ApiError("VALIDATION_ERROR", "Email or contact number is required.", 400);
      }
      const matchedUser = draft.users.find(
        (u) =>
          (normEmail && u.email.toLowerCase() === normEmail) ||
          (normPhone && u.phone === normPhone)
      );
      const customRole = payload.outletRoleId
        ? draft.outletRoles.find((r) => r.id === payload.outletRoleId && r.ownerUserId === user.id)
        : undefined;
      const perms =
        payload.permissions && payload.permissions.length > 0
          ? payload.permissions
          : customRole?.permissions ?? ["outlet:orders:manage"];

      for (const targetId of targets) {
        const rest = draft.restaurants.find((r) => r.id === targetId);
        if (!rest) throw new ApiError("NOT_FOUND", "Restaurant not found.", 404);
        const member: OutletStaffMember = {
          id: uuid("staff"),
          outletId: rest.id,
          outletName: rest.name,
          brandName: rest.brandName || rest.name,
          branchName: rest.branchName || "",
          userId: matchedUser?.id,
          fullName: payload.fullName || matchedUser?.fullName || "Invited Member",
          email: normEmail || matchedUser?.email || "",
          phone: normPhone || matchedUser?.phone || "",
          roleCode: customRole ? "CUSTOM" : payload.roleCode || "OUTLET_STAFF",
          outletRoleId: customRole?.id,
          outletRoleName: customRole?.name,
          permissions: perms,
          status: "PENDING_ACCEPTANCE",
        };
        if (!rest.staffMembers) rest.staffMembers = [];
        rest.staffMembers.unshift(member);
        if (!created) created = member;
      }
    });
    return created;
  },

  async listBranchStaff(outletId) {
    const db = readMockDb();
    const user = requireUser(db, "restaurant");
    const allowed = getUserAccessibleOutlets(db, user);
    if (outletId === "all") {
      return allowed.flatMap((rest) =>
        (rest.staffMembers ?? []).map((m) => ({
          ...m,
          outletName: m.outletName ?? rest.name,
          brandName: m.brandName ?? rest.brandName ?? rest.name,
          branchName: m.branchName ?? rest.branchName ?? "",
        }))
      );
    }
    const restId = outletId || resolveActiveOutletId(db);
    if (!allowed.some((r) => r.id === restId)) {
      throw new ApiError("FORBIDDEN", "You do not have active access to this outlet.", 403);
    }
    const rest = db.restaurants.find((r) => r.id === restId);
    return (rest?.staffMembers ?? []).map((m) => ({
      ...m,
      outletName: m.outletName ?? rest?.name,
      brandName: m.brandName ?? rest?.brandName ?? rest?.name,
      branchName: m.branchName ?? rest?.branchName ?? "",
    }));
  },

  async approveBranchStaff(outletId, assignmentId) {
    let updated!: OutletStaffMember;
    writeMockDb((draft) => {
      const rest = draft.restaurants.find((r) => r.id === outletId);
      const member = rest?.staffMembers?.find((m) => m.id === assignmentId);
      if (!member) throw new ApiError("NOT_FOUND", "Staff invitation not found.", 404);
      if (member.status === "PENDING_ACCEPTANCE" || member.status === "INVITED") {
        throw new ApiError(
          "APPROVAL_BLOCKED",
          "Invitee must accept the invitation before admin/owner approval.",
          400
        );
      }
      member.status = "ACTIVE";
      member.approvedAt = nowIso();
      if (member.userId) {
        const u = draft.users.find((x) => x.id === member.userId);
        if (u) {
          if (!u.roles.includes("OUTLET_STAFF") && !u.roles.includes("BRANCH_MANAGER")) {
            u.roles.push(member.roleCode === "BRANCH_MANAGER" ? "BRANCH_MANAGER" : "OUTLET_STAFF");
          }
          if (!u.restaurantId) u.restaurantId = outletId;
        }
      }
      updated = member;
    });
    return updated;
  },

  async revokeBranchStaff(outletId, assignmentId) {
    writeMockDb((draft) => {
      const rest = draft.restaurants.find((r) => r.id === outletId);
      const member = rest?.staffMembers?.find((m) => m.id === assignmentId);
      if (member) member.status = "REVOKED";
    });
  },

  async listOutletRoles() {
    const db = readMockDb();
    resolveActiveOutletId(db);
    const user = requireUser(db, "restaurant");
    return db.outletRoles.filter((r) => r.ownerUserId === user.id);
  },

  async createOutletRole(payload) {
    let created!: OutletRoleDefinition;
    writeMockDb((draft) => {
      resolveActiveOutletId(draft);
      const user = requireUser(draft, "restaurant");
      created = {
        id: uuid("orole"),
        ownerUserId: user.id,
        name: payload.name,
        description: payload.description ?? "",
        permissions: payload.permissions,
      };
      draft.outletRoles.push(created);
    });
    return created;
  },

  async updateOutletRole(roleId, payload) {
    let updated!: OutletRoleDefinition;
    writeMockDb((draft) => {
      const user = requireUser(draft, "restaurant");
      const role = draft.outletRoles.find((r) => r.id === roleId && r.ownerUserId === user.id);
      if (!role) throw new ApiError("NOT_FOUND", "Outlet role not found.", 404);
      if (payload.name) role.name = payload.name;
      if (payload.description !== undefined) role.description = payload.description;
      role.permissions = payload.permissions;
      for (const rest of draft.restaurants) {
        for (const s of rest.staffMembers ?? []) {
          if (s.outletRoleId === roleId) {
            s.permissions = payload.permissions;
            s.outletRoleName = role.name;
          }
        }
      }
      updated = role;
    });
    return updated;
  },

  async listServiceZones() {
    const db = readMockDb();
    return db.zones.filter((z) => z.isActive);
  },

  async getOwnerProfile() {
    const db = readMockDb();
    const user = requireUser(db, "restaurant");
    const found = (db.ownerProfiles ?? []).find((p) => p.userId === user.id);
    if (found) {
      return found;
    }
    return {
      id: "",
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      idDocumentType: "PAN_CARD",
      idDocumentNumber: "",
      verificationStatus: "NOT_SUBMITTED",
    };
  },

  async submitOwnerProfile(payload) {
    let saved!: RestaurantOwnerProfile;
    writeMockDb((draft) => {
      const user = requireUser(draft, "restaurant");
      if (!user.roles.includes("OUTLET_OWNER")) {
        user.roles.push("OUTLET_OWNER");
      }
      if (!draft.ownerProfiles) draft.ownerProfiles = [];
      const existing = draft.ownerProfiles.find((p) => p.userId === user.id);
      if (existing) {
        existing.organizationName = payload.organizationName?.trim() || undefined;
        existing.idDocumentType = payload.idDocumentType;
        existing.idDocumentNumber = payload.idDocumentNumber.trim();
        if (payload.idDocumentFilename) {
          existing.idDocumentFilename = payload.idDocumentFilename;
        }
        existing.verificationStatus = "PENDING_REVIEW";
        existing.reviewNotes = undefined;
        saved = existing;
      } else {
        saved = {
          id: uuid("owner-prof"),
          userId: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          organizationName: payload.organizationName?.trim() || undefined,
          idDocumentType: payload.idDocumentType,
          idDocumentNumber: payload.idDocumentNumber.trim(),
          idDocumentFilename: payload.idDocumentFilename || "demo-id-upload.pdf",
          verificationStatus: "PENDING_REVIEW",
          createdAt: nowIso(),
        };
        draft.ownerProfiles.unshift(saved);
      }
    });
    return saved;
  },

  async submitOnboarding(payload) {
    let created!: Restaurant;
    writeMockDb((draft) => {
      const user = requireUser(draft, "restaurant");
      const ownerProf = (draft.ownerProfiles ?? []).find((p) => p.userId === user.id);
      if (!ownerProf || ownerProf.verificationStatus !== "APPROVED") {
        throw new ApiError(
          "OWNER_KYC_REQUIRED",
          "Only verified restaurant owners can add outlets. Complete Owner Profile & ID KYC and await admin approval.",
          403
        );
      }
      const outletGroup = (payload.brandName || payload.name).trim();
      if (payload.setupType !== "ADD_BRANCH") {
        const duplicate = draft.restaurants.some(
          (r) =>
            r.ownerUserId === user.id &&
            (r.brandName || r.name).trim().toLowerCase() === outletGroup.toLowerCase()
        );
        if (duplicate) {
          throw new ApiError(
            "DUPLICATE_OUTLET_NAME",
            "An outlet with this name already exists under your account. Add a branch location instead.",
            409
          );
        }
      }
      if (!user.roles.includes("OUTLET_OWNER")) {
        user.roles.push("OUTLET_OWNER");
      }
      created = {
        id: uuid("rest"),
        ownerUserId: user.id,
        brandName: outletGroup,
        branchName: payload.branchName || "Main Location",
        serviceZoneId: payload.serviceZoneId || "zone-brooklyn",
        slug: payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: payload.name,
        eyebrow: "NEW NEIGHBORHOOD PARTNER",
        tagline: "Fresh from our kitchen",
        description: `${payload.name} onboarding application`,
        cuisines: payload.cuisines,
        categoryFilterKeys: ["italian"],
        phone: payload.phone,
        email: payload.email,
        addressLine1: payload.addressLine1,
        city: payload.city,
        state: payload.state,
        postalCode: payload.postalCode,
        location: { lat: 12.9784, lng: 77.6408 },
        maxDeliveryRadiusMeters: 7000,
        heroImageUrl: "/images/sunday-table.jpg",
        cardImageUrl: "/images/sunday-table.jpg",
        verificationStatus: "PENDING_REVIEW",
        isActive: true,
        isAcceptingOrders: false,
        maxConcurrentOrders: 15,
        activeOrdersCount: 0,
        avgPrepTimeMinutes: 20,
        estimatedDeliveryMin: 20,
        estimatedDeliveryMax: 30,
        deliveryFeeMinor: 2900,
        minOrderAmountMinor: 29900,
        packagingFeeMinor: 2000,
        commissionRateBps: 2000,
        currency: "INR",
        ratingAverage: 5.0,
        ratingCount: 0,
        operatingHours: [],
        documents: [
          {
            id: uuid("doc"),
            documentType: "FSSAI_LICENSE",
            documentNumber: payload.licenseNumber,
            status: "PENDING",
          },
        ],
      };
      draft.restaurants.push(created);
      user.restaurantId = created.id;
      draft.activeOutletId = created.id;
    });
    return created;
  },

  async toggleAcceptingOrders(isAccepting) {
    let updated!: Restaurant;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const rest = draft.restaurants.find((r) => r.id === restId);
      if (!rest) throw new ApiError("NOT_FOUND", "Restaurant not found.", 404);
      if (isAccepting && rest.verificationStatus !== "APPROVED") {
        throw new ApiError(
          "FORBIDDEN",
          "Restaurant must be verified by an Administrator before going online.",
          403
        );
      }
      rest.isAcceptingOrders = isAccepting;
      updated = rest;
    });
    return updated;
  },

  async updateOperatingHours(hours) {
    let updated!: Restaurant;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const rest = draft.restaurants.find((r) => r.id === restId);
      if (!rest) throw new ApiError("NOT_FOUND", "Restaurant not found.", 404);
      rest.operatingHours = hours;
      updated = rest;
    });
    return updated;
  },

  async createCategory(payload) {
    let created!: MenuCategory;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      created = {
        id: uuid("cat"),
        restaurantId: restId,
        name: payload.name,
        subtitle: payload.subtitle,
        displayOrder:
          draft.categories.filter((c) => c.restaurantId === restId).length + 1,
        isActive: true,
        items: [],
      };
      draft.categories.push(created);
    });
    return created;
  },

  async upsertMenuItem(payload) {
    let saved!: MenuItem;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const cat = draft.categories.find((c) => c.id === payload.categoryId);
      if (!cat) throw new ApiError("NOT_FOUND", "Category not found.", 404);

      if (payload.id) {
        const existing = cat.items.find((i) => i.id === payload.id);
        if (existing) {
          Object.assign(existing, payload);
          saved = existing;
          return;
        }
      }
      saved = {
        id: uuid("item"),
        restaurantId: restId,
        categoryId: payload.categoryId,
        name: payload.name,
        description: payload.description ?? "",
        badgeLabel: payload.badgeLabel,
        vegClassification: payload.vegClassification ?? "VEG",
        dietaryTags: payload.dietaryTags ?? [],
        cuisineType: payload.cuisineType,
        spiceLevel: payload.spiceLevel ?? "NONE",
        caloriesKcal: payload.caloriesKcal,
        servingSize: payload.servingSize,
        prepTimeMinutes: payload.prepTimeMinutes,
        ingredients: payload.ingredients ?? [],
        allergens: payload.allergens ?? [],
        searchKeywords: payload.searchKeywords ?? [],
        isRecommended: Boolean(payload.isRecommended),
        basePriceMinor: payload.basePriceMinor,
        currency: "INR",
        imageUrl: payload.imageUrl ?? "/images/sunday-table.jpg",
        isAvailable: payload.isAvailable ?? true,
        isActive: true,
        trackInventory: payload.trackInventory ?? false,
        availableQuantity: payload.availableQuantity ?? 25,
        customizationGroups: payload.customizationGroups ?? [],
      };
      cat.items.push(saved);
    });
    return saved;
  },

  async toggleMenuItemAvailability(itemId, isAvailable) {
    let updated!: MenuItem;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const item = findMenuItem(draft, itemId);
      if (!item || item.restaurantId !== restId) {
        throw new ApiError("FORBIDDEN", "Menu item not accessible for your active outlet.", 403);
      }
      item.isAvailable = isAvailable;
      if (isAvailable && item.trackInventory && item.availableQuantity === 0) {
        item.availableQuantity = 10;
      }
      updated = item;
    });
    return updated;
  },

  async listRestaurantOrders() {
    const db = readMockDb();
    const restId = resolveActiveOutletId(db);
    return db.orders.filter((o) => o.restaurantId === restId);
  },

  async acceptOrder(orderId, estimatedPrepMinutes) {
    let updated!: Order;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const order = draft.orders.find((o) => o.id === orderId && o.restaurantId === restId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found for your active outlet.", 404);
      if (order.orderStatus !== "CONFIRMED") {
        throw new ApiError(
          "ORDER_STATE_CONFLICT",
          `Cannot accept order from state ${order.orderStatus}.`,
          409
        );
      }
      const ts = nowIso();
      order.orderStatus = "RESTAURANT_ACCEPTED";
      order.estimatedPrepMinutes = estimatedPrepMinutes;
      order.deliveryStatus = "PARTNER_OFFERED";
      order.version += 1;
      order.updatedAt = ts;
      order.statusHistory.push({
        id: uuid("hist"),
        fromOrderStatus: "CONFIRMED",
        toOrderStatus: "RESTAURANT_ACCEPTED",
        toPaymentStatus: order.paymentStatus,
        toDeliveryStatus: "PARTNER_OFFERED",
        actorRole: "OUTLET_OWNER",
        createdAt: ts,
      });

      // Simultaneous Broadcast Dispatch: send offer to ALL eligible online approved partners
      const eligiblePartners = draft.partners.filter(
        (p) =>
          p.verificationStatus === "APPROVED" &&
          p.availabilityStatus === "ONLINE_AVAILABLE"
      );
      if (eligiblePartners.length > 0) {
        const expiresAt = new Date(Date.now() + 45000).toISOString();
        const estimatedPayoutMinor =
          draft.commissionConfig.partnerBasePayoutMinor +
          Math.round(
            (order.roadDistanceMeters / 1000) *
              draft.commissionConfig.partnerPerKmPayoutMinor
          ) +
          order.breakdown.tipAmountMinor;

        for (const partner of eligiblePartners) {
          draft.offers.unshift({
            assignmentId: uuid("asgn"),
            orderId: order.id,
            orderNumber: order.orderNumber,
            partnerId: partner.id,
            restaurantName: order.restaurantName,
            pickupAddress: order.restaurantAddress,
            dropoffNeighborhood: `${order.deliveryAddressSnapshot.city}, ${order.deliveryAddressSnapshot.postalCode}`,
            distanceToPickupMeters: haversineMeters(
              partner.lastKnownLocation,
              order.pickupLocation
            ),
            totalTripMeters: order.roadDistanceMeters,
            estimatedPayoutMinor,
            currency: order.currency,
            expiresAt,
            status: "OFFERED",
          });
        }
      } else {
        order.deliveryStatus = "UNASSIGNABLE";
      }

      updated = order;
    });
    return updated;
  },

  async rejectOrder(orderId, reason) {
    let updated!: Order;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const order = draft.orders.find((o) => o.id === orderId && o.restaurantId === restId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found for your active outlet.", 404);
      if (order.orderStatus !== "CONFIRMED") {
        throw new ApiError(
          "ORDER_STATE_CONFLICT",
          "Only confirmed incoming orders can be rejected.",
          409
        );
      }
      const ts = nowIso();
      order.orderStatus = "CANCELLED";
      order.deliveryStatus = "CANCELLED";
      order.paymentStatus =
        order.paymentStatus === "CAPTURED" ? "REFUNDED" : order.paymentStatus;
      order.version += 1;
      order.updatedAt = ts;

      const rest = draft.restaurants.find((r) => r.id === order.restaurantId);
      if (rest && (rest.activeOrdersCount ?? 0) > 0) {
        rest.activeOrdersCount = Math.max(0, (rest.activeOrdersCount ?? 0) - 1);
      }

      const pay = draft.payments.find((p) => p.orderId === orderId);
      if (pay && pay.status === "CAPTURED") {
        pay.status = "REFUNDED";
        draft.refunds.unshift({
          id: uuid("ref"),
          paymentId: pay.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          amountMinor: order.breakdown.totalPayableMinor,
          currency: order.currency,
          refundType: "FULL",
          reasonCode: "RESTAURANT_REJECTED",
          notes: reason,
          status: "PROCESSED",
          initiatedByRole: "OUTLET_OWNER",
          createdAt: ts,
        });
      }

      order.statusHistory.push({
        id: uuid("hist"),
        fromOrderStatus: "CONFIRMED",
        toOrderStatus: "CANCELLED",
        toPaymentStatus: order.paymentStatus,
        toDeliveryStatus: "CANCELLED",
        actorRole: "OUTLET_OWNER",
        reason,
        createdAt: ts,
      });
      updated = order;
    });
    return updated;
  },

  async advanceOrderStatus(orderId, nextStatus) {
    let updated!: Order;
    writeMockDb((draft) => {
      const restId = resolveActiveOutletId(draft);
      const order = draft.orders.find((o) => o.id === orderId && o.restaurantId === restId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found for your active outlet.", 404);
      const valid =
        (order.orderStatus === "RESTAURANT_ACCEPTED" &&
          nextStatus === "PREPARING") ||
        (order.orderStatus === "PREPARING" && nextStatus === "READY_FOR_PICKUP");
      if (!valid) {
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          `Invalid transition from ${order.orderStatus} to ${nextStatus}.`,
          409
        );
      }
      const ts = nowIso();
      const prev = order.orderStatus;
      order.orderStatus = nextStatus;
      order.version += 1;
      order.updatedAt = ts;
      order.statusHistory.push({
        id: uuid("hist"),
        fromOrderStatus: prev,
        toOrderStatus: nextStatus,
        toPaymentStatus: order.paymentStatus,
        toDeliveryStatus: order.deliveryStatus,
        actorRole: "OUTLET_OWNER",
        createdAt: ts,
      });
      updated = order;
    });
    return updated;
  },

  async getSettlementsAndReviews() {
    const db = readMockDb();
    const restId = resolveActiveOutletId(db);
    return {
      settlements: db.settlements.filter((s) => s.restaurantId === restId),
      reviews: db.reviews.filter((r) => r.restaurantId === restId),
      penalties: db.penalties.filter((p) => p.outletId === restId),
    };
  },

  async replyToReview(reviewId, reply) {
    let updated!: ReviewRecord;
    writeMockDb((draft) => {
      const rev = draft.reviews.find((r) => r.id === reviewId);
      if (!rev) throw new ApiError("NOT_FOUND", "Review not found.", 404);
      rev.restaurantReply = reply;
      updated = rev;
    });
    return updated;
  },
};

export const mockDeliveryPortalService: IDeliveryPortalService = {
  async getMyPartnerProfile(): Promise<DeliveryPartnerWithStatus> {
    const db = readMockDb();
    const user = requireUser(db, "delivery");
    const partner = user.partnerId
      ? db.partners.find((p) => p.id === user.partnerId)
      : db.partners.find((p) => p.userId === user.id);
    if (!partner) {
      return {
        id: "unonboarded",
        userId: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        serviceZoneId: "zone-brooklyn",
        vehicleType: "SCOOTER",
        vehicleModel: "",
        licensePlate: "",
        verificationStatus: "NOT_SUBMITTED",
        availabilityStatus: "OFFLINE",
        activeDeliveriesCount: 0,
        lastKnownLocation: { lat: 12.9784, lng: 77.6408 },
        ratingAverage: 5.0,
        totalDeliveriesCount: 0,
        onboarded: false,
        canReceiveOrders: false,
        warningMessage: "You are not receiving orders due to onboarding verification pending",
      };
    }
    const canReceive = partner.verificationStatus === "APPROVED";
    return {
      ...partner,
      onboarded: true,
      canReceiveOrders: canReceive,
      warningMessage: canReceive
        ? undefined
        : "You are not receiving orders due to onboarding verification pending",
    };
  },

  async submitOnboarding(payload) {
    let updated!: DeliveryPartner;
    writeMockDb((draft) => {
      const user = requireUser(draft, "delivery");
      updated = {
        id: uuid("partner"),
        userId: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        serviceZoneId: "zone-brooklyn",
        vehicleType: payload.vehicleType,
        vehicleModel: payload.vehicleModel,
        licensePlate: payload.licensePlate,
        verificationStatus: "PENDING_REVIEW",
        availabilityStatus: "OFFLINE",
        activeDeliveriesCount: 0,
        lastKnownLocation: { lat: 12.9784, lng: 77.6408 },
        ratingAverage: 5.0,
        totalDeliveriesCount: 0,
        documents: [
          { id: uuid("pdoc"), documentType: "DRIVERS_LICENSE", status: "PENDING" },
        ],
      };
      draft.partners.push(updated);
      user.partnerId = updated.id;
    });
    return updated;
  },

  async toggleAvailability(status, location) {
    let updated!: DeliveryPartner;
    writeMockDb((draft) => {
      const user = requireUser(draft, "delivery");
      const partnerId = user.partnerId ?? "partner-devon";
      const partner = draft.partners.find((p) => p.id === partnerId || p.userId === user.id);
      if (!partner) throw new ApiError("NOT_FOUND", "Partner onboarding required first.", 404);
      if (status === "ONLINE_AVAILABLE" && partner.verificationStatus !== "APPROVED") {
        throw new ApiError(
          "FORBIDDEN",
          "Account must be verified by Admin before going online.",
          403
        );
      }
      partner.availabilityStatus = status;
      if (location) partner.lastKnownLocation = location;
      updated = partner;
    });
    return updated;
  },

  async getPendingOffers() {
    const db = readMockDb();
    const user = requireUser(db, "delivery");
    const partner = db.partners.find((p) => p.id === user.partnerId || p.userId === user.id);
    if (!partner || partner.verificationStatus !== "APPROVED") {
      return [];
    }
    return db.offers.filter(
      (o) =>
        o.status === "OFFERED" &&
        (!o.partnerId || o.partnerId === partner.id)
    );
  },

  async acceptOffer(assignmentId) {
    let updatedOrder!: Order;
    writeMockDb((draft) => {
      const user = requireUser(draft, "delivery");
      const offer = draft.offers.find((o) => o.assignmentId === assignmentId);
      if (!offer || offer.status !== "OFFERED") {
        throw new ApiError(
          "OFFER_EXPIRED_OR_TAKEN",
          "This delivery offer has expired or was already claimed.",
          409
        );
      }
      const order = draft.orders.find((o) => o.id === offer.orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
      if (order.partnerId) {
        throw new ApiError(
          "OFFER_EXPIRED_OR_TAKEN",
          "Another delivery partner has already claimed this order.",
          409
        );
      }

      const partnerId = offer.partnerId ?? user.partnerId ?? "partner-devon";
      const partner = draft.partners.find((p) => p.id === partnerId || p.userId === user.id)!;

      const ts = nowIso();
      offer.status = "ACCEPTED";
      // Expire all sibling broadcast offers for the same order atomically
      draft.offers.forEach((other) => {
        if (
          other.orderId === order.id &&
          other.assignmentId !== offer.assignmentId &&
          other.status === "OFFERED"
        ) {
          other.status = "SUPERSEDED";
        }
      });

      partner.availabilityStatus = "ON_DELIVERY";
      partner.activeDeliveriesCount = 1;

      order.partnerId = partner.id;
      order.partnerName = partner.fullName;
      order.partnerPhone = partner.phone;
      order.partnerVehicle = `${partner.vehicleModel} (${partner.vehicleType})`;
      order.deliveryStatus = "PARTNER_ASSIGNED";
      order.version += 1;
      order.updatedAt = ts;
      order.statusHistory.push({
        id: uuid("hist"),
        fromOrderStatus: order.orderStatus,
        toOrderStatus: order.orderStatus,
        toPaymentStatus: order.paymentStatus,
        toDeliveryStatus: "PARTNER_ASSIGNED",
        actorRole: "DELIVERY_PARTNER",
        createdAt: ts,
      });
      updatedOrder = order;
    });
    return updatedOrder;
  },

  async rejectOffer(assignmentId) {
    writeMockDb((draft) => {
      const offer = draft.offers.find((o) => o.assignmentId === assignmentId);
      if (offer && offer.status === "OFFERED") {
        offer.status = "REJECTED";
        const order = draft.orders.find((o) => o.id === offer.orderId);
        const remainingOffers = draft.offers.some(
          (o) => o.orderId === offer.orderId && o.status === "OFFERED"
        );
        if (order && !order.partnerId && !remainingOffers) {
          order.deliveryStatus = "UNASSIGNABLE";
        }
      }
    });
  },

  async getActiveDelivery() {
    const db = readMockDb();
    const user = requireUser(db, "delivery");
    const partnerId = user.partnerId ?? "partner-devon";
    return (
      db.orders.find(
        (o) =>
          o.partnerId === partnerId &&
          !["DELIVERED", "CANCELLED"].includes(o.orderStatus)
      ) ?? null
    );
  },

  async getDeliveryOrder(orderId) {
    const db = readMockDb();
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
    return order;
  },

  async updateDeliveryProgress(orderId, nextStatus, pin) {
    let updated!: Order;
    writeMockDb((draft) => {
      const order = draft.orders.find((o) => o.id === orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);

      if (nextStatus === "ARRIVED_AT_CUSTOMER") {
        const isOnlinePaid =
          order.paymentMethod === "ONLINE" &&
          ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus);
        if (isOnlinePaid) {
          if (!order.deliveryPin) {
            order.deliveryPin = String(Math.floor(1000 + Math.random() * 9000));
          }
        } else {
          order.deliveryPin = "";
        }
      }

      if (nextStatus === "DELIVERED") {
        if (order.paymentMethod === "ONLINE") {
          if (!order.deliveryPin) {
            throw new ApiError(
              "ORDER_STATE_CONFLICT",
              "Mark arrived at customer location first to generate delivery OTP.",
              409
            );
          }
          if (order.otpVerifiedAt) {
            throw new ApiError(
              "ORDER_STATE_CONFLICT",
              "Delivery OTP has already been verified and consumed for this order.",
              409
            );
          }
          if (
            order.otpRateLimitedUntil &&
            new Date(order.otpRateLimitedUntil).getTime() > Date.now()
          ) {
            throw new ApiError(
              "INVALID_DELIVERY_PIN",
              "Too many incorrect OTP attempts. Please wait 5 minutes or contact Customer Care.",
              429
            );
          }
          if (pin !== order.deliveryPin) {
            const attempts = (order.otpFailedAttempts ?? 0) + 1;
            order.otpFailedAttempts = attempts;
            if (attempts >= 3) {
              order.otpRateLimitedUntil = new Date(
                Date.now() + 5 * 60 * 1000
              ).toISOString();
            }
            throw new ApiError(
              "INVALID_DELIVERY_PIN",
              attempts >= 3
                ? "3 incorrect OTP attempts. OTP verification locked for 5 minutes."
                : `Incorrect 4-digit customer delivery OTP (${3 - attempts} attempt(s) remaining).`,
              attempts >= 3 ? 429 : 400
            );
          }
        }
      }

      const ts = nowIso();
      order.deliveryStatus = nextStatus;
      if (nextStatus === "PICKED_UP" || nextStatus === "OUT_FOR_DELIVERY") {
        order.orderStatus = "OUT_FOR_DELIVERY";
      } else if (nextStatus === "DELIVERED") {
        order.orderStatus = "DELIVERED";
        order.otpVerifiedAt = ts;
        order.ratingPromptStatus = "ELIGIBLE_ON_APP_OPEN";
        const partner = draft.partners.find((p) => p.id === order.partnerId);
        if (partner) {
          partner.availabilityStatus = "ONLINE_AVAILABLE";
          partner.activeDeliveriesCount = 0;
          partner.totalDeliveriesCount += 1;
        }
        // Decrement outlet active order count & record 20% commission settlement
        const rest = draft.restaurants.find((r) => r.id === order.restaurantId);
        if (rest && (rest.activeOrdersCount ?? 0) > 0) {
          rest.activeOrdersCount = Math.max(0, (rest.activeOrdersCount ?? 0) - 1);
        }
        const commBps =
          order.commissionRateBpsSnapshot ??
          rest?.commissionRateBps ??
          draft.commissionConfig.defaultCommissionBps;
        const commBasis =
          order.commissionBasisSnapshot ??
          draft.commissionConfig.commissionCalculationBasis;
        const commissionableAmount =
          commBasis === "SUBTOTAL_PLUS_PACKAGING"
            ? order.breakdown.itemSubtotalMinor + order.breakdown.packagingFeeMinor
            : commBasis === "NET_AFTER_OUTLET_DISCOUNT"
              ? Math.max(
                  0,
                  order.breakdown.itemSubtotalMinor -
                    order.breakdown.discountAmountMinor
                )
              : order.breakdown.itemSubtotalMinor;
        const commMinor = Math.round((commissionableAmount * commBps) / 10000);
        draft.settlements.unshift({
          id: uuid("settle"),
          orderId: order.id,
          orderNumber: order.orderNumber,
          restaurantId: order.restaurantId,
          grossFoodAmountMinor: order.breakdown.itemSubtotalMinor,
          packagingFeeMinor: order.breakdown.packagingFeeMinor,
          platformCommissionBps: commBps,
          platformCommissionMinor: commMinor,
          taxWithheldMinor: order.breakdown.taxAmountMinor,
          netPayoutMinor:
            order.breakdown.itemSubtotalMinor +
            order.breakdown.packagingFeeMinor -
            commMinor,
          currency: order.currency,
          settlementStatus: "ACCRUED",
          createdAt: ts,
        });

        const distPay = Math.round(
          (order.roadDistanceMeters / 1000) *
            draft.commissionConfig.partnerPerKmPayoutMinor
        );
        draft.partnerEarnings.unshift({
          id: uuid("earn"),
          orderId: order.id,
          orderNumber: order.orderNumber,
          partnerId: order.partnerId ?? "partner-devon",
          basePayoutMinor: draft.commissionConfig.partnerBasePayoutMinor,
          distancePayoutMinor: distPay,
          surgeBonusMinor: 0,
          tipAmountMinor: order.breakdown.tipAmountMinor,
          totalEarningMinor:
            draft.commissionConfig.partnerBasePayoutMinor +
            distPay +
            order.breakdown.tipAmountMinor,
          currency: order.currency,
          status: "CREDITED",
          createdAt: ts,
        });
      }

      order.version += 1;
      order.updatedAt = ts;
      order.statusHistory.push({
        id: uuid("hist"),
        fromOrderStatus: order.orderStatus,
        toOrderStatus: order.orderStatus,
        toPaymentStatus: order.paymentStatus,
        toDeliveryStatus: nextStatus,
        actorRole: "DELIVERY_PARTNER",
        createdAt: ts,
      });
      updated = order;
    });
    return updated;
  },

  async pingLocation(orderId, location, bearingDegrees) {
    writeMockDb((draft) => {
      const order = draft.orders.find((o) => o.id === orderId);
      const total = order ? Math.max(1, order.roadDistanceMeters) : 1500;
      const remaining = order
        ? haversineMeters(location, order.deliveryLocation)
        : 500;
      const progress = Math.min(0.98, Math.max(0.1, 1 - remaining / total));
      draft.trackingLocations[orderId] = {
        location,
        bearingDegrees,
        progress,
        updatedAt: nowIso(),
      };
    });
  },

  async getHistoryAndEarnings() {
    const db = readMockDb();
    const user = requireUser(db, "delivery");
    const partnerId = user.partnerId ?? "partner-devon";
    return {
      deliveries: db.orders.filter(
        (o) => o.partnerId === partnerId && o.orderStatus === "DELIVERED"
      ),
      earnings: db.partnerEarnings.filter((e) => e.partnerId === partnerId),
    };
  },
};

export const mockAdminPortalService: IAdminPortalService = {
  async getOverviewStats() {
    const db = readMockDb();
    requireAdminPermission(db, "orders:monitor");
    return {
      activeOrdersCount: db.orders.filter(
        (o) => !["DELIVERED", "CANCELLED"].includes(o.orderStatus)
      ).length,
      onlinePartnersCount: db.partners.filter(
        (p) => p.availabilityStatus !== "OFFLINE"
      ).length,
      todayGmvMinor: db.orders
        .filter((o) => o.paymentStatus === "CAPTURED")
        .reduce((s, o) => s + o.breakdown.totalPayableMinor, 0),
      pendingVerificationsCount:
        db.restaurants.filter((r) => r.verificationStatus === "PENDING_REVIEW")
          .length +
        db.partners.filter((p) => p.verificationStatus === "PENDING_REVIEW")
          .length,
      openComplaintsCount: db.complaints.filter((c) => c.status === "OPEN")
        .length,
      unassignableOrdersCount: db.orders.filter(
        (o) => o.deliveryStatus === "UNASSIGNABLE"
      ).length,
    };
  },

  async listAllUsers() {
    const db = readMockDb();
    requireAdminAnyPermission(db, [
      "users:manage",
      "users:customers:view",
      "users:owners:view",
      "users:outlets:view",
      "users:management:view",
      "users:delivery:view",
    ]);
    return db.users;
  },

  async updateUserStatus(userId, status, reason) {
    let updated!: User;
    writeMockDb((draft) => {
      const admin = requireAdminAnyPermission(draft, [
        "users:manage",
        "users:customers:manage",
        "users:owners:manage",
        "users:outlets:manage",
        "users:management:manage",
        "users:delivery:manage",
      ]);
      const user = draft.users.find((u) => u.id === userId);
      if (!user) throw new ApiError("NOT_FOUND", "User not found.", 404);
      const prev = user.status;
      user.status = status;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "users:manage",
        action: "USER_STATUS_UPDATED",
        targetEntityType: "USER",
        targetEntityId: userId,
        reason,
        beforeState: { status: prev },
        afterState: { status },
        createdAt: nowIso(),
      });
      updated = user;
    });
    return updated;
  },

  async deleteUser(userId) {
    writeMockDb((draft) => {
      const admin = requireAdminAnyPermission(draft, [
        "users:manage",
        "users:customers:manage",
        "users:owners:manage",
        "users:outlets:manage",
        "users:management:manage",
        "users:delivery:manage",
      ]);
      if (admin.id === userId) {
        throw new ApiError("VALIDATION_ERROR", "You cannot delete your own admin account.", 400);
      }
      const idx = draft.users.findIndex((u) => u.id === userId);
      if (idx < 0) {
        throw new ApiError("NOT_FOUND", "User not found.", 404);
      }
      const removed = draft.users[idx];
      draft.users.splice(idx, 1);

      const portals: PortalScope[] = ["customer", "restaurant", "delivery", "admin"];
      for (const p of portals) {
        if (draft.portalSessions[p]?.userId === userId) {
          draft.portalSessions[p] = null;
        }
      }
      if (draft.currentUserId === userId) {
        draft.currentUserId = null;
      }
      draft.platformInvitations = draft.platformInvitations.filter(
        (inv) =>
          inv.invitedEmail?.toLowerCase() !== removed.email.toLowerCase() &&
          inv.invitedPhone !== removed.phone
      );
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "users:manage",
        action: "USER_DELETED",
        targetEntityType: "USER",
        targetEntityId: userId,
        reason: `Deleted user ${removed.email}`,
        beforeState: { email: removed.email, roles: removed.roles },
        afterState: { deleted: true },
        createdAt: nowIso(),
      });
    });
  },

  async updateManagementUserRoles(userId, payload) {
    let res!: { userId: string; roles: string[]; permissions: AdminPermission[] };
    writeMockDb((draft) => {
      const admin = requireAdminAnyPermission(draft, [
        "users:manage",
        "users:management:manage",
      ]);
      if (userId === admin.id) {
        throw new ApiError(
          "CANNOT_MODIFY_SELF_ROLE",
          "You cannot modify your own admin roles or permissions.",
          400
        );
      }
      const user = draft.users.find((u) => u.id === userId);
      if (!user) throw new ApiError("NOT_FOUND", "User not found.", 404);

      const nonAdminRoles = user.roles.filter((r) =>
        ["CUSTOMER", "OUTLET_OWNER", "BRANCH_MANAGER", "OUTLET_STAFF", "DELIVERY_PARTNER"].includes(r)
      );
      const nextAdminRoles: string[] = [];
      let nextPerms: AdminPermission[] = [];

      if (payload.roleId) {
        const role = draft.roles.find((r) => r.id === payload.roleId);
        if (!role) throw new ApiError("NOT_FOUND", "Role not found.", 404);
        nextAdminRoles.push(role.code);
        nextPerms = [...role.permissions];
      } else if (payload.roleCodes && payload.roleCodes.length > 0) {
        for (const rc of payload.roleCodes) {
          const role = draft.roles.find((r) => r.code === rc);
          if (role) {
            nextAdminRoles.push(role.code);
            nextPerms.push(...role.permissions);
          }
        }
      } else {
        nextAdminRoles.push(
          ...user.roles.filter(
            (r) =>
              !["CUSTOMER", "OUTLET_OWNER", "BRANCH_MANAGER", "OUTLET_STAFF", "DELIVERY_PARTNER"].includes(r)
          )
        );
        nextPerms = [...user.permissions];
      }

      if (payload.customPermissions !== undefined) {
        nextPerms = Array.from(new Set([...nextPerms, ...payload.customPermissions]));
      }
      user.roles = Array.from(new Set([...nonAdminRoles, ...nextAdminRoles])) as UserRole[];
      user.permissions = Array.from(new Set(nextPerms));
      res = { userId: user.id, roles: user.roles, permissions: user.permissions };
    });
    return res;
  },

  async listDirectoryCustomers(): Promise<AdminDirectoryCustomer[]> {
    const db = readMockDb();
    requireAdminAnyPermission(db, ["users:manage", "users:customers:view"]);
    return db.users
      .filter((u) => u.roles.includes("CUSTOMER"))
      .map((u) => {
        const custOrders = db.orders.filter((o) => o.customerId === u.id);
        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          status: u.status,
          isEmailVerified: u.isEmailVerified,
          createdAt: u.createdAt,
          addressesCount: db.addresses.filter((a) => a.userId === u.id).length,
          ordersCount: custOrders.length,
          totalSpentMinor: custOrders
            .filter((o) => o.paymentStatus === "CAPTURED")
            .reduce((s, o) => s + o.breakdown.totalPayableMinor, 0),
        };
      });
  },

  async listDirectoryOwners(): Promise<AdminDirectoryOwner[]> {
    const db = readMockDb();
    requireAdminAnyPermission(db, ["users:manage", "users:owners:view"]);
    return db.users
      .filter(
        (u) =>
          u.roles.includes("OUTLET_OWNER") ||
          u.roles.includes("RESTAURANT_OWNER") ||
          (db.ownerProfiles ?? []).some((op) => op.userId === u.id)
      )
      .map((u) => {
        const op = (db.ownerProfiles ?? []).find((p) => p.userId === u.id);
        const owned = db.restaurants.filter((r) => r.ownerUserId === u.id && r.isActive);
        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          status: u.status,
          createdAt: u.createdAt,
          organizationName: op?.organizationName ?? "",
          kycStatus: op?.verificationStatus ?? "NOT_SUBMITTED",
          idDocumentType: op?.idDocumentType ?? "",
          idDocumentNumber: op?.idDocumentNumber ?? "",
          outletsCount: owned.length,
          approvedOutletsCount: owned.filter((r) => r.verificationStatus === "APPROVED").length,
        };
      });
  },

  async listDirectoryOutlets(): Promise<{
    outlets: AdminDirectoryOutlet[];
    staff: AdminDirectoryStaffUser[];
  }> {
    const db = readMockDb();
    requireAdminAnyPermission(db, ["users:manage", "users:outlets:view"]);
    const outlets: AdminDirectoryOutlet[] = db.restaurants
      .filter((r) => r.isActive)
      .map((r) => {
        const owner = db.users.find((u) => u.id === r.ownerUserId);
        const menuItemsCount = db.categories
          .filter((c) => c.restaurantId === r.id && c.isActive)
          .reduce((sum, c) => sum + c.items.filter((i) => i.isActive).length, 0);
        return {
          id: r.id,
          name: r.name,
          brandName: r.brandName,
          branchName: r.branchName,
          city: r.city,
          verificationStatus: r.verificationStatus,
          isAcceptingOrders: r.isAcceptingOrders,
          ownerUserId: r.ownerUserId,
          ownerName: owner?.fullName ?? "Outlet Owner",
          ownerEmail: owner?.email ?? r.email,
          menuItemsCount,
          ordersCount: db.orders.filter((o) => o.restaurantId === r.id).length,
          staffCount: (r.staffMembers ?? []).filter((s) => s.status === "ACTIVE").length,
        };
      });
    const staff: AdminDirectoryStaffUser[] = db.users
      .filter(
        (u) =>
          u.roles.includes("BRANCH_MANAGER") ||
          u.roles.includes("OUTLET_STAFF") ||
          db.restaurants.some((r) =>
            (r.staffMembers ?? []).some((s) => s.userId === u.id)
          )
      )
      .map((u) => {
        const assignments = db.restaurants.flatMap((r) =>
          (r.staffMembers ?? [])
            .filter((s) => s.userId === u.id)
            .map((s) => ({ rest: r, member: s }))
        );
        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          status: u.status,
          createdAt: u.createdAt,
          outletNames: assignments.map((a) =>
            a.rest.branchName ? `${a.rest.name} · ${a.rest.branchName}` : a.rest.name
          ),
          staffRoles: Array.from(
            new Set(assignments.map((a) => a.member.outletRoleName || a.member.roleCode))
          ),
        };
      });
    return { outlets, staff };
  },

  async listDirectoryManagement(): Promise<AdminDirectoryManagementUser[]> {
    const db = readMockDb();
    requireAdminAnyPermission(db, ["users:manage", "users:management:view"]);
    return db.users
      .filter(
        (u) =>
          u.roles.some(
            (r) =>
              r.endsWith("_ADMIN") || r === "CUSTOMER_CARE" || r.startsWith("CUSTOM_")
          ) ||
          db.platformInvitations.some(
            (inv) =>
              inv.invitedEmail?.toLowerCase() === u.email.toLowerCase() &&
              inv.status !== "REVOKED"
          )
      )
      .map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        status: u.status,
        isEmailVerified: u.isEmailVerified,
        roles: u.roles,
        permissions: u.permissions,
        createdAt: u.createdAt,
      }));
  },

  async listDirectoryDelivery(): Promise<AdminDirectoryDeliveryUser[]> {
    const db = readMockDb();
    requireAdminAnyPermission(db, ["users:manage", "users:delivery:view"]);
    return db.users
      .filter(
        (u) =>
          u.roles.includes("DELIVERY_PARTNER") ||
          db.partners.some((p) => p.userId === u.id)
      )
      .map((u) => {
        const p = db.partners.find((x) => x.userId === u.id);
        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          status: u.status,
          createdAt: u.createdAt,
          partnerId: p?.id,
          vehicleType: p?.vehicleType,
          vehicleModel: p?.vehicleModel,
          licensePlate: p?.licensePlate,
          verificationStatus: p?.verificationStatus ?? "NOT_SUBMITTED",
          availabilityStatus: p?.availabilityStatus ?? "OFFLINE",
          totalDeliveriesCount: p?.totalDeliveriesCount ?? 0,
          ratingAverage: p?.ratingAverage ?? 5.0,
        };
      });
  },

  async getAdminUserDetail(userId): Promise<AdminUserDetail> {
    const db = readMockDb();
    requireAdminAnyPermission(db, [
      "users:manage",
      "users:customers:view",
      "users:owners:view",
      "users:outlets:view",
      "users:management:view",
      "users:delivery:view",
    ]);
    const u = db.users.find((x) => x.id === userId);
    if (!u) throw new ApiError("NOT_FOUND", "User not found.", 404);
    const op = (db.ownerProfiles ?? []).find((p) => p.userId === u.id);
    const partner = db.partners.find((p) => p.userId === u.id);
    return {
      user: {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        status: u.status,
        isEmailVerified: u.isEmailVerified,
        isPhoneVerified: u.isPhoneVerified,
        roles: u.roles,
        permissions: u.permissions,
        createdAt: u.createdAt,
      },
      addresses: db.addresses
        .filter((a) => a.userId === u.id)
        .map((a) => ({
          id: a.id,
          label: a.label,
          addressLine1: a.addressLine1,
          city: a.city,
          postalCode: a.postalCode,
          isDefault: a.isDefault,
        })),
      orders: db.orders
        .filter((o) => o.customerId === u.id)
        .map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          restaurantName: o.restaurantName,
          orderStatus: o.orderStatus,
          totalPayableMinor: o.breakdown.totalPayableMinor,
          createdAt: o.createdAt,
        })),
      complaintsCount: db.complaints.filter((c) => c.customerId === u.id).length,
      ownerProfile: op
        ? {
            id: op.id,
            organizationName: op.organizationName,
            idDocumentType: op.idDocumentType,
            idDocumentNumber: op.idDocumentNumber,
            idDocumentFilename: op.idDocumentFilename,
            verificationStatus: op.verificationStatus,
          }
        : null,
      ownedOutlets: db.restaurants
        .filter((r) => r.ownerUserId === u.id && r.isActive)
        .map((r) => ({
          id: r.id,
          name: r.name,
          brandName: r.brandName,
          branchName: r.branchName,
          city: r.city,
          verificationStatus: r.verificationStatus,
          isAcceptingOrders: r.isAcceptingOrders,
        })),
      staffAssignments: db.restaurants.flatMap((r) =>
        (r.staffMembers ?? [])
          .filter(
            (s) =>
              s.userId === u.id ||
              s.email.toLowerCase() === u.email.toLowerCase()
          )
          .map((s) => ({
            id: s.id,
            outletId: r.id,
            outletName: r.name,
            branchName: r.branchName,
            roleCode: s.roleCode,
            outletRoleName: s.outletRoleName,
            permissions: s.permissions,
            status: s.status,
          }))
      ),
      partnerProfile: partner
        ? {
            id: partner.id,
            vehicleType: partner.vehicleType,
            vehicleModel: partner.vehicleModel,
            licensePlate: partner.licensePlate,
            verificationStatus: partner.verificationStatus,
            availabilityStatus: partner.availabilityStatus,
            totalDeliveriesCount: partner.totalDeliveriesCount,
            ratingAverage: partner.ratingAverage,
          }
        : null,
      recentDeliveries: partner
        ? db.orders
            .filter((o) => o.partnerId === partner.id)
            .map((o) => ({
              orderNumber: o.orderNumber,
              restaurantName: o.restaurantName,
              status: o.deliveryStatus,
              totalPayableMinor: o.breakdown.totalPayableMinor,
              createdAt: o.createdAt,
            }))
        : [],
    };
  },

  async getAdminOutletDetail(outletId): Promise<AdminOutletDetail> {
    const db = readMockDb();
    requireAdminAnyPermission(db, [
      "users:manage",
      "users:outlets:view",
      "restaurants:verify",
    ]);
    const r = db.restaurants.find((x) => x.id === outletId);
    if (!r) throw new ApiError("NOT_FOUND", "Outlet not found.", 404);
    const owner = db.users.find((u) => u.id === r.ownerUserId);
    const outletOrders = db.orders.filter((o) => o.restaurantId === r.id);
    const menuItemsCount = db.categories
      .filter((c) => c.restaurantId === r.id && c.isActive)
      .reduce((sum, c) => sum + c.items.filter((i) => i.isActive).length, 0);
    return {
      outlet: {
        id: r.id,
        name: r.name,
        brandName: r.brandName,
        branchName: r.branchName,
        addressLine1: r.addressLine1,
        city: r.city,
        state: r.state,
        postalCode: r.postalCode,
        phone: r.phone,
        email: r.email,
        verificationStatus: r.verificationStatus,
        isAcceptingOrders: r.isAcceptingOrders,
        avgPrepTimeMinutes: r.avgPrepTimeMinutes,
        maxConcurrentOrders: r.maxConcurrentOrders ?? 15,
        ownerUserId: r.ownerUserId,
        ownerName: owner?.fullName ?? "Outlet Owner",
        ownerEmail: owner?.email ?? r.email,
        menuItemsCount,
        ordersCount: outletOrders.length,
        totalGmvMinor: outletOrders.reduce((s, o) => s + o.breakdown.totalPayableMinor, 0),
      },
      staff: (r.staffMembers ?? []).map((s) => ({
        id: s.id,
        fullName: s.fullName,
        email: s.email,
        role: s.outletRoleName || s.roleCode,
        permissions: s.permissions,
        status: s.status,
      })),
    };
  },

  async listRestaurantOwners() {
    const db = readMockDb();
    requireAdminPermission(db, "orders:monitor");
    return db.ownerProfiles ?? [];
  },

  async decideRestaurantOwnerVerification(ownerId, decision, notes) {
    let updated!: RestaurantOwnerProfile;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "restaurants:verify");
      if (!draft.ownerProfiles) draft.ownerProfiles = [];
      const prof = draft.ownerProfiles.find(
        (p) => p.id === ownerId || p.userId === ownerId
      );
      if (!prof) {
        throw new ApiError("NOT_FOUND", "Restaurant owner profile not found.", 404);
      }
      const prev = prof.verificationStatus;
      prof.verificationStatus = decision;
      prof.reviewNotes = notes;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "restaurants:verify",
        action: `RESTAURANT_OWNER_${decision}`,
        targetEntityType: "RESTAURANT_OWNER",
        targetEntityId: prof.userId,
        reason: notes,
        beforeState: { verificationStatus: prev },
        afterState: { verificationStatus: decision },
        createdAt: nowIso(),
      });
      updated = prof;
    });
    return updated;
  },

  async listRestaurants() {
    const db = readMockDb();
    requireAdminPermission(db, "orders:monitor");
    return db.restaurants;
  },

  async decideRestaurantVerification(restaurantId, decision, notes) {
    let updated!: Restaurant;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "restaurants:verify");
      const rest = draft.restaurants.find((r) => r.id === restaurantId);
      if (!rest) throw new ApiError("NOT_FOUND", "Restaurant not found.", 404);
      const prev = rest.verificationStatus;
      rest.verificationStatus = decision;
      if (decision !== "APPROVED") rest.isAcceptingOrders = false;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "restaurants:verify",
        action: `RESTAURANT_${decision}`,
        targetEntityType: "RESTAURANT",
        targetEntityId: restaurantId,
        reason: notes,
        beforeState: { verificationStatus: prev },
        afterState: { verificationStatus: decision },
        createdAt: nowIso(),
      });
      updated = rest;
    });
    return updated;
  },

  async listDeliveryPartners() {
    const db = readMockDb();
    requireAdminPermission(db, "orders:monitor");
    return db.partners;
  },

  async decidePartnerVerification(partnerId, decision, notes) {
    let updated!: DeliveryPartner;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "partners:verify");
      const partner = draft.partners.find((p) => p.id === partnerId);
      if (!partner) throw new ApiError("NOT_FOUND", "Partner not found.", 404);
      const prev = partner.verificationStatus;
      partner.verificationStatus = decision;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "partners:verify",
        action: `PARTNER_${decision}`,
        targetEntityType: "DELIVERY_PARTNER",
        targetEntityId: partnerId,
        reason: notes,
        beforeState: { verificationStatus: prev },
        afterState: { verificationStatus: decision },
        createdAt: nowIso(),
      });
      updated = partner;
    });
    return updated;
  },

  async listAllOrders() {
    const db = readMockDb();
    requireAdminPermission(db, "orders:monitor");
    return db.orders;
  },

  async interveneOrder(orderId, action, payload) {
    let updated!: Order;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "orders:intervene");
      const order = draft.orders.find((o) => o.id === orderId);
      if (!order) throw new ApiError("NOT_FOUND", "Order not found.", 404);
      const ts = nowIso();
      if (action === "MANUAL_ASSIGN_PARTNER") {
        const partner = draft.partners.find(
          (p) => p.id === payload.partnerId && p.verificationStatus === "APPROVED"
        );
        if (!partner) {
          throw new ApiError("NOT_FOUND", "Valid partner not found.", 404);
        }
        order.partnerId = partner.id;
        order.partnerName = partner.fullName;
        order.partnerPhone = partner.phone;
        order.partnerVehicle = `${partner.vehicleModel} (${partner.vehicleType})`;
        order.deliveryStatus = "PARTNER_ASSIGNED";
        partner.availabilityStatus = "ON_DELIVERY";
      } else {
        order.orderStatus = "CANCELLED";
        order.deliveryStatus = "CANCELLED";
        if (order.paymentStatus === "CAPTURED") {
          order.paymentStatus = "REFUNDED";
          const pay = draft.payments.find((p) => p.orderId === orderId);
          if (pay) {
            pay.status = "REFUNDED";
            draft.refunds.unshift({
              id: uuid("ref"),
              paymentId: pay.id,
              orderId: order.id,
              orderNumber: order.orderNumber,
              amountMinor: order.breakdown.totalPayableMinor,
              currency: order.currency,
              refundType: "FULL",
              reasonCode: "ADMIN_INTERVENTION",
              notes: payload.reason,
              status: "PROCESSED",
              initiatedByRole: admin.roles[0],
              createdAt: ts,
            });
          }
        }
      }
      order.version += 1;
      order.updatedAt = ts;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "orders:intervene",
        action,
        targetEntityType: "ORDER",
        targetEntityId: orderId,
        reason: payload.reason,
        createdAt: ts,
      });
      updated = order;
    });
    return updated;
  },

  async listPaymentsAndRefunds() {
    const db = readMockDb();
    requireAdminPermission(db, "refunds:approve");
    return { payments: db.payments, refunds: db.refunds };
  },

  async issueRefund(payload) {
    let created!: RefundRecord;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "refunds:approve");
      const order = draft.orders.find((o) => o.id === payload.orderId);
      const pay = draft.payments.find((p) => p.orderId === payload.orderId);
      if (!order || !pay) throw new ApiError("NOT_FOUND", "Payment not found.", 404);
      const alreadyRefunded = draft.refunds
        .filter((r) => r.paymentId === pay.id && r.status !== "FAILED")
        .reduce((s, r) => s + r.amountMinor, 0);
      if (alreadyRefunded + payload.amountMinor > pay.amountMinor) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "Refund amount exceeds remaining captured balance.",
          400
        );
      }
      const ts = nowIso();
      created = {
        id: uuid("ref"),
        paymentId: pay.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        amountMinor: payload.amountMinor,
        currency: order.currency,
        refundType:
          alreadyRefunded + payload.amountMinor === pay.amountMinor
            ? "FULL"
            : "PARTIAL",
        reasonCode: payload.reasonCode,
        notes: payload.notes,
        status: "PROCESSED",
        initiatedByRole: admin.roles[0],
        createdAt: ts,
      };
      draft.refunds.unshift(created);
      const totalRefunded = alreadyRefunded + payload.amountMinor;
      pay.status =
        totalRefunded === pay.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
      order.paymentStatus = pay.status;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "refunds:approve",
        action: "REFUND_ISSUED",
        targetEntityType: "PAYMENT",
        targetEntityId: pay.id,
        reason: payload.notes,
        afterState: { amountMinor: payload.amountMinor },
        createdAt: ts,
      });
    });
    return created;
  },

  async getCommissionConfig() {
    const db = readMockDb();
    requireAdminPermission(db, "commissions:configure");
    return db.commissionConfig;
  },

  async updateCommissionConfig(config, reason) {
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "commissions:configure");
      const prev = { ...draft.commissionConfig };
      draft.commissionConfig = config;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "commissions:configure",
        action: "COMMISSION_CONFIG_UPDATED",
        targetEntityType: "PLATFORM_CONFIG",
        targetEntityId: "commission_config",
        reason,
        beforeState: prev,
        afterState: { ...config },
        createdAt: nowIso(),
      });
    });
    return config;
  },

  async listCoupons() {
    const db = readMockDb();
    requireAdminPermission(db, "promotions:manage");
    return db.coupons;
  },

  async createCoupon(coupon) {
    let created!: CouponRecord;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "promotions:manage");
      created = { ...coupon, id: uuid("cpn"), currentUses: 0 };
      draft.coupons.unshift(created);
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "promotions:manage",
        action: "COUPON_CREATED",
        targetEntityType: "COUPON",
        targetEntityId: created.id,
        afterState: { code: created.code },
        createdAt: nowIso(),
      });
    });
    return created;
  },

  async toggleCoupon(couponId, isActive) {
    let updated!: CouponRecord;
    writeMockDb((draft) => {
      requireAdminPermission(draft, "promotions:manage");
      const c = draft.coupons.find((x) => x.id === couponId);
      if (!c) throw new ApiError("NOT_FOUND", "Coupon not found.", 404);
      c.isActive = isActive;
      updated = c;
    });
    return updated;
  },

  async listServiceZones() {
    const db = readMockDb();
    requireAdminPermission(db, "zones:manage");
    return db.zones;
  },

  async updateServiceZone(zoneId, isActive) {
    let updated!: ServiceZone;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "zones:manage");
      const z = draft.zones.find((x) => x.id === zoneId);
      if (!z) throw new ApiError("NOT_FOUND", "Service zone not found.", 404);
      z.isActive = isActive;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "zones:manage",
        action: "SERVICE_ZONE_TOGGLED",
        targetEntityType: "SERVICE_ZONE",
        targetEntityId: zoneId,
        afterState: { isActive },
        createdAt: nowIso(),
      });
      updated = z;
    });
    return updated;
  },

  async listComplaints() {
    const db = readMockDb();
    requireAdminPermission(db, "complaints:resolve");
    return db.complaints;
  },

  async resolveComplaint(complaintId, payload) {
    let updated!: ComplaintRecord;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "complaints:resolve");
      const cmp = draft.complaints.find((c) => c.id === complaintId);
      if (!cmp) throw new ApiError("NOT_FOUND", "Complaint not found.", 404);
      cmp.status = payload.status;
      cmp.resolutionNotes = payload.resolutionNotes;
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "complaints:resolve",
        action: "COMPLAINT_RESOLVED",
        targetEntityType: "COMPLAINT",
        targetEntityId: complaintId,
        reason: payload.resolutionNotes,
        createdAt: nowIso(),
      });
      updated = cmp;
    });
    return updated;
  },

  async listAuditLogs() {
    const db = readMockDb();
    requireAdminPermission(db, "audit_logs:view");
    return db.auditLogs;
  },

  async listRoles() {
    const db = readMockDb();
    requireAdminAnyPermission(db, [
      "users:manage",
      "roles:manage",
      "users:management:view",
      "users:management:manage",
    ]);
    return db.roles;
  },

  async createRole(payload) {
    let created!: RoleDefinition;
    writeMockDb((draft) => {
      const admin = requireAdminAnyPermission(draft, ["users:manage", "roles:manage"]);
      const slug = payload.name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      created = {
        id: uuid("role"),
        code: `CUSTOM_${slug}_${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
        name: payload.name,
        description: payload.description ?? "",
        isSystem: false,
        permissions: payload.permissions,
      };
      draft.roles.push(created);
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "roles:manage",
        action: "ADMIN_ROLE_CREATED",
        targetEntityType: "ROLE",
        targetEntityId: created.id,
        afterState: { code: created.code, permissions: payload.permissions },
        createdAt: nowIso(),
      });
    });
    return created;
  },

  async updateRolePermissions(roleId, permissions) {
    let updated!: RoleDefinition;
    writeMockDb((draft) => {
      requireAdminAnyPermission(draft, ["users:manage", "roles:manage"]);
      const role = draft.roles.find((r) => r.id === roleId);
      if (!role) throw new ApiError("NOT_FOUND", "Role not found.", 404);
      if (role.code === "PLATFORM_ADMIN") {
        throw new ApiError("PROTECTED_ROLE", "PLATFORM_ADMIN keeps all permissions.", 400);
      }
      role.permissions = permissions;
      for (const u of draft.users) {
        if (u.roles.includes(role.code as UserRole)) {
          u.permissions = permissions;
        }
      }
      updated = role;
    });
    return updated;
  },

  async deleteRole(roleId) {
    writeMockDb((draft) => {
      const admin = requireAdminAnyPermission(draft, ["users:manage", "roles:manage"]);
      if (!admin.roles.includes("PLATFORM_ADMIN") && !admin.roles.includes("SUPER_ADMIN")) {
        throw new ApiError("FORBIDDEN", "Only Super Admin can delete platform roles.", 403);
      }
      const idx = draft.roles.findIndex((r) => r.id === roleId);
      if (idx < 0) throw new ApiError("NOT_FOUND", "Role not found.", 404);
      const role = draft.roles[idx];
      if (
        ["PLATFORM_ADMIN", "CUSTOMER", "OUTLET_OWNER", "BRANCH_MANAGER", "OUTLET_STAFF", "DELIVERY_PARTNER"].includes(
          role.code
        )
      ) {
        throw new ApiError("PROTECTED_ROLE", "Core platform roles cannot be deleted.", 400);
      }
      draft.roles.splice(idx, 1);
      draft.platformInvitations = draft.platformInvitations.filter((inv) => inv.targetId !== roleId);
      for (const u of draft.users) {
        if (u.roles.includes(role.code as UserRole)) {
          u.roles = u.roles.filter((c) => c !== role.code);
        }
      }
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "roles:manage",
        action: "ADMIN_ROLE_DELETED",
        targetEntityType: "ROLE",
        targetEntityId: roleId,
        afterState: { code: role.code },
        createdAt: nowIso(),
      });
    });
  },

  async listAdminInvitations() {
    const db = readMockDb();
    requireAdminAnyPermission(db, ["users:manage", "users:management:manage"]);
    return db.platformInvitations;
  },

  async createAdminInvitation(payload) {
    let created!: InvitationItem;
    writeMockDb((draft) => {
      const admin = requireAdminAnyPermission(draft, ["users:manage", "users:management:manage"]);
      const role = draft.roles.find((r) => r.id === payload.roleId);
      if (!role) throw new ApiError("NOT_FOUND", "Selected role not found.", 404);
      const email = payload.email?.trim().toLowerCase() || undefined;
      const phone = payload.phone?.trim() || undefined;
      if (!email && !phone) {
        throw new ApiError("VALIDATION_ERROR", "Provide an email ID or contact number.", 400);
      }
      created = {
        id: uuid("pinv"),
        kind: "PLATFORM",
        targetId: role.id,
        targetName: "Goodly Platform Operations",
        roleName: role.name,
        roleCode: role.code,
        permissions:
          payload.customPermissions && payload.customPermissions.length > 0
            ? payload.customPermissions
            : role.permissions,
        invitedByName: admin.fullName,
        status: "PENDING_ACCEPTANCE",
        invitedEmail: email,
        invitedPhone: phone,
        preApproved: Boolean(payload.preApproved),
        createdAt: nowIso(),
      };
      draft.platformInvitations.unshift(created);
    });
    return created;
  },

  async approveAdminInvitation(invitationId) {
    let updated!: InvitationItem;
    writeMockDb((draft) => {
      const admin = requireAdminPermission(draft, "users:manage");
      const inv = draft.platformInvitations.find((i) => i.id === invitationId);
      if (!inv) throw new ApiError("NOT_FOUND", "Invitation not found.", 404);
      if (inv.status === "PENDING_ACCEPTANCE") {
        throw new ApiError(
          "APPROVAL_BLOCKED",
          "User must log in and accept the invitation before Admin approval.",
          400
        );
      }
      inv.status = "ACTIVE";
      inv.approvedAt = nowIso();
      const targetUser = draft.users.find(
        (u) =>
          (inv.invitedEmail && u.email.toLowerCase() === inv.invitedEmail.toLowerCase()) ||
          (inv.invitedPhone && u.phone === inv.invitedPhone)
      );
      if (targetUser) {
        if (!targetUser.roles.includes(inv.roleCode as UserRole)) {
          targetUser.roles.push(inv.roleCode as UserRole);
        }
        const merged = new Set([...targetUser.permissions, ...(inv.permissions as AdminPermission[])]);
        targetUser.permissions = Array.from(merged);
      }
      draft.auditLogs.unshift({
        id: uuid("aud"),
        adminUserId: admin.id,
        adminName: admin.fullName,
        adminRole: admin.roles[0],
        permissionUsed: "users:manage",
        action: "ADMIN_INVITATION_APPROVED",
        targetEntityType: "INVITATION",
        targetEntityId: invitationId,
        afterState: { roleCode: inv.roleCode, status: "ACTIVE" },
        createdAt: nowIso(),
      });
      updated = inv;
    });
    return updated;
  },

  async revokeAdminInvitation(invitationId) {
    writeMockDb((draft) => {
      requireAdminPermission(draft, "users:manage");
      const inv = draft.platformInvitations.find((i) => i.id === invitationId);
      if (inv) {
        inv.status = "REVOKED";
        const targetUser = draft.users.find(
          (u) =>
            (inv.invitedEmail && u.email.toLowerCase() === inv.invitedEmail.toLowerCase()) ||
            (inv.invitedPhone && u.phone === inv.invitedPhone)
        );
        if (targetUser) {
          targetUser.roles = targetUser.roles.filter((r) => r !== inv.roleCode);
        }
      }
    });
  },

  async listAllPendingOutletStaff() {
    const db = readMockDb();
    requireAdminPermission(db, "restaurants:verify");
    const rows: (OutletStaffMember & { outletName: string })[] = [];
    for (const rest of db.restaurants) {
      for (const s of rest.staffMembers ?? []) {
        rows.push({ ...s, outletName: rest.name });
      }
    }
    return rows;
  },

  async approveOutletStaff(outletId, assignmentId) {
    return mockRestaurantPortalService.approveBranchStaff(outletId, assignmentId);
  },
};

export const mockServiceRegistry: ServiceRegistry = {
  auth: mockAuthService,
  discovery: mockDiscoveryService,
  cart: mockCartService,
  orders: mockOrderService,
  restaurantPortal: mockRestaurantPortalService,
  deliveryPortal: mockDeliveryPortalService,
  adminPortal: mockAdminPortalService,
};
