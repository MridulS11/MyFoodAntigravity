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
  AuditLogEntry,
  Cart,
  CommissionConfig,
  ComplaintRecord,
  CouponRecord,
  CustomerAddress,
  DeliveryEarningRecord,
  DeliveryOffer,
  DeliveryPartner,
  DeliveryPartnerWithStatus,
  EmailCheckResult,
  GeoPoint,
  InvitationItem,
  MediaCategory,
  MenuCategory,
  MenuItem,
  MenuItemRatingEntry,
  NotificationItem,
  OperatingHourSlot,
  Order,
  OutletPenaltyRecord,
  OutletPermission,
  OutletRoleDefinition,
  OutletStaffMember,
  PaymentRecord,
  PortalAuthResult,
  PresignedMediaUploadResponse,
  PresignedMediaViewResponse,
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
  VerificationStatus,
} from "./types";

export interface DiscoveryFeedFilters {
  lat: number;
  lng: number;
  category?: string;
  freeDeliveryOnly?: boolean;
  minRating?: number;
  maxEtaMinutes?: number;
  sortBy?: "featured" | "rating" | "fastest" | "delivery_fee";
}

export interface DiscoveryFeedResponse {
  serviceable: boolean;
  zone: ServiceZone | null;
  spotlightRestaurant: Restaurant | null;
  restaurants: Restaurant[];
}

export interface SearchResultResponse {
  restaurants: Restaurant[];
  dishes: {
    item: MenuItem;
    restaurant: Restaurant;
  }[];
}

export interface CheckoutValidationResponse {
  isValid: boolean;
  pricingQuoteHash: string;
  cart: Cart;
}

export interface IAuthService {
  getSessionUser(portal?: PortalScope): Promise<User | null>;
  getPortalSession(portal: PortalScope): Promise<PortalAuthResult | null>;
  checkEmailAvailability(portal: PortalScope, emailOrPhone: string): Promise<EmailCheckResult>;
  login(emailOrPhone: string, password: string, portal?: PortalScope): Promise<User>;
  loginForPortal(
    portal: PortalScope,
    emailOrPhone: string,
    password: string
  ): Promise<PortalAuthResult>;
  register(
    payload: {
      fullName: string;
      email: string;
      phone: string;
      password: string;
      role: UserRole;
    },
    portal?: PortalScope
  ): Promise<{ user: User; otpRequired: boolean; onboardingRequired?: boolean }>;
  verifyOtp(target: string, code: string, portal?: PortalScope): Promise<User>;
  switchDemoPersona(role: UserRole | string, portal?: PortalScope): Promise<User>;
  logout(portal?: PortalScope): Promise<void>;
  getAddresses(): Promise<CustomerAddress[]>;
  saveAddress(
    input: Omit<CustomerAddress, "id" | "userId" | "isServiceable">
  ): Promise<CustomerAddress>;
  deleteAddress(addressId: string): Promise<void>;
  setDefaultAddress(addressId: string): Promise<void>;
  getFavorites(): Promise<Restaurant[]>;
  toggleFavorite(restaurantId: string): Promise<string[]>;
  getNotifications(): Promise<NotificationItem[]>;
  markNotificationRead(notificationId: string): Promise<void>;
  listMyInvitations(portal?: PortalScope): Promise<InvitationItem[]>;
  respondToInvitation(
    kind: "PLATFORM" | "OUTLET",
    invitationId: string,
    action: "ACCEPT" | "DECLINE",
    portal?: PortalScope
  ): Promise<void>;
}

export interface IDiscoveryService {
  getFeed(filters: DiscoveryFeedFilters): Promise<DiscoveryFeedResponse>;
  search(query: string, lat: number, lng: number): Promise<SearchResultResponse>;
  checkServiceability(lat: number, lng: number): Promise<{
    serviceable: boolean;
    zone: ServiceZone | null;
  }>;
  getRestaurantMenu(
    slugOrId: string,
    lat: number,
    lng: number,
    query?: string
  ): Promise<RestaurantWithMenu>;
}

export interface ICartService {
  getCart(addressId?: string | null): Promise<Cart>;
  addItem(payload: {
    restaurantId: string;
    menuItemId: string;
    quantity: number;
    selectedOptionIds: string[];
    replaceCart?: boolean;
  }): Promise<Cart>;
  updateItemQuantity(cartItemId: string, quantity: number): Promise<Cart>;
  removeItem(cartItemId: string): Promise<Cart>;
  clearCart(): Promise<Cart>;
  applyCoupon(code: string): Promise<Cart>;
  removeCoupon(): Promise<Cart>;
  setTip(tipAmountMinor: number): Promise<Cart>;
  setSpecialInstructions(instructions: string): Promise<Cart>;
  validateCheckout(addressId: string): Promise<CheckoutValidationResponse>;
}

export interface IOrderService {
  createOrder(payload: {
    deliveryAddressId: string;
    paymentMethod: "ONLINE" | "COD";
    pricingQuoteHash: string;
    idempotencyKey: string;
    specialInstructions?: string;
    simulatePaymentFailure?: boolean;
    deferOnlineCapture?: boolean;
  }): Promise<{ order: Order; payment: PaymentRecord }>;
  simulateGatewayDecision?(
    orderId: string,
    outcome: "CAPTURE" | "FAIL",
    reason?: string,
    knownOrder?: Order
  ): Promise<{ order: Order; payment: PaymentRecord }>;
  retryPayment(orderId: string): Promise<{ order: Order; payment: PaymentRecord }>;
  listMyOrders(): Promise<Order[]>;
  getOrderById(orderId: string): Promise<Order>;
  cancelOrder(orderId: string, reason: string): Promise<Order>;
  getTrackingSnapshot(orderId: string): Promise<TrackingSnapshot>;
  submitReview(
    orderId: string,
    payload: {
      foodRating: number;
      deliveryRating?: number;
      itemRatings?: MenuItemRatingEntry[];
      comment?: string;
      deliveryComment?: string;
    }
  ): Promise<ReviewRecord>;
  submitComplaint(
    orderId: string,
    payload: {
      category: ComplaintRecord["category"];
      description: string;
    }
  ): Promise<ComplaintRecord>;
  listMyComplaints(): Promise<ComplaintRecord[]>;
}

export interface IRestaurantPortalService {
  getMyRestaurant(): Promise<RestaurantWithMenu>;
  listMyOutlets(): Promise<Restaurant[]>;
  switchActiveOutlet(outletId: string): Promise<RestaurantWithMenu>;
  updateOutletCapacity(maxConcurrentOrders: number | null): Promise<Restaurant>;
  inviteBranchStaff(payload: {
    outletId?: string;
    outletIds?: string[];
    fullName?: string;
    email?: string;
    phone?: string;
    roleCode?: "BRANCH_MANAGER" | "OUTLET_STAFF" | "CUSTOM";
    outletRoleId?: string;
    permissions?: OutletPermission[];
  }): Promise<OutletStaffMember>;
  listBranchStaff(outletId?: string): Promise<OutletStaffMember[]>;
  approveBranchStaff(outletId: string, assignmentId: string): Promise<OutletStaffMember>;
  revokeBranchStaff(outletId: string, assignmentId: string): Promise<void>;
  listOutletRoles(): Promise<OutletRoleDefinition[]>;
  createOutletRole(payload: {
    name: string;
    description?: string;
    permissions: OutletPermission[];
  }): Promise<OutletRoleDefinition>;
  updateOutletRole(
    roleId: string,
    payload: {
      name?: string;
      description?: string;
      permissions: OutletPermission[];
    }
  ): Promise<OutletRoleDefinition>;
  listServiceZones(): Promise<ServiceZone[]>;
  getOwnerProfile(): Promise<RestaurantOwnerProfile>;
  submitOwnerProfile(payload: {
    organizationName?: string;
    idDocumentType: RestaurantOwnerProfile["idDocumentType"];
    idDocumentNumber: string;
    idDocumentFilename?: string;
  }): Promise<RestaurantOwnerProfile>;
  submitOnboarding(payload: {
    setupType?: "NEW_OUTLET" | "ADD_BRANCH";
    name: string;
    brandName?: string;
    branchName?: string;
    serviceZoneId?: string;
    cuisines: string[];
    phone: string;
    email: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
    licenseNumber: string;
    lat?: number;
    lng?: number;
  }): Promise<Restaurant>;
  toggleAcceptingOrders(isAccepting: boolean): Promise<Restaurant>;
  updateOperatingHours(hours: OperatingHourSlot[]): Promise<Restaurant>;
  createCategory(payload: { name: string; subtitle?: string }): Promise<MenuCategory>;
  upsertMenuItem(payload: Partial<MenuItem> & { categoryId: string; name: string; basePriceMinor: number }): Promise<MenuItem>;
  toggleMenuItemAvailability(itemId: string, isAvailable: boolean): Promise<MenuItem>;
  listRestaurantOrders(): Promise<Order[]>;
  acceptOrder(orderId: string, estimatedPrepMinutes: number): Promise<Order>;
  rejectOrder(orderId: string, reason: string): Promise<Order>;
  advanceOrderStatus(
    orderId: string,
    nextStatus: "PREPARING" | "READY_FOR_PICKUP"
  ): Promise<Order>;
  getSettlementsAndReviews(): Promise<{
    settlements: RestaurantSettlement[];
    reviews: ReviewRecord[];
    penalties?: OutletPenaltyRecord[];
  }>;
  replyToReview(reviewId: string, reply: string): Promise<ReviewRecord>;
  presignMediaUpload?(payload: {
    category: MediaCategory;
    outletId?: string;
    filename: string;
    contentType: string;
    sizeBytes?: number;
  }): Promise<PresignedMediaUploadResponse>;
  presignMediaView?(key: string): Promise<PresignedMediaViewResponse>;
}

export interface IDeliveryPortalService {
  getMyPartnerProfile(): Promise<DeliveryPartnerWithStatus>;
  submitOnboarding(payload: {
    vehicleType: DeliveryPartner["vehicleType"];
    vehicleModel: string;
    licensePlate: string;
    documentType?: string;
    fileKey?: string;
  }): Promise<DeliveryPartner>;
  presignMediaUpload?(payload: {
    category: MediaCategory;
    outletId?: string;
    filename: string;
    contentType: string;
    sizeBytes?: number;
  }): Promise<PresignedMediaUploadResponse>;
  presignMediaView?(key: string): Promise<PresignedMediaViewResponse>;
  toggleAvailability(
    status: "ONLINE_AVAILABLE" | "OFFLINE",
    location?: GeoPoint
  ): Promise<DeliveryPartner>;
  getPendingOffers(): Promise<DeliveryOffer[]>;
  acceptOffer(assignmentId: string): Promise<Order>;
  rejectOffer(assignmentId: string, reason: string): Promise<void>;
  getActiveDelivery(): Promise<Order | null>;
  getDeliveryOrder?(orderId: string): Promise<Order>;
  updateDeliveryProgress(
    orderId: string,
    nextStatus:
      | "ARRIVED_AT_RESTAURANT"
      | "PICKED_UP"
      | "OUT_FOR_DELIVERY"
      | "ARRIVED_AT_CUSTOMER"
      | "DELIVERED",
    pin?: string
  ): Promise<Order>;
  pingLocation(orderId: string, location: GeoPoint, bearingDegrees: number): Promise<void>;
  getHistoryAndEarnings(): Promise<{
    deliveries: Order[];
    earnings: DeliveryEarningRecord[];
  }>;
}

export interface IAdminPortalService {
  getOverviewStats(): Promise<{
    activeOrdersCount: number;
    onlinePartnersCount: number;
    todayGmvMinor: number;
    pendingVerificationsCount: number;
    openComplaintsCount: number;
    unassignableOrdersCount: number;
  }>;
  listAllUsers(): Promise<User[]>;
  updateUserStatus(
    userId: string,
    status: User["status"],
    reason: string
  ): Promise<User>;
  deleteUser(userId: string): Promise<void>;
  updateManagementUserRoles(
    userId: string,
    payload: {
      roleId?: string;
      roleCodes?: string[];
      customPermissions?: AdminPermission[];
    }
  ): Promise<{ userId: string; roles: string[]; permissions: AdminPermission[] }>;
  listDirectoryCustomers(): Promise<AdminDirectoryCustomer[]>;
  listDirectoryOwners(): Promise<AdminDirectoryOwner[]>;
  listDirectoryOutlets(): Promise<{
    outlets: AdminDirectoryOutlet[];
    staff: AdminDirectoryStaffUser[];
  }>;
  listDirectoryManagement(): Promise<AdminDirectoryManagementUser[]>;
  listDirectoryDelivery(): Promise<AdminDirectoryDeliveryUser[]>;
  getAdminUserDetail(userId: string): Promise<AdminUserDetail>;
  getAdminOutletDetail(outletId: string): Promise<AdminOutletDetail>;
  listRestaurantOwners(): Promise<RestaurantOwnerProfile[]>;
  decideRestaurantOwnerVerification(
    ownerId: string,
    decision: VerificationStatus,
    notes: string
  ): Promise<RestaurantOwnerProfile>;
  listRestaurants(): Promise<Restaurant[]>;
  decideRestaurantVerification(
    restaurantId: string,
    decision: VerificationStatus,
    notes: string
  ): Promise<Restaurant>;
  listDeliveryPartners(): Promise<DeliveryPartner[]>;
  decidePartnerVerification(
    partnerId: string,
    decision: VerificationStatus,
    notes: string
  ): Promise<DeliveryPartner>;
  listAllOrders(): Promise<Order[]>;
  interveneOrder(
    orderId: string,
    action: "FORCE_CANCEL_REFUND" | "MANUAL_ASSIGN_PARTNER",
    payload: { reason: string; partnerId?: string }
  ): Promise<Order>;
  listPaymentsAndRefunds(): Promise<{
    payments: PaymentRecord[];
    refunds: RefundRecord[];
  }>;
  reconcilePayments?(): Promise<{
    reconciledCount: number;
    processedRefundsCount: number;
  }>;
  issueRefund(payload: {
    orderId: string;
    amountMinor: number;
    reasonCode: string;
    notes: string;
  }): Promise<RefundRecord>;
  getCommissionConfig(): Promise<CommissionConfig>;
  updateCommissionConfig(
    config: CommissionConfig,
    reason: string
  ): Promise<CommissionConfig>;
  listCoupons(): Promise<CouponRecord[]>;
  createCoupon(coupon: Omit<CouponRecord, "id" | "currentUses">): Promise<CouponRecord>;
  toggleCoupon(couponId: string, isActive: boolean): Promise<CouponRecord>;
  listServiceZones(): Promise<ServiceZone[]>;
  updateServiceZone(zoneId: string, isActive: boolean): Promise<ServiceZone>;
  listComplaints(): Promise<ComplaintRecord[]>;
  resolveComplaint(
    complaintId: string,
    payload: { status: "RESOLVED" | "CLOSED"; resolutionNotes: string; issueRefundMinor?: number }
  ): Promise<ComplaintRecord>;
  listAuditLogs(): Promise<AuditLogEntry[]>;
  listRoles(): Promise<RoleDefinition[]>;
  createRole(payload: {
    name: string;
    description?: string;
    permissions: AdminPermission[];
  }): Promise<RoleDefinition>;
  updateRolePermissions(
    roleId: string,
    permissions: AdminPermission[]
  ): Promise<RoleDefinition>;
  deleteRole(roleId: string): Promise<void>;
  listAdminInvitations(): Promise<InvitationItem[]>;
  createAdminInvitation(payload: {
    email?: string;
    phone?: string;
    roleId: string;
    customPermissions?: AdminPermission[];
    preApproved?: boolean;
  }): Promise<InvitationItem>;
  approveAdminInvitation(invitationId: string): Promise<InvitationItem>;
  revokeAdminInvitation(invitationId: string): Promise<void>;
  listAllPendingOutletStaff(): Promise<(OutletStaffMember & { outletName: string })[]>;
  approveOutletStaff(outletId: string, assignmentId: string): Promise<OutletStaffMember>;
  presignMediaView?(key: string): Promise<PresignedMediaViewResponse>;
}

export interface ServiceRegistry {
  auth: IAuthService;
  discovery: IDiscoveryService;
  cart: ICartService;
  orders: IOrderService;
  restaurantPortal: IRestaurantPortalService;
  deliveryPortal: IDeliveryPortalService;
  adminPortal: IAdminPortalService;
}
