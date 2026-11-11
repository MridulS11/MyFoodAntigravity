import { ApiError, type ApiErrorCode } from "@/services/contracts/errors";
import type {
  IAuthService,
  ICartService,
  IDiscoveryService,
  IOrderService,
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
  CustomerAddress,
  DeliveryEarningRecord,
  DeliveryOffer,
  DeliveryPartner,
  DeliveryPartnerWithStatus,
  EmailCheckResult,
  InvitationItem,
  MenuCategory,
  MenuItem,
  OperatingHourSlot,
  Order,
  OutletPenaltyRecord,
  OutletPermission,
  OutletRoleDefinition,
  OutletStaffMember,
  PaymentRecord,
  PortalAuthResult,
  PortalScope,
  RefundRecord,
  Restaurant,
  RestaurantOwnerProfile,
  RestaurantSettlement,
  RestaurantWithMenu,
  ReviewRecord,
  RoleDefinition,
  ServiceZone,
  TrackingSnapshot,
  User,
  UserRole,
  VegClassification,
  VerificationStatus,
} from "@/services/contracts/types";
import type {
  IAdminPortalService,
  IDeliveryPortalService,
  IRestaurantPortalService,
} from "@/services/contracts/interfaces";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api/v1";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const rawText = await res.text();
  let json: {
    success?: boolean;
    data?: T;
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  } | null = null;
  if (rawText) {
    try {
      json = JSON.parse(rawText);
    } catch {
      throw new ApiError(
        res.status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
        rawText.trim() || `Request failed (${res.status})`,
        res.status
      );
    }
  }
  if (!res.ok || !json?.success) {
    throw new ApiError(
      (json?.error?.code as ApiErrorCode | undefined) ??
        (res.status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR"),
      json?.error?.message ?? (rawText.trim() || `Request failed (${res.status})`),
      res.status,
      json?.error?.details
    );
  }
  return json.data as T;
}

interface BackendUser {
  id?: string;
  user_id?: string;
  email: string;
  phone: string;
  full_name: string;
  roles: UserRole[];
  permissions?: User["permissions"];
  status?: User["status"];
  is_email_verified?: boolean;
  is_phone_verified?: boolean;
  created_at?: string;
}

function mapUser(u: BackendUser): User {
  return {
    id: u.id ?? u.user_id ?? "",
    email: u.email,
    phone: u.phone,
    fullName: u.full_name,
    roles: u.roles ?? ["CUSTOMER"],
    permissions: u.permissions ?? [],
    status: u.status ?? "ACTIVE",
    isEmailVerified: u.is_email_verified ?? true,
    isPhoneVerified: u.is_phone_verified ?? true,
    createdAt: u.created_at ?? new Date().toISOString(),
  };
}

interface BackendAddress {
  id: string;
  user_id: string;
  label: CustomerAddress["label"];
  recipient_name: string;
  recipient_phone: string;
  address_line1: string;
  address_line2?: string;
  landmark?: string;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  delivery_instructions?: string;
  lat: number;
  lng: number;
  is_default: boolean;
  is_serviceable: boolean;
}

function mapAddress(a: BackendAddress): CustomerAddress {
  return {
    id: a.id,
    userId: a.user_id,
    label: a.label,
    recipientName: a.recipient_name,
    recipientPhone: a.recipient_phone,
    addressLine1: a.address_line1,
    addressLine2: a.address_line2,
    landmark: a.landmark,
    city: a.city,
    state: a.state,
    postalCode: a.postal_code,
    countryCode: a.country_code,
    deliveryInstructions: a.delivery_instructions,
    location: { lat: a.lat, lng: a.lng },
    isDefault: a.is_default,
    isServiceable: a.is_serviceable,
  };
}

export const httpAuthService: IAuthService = {
  async getSessionUser(portal: PortalScope = "customer") {
    const res = await this.getPortalSession(portal);
    return res?.user ?? null;
  },
  async getPortalSession(portal: PortalScope) {
    try {
      const me = await apiRequest<{
        user: BackendUser;
        portal: PortalScope;
        onboarding_required: boolean;
        onboarding_hint?: string;
      }>(`/${portal}/auth/me`);
      return {
        user: mapUser(me.user),
        portal: me.portal ?? portal,
        onboardingRequired: Boolean(me.onboarding_required),
        onboardingHint: me.onboarding_hint,
      };
    } catch {
      return null;
    }
  },
  async checkEmailAvailability(portal: PortalScope, emailOrPhone: string): Promise<EmailCheckResult> {
    const res = await apiRequest<{
      exists: boolean;
      portal: PortalScope;
      onboarding_recommended: boolean;
    }>(`/${portal}/auth/check-email`, {
      method: "POST",
      body: JSON.stringify({ email_or_phone: emailOrPhone }),
    });
    return {
      exists: res.exists,
      portal: res.portal ?? portal,
      onboardingRecommended: res.onboarding_recommended,
    };
  },
  async login(emailOrPhone, password, portal = "customer") {
    const res = await this.loginForPortal(portal, emailOrPhone, password);
    return res.user;
  },
  async loginForPortal(portal: PortalScope, emailOrPhone: string, password: string): Promise<PortalAuthResult> {
    const res = await apiRequest<{
      user: BackendUser;
      portal?: PortalScope;
      onboarding_required?: boolean;
      onboarding_hint?: string;
    }>(`/${portal}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email_or_phone: emailOrPhone, password }),
    });
    return {
      user: mapUser(res.user),
      portal: res.portal ?? portal,
      onboardingRequired: Boolean(res.onboarding_required),
      onboardingHint: res.onboarding_hint,
    };
  },
  async register(payload, portal = "customer") {
    const res = await apiRequest<{
      user: BackendUser;
      otp_required: boolean;
      onboarding_required?: boolean;
    }>(`/${portal}/auth/register`, {
      method: "POST",
      body: JSON.stringify({
        full_name: payload.fullName,
        email: payload.email,
        phone: payload.phone,
        password: payload.password,
        role: payload.role,
      }),
    });
    return {
      user: mapUser(res.user),
      otpRequired: res.otp_required,
      onboardingRequired: res.onboarding_required,
    };
  },
  async verifyOtp(target, code, portal = "customer") {
    const res = await apiRequest<{ user: BackendUser }>(`/${portal}/auth/otp/verify`, {
      method: "POST",
      body: JSON.stringify({ target, purpose: "REGISTER", code }),
    });
    return mapUser(res.user);
  },
  async switchDemoPersona() {
    throw new ApiError(
      "FORBIDDEN",
      "Demo persona switching is disabled in live API mode. Sign in with credentials.",
      403
    );
  },
  async logout(portal: PortalScope = "customer") {
    await apiRequest(`/${portal}/auth/logout`, { method: "POST" });
  },
  async getAddresses() {
    const list = await apiRequest<BackendAddress[]>("/customers/me/addresses");
    return list.map(mapAddress);
  },
  async saveAddress(input) {
    const saved = await apiRequest<BackendAddress>("/customers/me/addresses", {
      method: "POST",
      body: JSON.stringify({
        label: input.label,
        recipient_name: input.recipientName,
        recipient_phone: input.recipientPhone,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2,
        landmark: input.landmark,
        city: input.city,
        state: input.state,
        postal_code: input.postalCode,
        country_code: input.countryCode,
        delivery_instructions: input.deliveryInstructions,
        lat: input.location.lat,
        lng: input.location.lng,
        is_default: input.isDefault,
      }),
    });
    return mapAddress(saved);
  },
  async deleteAddress(addressId) {
    await apiRequest(`/customers/me/addresses/${addressId}`, {
      method: "DELETE",
    });
  },
  async setDefaultAddress(addressId) {
    await apiRequest(`/customers/me/addresses/${addressId}`, {
      method: "PATCH",
    });
  },
  async getFavorites() {
    return [];
  },
  async toggleFavorite() {
    return [];
  },
  async getNotifications() {
    return [];
  },
  async markNotificationRead() {},
  async listMyInvitations(portal = "customer") {
    const raw = await apiRequest<Record<string, unknown>[]>(`/${portal}/auth/invitations`);
    return (raw ?? []).map(
      (i): InvitationItem => ({
        id: String(i.id ?? ""),
        kind: (i.kind as "PLATFORM" | "OUTLET") ?? "PLATFORM",
        targetId: String(i.target_id ?? ""),
        targetName: String(i.target_name ?? ""),
        roleName: String(i.role_name ?? ""),
        roleCode: String(i.role_code ?? ""),
        permissions: (i.permissions as string[]) ?? [],
        invitedByName: String(i.invited_by_name ?? "Admin"),
        status: i.status as InvitationItem["status"],
        invitedEmail: i.invited_email ? String(i.invited_email) : undefined,
        invitedPhone: i.invited_phone ? String(i.invited_phone) : undefined,
        preApproved: Boolean(i.pre_approved),
        acceptedAt: i.accepted_at ? String(i.accepted_at) : undefined,
        approvedAt: i.approved_at ? String(i.approved_at) : undefined,
        createdAt: String(i.created_at ?? new Date().toISOString()),
      })
    );
  },
  async respondToInvitation(kind, invitationId, action, portal = "customer") {
    await apiRequest(`/${portal}/auth/invitations/${kind}/${invitationId}/respond`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  },
};

function mapDiscoveryRestaurant(r: Record<string, unknown>, lat = 12.9784, lng = 77.6408, city = "Bengaluru", zoneId = ""): Restaurant {
  return {
    id: String(r.id ?? ""),
    ownerUserId: "",
    serviceZoneId: zoneId,
    slug: String(r.slug ?? ""),
    name: String(r.name ?? ""),
    eyebrow: String(r.eyebrow ?? ""),
    tagline: String(r.tagline ?? ""),
    description: String(r.description ?? ""),
    cuisines: (r.cuisines as string[]) ?? [],
    categoryFilterKeys: [],
    phone: "",
    email: "",
    addressLine1: "",
    city,
    state: "KA",
    postalCode: "560038",
    location: { lat, lng },
    maxDeliveryRadiusMeters: 7000,
    heroImageUrl: String(r.hero_image_url ?? "/images/sunday-table.jpg"),
    cardImageUrl: String(r.hero_image_url ?? "/images/sunday-table.jpg"),
    verificationStatus: "APPROVED",
    isActive: true,
    isAcceptingOrders: Boolean(r.is_accepting_orders),
    avgPrepTimeMinutes: Number(r.avg_prep_time_minutes ?? 20),
    estimatedDeliveryMin: Number(r.estimated_delivery_min ?? 20),
    estimatedDeliveryMax: Number(r.estimated_delivery_max ?? 32),
    deliveryFeeMinor: Number(r.delivery_fee_minor ?? 2900),
    minOrderAmountMinor: Number(r.min_cart_threshold_minor ?? 29900),
    packagingFeeMinor: Number(r.packaging_fee_minor ?? 2000),
    commissionRateBps: 2000,
    currency: String(r.currency ?? "INR"),
    ratingAverage: Number(r.rating_average ?? 4.9),
    ratingCount: Number(r.rating_count ?? 0),
    operatingHours: [],
  };
}

function mapMenuItemRow(it: Record<string, unknown>, fallbackRestId = ""): MenuItem {
  return {
    id: String(it.id ?? ""),
    restaurantId: String(it.restaurant_id ?? fallbackRestId),
    categoryId: String(it.category_id ?? ""),
    name: String(it.name ?? ""),
    description: String(it.description ?? ""),
    badgeLabel: it.badge_label ? String(it.badge_label) : undefined,
    vegClassification: (it.veg_classification as VegClassification) ?? "VEG",
    dietaryTags: (it.dietary_tags as string[]) ?? [],
    cuisineType: it.cuisine_type ? String(it.cuisine_type) : undefined,
    spiceLevel: (it.spice_level as MenuItem["spiceLevel"]) ?? "NONE",
    caloriesKcal: typeof it.calories_kcal === "number" ? it.calories_kcal : undefined,
    servingSize: it.serving_size ? String(it.serving_size) : undefined,
    prepTimeMinutes:
      typeof it.prep_time_minutes === "number" ? it.prep_time_minutes : undefined,
    ingredients: (it.ingredients as string[]) ?? [],
    allergens: (it.allergens as string[]) ?? [],
    searchKeywords: (it.search_keywords as string[]) ?? [],
    isRecommended: Boolean(it.is_recommended),
    basePriceMinor: Number(it.base_price_minor ?? 0),
    currency: String(it.currency ?? "INR"),
    imageUrl: String(it.image_url ?? "/images/sunday-table.jpg"),
    isAvailable: it.is_available !== false,
    isActive: it.is_active !== false,
    trackInventory: Boolean(it.track_inventory),
    availableQuantity: Number(it.available_quantity ?? 25),
    customizationGroups: ((it.customization_groups as Record<string, unknown>[]) ?? []).map((g) => ({
      id: String(g.id ?? ""),
      name: String(g.name ?? ""),
      minSelections: Number(g.min_selections ?? 0),
      maxSelections: Number(g.max_selections ?? 1),
      isRequired: Boolean(g.is_required),
      options: ((g.options as Record<string, unknown>[]) ?? []).map((o) => ({
        id: String(o.id ?? ""),
        name: String(o.name ?? ""),
        priceDeltaMinor: Number(o.price_delta_minor ?? 0),
        isDefault: Boolean(o.is_default),
        isAvailable: o.is_available !== false,
      })),
    })),
  };
}

function mapMenuCategoryRow(c: Record<string, unknown>, fallbackRestId = ""): MenuCategory {
  const restId = String(c.restaurant_id ?? fallbackRestId);
  return {
    id: String(c.id ?? ""),
    restaurantId: restId,
    name: String(c.name ?? ""),
    subtitle: c.subtitle ? String(c.subtitle) : undefined,
    displayOrder: Number(c.display_order ?? 1),
    isActive: c.is_active !== false,
    items: ((c.items as Record<string, unknown>[]) ?? []).map((it) => mapMenuItemRow(it, restId)),
  };
}

export const httpDiscoveryService: IDiscoveryService = {
  async checkServiceability(lat, lng) {
    return apiRequest(`/discovery/serviceability?lat=${lat}&lng=${lng}`);
  },
  async getFeed(filters) {
    const params = new URLSearchParams({
      lat: String(filters.lat),
      lng: String(filters.lng),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.sortBy ? { sort: filters.sortBy } : {}),
      ...(filters.minRating ? { min_rating: String(filters.minRating) } : {}),
    });
    const res = await apiRequest<{
      serviceable: boolean;
      zone: {
        id: string;
        name: string;
        city: string;
        timezone: string;
        currency: string;
        base_delivery_fee_minor: number;
      } | null;
      spotlight_restaurant: Record<string, unknown> | null;
      restaurants: Record<string, unknown>[];
    }>(`/discovery/feed?${params.toString()}`);

    const zoneCity = res.zone?.city ?? "Bengaluru";
    const zoneId = res.zone?.id ?? "";
    const mapRest = (r: Record<string, unknown>) =>
      mapDiscoveryRestaurant(r, filters.lat, filters.lng, zoneCity, zoneId);

    return {
      serviceable: res.serviceable,
      zone: res.zone
        ? {
            id: res.zone.id,
            name: res.zone.name,
            city: res.zone.city,
            timezone: res.zone.timezone,
            currency: res.zone.currency,
            isActive: true,
            baseDeliveryFeeMinor: res.zone.base_delivery_fee_minor,
            center: { lat: filters.lat, lng: filters.lng },
            radiusMeters: 12000,
          }
        : null,
      spotlightRestaurant: res.spotlight_restaurant
        ? mapRest(res.spotlight_restaurant)
        : null,
      restaurants: (res.restaurants ?? []).map(mapRest),
    };
  },
  async search(query, lat, lng) {
    const res = await apiRequest<{
      restaurants: Record<string, unknown>[];
      dishes: { item: Record<string, unknown>; restaurant: Record<string, unknown> }[];
    }>(`/discovery/search?q=${encodeURIComponent(query)}&lat=${lat}&lng=${lng}`);
    return {
      restaurants: (res.restaurants ?? []).map((r) => mapDiscoveryRestaurant(r, lat, lng)),
      dishes: (res.dishes ?? []).map((d) => ({
        item: mapMenuItemRow(d.item),
        restaurant: mapDiscoveryRestaurant(d.restaurant, lat, lng),
      })),
    };
  },
  async getRestaurantMenu(slugOrId, lat, lng, query) {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      ...(query ? { q: query } : {}),
    });
    const res = await apiRequest<{
      restaurant: Record<string, unknown>;
      categories: Record<string, unknown>[];
    }>(`/restaurants/${encodeURIComponent(slugOrId)}?${params.toString()}`);
    const rest = mapDiscoveryRestaurant(res.restaurant ?? {}, lat, lng);
    return {
      restaurant: rest,
      categories: (res.categories ?? []).map((c) => mapMenuCategoryRow(c, rest.id)),
    };
  },
};

let liveCartTipMinor = 0;
let liveCartInstructions = "";

function createEmptyCart(): Cart {
  return {
    restaurantId: null,
    restaurantName: null,
    restaurantSlug: null,
    estimatedDeliveryMin: 20,
    estimatedDeliveryMax: 30,
    currency: "INR",
    items: [],
    appliedCouponCode: null,
    tipAmountMinor: liveCartTipMinor,
    specialInstructions: liveCartInstructions,
    breakdown: {
      itemSubtotalMinor: 0,
      smallCartFeeMinor: 0,
      packagingFeeMinor: 0,
      deliveryFeeMinor: 0,
      platformFeeMinor: 0,
      discountAmountMinor: 0,
      taxAmountMinor: 0,
      tipAmountMinor: 0,
      totalPayableMinor: 0,
    },
  };
}

function mapCartDto(c: Record<string, unknown>): Cart {
  const b = (c.breakdown as Record<string, unknown>) ?? {};
  const items = ((c.items as Record<string, unknown>[]) ?? []).map((it) => ({
    id: String(it.id ?? ""),
    menuItemId: String(it.menu_item_id ?? ""),
    name: String(it.name ?? ""),
    imageUrl: String(
      it.image_url ??
        "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80"
    ),
    unitBasePriceMinor: Number(it.unit_base_price_minor ?? 0),
    unitCustomizationsPriceMinor: Number(it.unit_customizations_price_minor ?? 0),
    quantity: Number(it.quantity ?? 1),
    customizations: ((it.customizations as Record<string, unknown>[]) ?? []).map((opt) => ({
      groupId: String(opt.group_id ?? ""),
      optionId: String(opt.option_id ?? ""),
      groupName: String(opt.group_name ?? ""),
      optionName: String(opt.option_name ?? ""),
      priceDeltaMinor: Number(opt.price_delta_minor ?? 0),
    })),
    lineTotalMinor: Number(it.line_total_minor ?? 0),
  }));
  const tip = Number(b.tip_amount_minor ?? liveCartTipMinor);
  const itemSubtotal = Number(b.item_subtotal_minor ?? 0);
  const totalWithClientTip =
    items.length > 0 && Number(b.tip_amount_minor ?? 0) === 0 && liveCartTipMinor > 0
      ? Number(b.total_payable_minor ?? 0) + liveCartTipMinor
      : Number(b.total_payable_minor ?? 0);
  return {
    restaurantId: c.restaurant_id ? String(c.restaurant_id) : null,
    restaurantName: c.restaurant_name ? String(c.restaurant_name) : null,
    restaurantSlug: c.restaurant_slug ? String(c.restaurant_slug) : null,
    estimatedDeliveryMin: 20,
    estimatedDeliveryMax: 30,
    currency: String(c.currency ?? "INR"),
    items,
    appliedCouponCode: c.applied_coupon_code ? String(c.applied_coupon_code) : null,
    tipAmountMinor: items.length > 0 ? tip : 0,
    specialInstructions: c.special_instructions
      ? String(c.special_instructions)
      : liveCartInstructions,
    breakdown: {
      itemSubtotalMinor: itemSubtotal,
      smallCartFeeMinor: Number(b.small_cart_fee_minor ?? 0),
      packagingFeeMinor: Number(b.packaging_fee_minor ?? 0),
      deliveryFeeMinor: Number(b.delivery_fee_minor ?? 0),
      platformFeeMinor: Number(b.platform_fee_minor ?? 0),
      discountAmountMinor: Number(b.discount_amount_minor ?? 0),
      taxAmountMinor: Number(b.tax_amount_minor ?? 0),
      tipAmountMinor: items.length > 0 ? tip : 0,
      totalPayableMinor: totalWithClientTip,
    },
  };
}

export const httpCartService: ICartService = {
  async getCart(addressId?: string | null) {
    try {
      const q = addressId ? `?address_id=${encodeURIComponent(addressId)}` : "";
      const raw = await apiRequest<Record<string, unknown>>(`/customer/cart${q}`);
      return mapCartDto(raw ?? {});
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return createEmptyCart();
      }
      throw err;
    }
  },
  async addItem(payload) {
    try {
      const raw = await apiRequest<Record<string, unknown>>("/customer/cart/items", {
        method: "POST",
        body: JSON.stringify({
          restaurant_id: payload.restaurantId,
          menu_item_id: payload.menuItemId,
          quantity: payload.quantity,
          selected_option_ids: payload.selectedOptionIds,
          replace_cart: Boolean(payload.replaceCart),
        }),
      });
      return mapCartDto(raw ?? {});
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw new ApiError(
          "UNAUTHORIZED",
          "Please sign in as a Customer to add items to your bag.",
          401
        );
      }
      throw err;
    }
  },
  async updateItemQuantity(cartItemId, quantity) {
    const raw = await apiRequest<Record<string, unknown>>(
      `/customer/cart/items/${encodeURIComponent(cartItemId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      }
    );
    return mapCartDto(raw ?? {});
  },
  async removeItem(cartItemId) {
    const raw = await apiRequest<Record<string, unknown>>(
      `/customer/cart/items/${encodeURIComponent(cartItemId)}`,
      { method: "DELETE" }
    );
    return mapCartDto(raw ?? {});
  },
  async clearCart() {
    liveCartTipMinor = 0;
    liveCartInstructions = "";
    const raw = await apiRequest<Record<string, unknown>>("/customer/cart", {
      method: "DELETE",
    });
    return mapCartDto(raw ?? {});
  },
  async applyCoupon(code) {
    const raw = await apiRequest<Record<string, unknown>>("/customer/cart/coupon", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    return mapCartDto(raw ?? {});
  },
  async removeCoupon() {
    const raw = await apiRequest<Record<string, unknown>>("/customer/cart/coupon", {
      method: "DELETE",
    });
    return mapCartDto(raw ?? {});
  },
  async setTip(tipAmountMinor) {
    liveCartTipMinor = Math.max(0, tipAmountMinor);
    return this.getCart();
  },
  async setSpecialInstructions(instructions) {
    liveCartInstructions = instructions;
    return this.getCart();
  },
  async validateCheckout(addressId) {
    const raw = await apiRequest<{
      is_valid: boolean;
      pricing_quote_hash: string;
      cart: Record<string, unknown>;
    }>("/customer/cart/validate-checkout", {
      method: "POST",
      body: JSON.stringify({
        delivery_address_id: addressId,
        tip_amount_minor: liveCartTipMinor,
      }),
    });
    return {
      isValid: Boolean(raw.is_valid),
      pricingQuoteHash: String(raw.pricing_quote_hash ?? ""),
      cart: mapCartDto(raw.cart ?? {}),
    };
  },
};

function mapPaymentRow(
  p: Record<string, unknown>,
  orderNumberFallback = "",
  customerIdFallback = ""
): PaymentRecord {
  return {
    id: String(p.id ?? ""),
    orderId: String(p.order_id ?? ""),
    orderNumber: String(p.order_number ?? orderNumberFallback),
    customerId: String(p.customer_id ?? customerIdFallback),
    provider: (String(p.provider ?? "RAZORPAY") as PaymentRecord["provider"]),
    providerOrderId: String(p.provider_order_id ?? ""),
    providerPaymentId: p.provider_payment_id ? String(p.provider_payment_id) : undefined,
    amountMinor: Number(p.amount_minor ?? 0),
    currency: String(p.currency ?? "INR"),
    status: (String(p.status ?? "INITIATED") as PaymentRecord["status"]),
    paymentInstrument: p.payment_instrument ? String(p.payment_instrument) : undefined,
    failureMessage: p.failure_message ? String(p.failure_message) : undefined,
    reconciledAt: p.reconciled_at ? String(p.reconciled_at) : undefined,
    createdAt: String(p.created_at ?? new Date().toISOString()),
  };
}

function mapRefundRow(
  rf: Record<string, unknown>,
  orderNumberFallback = "",
  currencyFallback = "INR"
): RefundRecord {
  return {
    id: String(rf.id ?? ""),
    paymentId: String(rf.payment_id ?? ""),
    orderId: String(rf.order_id ?? ""),
    orderNumber: String(rf.order_number ?? orderNumberFallback),
    amountMinor: Number(rf.amount_minor ?? 0),
    currency: String(rf.currency ?? currencyFallback),
    refundType: (String(rf.refund_type ?? "FULL") as RefundRecord["refundType"]),
    reasonCode: String(rf.reason_code ?? "ADMIN_ADJUSTMENT"),
    notes: rf.notes ? String(rf.notes) : undefined,
    status: (String(rf.status ?? "PENDING") as RefundRecord["status"]),
    initiatedByRole: String(rf.initiated_by_role ?? "SYSTEM"),
    createdAt: String(rf.created_at ?? new Date().toISOString()),
  };
}

export const httpOrderService: Partial<IOrderService> = {
  async createOrder(payload) {
    const raw = await apiRequest<{ order: Record<string, unknown> }>("/customer/orders", {
      method: "POST",
      headers: {
        "Idempotency-Key": payload.idempotencyKey,
      },
      body: JSON.stringify({
        delivery_address_id: payload.deliveryAddressId,
        payment_method: payload.paymentMethod,
        tip_amount_minor: liveCartTipMinor,
        special_instructions: liveCartInstructions,
      }),
    });
    liveCartTipMinor = 0;
    liveCartInstructions = "";
    const order = mapRestaurantOrderRow(raw.order ?? {});

    if (payload.paymentMethod === "COD") {
      const payment: PaymentRecord = {
        id: `pay-${order.id}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        provider: "COD",
        providerOrderId: order.orderNumber,
        amountMinor: order.breakdown.totalPayableMinor,
        currency: order.currency,
        status: "INITIATED",
        createdAt: order.createdAt,
      };
      return { order, payment };
    }

    const sess = await apiRequest<Record<string, unknown>>(
      "/customer/payments/initiate",
      {
        method: "POST",
        body: JSON.stringify({ order_id: order.id }),
      }
    ).catch(() => null);

    if (payload.deferOnlineCapture) {
      const payment: PaymentRecord = {
        id: String(sess?.payment_id ?? `pay-${order.id}`),
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        provider: (String(sess?.provider ?? "RAZORPAY") as PaymentRecord["provider"]),
        providerOrderId: String(sess?.provider_order_id ?? order.orderNumber),
        amountMinor: Number(sess?.amount_minor ?? order.breakdown.totalPayableMinor),
        currency: String(sess?.currency ?? order.currency),
        status: "INITIATED",
        createdAt: order.createdAt,
      };
      return { order, payment };
    }

    if (payload.simulatePaymentFailure) {
      return this.simulateGatewayDecision!(
        order.id,
        "FAIL",
        "Simulated bank authorization decline (timeout / insufficient funds)"
      );
    }

    return this.simulateGatewayDecision!(order.id, "CAPTURE");
  },
  async simulateGatewayDecision(orderId, outcome, reason) {
    if (outcome === "FAIL") {
      const failRes = await apiRequest<{ payment?: Record<string, unknown> }>(
        "/customer/payments/sandbox-fail",
        {
          method: "POST",
          body: JSON.stringify({
            order_id: orderId,
            reason:
              reason ??
              "Simulated bank authorization decline (timeout / insufficient funds)",
          }),
        }
      );
      const refreshedOrder = await this.getOrderById!(orderId);
      return {
        order: refreshedOrder,
        payment: mapPaymentRow(
          failRes.payment ?? {},
          refreshedOrder.orderNumber,
          refreshedOrder.customerId
        ),
      };
    }

    const capRes = await apiRequest<{ payment?: Record<string, unknown> }>(
      "/customer/payments/sandbox-capture",
      {
        method: "POST",
        body: JSON.stringify({ order_id: orderId }),
      }
    );
    const refreshedOrder = await this.getOrderById!(orderId);
    return {
      order: refreshedOrder,
      payment: mapPaymentRow(
        capRes.payment ?? {},
        refreshedOrder.orderNumber,
        refreshedOrder.customerId
      ),
    };
  },
  async retryPayment(orderId) {
    await apiRequest("/customer/payments/initiate", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    }).catch(() => null);
    return this.simulateGatewayDecision!(orderId, "CAPTURE");
  },
  async listMyOrders() {
    const rows = await apiRequest<Record<string, unknown>[]>("/customer/orders");
    return (rows ?? []).map(mapRestaurantOrderRow);
  },
  async getOrderById(orderId) {
    const row = await apiRequest<Record<string, unknown>>(
      `/customer/orders/${encodeURIComponent(orderId)}`
    );
    return mapRestaurantOrderRow(row ?? {});
  },
  async cancelOrder(orderId, reason) {
    const row = await apiRequest<Record<string, unknown>>(
      `/customer/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      }
    );
    return mapRestaurantOrderRow(row ?? {});
  },
  async getTrackingSnapshot(orderId): Promise<TrackingSnapshot> {
    const order = await this.getOrderById!(orderId);
    return {
      orderId: order.id,
      partnerId: order.partnerId,
      partnerName: order.partnerName,
      partnerLocation: order.pickupLocation,
      bearingDegrees: 0,
      etaMinutes: order.estimatedPrepMinutes,
      distanceRemainingMeters: order.roadDistanceMeters,
      routeProgress: 0.25,
      updatedAt: order.updatedAt,
    };
  },
  async submitReview(orderId, payload): Promise<ReviewRecord> {
    const r = await apiRequest<Record<string, unknown>>(
      `/customer/orders/${encodeURIComponent(orderId)}/review`,
      {
        method: "POST",
        body: JSON.stringify({
          restaurant_rating: payload.foodRating,
          delivery_partner_rating: payload.deliveryRating,
          restaurant_comment: payload.comment,
          delivery_partner_comment: payload.deliveryComment,
          item_ratings: (payload.itemRatings ?? []).map((it) => ({
            menu_item_id: it.menuItemId,
            rating: it.rating,
            comment: it.comment,
          })),
        }),
      }
    );
    return {
      id: String(r.id ?? ""),
      orderId: String(r.order_id ?? orderId),
      restaurantId: "",
      customerName: "Customer",
      foodRating: Number(r.restaurant_rating ?? payload.foodRating),
      deliveryRating: r.delivery_partner_rating
        ? Number(r.delivery_partner_rating)
        : undefined,
      comment: r.restaurant_comment ? String(r.restaurant_comment) : payload.comment,
      deliveryComment: r.delivery_partner_comment
        ? String(r.delivery_partner_comment)
        : payload.deliveryComment,
      editableUntil: String(r.editable_until ?? new Date().toISOString()),
      createdAt: String(r.created_at ?? new Date().toISOString()),
    };
  },
};

const ACTIVE_OUTLET_STORAGE_KEY = "goodly_active_outlet_id";

function getStoredOutletId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_OUTLET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredOutletId(outletId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (outletId) {
      window.localStorage.setItem(ACTIVE_OUTLET_STORAGE_KEY, outletId);
    } else {
      window.localStorage.removeItem(ACTIVE_OUTLET_STORAGE_KEY);
    }
  } catch {
    // Ignore storage unavailability
  }
}

function withOutletQuery(path: string, explicitOutletId?: string | null): string {
  const outletId = explicitOutletId ?? getStoredOutletId();
  if (!outletId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}outlet_id=${encodeURIComponent(outletId)}`;
}

function mapOperatingSlots(raw: unknown): OperatingHourSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: Record<string, unknown>) => ({
    dayOfWeek: Number(s.day_of_week ?? 0),
    slotNumber: Number(s.slot_number ?? 1),
    openTime: String(s.open_time ?? "09:00").slice(0, 5),
    closeTime: String(s.close_time ?? "22:00").slice(0, 5),
    isClosed: Boolean(s.is_closed),
  }));
}

function mapStaffRow(s: Record<string, unknown>, fallbackOutletId = ""): OutletStaffMember {
  return {
    id: String(s.id ?? ""),
    outletId: String(s.outlet_id ?? fallbackOutletId),
    outletName: s.outlet_name ? String(s.outlet_name) : undefined,
    brandName: s.brand_name ? String(s.brand_name) : undefined,
    branchName: s.branch_name ? String(s.branch_name) : undefined,
    userId: s.user_id ? String(s.user_id) : undefined,
    fullName: String(s.full_name ?? "Team Member"),
    email: String(s.email ?? ""),
    phone: String(s.phone ?? ""),
    roleCode: (s.role_code as OutletStaffMember["roleCode"]) ?? "OUTLET_STAFF",
    outletRoleId: s.outlet_role_id ? String(s.outlet_role_id) : undefined,
    outletRoleName: s.outlet_role_name ? String(s.outlet_role_name) : undefined,
    permissions: (s.permissions as OutletPermission[]) ?? [],
    status: (s.status as OutletStaffMember["status"]) ?? "PENDING_ACCEPTANCE",
    acceptedAt: s.accepted_at ? String(s.accepted_at) : undefined,
    approvedAt: s.approved_at ? String(s.approved_at) : undefined,
  };
}

function mapRestaurantOrderRow(o: Record<string, unknown>): Order {
  const b = (o.breakdown as Record<string, unknown>) ?? {};
  return {
    id: String(o.id ?? ""),
    orderNumber: String(o.order_number ?? ""),
    customerId: String(o.customer_id ?? ""),
    customerName: String(o.customer_name ?? "Customer"),
    customerPhone: String(o.customer_phone ?? ""),
    restaurantId: String(o.restaurant_id ?? ""),
    restaurantName: String(o.restaurant_name ?? ""),
    restaurantSlug: String(o.restaurant_slug ?? ""),
    restaurantAddress: String(o.restaurant_address ?? ""),
    pickupLocation: {
      lat: Number(o.pickup_lat ?? 12.9784),
      lng: Number(o.pickup_lng ?? 77.6408),
    },
    deliveryAddressSnapshot: {
      id: "",
      userId: String(o.customer_id ?? ""),
      label: "Other",
      recipientName: String(o.customer_name ?? "Customer"),
      recipientPhone: String(o.customer_phone ?? ""),
      addressLine1: String(o.delivery_address_line1 ?? "Service Zone Address"),
      city: "Bengaluru",
      state: "KA",
      postalCode: "560038",
      countryCode: "IN",
      location: {
        lat: Number(o.dropoff_lat ?? 12.9784),
        lng: Number(o.dropoff_lng ?? 77.6408),
      },
      isDefault: false,
      isServiceable: true,
    },
    deliveryLocation: {
      lat: Number(o.dropoff_lat ?? 12.9784),
      lng: Number(o.dropoff_lng ?? 77.6408),
    },
    orderStatus: (o.order_status as Order["orderStatus"]) ?? "CONFIRMED",
    paymentStatus: (o.payment_status as Order["paymentStatus"]) ?? "CAPTURED",
    deliveryStatus: (o.delivery_status as Order["deliveryStatus"]) ?? "PENDING",
    paymentMethod: (o.payment_method as "ONLINE" | "COD") ?? "ONLINE",
    currency: String(o.currency ?? "INR"),
    partnerId: o.partner_id ? String(o.partner_id) : undefined,
    partnerName: o.partner_name ? String(o.partner_name) : undefined,
    breakdown: {
      itemSubtotalMinor: Number(b.item_subtotal_minor ?? 0),
      smallCartFeeMinor: Number(b.small_cart_fee_minor ?? 0),
      packagingFeeMinor: Number(b.packaging_fee_minor ?? 0),
      deliveryFeeMinor: Number(b.delivery_fee_minor ?? 0),
      platformFeeMinor: Number(b.platform_fee_minor ?? 0),
      discountAmountMinor: Number(b.discount_amount_minor ?? 0),
      taxAmountMinor: Number(b.tax_amount_minor ?? 0),
      tipAmountMinor: Number(b.tip_amount_minor ?? o.tip_amount_minor ?? 0),
      totalPayableMinor: Number(b.total_payable_minor ?? o.total_payable_minor ?? 0),
    },
    specialInstructions: o.special_instructions ? String(o.special_instructions) : undefined,
    deliveryPin:
      o.payment_method === "ONLINE" &&
      ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(String(o.payment_status ?? ""))
        ? String(o.delivery_otp_hint ?? "")
        : "",
    otpVerifiedAt: o.otp_verified_at ? String(o.otp_verified_at) : undefined,
    acceptDeadlineAt: o.accept_deadline_at ? String(o.accept_deadline_at) : undefined,
    customerCareAlertedAt: o.customer_care_alerted_at ? String(o.customer_care_alerted_at) : undefined,
    graceDeadlineAt: o.grace_deadline_at ? String(o.grace_deadline_at) : undefined,
    acceptanceEscalationState:
      (o.acceptance_escalation_state as Order["acceptanceEscalationState"]) ?? "NONE",
    ratingPromptStatus:
      (o.rating_prompt_status as Order["ratingPromptStatus"]) ?? "PENDING_DELIVERY",
    estimatedPrepMinutes: Number(o.estimated_prep_minutes ?? 20),
    estimatedDeliveryAt: String(o.updated_at ?? new Date().toISOString()),
    roadDistanceMeters: 2500,
    items: ((o.items as Record<string, unknown>[]) ?? []).map((it) => ({
      id: String(it.id ?? ""),
      menuItemId: String(it.menu_item_id ?? ""),
      name: String(it.name ?? ""),
      quantity: Number(it.quantity ?? 1),
      unitBasePriceMinor: Number(it.unit_base_price_minor ?? 0),
      unitCustomizationsPriceMinor: Number(it.unit_customizations_price_minor ?? 0),
      lineTotalMinor: Number(it.line_total_minor ?? 0),
      customizations: [],
    })),
    statusHistory: [],
    version: Number(o.version ?? 1),
    createdAt: String(o.created_at ?? new Date().toISOString()),
    updatedAt: String(o.updated_at ?? new Date().toISOString()),
  };
}

function mapOutletRow(r: Record<string, unknown>): Restaurant {
  return {
    id: String(r.id ?? ""),
    ownerUserId: String(r.owner_user_id ?? ""),
    brandName: r.brand_name ? String(r.brand_name) : undefined,
    branchName: r.branch_name ? String(r.branch_name) : undefined,
    serviceZoneId: String(r.service_zone_id ?? ""),
    slug: String(r.slug ?? ""),
    name: String(r.name ?? ""),
    eyebrow: String(r.eyebrow ?? ""),
    tagline: String(r.tagline ?? ""),
    description: String(r.description ?? ""),
    cuisines: (r.cuisines as string[]) ?? [],
    categoryFilterKeys: [],
    phone: String(r.phone ?? ""),
    email: String(r.email ?? r.owner_email ?? ""),
    addressLine1: String(r.address_line1 ?? ""),
    city: String(r.city ?? "Bengaluru"),
    state: String(r.state ?? "KA"),
    postalCode: String(r.postal_code ?? "560038"),
    location: { lat: Number(r.lat ?? 12.9784), lng: Number(r.lng ?? 77.6408) },
    maxDeliveryRadiusMeters: Number(r.max_delivery_radius_meters ?? 7000),
    heroImageUrl: String(r.hero_image_url ?? "/images/sunday-table.jpg"),
    cardImageUrl: String(r.hero_image_url ?? "/images/sunday-table.jpg"),
    verificationStatus: (r.verification_status as Restaurant["verificationStatus"]) ?? "PENDING_REVIEW",
    isActive: r.is_active !== false,
    isAcceptingOrders: Boolean(r.is_accepting_orders),
    maxConcurrentOrders: (r.max_concurrent_orders as number | null) ?? 15,
    activeOrdersCount: Number(r.active_orders_count ?? 0),
    avgPrepTimeMinutes: Number(r.avg_prep_time_minutes ?? 20),
    estimatedDeliveryMin: 20,
    estimatedDeliveryMax: 32,
    deliveryFeeMinor: 2900,
    minOrderAmountMinor: Number(r.min_order_amount_minor ?? 29900),
    packagingFeeMinor: Number(r.packaging_fee_minor ?? 2000),
    commissionRateBps: Number(r.commission_rate_bps ?? 2000),
    currency: "INR",
    ratingAverage: Number(r.rating_average ?? 5.0),
    ratingCount: Number(r.rating_count ?? 0),
    operatingHours: mapOperatingSlots(r.operating_hours),
  };
}

function mapOwnerProfileRow(p: Record<string, unknown>): RestaurantOwnerProfile {
  return {
    id: String(p.id ?? ""),
    userId: String(p.user_id ?? ""),
    fullName: p.full_name ? String(p.full_name) : undefined,
    email: p.email ? String(p.email) : undefined,
    phone: p.phone ? String(p.phone) : undefined,
    organizationName: p.organization_name ? String(p.organization_name) : undefined,
    idDocumentType:
      (p.id_document_type as RestaurantOwnerProfile["idDocumentType"]) || "PAN_CARD",
    idDocumentNumber: String(p.id_document_number ?? ""),
    idDocumentFilename: p.id_document_filename ? String(p.id_document_filename) : undefined,
    verificationStatus:
      (p.verification_status as RestaurantOwnerProfile["verificationStatus"]) ?? "NOT_SUBMITTED",
    reviewNotes: p.review_notes ? String(p.review_notes) : undefined,
    createdAt: p.created_at ? String(p.created_at) : undefined,
  };
}

export const httpRestaurantPortalService: Partial<IRestaurantPortalService> = {
  async listMyOutlets() {
    const rows = await apiRequest<Record<string, unknown>[]>("/restaurant/outlets");
    return (rows ?? []).map(mapOutletRow);
  },
  async getMyRestaurant(): Promise<RestaurantWithMenu> {
    let o: Record<string, unknown>;
    try {
      o = await apiRequest<Record<string, unknown>>(withOutletQuery("/restaurants/me"));
    } catch (err) {
      if (getStoredOutletId() && err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setStoredOutletId(null);
        o = await apiRequest<Record<string, unknown>>("/restaurants/me");
      } else {
        throw err;
      }
    }
    const restaurant = mapOutletRow(o);
    setStoredOutletId(restaurant.id);
    const rawCats = await apiRequest<Record<string, unknown>[]>(
      `/restaurant/menu?outlet_id=${encodeURIComponent(restaurant.id)}`
    ).catch(() => []);
    return {
      restaurant,
      categories: (rawCats ?? []).map((c) => mapMenuCategoryRow(c, restaurant.id)),
    };
  },
  async switchActiveOutlet(outletId: string): Promise<RestaurantWithMenu> {
    const o = await apiRequest<Record<string, unknown>>(
      `/restaurants/me?outlet_id=${encodeURIComponent(outletId)}`
    );
    const restaurant = mapOutletRow(o);
    setStoredOutletId(restaurant.id);
    const rawCats = await apiRequest<Record<string, unknown>[]>(
      `/restaurant/menu?outlet_id=${encodeURIComponent(restaurant.id)}`
    ).catch(() => []);
    return {
      restaurant,
      categories: (rawCats ?? []).map((c) => mapMenuCategoryRow(c, restaurant.id)),
    };
  },
  async updateOutletCapacity(maxConcurrentOrders) {
    const o = await apiRequest<Record<string, unknown>>(withOutletQuery("/restaurant/me"), {
      method: "PATCH",
      body: JSON.stringify({
        max_concurrent_orders: maxConcurrentOrders,
        clear_capacity_limit: maxConcurrentOrders === null,
      }),
    });
    return mapOutletRow(o);
  },
  async toggleAcceptingOrders(isAccepting) {
    const o = await apiRequest<Record<string, unknown>>(
      withOutletQuery("/restaurant/me/availability"),
      {
        method: "PATCH",
        body: JSON.stringify({ is_accepting_orders: isAccepting }),
      }
    );
    return mapOutletRow(o);
  },
  async updateOperatingHours(hours) {
    await apiRequest(withOutletQuery("/restaurant/me/operating-hours"), {
      method: "PUT",
      body: JSON.stringify({
        slots: hours.map((h) => ({
          day_of_week: h.dayOfWeek,
          slot_number: h.slotNumber,
          open_time: h.openTime,
          close_time: h.closeTime,
          is_closed: h.isClosed,
        })),
      }),
    });
    const res = await this.getMyRestaurant!();
    return res.restaurant;
  },
  async createCategory(payload) {
    const c = await apiRequest<Record<string, unknown>>(
      withOutletQuery("/restaurant/menu/categories"),
      {
        method: "POST",
        body: JSON.stringify({
          name: payload.name,
          subtitle: payload.subtitle,
        }),
      }
    );
    return mapMenuCategoryRow(c, getStoredOutletId() ?? "");
  },
  async upsertMenuItem(payload) {
    const body = JSON.stringify({
      category_id: payload.categoryId,
      name: payload.name,
      description: payload.description ?? "",
      badge_label: payload.badgeLabel,
      veg_classification: payload.vegClassification ?? "VEG",
      base_price_minor: payload.basePriceMinor,
      track_inventory: Boolean(payload.trackInventory),
      available_quantity: payload.availableQuantity ?? 25,
      image_url: payload.imageUrl || undefined,
      dietary_tags: payload.dietaryTags ?? [],
      cuisine_type: payload.cuisineType || undefined,
      spice_level: payload.spiceLevel ?? "NONE",
      calories_kcal: payload.caloriesKcal ?? undefined,
      serving_size: payload.servingSize || undefined,
      prep_time_minutes: payload.prepTimeMinutes ?? undefined,
      ingredients: payload.ingredients ?? [],
      allergens: payload.allergens ?? [],
      search_keywords: payload.searchKeywords ?? [],
      is_recommended: Boolean(payload.isRecommended),
      customization_groups: payload.customizationGroups
        ? payload.customizationGroups.map((g) => ({
            id: g.id,
            name: g.name,
            min_selections: g.minSelections,
            max_selections: g.maxSelections,
            is_required: g.isRequired,
            options: g.options.map((o) => ({
              id: o.id,
              name: o.name,
              price_delta_minor: o.priceDeltaMinor,
              is_default: o.isDefault,
              is_available: o.isAvailable,
            })),
          }))
        : undefined,
    });
    const saved = payload.id
      ? await apiRequest<Record<string, unknown>>(
          withOutletQuery(`/restaurant/menu/items/${encodeURIComponent(payload.id)}`),
          { method: "PUT", body }
        )
      : await apiRequest<Record<string, unknown>>(
          withOutletQuery("/restaurant/menu/items"),
          { method: "POST", body }
        );
    return mapMenuItemRow(saved, getStoredOutletId() ?? "");
  },
  async toggleMenuItemAvailability(itemId, isAvailable) {
    const updated = await apiRequest<Record<string, unknown>>(
      withOutletQuery(`/restaurant/menu/items/${encodeURIComponent(itemId)}/availability`),
      {
        method: "PATCH",
        body: JSON.stringify({ is_available: isAvailable }),
      }
    );
    return mapMenuItemRow(updated, getStoredOutletId() ?? "");
  },
  async listRestaurantOrders() {
    const rows = await apiRequest<Record<string, unknown>[]>(
      withOutletQuery("/restaurant/orders")
    );
    return (rows ?? []).map(mapRestaurantOrderRow);
  },
  async acceptOrder(orderId, estimatedPrepMinutes) {
    const o = await apiRequest<Record<string, unknown>>(
      withOutletQuery(`/restaurant/orders/${encodeURIComponent(orderId)}/accept`),
      {
        method: "POST",
        body: JSON.stringify({ estimated_prep_minutes: estimatedPrepMinutes }),
      }
    );
    return mapRestaurantOrderRow(o);
  },
  async rejectOrder(orderId, reason) {
    const o = await apiRequest<Record<string, unknown>>(
      withOutletQuery(`/restaurant/orders/${encodeURIComponent(orderId)}/reject`),
      {
        method: "POST",
        body: JSON.stringify({ reason_code: reason }),
      }
    );
    return mapRestaurantOrderRow(o);
  },
  async advanceOrderStatus(orderId, nextStatus) {
    const o = await apiRequest<Record<string, unknown>>(
      withOutletQuery(`/restaurant/orders/${encodeURIComponent(orderId)}/status`),
      {
        method: "PATCH",
        body: JSON.stringify({ next_status: nextStatus }),
      }
    );
    return mapRestaurantOrderRow(o);
  },
  async getSettlementsAndReviews() {
    const data = await apiRequest<{
      settlements: Record<string, unknown>[];
      penalties: Record<string, unknown>[];
    }>(withOutletQuery("/restaurant/me/settlements"));
    const settlements: RestaurantSettlement[] = (data.settlements ?? []).map((s) => ({
      id: String(s.id ?? ""),
      orderId: String(s.order_id ?? ""),
      orderNumber: String(s.order_number ?? ""),
      restaurantId: String(s.restaurant_id ?? ""),
      grossFoodAmountMinor: Number(s.gross_food_amount_minor ?? 0),
      packagingFeeMinor: Number(s.packaging_fee_minor ?? 0),
      platformCommissionBps: Number(s.platform_commission_bps ?? 2000),
      platformCommissionMinor: Number(s.platform_commission_minor ?? 0),
      taxWithheldMinor: Number(s.penalty_deduction_minor ?? 0),
      netPayoutMinor: Number(s.net_payout_minor ?? 0),
      currency: "INR",
      settlementStatus:
        (s.settlement_status as RestaurantSettlement["settlementStatus"]) ?? "ACCRUED",
      createdAt: String(s.created_at ?? new Date().toISOString()),
    }));
    const penalties: OutletPenaltyRecord[] = (data.penalties ?? []).map((p) => ({
      id: String(p.id ?? ""),
      orderId: String(p.order_id ?? ""),
      orderNumber: "",
      outletId: String(p.outlet_id ?? ""),
      outletName: "",
      penaltyAmountMinor: Number(p.penalty_amount_minor ?? 0),
      currency: String(p.currency ?? "INR"),
      reasonCode: String(p.reason_code ?? ""),
      penaltyModeSnapshot: String(p.order_resolution_policy ?? ""),
      status: (p.status as OutletPenaltyRecord["status"]) ?? "APPLIED",
      createdAt: String(p.created_at ?? new Date().toISOString()),
    }));
    return { settlements, penalties, reviews: [] };
  },
  async listServiceZones(): Promise<ServiceZone[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/service-zones");
    return (rows ?? []).map((z) => ({
      id: String(z.id ?? ""),
      name: String(z.name ?? ""),
      city: String(z.city ?? ""),
      timezone: "Asia/Kolkata",
      currency: "INR",
      isActive: true,
      baseDeliveryFeeMinor: Number(z.base_delivery_fee_minor ?? 2900),
      center: { lat: 12.9784, lng: 77.6408 },
      radiusMeters: 12000,
    }));
  },
  async getOwnerProfile() {
    const p = await apiRequest<Record<string, unknown>>("/restaurant/owner-profile");
    return mapOwnerProfileRow(p);
  },
  async submitOwnerProfile(payload) {
    const p = await apiRequest<Record<string, unknown>>("/restaurant/owner-profile", {
      method: "POST",
      body: JSON.stringify({
        organization_name: payload.organizationName,
        id_document_type: payload.idDocumentType,
        id_document_number: payload.idDocumentNumber,
        id_document_filename: payload.idDocumentFilename,
      }),
    });
    return mapOwnerProfileRow(p);
  },
  async submitOnboarding(payload) {
    const created = await apiRequest<Record<string, unknown>>("/restaurant/onboarding", {
      method: "POST",
      body: JSON.stringify({
        setup_type: payload.setupType,
        name: payload.name,
        brand_name: payload.brandName,
        branch_name: payload.branchName,
        service_zone_id: payload.serviceZoneId,
        cuisines: payload.cuisines,
        phone: payload.phone,
        email: payload.email,
        address_line1: payload.addressLine1,
        city: payload.city,
        state: payload.state,
        postal_code: payload.postalCode,
        license_number: payload.licenseNumber,
      }),
    });
    const outlet = mapOutletRow(created);
    setStoredOutletId(outlet.id);
    return outlet;
  },
  async listBranchStaff(outletId?: string) {
    if (outletId === "all") {
      const rows = await apiRequest<Record<string, unknown>[]>("/restaurant/staff");
      return (rows ?? []).map((s) => mapStaffRow(s));
    }
    const id = outletId || getStoredOutletId() || (await this.listMyOutlets?.())?.[0]?.id;
    if (!id) return [];
    const rows = await apiRequest<Record<string, unknown>[]>(`/restaurant/outlets/${id}/staff`);
    return (rows ?? []).map((s) => mapStaffRow(s, id));
  },
  async inviteBranchStaff(payload) {
    const targets =
      payload.outletIds && payload.outletIds.length > 0
        ? payload.outletIds
        : [payload.outletId || getStoredOutletId() || (await this.listMyOutlets?.())?.[0]?.id].filter(
            Boolean
          ) as string[];
    const res = await apiRequest<{
      assignments?: Record<string, unknown>[];
      first?: Record<string, unknown>;
    }>("/restaurant/staff/invite", {
      method: "POST",
      body: JSON.stringify({
        outlet_ids: targets,
        email: payload.email,
        phone: payload.phone,
        role_code: payload.roleCode,
        outlet_role_id: payload.outletRoleId,
        permissions: payload.permissions,
      }),
    });
    const first = res.first ?? res.assignments?.[0] ?? {};
    return mapStaffRow(first, targets[0] ?? "");
  },
  async approveBranchStaff(outletId, assignmentId) {
    const s = await apiRequest<Record<string, unknown>>(
      `/restaurant/outlets/${outletId}/staff/${assignmentId}/approve`,
      { method: "POST" }
    );
    return mapStaffRow(s, outletId);
  },
  async revokeBranchStaff(outletId, assignmentId) {
    await apiRequest(`/restaurant/outlets/${outletId}/staff/${assignmentId}`, { method: "DELETE" });
  },
  async listOutletRoles() {
    const rows = await apiRequest<Record<string, unknown>[]>("/restaurant/roles");
    return (rows ?? []).map(
      (r): OutletRoleDefinition => ({
        id: String(r.id ?? ""),
        ownerUserId: String(r.owner_user_id ?? ""),
        name: String(r.name ?? ""),
        description: String(r.description ?? ""),
        permissions: (r.permissions as OutletPermission[]) ?? [],
      })
    );
  },
  async createOutletRole(payload) {
    const r = await apiRequest<Record<string, unknown>>("/restaurant/roles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      id: String(r.id ?? ""),
      ownerUserId: String(r.owner_user_id ?? ""),
      name: String(r.name ?? payload.name),
      description: String(r.description ?? ""),
      permissions: (r.permissions as OutletPermission[]) ?? payload.permissions,
    };
  },
  async updateOutletRole(roleId, payload) {
    const r = await apiRequest<Record<string, unknown>>(
      `/restaurant/roles/${encodeURIComponent(roleId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: payload.name,
          description: payload.description,
          permissions: payload.permissions,
        }),
      }
    );
    return {
      id: String(r.id ?? roleId),
      ownerUserId: String(r.owner_user_id ?? ""),
      name: String(r.name ?? payload.name ?? ""),
      description: String(r.description ?? payload.description ?? ""),
      permissions: (r.permissions as OutletPermission[]) ?? payload.permissions,
    };
  },
};

export const httpDeliveryPortalService: Partial<IDeliveryPortalService> = {
  async getMyPartnerProfile(): Promise<DeliveryPartnerWithStatus> {
    const p = await apiRequest<Record<string, unknown>>("/delivery/me");
    return {
      id: String(p.id || "unonboarded"),
      userId: String(p.user_id ?? ""),
      fullName: String(p.full_name ?? ""),
      phone: "",
      email: "",
      serviceZoneId: String(p.service_zone_id ?? ""),
      vehicleType: (p.vehicle_type as DeliveryPartner["vehicleType"]) || "SCOOTER",
      vehicleModel: String(p.vehicle_make_model ?? ""),
      licensePlate: String(p.license_plate ?? ""),
      verificationStatus: (p.verification_status as DeliveryPartner["verificationStatus"]) ?? "NOT_SUBMITTED",
      availabilityStatus: (p.availability_status as DeliveryPartner["availabilityStatus"]) ?? "OFFLINE",
      activeDeliveriesCount: 0,
      lastKnownLocation: { lat: 12.9784, lng: 77.6408 },
      ratingAverage: Number(p.rating_average ?? 5.0),
      totalDeliveriesCount: Number(p.total_deliveries_count ?? 0),
      onboarded: Boolean(p.onboarded),
      canReceiveOrders: Boolean(p.can_receive_orders),
      warningMessage: p.warning_message ? String(p.warning_message) : undefined,
    };
  },
  async submitOnboarding(payload): Promise<DeliveryPartner> {
    const zones = await apiRequest<Record<string, unknown>[]>("/service-zones");
    const zoneId = String(zones?.[0]?.id ?? "");
    const p = await apiRequest<Record<string, unknown>>("/delivery/onboarding", {
      method: "POST",
      body: JSON.stringify({
        service_zone_id: zoneId,
        vehicle_type: payload.vehicleType,
        vehicle_make_model: payload.vehicleModel,
        license_plate: payload.licensePlate,
      }),
    });
    return {
      id: String(p.id ?? ""),
      userId: String(p.user_id ?? ""),
      fullName: String(p.full_name ?? ""),
      phone: "",
      email: "",
      serviceZoneId: String(p.service_zone_id ?? zoneId),
      vehicleType: (p.vehicle_type as DeliveryPartner["vehicleType"]) ?? payload.vehicleType,
      vehicleModel: String(p.vehicle_make_model ?? payload.vehicleModel),
      licensePlate: String(p.license_plate ?? payload.licensePlate),
      verificationStatus: (p.verification_status as DeliveryPartner["verificationStatus"]) ?? "PENDING_REVIEW",
      availabilityStatus: (p.availability_status as DeliveryPartner["availabilityStatus"]) ?? "OFFLINE",
      activeDeliveriesCount: 0,
      lastKnownLocation: { lat: 12.9784, lng: 77.6408 },
      ratingAverage: Number(p.rating_average ?? 5.0),
      totalDeliveriesCount: Number(p.total_deliveries_count ?? 0),
    };
  },
  async toggleAvailability(status) {
    const p = await apiRequest<Record<string, unknown>>("/delivery/me/availability", {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return {
      id: String(p.id ?? ""),
      userId: String(p.user_id ?? ""),
      fullName: String(p.full_name ?? ""),
      phone: "",
      email: "",
      serviceZoneId: String(p.service_zone_id ?? ""),
      vehicleType: (p.vehicle_type as DeliveryPartner["vehicleType"]) ?? "SCOOTER",
      vehicleModel: String(p.vehicle_make_model ?? ""),
      licensePlate: String(p.license_plate ?? ""),
      verificationStatus: (p.verification_status as DeliveryPartner["verificationStatus"]) ?? "APPROVED",
      availabilityStatus: (p.availability_status as DeliveryPartner["availabilityStatus"]) ?? status,
      activeDeliveriesCount: 0,
      lastKnownLocation: { lat: 12.9784, lng: 77.6408 },
      ratingAverage: Number(p.rating_average ?? 5.0),
      totalDeliveriesCount: Number(p.total_deliveries_count ?? 0),
    };
  },
  async getPendingOffers(): Promise<DeliveryOffer[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/delivery/offers");
    return (rows ?? []).map((r) => ({
      assignmentId: String(r.assignment_id ?? r.delivery_id ?? ""),
      orderId: String(r.order_id ?? ""),
      orderNumber: String(r.order_number ?? ""),
      restaurantName: String(r.restaurant_name ?? ""),
      pickupAddress: String(r.restaurant_address ?? ""),
      dropoffNeighborhood: String(r.dropoff_address ?? ""),
      distanceToPickupMeters: Number(r.distance_meters ?? 1200),
      totalTripMeters: Number(r.distance_meters ?? 2500),
      estimatedPayoutMinor: Number(r.estimated_earning_minor ?? 4500),
      currency: "INR",
      expiresAt: String(r.expires_at ?? new Date(Date.now() + 300000).toISOString()),
      status: "OFFERED",
    }));
  },
  async acceptOffer(assignmentId: string): Promise<Order> {
    const o = await apiRequest<Record<string, unknown>>(
      `/delivery/offers/${encodeURIComponent(assignmentId)}/accept`,
      { method: "POST" }
    );
    return mapRestaurantOrderRow(o ?? {});
  },
  async rejectOffer(assignmentId: string, reason: string): Promise<void> {
    await apiRequest(`/delivery/offers/${encodeURIComponent(assignmentId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  async getActiveDelivery(): Promise<Order | null> {
    const o = await apiRequest<Record<string, unknown> | null>("/delivery/active");
    if (!o) return null;
    return mapRestaurantOrderRow(o);
  },
  async getDeliveryOrder(orderId: string): Promise<Order> {
    const o = await apiRequest<Record<string, unknown>>(
      `/delivery/orders/${encodeURIComponent(orderId)}`
    );
    return mapRestaurantOrderRow(o ?? {});
  },
  async updateDeliveryProgress(orderId, nextStatus, pin): Promise<Order> {
    const o = await apiRequest<Record<string, unknown>>(
      `/delivery/orders/${encodeURIComponent(orderId)}/stage`,
      {
        method: "POST",
        body: JSON.stringify({ stage: nextStatus, otp: pin ?? "" }),
      }
    );
    return mapRestaurantOrderRow(o ?? {});
  },
  async pingLocation(orderId, location, bearingDegrees): Promise<void> {
    await apiRequest(`/delivery/orders/${encodeURIComponent(orderId)}/location`, {
      method: "POST",
      body: JSON.stringify({
        lat: location.lat,
        lng: location.lng,
        bearing_degrees: bearingDegrees,
      }),
    });
  },
  async getHistoryAndEarnings() {
    const rows = await apiRequest<Record<string, unknown>[]>("/delivery/earnings");
    const earnings: DeliveryEarningRecord[] = (rows ?? []).map((e) => ({
      id: String(e.id ?? ""),
      orderId: String(e.order_id ?? ""),
      orderNumber: String(e.order_number ?? ""),
      partnerId: "",
      basePayoutMinor: Number(e.base_payout_minor ?? 0),
      distancePayoutMinor: Number(e.distance_payout_minor ?? 0),
      surgeBonusMinor: 0,
      tipAmountMinor: Number(e.tip_amount_minor ?? 0),
      dailyPayoutFeeMinor: Number(e.daily_payout_fee_minor ?? 0),
      totalEarningMinor: Number(e.net_earning_minor ?? 0),
      currency: "INR",
      status: (e.status as DeliveryEarningRecord["status"]) ?? "CREDITED",
      createdAt: String(e.created_at ?? new Date().toISOString()),
    }));
    return { deliveries: [], earnings };
  },
};

export const httpAdminPortalService: Partial<IAdminPortalService> = {
  async listAllUsers() {
    const rows = await apiRequest<BackendUser[]>("/admin/users");
    return (rows ?? []).map(mapUser);
  },
  async updateUserStatus(userId, status, reason) {
    await apiRequest(`/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
    const users = await this.listAllUsers!();
    return users.find((u) => u.id === userId) ?? ({ id: userId, status } as User);
  },
  async deleteUser(userId) {
    await apiRequest(`/admin/users/${userId}`, { method: "DELETE" });
  },
  async listRoles(): Promise<RoleDefinition[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/roles");
    return (rows ?? []).map((r) => ({
      id: String(r.id ?? ""),
      code: String(r.code ?? ""),
      name: String(r.name ?? ""),
      description: String(r.description ?? ""),
      isSystem: Boolean(r.is_system),
      permissions: (r.permissions as AdminPermission[]) ?? [],
    }));
  },
  async createRole(payload): Promise<RoleDefinition> {
    const r = await apiRequest<Record<string, unknown>>("/admin/roles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      id: String(r.id ?? ""),
      code: String(r.code ?? ""),
      name: String(r.name ?? payload.name),
      description: String(r.description ?? ""),
      isSystem: false,
      permissions: (r.permissions as AdminPermission[]) ?? payload.permissions,
    };
  },
  async updateRolePermissions(roleId, permissions) {
    await apiRequest(`/admin/roles/${roleId}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    });
    const roles = await this.listRoles!();
    return roles.find((r) => r.id === roleId) ?? ({ id: roleId, permissions } as RoleDefinition);
  },
  async deleteRole(roleId) {
    await apiRequest(`/admin/roles/${encodeURIComponent(roleId)}`, { method: "DELETE" });
  },
  async updateManagementUserRoles(userId, payload) {
    return apiRequest<{ user_id: string; roles: string[]; permissions: AdminPermission[] }>(
      `/admin/users/${encodeURIComponent(userId)}/roles`,
      {
        method: "PATCH",
        body: JSON.stringify({
          role_id: payload.roleId,
          role_codes: payload.roleCodes,
          custom_permissions: payload.customPermissions,
        }),
      }
    ).then((res) => ({
      userId: res.user_id,
      roles: res.roles ?? [],
      permissions: res.permissions ?? [],
    }));
  },
  async listDirectoryCustomers(): Promise<AdminDirectoryCustomer[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/directory/customers");
    return (rows ?? []).map((r) => ({
      id: String(r.id ?? ""),
      fullName: String(r.full_name ?? ""),
      email: String(r.email ?? ""),
      phone: String(r.phone ?? ""),
      status: (r.status as User["status"]) ?? "ACTIVE",
      isEmailVerified: Boolean(r.is_email_verified),
      createdAt: String(r.created_at ?? ""),
      addressesCount: Number(r.addresses_count ?? 0),
      ordersCount: Number(r.orders_count ?? 0),
      totalSpentMinor: Number(r.total_spent_minor ?? 0),
    }));
  },
  async listDirectoryOwners(): Promise<AdminDirectoryOwner[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/directory/owners");
    return (rows ?? []).map((r) => ({
      id: String(r.id ?? ""),
      fullName: String(r.full_name ?? ""),
      email: String(r.email ?? ""),
      phone: String(r.phone ?? ""),
      status: (r.status as User["status"]) ?? "ACTIVE",
      createdAt: String(r.created_at ?? ""),
      organizationName: r.organization_name ? String(r.organization_name) : undefined,
      kycStatus: (r.kyc_status as VerificationStatus) ?? "PENDING_REVIEW",
      idDocumentType: r.id_document_type ? String(r.id_document_type) : undefined,
      idDocumentNumber: r.id_document_number ? String(r.id_document_number) : undefined,
      outletsCount: Number(r.outlets_count ?? 0),
      approvedOutletsCount: Number(r.approved_outlets_count ?? 0),
    }));
  },
  async listDirectoryOutlets(): Promise<{
    outlets: AdminDirectoryOutlet[];
    staff: AdminDirectoryStaffUser[];
  }> {
    const res = await apiRequest<{
      outlets?: Record<string, unknown>[];
      staff?: Record<string, unknown>[];
    }>("/admin/directory/outlets");
    return {
      outlets: (res?.outlets ?? []).map((o) => ({
        id: String(o.id ?? ""),
        name: String(o.name ?? ""),
        brandName: o.brand_name ? String(o.brand_name) : undefined,
        branchName: o.branch_name ? String(o.branch_name) : undefined,
        city: String(o.city ?? ""),
        verificationStatus: (o.verification_status as VerificationStatus) ?? "PENDING_REVIEW",
        isAcceptingOrders: Boolean(o.is_accepting_orders),
        ownerUserId: String(o.owner_user_id ?? ""),
        ownerName: String(o.owner_name ?? ""),
        ownerEmail: String(o.owner_email ?? ""),
        menuItemsCount: Number(o.menu_items_count ?? 0),
        ordersCount: Number(o.orders_count ?? 0),
        staffCount: Number(o.staff_count ?? 0),
      })),
      staff: (res?.staff ?? []).map((s) => ({
        id: String(s.id ?? ""),
        fullName: String(s.full_name ?? ""),
        email: String(s.email ?? ""),
        phone: String(s.phone ?? ""),
        status: (s.status as User["status"]) ?? "ACTIVE",
        createdAt: String(s.created_at ?? ""),
        outletNames: (s.outlet_names as string[]) ?? [],
        staffRoles: (s.staff_roles as string[]) ?? [],
      })),
    };
  },
  async listDirectoryManagement(): Promise<AdminDirectoryManagementUser[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/directory/management");
    return (rows ?? []).map((m) => ({
      id: String(m.id ?? ""),
      fullName: String(m.full_name ?? ""),
      email: String(m.email ?? ""),
      phone: String(m.phone ?? ""),
      status: (m.status as User["status"]) ?? "ACTIVE",
      isEmailVerified: Boolean(m.is_email_verified),
      roles: (m.roles as string[]) ?? [],
      permissions: (m.permissions as AdminPermission[]) ?? [],
      createdAt: String(m.created_at ?? ""),
    }));
  },
  async listDirectoryDelivery(): Promise<AdminDirectoryDeliveryUser[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/directory/delivery");
    return (rows ?? []).map((d) => ({
      id: String(d.id ?? ""),
      fullName: String(d.full_name ?? ""),
      email: String(d.email ?? ""),
      phone: String(d.phone ?? ""),
      status: (d.status as User["status"]) ?? "ACTIVE",
      createdAt: String(d.created_at ?? ""),
      partnerId: d.partner_id ? String(d.partner_id) : undefined,
      vehicleType: d.vehicle_type ? String(d.vehicle_type) : undefined,
      vehicleModel: d.vehicle_make_model ? String(d.vehicle_make_model) : undefined,
      licensePlate: d.license_plate ? String(d.license_plate) : undefined,
      verificationStatus: (d.verification_status as VerificationStatus) ?? "PENDING_REVIEW",
      availabilityStatus: String(d.availability_status ?? "OFFLINE"),
      totalDeliveriesCount: Number(d.total_deliveries_count ?? 0),
      ratingAverage: Number(d.rating_average ?? 5.0),
    }));
  },
  async getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
    const r = await apiRequest<{
      user: Record<string, unknown>;
      addresses?: Record<string, unknown>[];
      orders?: Record<string, unknown>[];
      complaints_count?: number;
      owner_profile?: Record<string, unknown> | null;
      owned_outlets?: Record<string, unknown>[];
      staff_assignments?: Record<string, unknown>[];
      partner_profile?: Record<string, unknown> | null;
      recent_deliveries?: Record<string, unknown>[];
    }>(`/admin/users/${encodeURIComponent(userId)}/detail`);
    return {
      user: {
        id: String(r.user?.id ?? ""),
        fullName: String(r.user?.full_name ?? ""),
        email: String(r.user?.email ?? ""),
        phone: String(r.user?.phone ?? ""),
        status: (r.user?.status as User["status"]) ?? "ACTIVE",
        isEmailVerified: Boolean(r.user?.is_email_verified),
        isPhoneVerified: Boolean(r.user?.is_phone_verified),
        roles: (r.user?.roles as string[]) ?? [],
        permissions: (r.user?.permissions as AdminPermission[]) ?? [],
        createdAt: String(r.user?.created_at ?? ""),
      },
      addresses: (r.addresses ?? []).map((a) => ({
        id: String(a.id ?? ""),
        label: String(a.label ?? ""),
        addressLine1: String(a.address_line1 ?? ""),
        city: String(a.city ?? ""),
        postalCode: String(a.postal_code ?? ""),
        isDefault: Boolean(a.is_default),
      })),
      orders: (r.orders ?? []).map((o) => ({
        id: String(o.id ?? ""),
        orderNumber: String(o.order_number ?? ""),
        restaurantName: String(o.restaurant_name ?? ""),
        orderStatus: String(o.order_status ?? ""),
        totalPayableMinor: Number(o.total_payable_minor ?? 0),
        createdAt: String(o.created_at ?? ""),
      })),
      complaintsCount: Number(r.complaints_count ?? 0),
      ownerProfile: r.owner_profile
        ? {
            id: String(r.owner_profile.id ?? ""),
            organizationName: r.owner_profile.organization_name
              ? String(r.owner_profile.organization_name)
              : undefined,
            idDocumentType: String(r.owner_profile.id_document_type ?? ""),
            idDocumentNumber: String(r.owner_profile.id_document_number ?? ""),
            idDocumentFilename: r.owner_profile.id_document_filename
              ? String(r.owner_profile.id_document_filename)
              : undefined,
            verificationStatus:
              (r.owner_profile.verification_status as VerificationStatus) ?? "PENDING_REVIEW",
          }
        : null,
      ownedOutlets: (r.owned_outlets ?? []).map((o) => ({
        id: String(o.id ?? ""),
        name: String(o.name ?? ""),
        brandName: o.brand_name ? String(o.brand_name) : undefined,
        branchName: o.branch_name ? String(o.branch_name) : undefined,
        city: String(o.city ?? ""),
        verificationStatus: (o.verification_status as VerificationStatus) ?? "PENDING_REVIEW",
        isAcceptingOrders: Boolean(o.is_accepting_orders),
      })),
      staffAssignments: (r.staff_assignments ?? []).map((s) => ({
        id: String(s.id ?? ""),
        outletId: String(s.outlet_id ?? ""),
        outletName: String(s.outlet_name ?? ""),
        branchName: s.branch_name ? String(s.branch_name) : undefined,
        roleCode: String(s.role_code ?? ""),
        outletRoleName: s.outlet_role_name ? String(s.outlet_role_name) : undefined,
        permissions: (s.permissions as string[]) ?? [],
        status: String(s.status ?? ""),
      })),
      partnerProfile: r.partner_profile
        ? {
            id: String(r.partner_profile.id ?? ""),
            vehicleType: String(r.partner_profile.vehicle_type ?? ""),
            vehicleModel: r.partner_profile.vehicle_make_model
              ? String(r.partner_profile.vehicle_make_model)
              : undefined,
            licensePlate: r.partner_profile.license_plate
              ? String(r.partner_profile.license_plate)
              : undefined,
            verificationStatus:
              (r.partner_profile.verification_status as VerificationStatus) ?? "PENDING_REVIEW",
            availabilityStatus: String(r.partner_profile.availability_status ?? "OFFLINE"),
            totalDeliveriesCount: Number(r.partner_profile.total_deliveries_count ?? 0),
            ratingAverage: Number(r.partner_profile.rating_average ?? 5.0),
          }
        : null,
      recentDeliveries: (r.recent_deliveries ?? []).map((d) => ({
        orderNumber: String(d.order_number ?? ""),
        restaurantName: String(d.restaurant_name ?? ""),
        status: String(d.status ?? ""),
        totalPayableMinor: Number(d.total_payable_minor ?? 0),
        createdAt: String(d.created_at ?? ""),
      })),
    };
  },
  async getAdminOutletDetail(outletId: string): Promise<AdminOutletDetail> {
    const r = await apiRequest<{
      outlet: Record<string, unknown>;
      staff?: Record<string, unknown>[];
    }>(`/admin/outlets/${encodeURIComponent(outletId)}/detail`);
    const o = r.outlet ?? {};
    return {
      outlet: {
        id: String(o.id ?? ""),
        name: String(o.name ?? ""),
        brandName: o.brand_name ? String(o.brand_name) : undefined,
        branchName: o.branch_name ? String(o.branch_name) : undefined,
        addressLine1: String(o.address_line1 ?? ""),
        city: String(o.city ?? ""),
        state: String(o.state ?? ""),
        postalCode: String(o.postal_code ?? ""),
        phone: String(o.phone ?? ""),
        email: String(o.email ?? ""),
        verificationStatus: (o.verification_status as VerificationStatus) ?? "PENDING_REVIEW",
        isAcceptingOrders: Boolean(o.is_accepting_orders),
        avgPrepTimeMinutes: Number(o.avg_prep_time_minutes ?? 25),
        maxConcurrentOrders:
          typeof o.max_concurrent_orders === "number" ? o.max_concurrent_orders : null,
        ownerUserId: String(o.owner_user_id ?? ""),
        ownerName: String(o.owner_name ?? ""),
        ownerEmail: String(o.owner_email ?? ""),
        menuItemsCount: Number(o.menu_items_count ?? 0),
        ordersCount: Number(o.orders_count ?? 0),
        totalGmvMinor: Number(o.total_gmv_minor ?? 0),
      },
      staff: (r.staff ?? []).map((s) => ({
        id: String(s.id ?? ""),
        fullName: String(s.full_name ?? ""),
        email: String(s.email ?? ""),
        role: String(s.role ?? ""),
        permissions: (s.permissions as string[]) ?? [],
        status: String(s.status ?? ""),
      })),
    };
  },
  async listAdminInvitations(): Promise<InvitationItem[]> {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/invitations");
    return (rows ?? []).map((i) => ({
      id: String(i.id ?? ""),
      kind: "PLATFORM",
      targetId: String(i.role_id ?? ""),
      targetName: "Goodly Platform Operations",
      roleName: String(i.role_name ?? ""),
      roleCode: String(i.role_code ?? ""),
      permissions: (i.custom_permissions as string[]) ?? [],
      invitedByName: "Platform Admin",
      status: i.status as InvitationItem["status"],
      invitedEmail: i.email ? String(i.email) : undefined,
      invitedPhone: i.phone ? String(i.phone) : undefined,
      preApproved: Boolean(i.pre_approved),
      acceptedAt: i.accepted_at ? String(i.accepted_at) : undefined,
      approvedAt: i.approved_at ? String(i.approved_at) : undefined,
      createdAt: String(i.created_at ?? new Date().toISOString()),
    }));
  },
  async createAdminInvitation(payload): Promise<InvitationItem> {
    const r = await apiRequest<Record<string, unknown>>("/admin/invitations", {
      method: "POST",
      body: JSON.stringify({
        email: payload.email,
        phone: payload.phone,
        role_id: payload.roleId,
        custom_permissions: payload.customPermissions,
        pre_approved: Boolean(payload.preApproved),
      }),
    });
    return {
      id: String(r.id ?? ""),
      kind: "PLATFORM",
      targetId: payload.roleId,
      targetName: "Goodly Platform Operations",
      roleName: "",
      roleCode: "",
      permissions: payload.customPermissions ?? [],
      invitedByName: "Platform Admin",
      status: "PENDING_ACCEPTANCE",
      invitedEmail: payload.email,
      invitedPhone: payload.phone,
      preApproved: Boolean(payload.preApproved),
      createdAt: new Date().toISOString(),
    };
  },
  async approveAdminInvitation(invitationId) {
    await apiRequest(`/admin/invitations/${invitationId}/approve`, { method: "POST" });
    const list = await this.listAdminInvitations!();
    return list.find((x) => x.id === invitationId) ?? ({ id: invitationId, status: "ACTIVE" } as InvitationItem);
  },
  async revokeAdminInvitation(invitationId) {
    await apiRequest(`/admin/invitations/${invitationId}`, { method: "DELETE" });
  },
  async listRestaurantOwners() {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/restaurant-owners");
    return (rows ?? []).map(mapOwnerProfileRow);
  },
  async decideRestaurantOwnerVerification(ownerId, decision, notes) {
    await apiRequest(`/admin/restaurant-owners/${encodeURIComponent(ownerId)}/verify`, {
      method: "POST",
      body: JSON.stringify({ status: decision, notes }),
    });
    const list = await this.listRestaurantOwners!();
    return (
      list.find((o) => o.id === ownerId || o.userId === ownerId) ??
      ({ id: ownerId, userId: ownerId, verificationStatus: decision } as RestaurantOwnerProfile)
    );
  },
  async listRestaurants() {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/outlets");
    return (rows ?? []).map(mapOutletRow);
  },
  async decideRestaurantVerification(restaurantId, decision, notes) {
    await apiRequest(`/admin/outlets/${restaurantId}/verify`, {
      method: "POST",
      body: JSON.stringify({ status: decision, notes }),
    });
    const list = await this.listRestaurants!();
    return list.find((r) => r.id === restaurantId) ?? ({ id: restaurantId, verificationStatus: decision } as Restaurant);
  },
  async listDeliveryPartners() {
    const rows = await apiRequest<Record<string, unknown>[]>("/admin/delivery-partners");
    return (rows ?? []).map(
      (p): DeliveryPartner => ({
        id: String(p.id ?? ""),
        userId: String(p.user_id ?? ""),
        fullName: String(p.full_name ?? ""),
        email: String(p.email ?? ""),
        phone: String(p.phone ?? ""),
        serviceZoneId: "",
        vehicleType: (p.vehicle_type as DeliveryPartner["vehicleType"]) ?? "SCOOTER",
        vehicleModel: String(p.vehicle_make_model ?? ""),
        licensePlate: String(p.license_plate ?? ""),
        verificationStatus: (p.verification_status as DeliveryPartner["verificationStatus"]) ?? "PENDING_REVIEW",
        availabilityStatus: (p.availability_status as DeliveryPartner["availabilityStatus"]) ?? "OFFLINE",
        activeDeliveriesCount: 0,
        lastKnownLocation: { lat: 12.9784, lng: 77.6408 },
        ratingAverage: 5.0,
        totalDeliveriesCount: 0,
      })
    );
  },
  async decidePartnerVerification(partnerId, decision, notes) {
    await apiRequest(`/admin/delivery-partners/${partnerId}/verify`, {
      method: "POST",
      body: JSON.stringify({ status: decision, notes }),
    });
    const list = await this.listDeliveryPartners!();
    return list.find((p) => p.id === partnerId) ?? ({ id: partnerId, verificationStatus: decision } as DeliveryPartner);
  },
  async listPaymentsAndRefunds() {
    const res = await apiRequest<{
      payments?: Record<string, unknown>[];
      refunds?: Record<string, unknown>[];
    }>("/admin/payments");
    return {
      payments: (res.payments ?? []).map((p) => mapPaymentRow(p)),
      refunds: (res.refunds ?? []).map((rf) => mapRefundRow(rf)),
    };
  },
  async issueRefund(payload) {
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `refund-${crypto.randomUUID()}`
        : `refund-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const rf = await apiRequest<Record<string, unknown>>("/admin/refunds", {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        order_id: payload.orderId,
        amount_minor: payload.amountMinor,
        reason_code: payload.reasonCode,
        notes: payload.notes,
      }),
    });
    return mapRefundRow(rf ?? {});
  },
  async reconcilePayments() {
    const res = await apiRequest<{
      reconciled_count?: number;
      processed_refunds_count?: number;
    }>("/admin/payments/reconcile", { method: "POST" });
    return {
      reconciledCount: Number(res.reconciled_count ?? 0),
      processedRefundsCount: Number(res.processed_refunds_count ?? 0),
    };
  },
};

/**
 * Production HTTP Service Registry wired progressively during Phases 2–6.
 * Keeping this strictly isolated ensures Phase 1 UI components never change when switching modes.
 */
export function createHttpServiceRegistry(base: ServiceRegistry): ServiceRegistry {
  return {
    ...base,
    auth: httpAuthService,
    discovery: httpDiscoveryService,
    cart: httpCartService,
    orders: { ...base.orders, ...httpOrderService },
    restaurantPortal: { ...base.restaurantPortal, ...httpRestaurantPortalService },
    deliveryPortal: { ...base.deliveryPortal, ...httpDeliveryPortalService },
    adminPortal: { ...base.adminPortal, ...httpAdminPortalService },
  };
}
