export type PortalScope = "customer" | "restaurant" | "delivery" | "admin";

export interface PortalAuthResult {
  user: User;
  portal: PortalScope;
  onboardingRequired: boolean;
  onboardingHint?: string;
}

export interface EmailCheckResult {
  exists: boolean;
  portal: PortalScope;
  onboardingRecommended: boolean;
}

export type UserRole =
  | "CUSTOMER"
  | "OUTLET_OWNER"
  | "BRANCH_MANAGER"
  | "OUTLET_STAFF"
  | "RESTAURANT_OWNER"
  | "RESTAURANT_STAFF"
  | "DELIVERY_PARTNER"
  | "PLATFORM_ADMIN"
  | "CUSTOMER_CARE"
  | "SUPER_ADMIN"
  | "OPS_ADMIN"
  | "FINANCE_ADMIN"
  | "SUPPORT_ADMIN";

export type OutletPermission =
  | "outlet:orders:manage"
  | "outlet:menu:edit"
  | "outlet:inventory:toggle"
  | "outlet:hours:manage"
  | "outlet:capacity:configure"
  | "outlet:reports:view"
  | "outlet:staff:manage"
  | "outlet:locations:manage";

export type AdminPermission =
  | "users:manage"
  | "users:customers:view"
  | "users:customers:manage"
  | "users:owners:view"
  | "users:owners:manage"
  | "users:outlets:view"
  | "users:outlets:manage"
  | "users:management:view"
  | "users:management:manage"
  | "users:delivery:view"
  | "users:delivery:manage"
  | "roles:manage"
  | "restaurants:verify"
  | "partners:verify"
  | "orders:monitor"
  | "orders:intervene"
  | "orders:timeout_escalate"
  | "delivery:override_otp"
  | "refunds:approve"
  | "commissions:configure"
  | "promotions:manage"
  | "zones:manage"
  | "complaints:resolve"
  | "reports:view"
  | "audit_logs:view"
  | "settings:manage";

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "RESTAURANT_ACCEPTED"
  | "RESTAURANT_REJECTED"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLATION_REQUESTED"
  | "CANCELLED";

export type PaymentStatus =
  | "UNPAID"
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type DeliveryStatus =
  | "NOT_APPLICABLE"
  | "ASSIGNMENT_PENDING"
  | "PARTNER_OFFERED"
  | "PARTNER_ASSIGNED"
  | "ARRIVED_AT_RESTAURANT"
  | "PICKED_UP"
  | "OUT_FOR_DELIVERY"
  | "ARRIVED_AT_CUSTOMER"
  | "DELIVERED"
  | "UNASSIGNABLE"
  | "CANCELLED";

export type VerificationStatus =
  | "NOT_SUBMITTED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export interface RestaurantOwnerProfile {
  id: string;
  userId: string;
  fullName?: string;
  email?: string;
  phone?: string;
  organizationName?: string;
  idDocumentType: "PAN_CARD" | "AADHAAR" | "PASSPORT" | "DRIVING_LICENSE" | "BUSINESS_REG";
  idDocumentNumber: string;
  idDocumentFilename?: string;
  verificationStatus: VerificationStatus;
  reviewNotes?: string;
  createdAt?: string;
}

export type PartnerAvailability =
  | "OFFLINE"
  | "ONLINE_AVAILABLE"
  | "ON_DELIVERY";

export type VehicleType = "BICYCLE" | "SCOOTER" | "MOTORCYCLE" | "CAR";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface User {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  roles: UserRole[];
  permissions: AdminPermission[];
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  restaurantId?: string;
  partnerId?: string;
  createdAt: string;
}

export interface CustomerAddress {
  id: string;
  userId: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  deliveryInstructions?: string;
  location: GeoPoint;
  isDefault: boolean;
  isServiceable: boolean;
}

export interface ServiceZone {
  id: string;
  name: string;
  city: string;
  timezone: string;
  currency: string;
  isActive: boolean;
  baseDeliveryFeeMinor: number;
  center: GeoPoint;
  radiusMeters: number;
}

export interface OperatingHourSlot {
  dayOfWeek: number; // 0 = Sun ... 6 = Sat
  slotNumber: number;
  openTime: string; // "11:00"
  closeTime: string; // "22:30"
  isClosed: boolean;
}

export interface CustomizationOption {
  id: string;
  name: string;
  priceDeltaMinor: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface CustomizationGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
  options: CustomizationOption[];
}

export type VegClassification = "VEG" | "NON_VEG" | "EGG_ONLY";

export interface MenuItem {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  badgeLabel?: string;
  vegClassification?: VegClassification;
  dietaryTags: string[];
  cuisineType?: string;
  spiceLevel?: "NONE" | "MILD" | "MEDIUM" | "HOT" | "EXTRA_HOT";
  caloriesKcal?: number;
  servingSize?: string;
  ingredients?: string[];
  allergens?: string[];
  searchKeywords?: string[];
  isRecommended?: boolean;
  basePriceMinor: number;
  currency: string;
  imageUrl: string;
  isAvailable: boolean;
  isActive: boolean;
  trackInventory: boolean;
  availableQuantity: number;
  prepTimeMinutes?: number;
  customizationGroups: CustomizationGroup[];
}

export interface MenuCategory {
  id: string;
  restaurantId: string;
  name: string;
  subtitle?: string;
  displayOrder: number;
  isActive: boolean;
  items: MenuItem[];
}

export interface OutletStaffMember {
  id: string;
  outletId: string;
  outletName?: string;
  brandName?: string;
  branchName?: string;
  userId?: string;
  fullName: string;
  email: string;
  phone: string;
  roleCode: "BRANCH_MANAGER" | "OUTLET_STAFF" | "CUSTOM";
  outletRoleId?: string;
  outletRoleName?: string;
  permissions: OutletPermission[];
  status:
    | "ACTIVE"
    | "INVITED"
    | "PENDING_ACCEPTANCE"
    | "PENDING_APPROVAL"
    | "DECLINED"
    | "REVOKED";
  acceptedAt?: string;
  approvedAt?: string;
}

export interface MenuScheduleWindow {
  id: string;
  label: string;
  daysOfWeek: number[]; // 0..6
  startTime: string; // "08:00"
  endTime: string; // "15:00"
  isActive: boolean;
}

export interface Restaurant {
  id: string;
  ownerUserId: string;
  brandName?: string;
  branchName?: string;
  serviceZoneId: string;
  slug: string;
  name: string;
  eyebrow: string;
  heroTitleStart?: string;
  heroTitleAccent?: string;
  tagline: string;
  description: string;
  cuisines: string[];
  categoryFilterKeys: string[];
  establishedYear?: number;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  location: GeoPoint;
  distanceMeters?: number;
  maxDeliveryRadiusMeters: number;
  heroImageUrl: string;
  cardImageUrl: string;
  promoBanner?: string;
  promoSubtext?: string;
  cardBadge?: string;
  verificationStatus: VerificationStatus;
  isActive: boolean;
  isAcceptingOrders: boolean;
  maxConcurrentOrders?: number | null;
  activeOrdersCount?: number;
  avgPrepTimeMinutes: number;
  estimatedDeliveryMin: number;
  estimatedDeliveryMax: number;
  deliveryFeeMinor: number;
  minOrderAmountMinor: number;
  packagingFeeMinor: number;
  commissionRateBps: number;
  commissionCalculationBasis?:
    | "GROSS_FOOD_SUBTOTAL"
    | "NET_AFTER_OUTLET_DISCOUNT"
    | "SUBTOTAL_PLUS_PACKAGING";
  currency: string;
  ratingAverage: number;
  ratingCount: number;
  operatingHours: OperatingHourSlot[];
  menuSchedules?: MenuScheduleWindow[];
  staffMembers?: OutletStaffMember[];
  documents?: {
    id: string;
    documentType: string;
    documentNumber: string;
    status: "PENDING" | "VERIFIED" | "REJECTED";
    reviewNotes?: string;
  }[];
}

export interface RestaurantWithMenu {
  restaurant: Restaurant;
  categories: MenuCategory[];
}

export interface CartItemCustomization {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDeltaMinor: number;
}

export interface CartItem {
  id: string;
  menuItemId: string;
  name: string;
  imageUrl: string;
  unitBasePriceMinor: number;
  unitCustomizationsPriceMinor: number;
  quantity: number;
  customizations: CartItemCustomization[];
  lineTotalMinor: number;
}

export interface CartBreakdown {
  itemSubtotalMinor: number;
  smallCartFeeMinor?: number;
  packagingFeeMinor: number;
  deliveryFeeMinor: number;
  platformFeeMinor: number;
  discountAmountMinor: number;
  taxAmountMinor: number;
  tipAmountMinor: number;
  totalPayableMinor: number;
}

export interface Cart {
  restaurantId: string | null;
  restaurantName: string | null;
  restaurantSlug: string | null;
  estimatedDeliveryMin: number;
  estimatedDeliveryMax: number;
  currency: string;
  items: CartItem[];
  appliedCouponCode: string | null;
  tipAmountMinor: number;
  specialInstructions: string;
  breakdown: CartBreakdown;
}

export interface OrderItemSnapshot {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitBasePriceMinor: number;
  unitCustomizationsPriceMinor: number;
  customizations: CartItemCustomization[];
  lineTotalMinor: number;
}

export interface OrderStatusHistoryEntry {
  id: string;
  fromOrderStatus?: OrderStatus;
  toOrderStatus: OrderStatus;
  toPaymentStatus: PaymentStatus;
  toDeliveryStatus: DeliveryStatus;
  actorRole: string;
  reason?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  restaurantAddress: string;
  pickupLocation: GeoPoint;
  deliveryAddressSnapshot: CustomerAddress;
  deliveryLocation: GeoPoint;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  paymentMethod: "ONLINE" | "COD";
  currency: string;
  breakdown: CartBreakdown;
  appliedCouponCode?: string;
  specialInstructions?: string;
  deliveryPin: string;
  otpVerifiedAt?: string;
  otpFailedAttempts?: number;
  otpRateLimitedUntil?: string;
  otpOverrideByRole?: string;
  otpOverrideReason?: string;
  acceptDeadlineAt?: string;
  customerCareAlertedAt?: string;
  graceDeadlineAt?: string;
  acceptanceEscalationState?:
    | "NONE"
    | "CUSTOMER_CARE_ALERTED"
    | "GRACE_PERIOD"
    | "PENALTY_APPLIED";
  ratingPromptStatus?:
    | "PENDING_DELIVERY"
    | "ELIGIBLE_ON_APP_OPEN"
    | "DISMISSED"
    | "RATED";
  commissionRateBpsSnapshot?: number;
  commissionBasisSnapshot?: string;
  estimatedPrepMinutes: number;
  estimatedDeliveryAt: string;
  roadDistanceMeters: number;
  partnerId?: string;
  partnerName?: string;
  partnerVehicle?: string;
  partnerPhone?: string;
  items: OrderItemSnapshot[];
  statusHistory: OrderStatusHistoryEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OutletPenaltyRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  outletId: string;
  outletName: string;
  penaltyAmountMinor: number;
  currency: string;
  reasonCode: string;
  penaltyModeSnapshot: string;
  status: "APPLIED" | "WAIVED";
  createdAt: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  provider: "RAZORPAY" | "CASHFREE" | "STRIPE" | "COD";
  providerOrderId: string;
  providerPaymentId?: string;
  amountMinor: number;
  currency: string;
  status:
    | "INITIATED"
    | "AUTHORIZED"
    | "CAPTURED"
    | "FAILED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED";
  paymentMethod?: "ONLINE" | "COD";
  paymentInstrument?: string;
  failureMessage?: string;
  reconciledAt?: string;
  createdAt: string;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  refundType: "FULL" | "PARTIAL";
  reasonCode: string;
  notes?: string;
  status: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";
  initiatedByRole: string;
  createdAt: string;
}

export interface RestaurantSettlement {
  id: string;
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  grossFoodAmountMinor: number;
  packagingFeeMinor: number;
  platformCommissionBps: number;
  platformCommissionMinor: number;
  taxWithheldMinor: number;
  netPayoutMinor: number;
  currency: string;
  settlementStatus: "ACCRUED" | "PAYOUT_SCHEDULED" | "PAID" | "REVERSED";
  createdAt: string;
}

export interface DeliveryPartner {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  email: string;
  serviceZoneId: string;
  vehicleType: VehicleType;
  vehicleModel: string;
  licensePlate: string;
  verificationStatus: VerificationStatus;
  availabilityStatus: PartnerAvailability;
  activeDeliveriesCount: number;
  lastKnownLocation: GeoPoint;
  ratingAverage: number;
  totalDeliveriesCount: number;
  documents?: {
    id: string;
    documentType: string;
    fileKey?: string;
    status: "PENDING" | "VERIFIED" | "REJECTED";
  }[];
  fileKey?: string;
  documentType?: string;
}

export interface DeliveryOffer {
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  partnerId?: string;
  restaurantName: string;
  pickupAddress: string;
  dropoffNeighborhood: string;
  distanceToPickupMeters: number;
  totalTripMeters: number;
  estimatedPayoutMinor: number;
  currency: string;
  expiresAt: string;
  status: "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED";
}

export interface DeliveryEarningRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  partnerId: string;
  basePayoutMinor: number;
  distancePayoutMinor: number;
  surgeBonusMinor: number;
  tipAmountMinor: number;
  dailyPayoutFeeMinor?: number;
  totalEarningMinor: number;
  currency: string;
  status: "CREDITED" | "PAID";
  createdAt: string;
}

export interface TrackingSnapshot {
  orderId: string;
  partnerId?: string;
  partnerName?: string;
  partnerLocation?: GeoPoint;
  bearingDegrees: number;
  etaMinutes: number;
  distanceRemainingMeters: number;
  routeProgress: number; // 0..1
  updatedAt: string;
}

export interface MenuItemRatingEntry {
  menuItemId: string;
  itemName: string;
  rating: number;
  comment?: string;
}

export interface ReviewRecord {
  id: string;
  orderId: string;
  restaurantId: string;
  customerName: string;
  foodRating: number; // Category 1: Restaurant rating (1..5)
  deliveryRating?: number; // Category 2: Delivery partner rating (1..5)
  itemRatings?: MenuItemRatingEntry[]; // Category 3: Optional individual food/menu items rating
  comment?: string;
  deliveryComment?: string;
  restaurantReply?: string;
  editCount?: number;
  editableUntil?: string;
  createdAt: string;
}

export interface ComplaintRecord {
  id: string;
  ticketNumber: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  category:
    | "MISSING_ITEM"
    | "WRONG_ORDER"
    | "QUALITY_ISSUE"
    | "LATE_DELIVERY"
    | "BILLING_ISSUE"
    | "ACCEPTANCE_TIMEOUT_ESCALATION";
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "CLOSED";
  description: string;
  resolutionNotes?: string;
  linkedRefundId?: string;
  createdAt: string;
}

export interface CouponRecord {
  id: string;
  code: string;
  title: string;
  discountType: "PERCENTAGE" | "FLAT_AMOUNT" | "FREE_DELIVERY";
  discountValue: number; // bps if percentage, minor units if flat
  maxDiscountMinor?: number;
  minOrderSubtotalMinor: number;
  firstOrderOnly: boolean;
  maxTotalUses?: number;
  currentUses: number;
  isActive: boolean;
  endsAt: string;
}

export interface CommissionConfig {
  defaultCommissionBps: number; // Initial 20% = 2000 bps
  commissionCalculationBasis?:
    | "GROSS_FOOD_SUBTOTAL"
    | "NET_AFTER_OUTLET_DISCOUNT"
    | "SUBTOTAL_PLUS_PACKAGING";
  minCartThresholdMinor?: number; // Minimum cart threshold before smallCartFeeMinor applies
  smallCartFeeMinor?: number; // Applied ONLY when itemSubtotalMinor < minCartThresholdMinor
  taxRateBps: number;
  platformFeeMinor: number;
  baseDeliveryFeeMinor: number;
  perKmDeliveryFeeMinor: number;
  freeDeliveryThresholdMinor: number;
  partnerBasePayoutMinor: number;
  partnerPerKmPayoutMinor: number;
  surgeMultiplierBps: number;
  codEnabled: boolean;
  // Admin-configurable acceptance timeout & non-acceptance penalty rules
  acceptanceTimeoutSeconds?: number; // Default 300s (5 minutes)
  acceptanceGracePeriodSeconds?: number; // Default 180s (3 minutes)
  nonAcceptancePenaltyMode?: "PERCENTAGE_OF_SUBTOTAL" | "FLAT_AMOUNT";
  nonAcceptancePenaltyBps?: number;
  nonAcceptanceFlatPenaltyMinor?: number;
  nonAcceptanceMinPenaltyMinor?: number;
  nonAcceptanceMaxPenaltyMinor?: number;
  // Admin-configurable daily delivery partner payout fee rules
  partnerDailyPayoutFeeMode?:
    | "FREE_SCHEDULED_PAID_INSTANT"
    | "FLAT_DAILY"
    | "PERCENTAGE_CAPPED";
  partnerScheduledDailyFeeMinor?: number;
  partnerInstantCashoutFeeMinor?: number;
  partnerPayoutFeeBps?: number;
  partnerPayoutFeeCapMinor?: number;
  partnerWaiveFeeAboveTripsPerDay?: number;
}

export interface AuditLogEntry {
  id: string;
  adminUserId: string;
  adminName: string;
  adminRole: string;
  permissionUsed: string;
  action: string;
  targetEntityType: string;
  targetEntityId: string;
  reason?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  body: string;
  eventType: string;
  actionUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface InvitationItem {
  id: string;
  kind: "PLATFORM" | "OUTLET";
  targetId: string;
  targetName: string;
  roleName: string;
  roleCode: string;
  permissions: string[];
  invitedByName: string;
  status:
    | "PENDING_ACCEPTANCE"
    | "PENDING_ADMIN_APPROVAL"
    | "PENDING_APPROVAL"
    | "ACTIVE"
    | "DECLINED"
    | "REVOKED";
  invitedEmail?: string;
  invitedPhone?: string;
  preApproved?: boolean;
  acceptedAt?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface RoleDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: AdminPermission[];
}

export interface OutletRoleDefinition {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  permissions: OutletPermission[];
}

export interface DeliveryPartnerWithStatus extends DeliveryPartner {
  onboarded: boolean;
  canReceiveOrders: boolean;
  warningMessage?: string;
}

export type AdminDirectoryCategory =
  | "all"
  | "customers"
  | "owners"
  | "outlets"
  | "management"
  | "delivery";

export interface AdminDirectoryCustomer {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: User["status"];
  isEmailVerified: boolean;
  createdAt: string;
  addressesCount: number;
  ordersCount: number;
  totalSpentMinor: number;
}

export interface AdminDirectoryOwner {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: User["status"];
  createdAt: string;
  organizationName?: string;
  kycStatus: VerificationStatus;
  idDocumentType?: string;
  idDocumentNumber?: string;
  outletsCount: number;
  approvedOutletsCount: number;
}

export interface AdminDirectoryOutlet {
  id: string;
  name: string;
  brandName?: string;
  branchName?: string;
  city: string;
  verificationStatus: VerificationStatus;
  isAcceptingOrders: boolean;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  menuItemsCount: number;
  ordersCount: number;
  staffCount: number;
}

export interface AdminDirectoryStaffUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: User["status"];
  createdAt: string;
  outletNames: string[];
  staffRoles: string[];
}

export interface AdminDirectoryManagementUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: User["status"];
  isEmailVerified: boolean;
  roles: string[];
  permissions: AdminPermission[];
  createdAt: string;
}

export interface AdminDirectoryDeliveryUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: User["status"];
  createdAt: string;
  partnerId?: string;
  vehicleType?: string;
  vehicleModel?: string;
  licensePlate?: string;
  verificationStatus: VerificationStatus;
  availabilityStatus: string;
  totalDeliveriesCount: number;
  ratingAverage: number;
}

export interface AdminUserDetail {
  user: {
    id: string;
    fullName: string;
    email: string;
    phone: string;
    status: User["status"];
    isEmailVerified: boolean;
    isPhoneVerified: boolean;
    roles: string[];
    permissions: AdminPermission[];
    createdAt: string;
  };
  addresses: {
    id: string;
    label: string;
    addressLine1: string;
    city: string;
    postalCode: string;
    isDefault: boolean;
  }[];
  orders: {
    id: string;
    orderNumber: string;
    restaurantName: string;
    orderStatus: string;
    totalPayableMinor: number;
    createdAt: string;
  }[];
  complaintsCount: number;
  ownerProfile?: {
    id: string;
    organizationName?: string;
    idDocumentType: string;
    idDocumentNumber: string;
    idDocumentFilename?: string;
    verificationStatus: VerificationStatus;
  } | null;
  ownedOutlets: {
    id: string;
    name: string;
    brandName?: string;
    branchName?: string;
    city: string;
    verificationStatus: VerificationStatus;
    isAcceptingOrders: boolean;
  }[];
  staffAssignments: {
    id: string;
    outletId: string;
    outletName: string;
    branchName?: string;
    roleCode: string;
    outletRoleName?: string;
    permissions: string[];
    status: string;
  }[];
  partnerProfile?: {
    id: string;
    vehicleType: string;
    vehicleModel?: string;
    licensePlate?: string;
    verificationStatus: VerificationStatus;
    availabilityStatus: string;
    totalDeliveriesCount: number;
    ratingAverage: number;
  } | null;
  recentDeliveries: {
    orderNumber: string;
    restaurantName: string;
    status: string;
    totalPayableMinor: number;
    createdAt: string;
  }[];
}

export interface AdminOutletDetail {
  outlet: {
    id: string;
    name: string;
    brandName?: string;
    branchName?: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    phone: string;
    email: string;
    verificationStatus: VerificationStatus;
    isAcceptingOrders: boolean;
    avgPrepTimeMinutes: number;
    maxConcurrentOrders: number | null;
    ownerUserId: string;
    ownerName: string;
    ownerEmail: string;
    menuItemsCount: number;
    ordersCount: number;
    totalGmvMinor: number;
  };
  staff: {
    id: string;
    fullName: string;
    email: string;
    role: string;
    permissions: string[];
    status: string;
  }[];
}

export type MediaCategory = "Menu" | "Verification";

export interface PresignedMediaUploadResponse {
  bucket: string;
  category: MediaCategory;
  outletId: string;
  key: string;
  uploadUrl: string;
  viewUrl: string;
  expiresInSeconds: number;
}

export interface PresignedMediaViewResponse {
  key: string;
  category: MediaCategory;
  outletId: string;
  viewUrl: string;
  expiresInSeconds: number;
}
