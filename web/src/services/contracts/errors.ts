export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "MULTI_RESTAURANT_CART_CONFLICT"
  | "CART_PRICE_OR_AVAILABILITY_CHANGED"
  | "ITEM_OUT_OF_STOCK"
  | "INVALID_COUPON"
  | "OUT_OF_SERVICE_AREA"
  | "ORDER_STATE_CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "OFFER_EXPIRED_OR_TAKEN"
  | "PAYMENT_FAILED"
  | "INVALID_DELIVERY_PIN"
  | "CANCELLATION_NOT_ALLOWED"
  | "GPS_PERMISSION_REQUIRED"
  | "APPROVAL_BLOCKED"
  | "PROTECTED_ROLE"
  | "OWNER_KYC_REQUIRED"
  | "DUPLICATE_OUTLET_NAME"
  | "CANNOT_MODIFY_SELF_ROLE";

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
