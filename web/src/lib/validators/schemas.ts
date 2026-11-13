import { z } from "zod";
import type { CustomizationGroup } from "@/services/contracts/types";

export const loginSchema = z.object({
  emailOrPhone: z.string().trim().min(3, "Enter your email or phone number"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .min(8, "Enter a valid phone number")
    .regex(/^[+\d\s()-]+$/, "Phone number contains invalid characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum([
    "CUSTOMER",
    "OUTLET_OWNER",
    "OUTLET_STAFF",
    "RESTAURANT_OWNER",
    "DELIVERY_PARTNER",
  ]),
});

export const otpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit verification code"),
});

export const addressSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Location tag is required")
    .max(50, "Location tag must be 50 characters or less"),
  recipientName: z.string().trim().min(2, "Recipient name is required"),
  recipientPhone: z.string().trim().min(8, "Recipient phone is required"),
  addressLine1: z.string().trim().min(4, "Street address is required"),
  addressLine2: z.string().trim().optional(),
  landmark: z.string().trim().optional(),
  city: z.string().trim().min(2, "City is required"),
  state: z.string().trim().min(2, "State is required"),
  postalCode: z.string().trim().min(3, "Postal code is required"),
  deliveryInstructions: z.string().max(240, "Max 240 characters").optional(),
});

export const checkoutSchema = z.object({
  deliveryAddressId: z.string().min(1, "Please select a delivery address"),
  paymentMethod: z.enum(["ONLINE", "COD"]),
  specialInstructions: z.string().max(300, "Max 300 characters").optional(),
});

export const reviewSchema = z.object({
  foodRating: z.number().int().min(1).max(5),
  deliveryRating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(500, "Max 500 characters").optional(),
});

export const complaintSchema = z.object({
  category: z.enum([
    "MISSING_ITEM",
    "WRONG_ORDER",
    "QUALITY_ISSUE",
    "LATE_DELIVERY",
    "BILLING_ISSUE",
  ]),
  description: z
    .string()
    .trim()
    .min(15, "Please describe the issue in at least 15 characters")
    .max(1000, "Max 1000 characters"),
});

export const menuItemSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  name: z.string().trim().min(2, "Dish name is required"),
  description: z.string().trim().min(4, "Description is required"),
  badgeLabel: z.string().trim().max(40).optional(),
  vegClassification: z.enum(["VEG", "NON_VEG", "EGG_ONLY"]).optional(),
  basePriceDollars: z
    .number()
    .min(1, "Price must be at least ₹1")
    .max(50000, "Price exceeds maximum"),
  trackInventory: z.boolean(),
  availableQuantity: z.number().int().min(0).max(9999),
  imageUrl: z.string().trim().optional(),
  cuisineType: z.string().trim().max(80).optional(),
  spiceLevel: z.enum(["NONE", "MILD", "MEDIUM", "HOT", "EXTRA_HOT"]).optional(),
  prepTimeMinutes: z.number().int().min(1).max(180).optional().nullable(),
  caloriesKcal: z.number().int().min(0).max(5000).optional().nullable(),
  servingSize: z.string().trim().max(80).optional(),
  isRecommended: z.boolean().optional(),
});

export const restaurantOnboardingSchema = z.object({
  name: z.string().trim().min(2, "Restaurant name is required"),
  cuisines: z.string().trim().min(2, "Enter at least one cuisine"),
  phone: z.string().trim().min(8, "Business phone is required"),
  email: z.string().trim().email("Valid email is required"),
  addressLine1: z.string().trim().min(4, "Street address is required"),
  city: z.string().trim().min(2, "City is required"),
  state: z.string().trim().min(2, "State is required"),
  postalCode: z.string().trim().min(3, "Postal code is required"),
  licenseNumber: z.string().trim().min(4, "Food safety / business license is required"),
});

export const deliveryOnboardingSchema = z.object({
  vehicleType: z.enum(["BICYCLE", "SCOOTER", "MOTORCYCLE", "CAR"]),
  vehicleModel: z.string().trim().min(2, "Vehicle make/model is required"),
  licensePlate: z.string().trim().min(2, "License plate or ID is required"),
});

export const commissionConfigSchema = z.object({
  defaultCommissionBps: z.number().int().min(0).max(5000),
  commissionCalculationBasis: z
    .enum([
      "GROSS_FOOD_SUBTOTAL",
      "NET_AFTER_OUTLET_DISCOUNT",
      "SUBTOTAL_PLUS_PACKAGING",
    ])
    .optional(),
  minCartThresholdMinor: z.number().int().min(0).max(500000).optional(),
  smallCartFeeMinor: z.number().int().min(0).max(50000).optional(),
  taxRateBps: z.number().int().min(0).max(3000),
  platformFeeMinor: z.number().int().min(0).max(50000),
  baseDeliveryFeeMinor: z.number().int().min(0).max(50000),
  perKmDeliveryFeeMinor: z.number().int().min(0).max(20000),
  freeDeliveryThresholdMinor: z.number().int().min(0).max(500000),
  partnerBasePayoutMinor: z.number().int().min(100).max(50000),
  partnerPerKmPayoutMinor: z.number().int().min(0).max(20000),
  surgeMultiplierBps: z.number().int().min(10000).max(30000),
  codEnabled: z.boolean(),
  acceptanceTimeoutSeconds: z.number().int().min(60).max(1800).optional(),
  acceptanceGracePeriodSeconds: z.number().int().min(30).max(900).optional(),
  nonAcceptancePenaltyMode: z
    .enum(["PERCENTAGE_OF_SUBTOTAL", "FLAT_AMOUNT"])
    .optional(),
  nonAcceptancePenaltyBps: z.number().int().min(0).max(5000).optional(),
  nonAcceptanceFlatPenaltyMinor: z.number().int().min(0).max(500000).optional(),
  nonAcceptanceMinPenaltyMinor: z.number().int().min(0).max(500000).optional(),
  nonAcceptanceMaxPenaltyMinor: z.number().int().min(0).max(500000).optional(),
  partnerDailyPayoutFeeMode: z
    .enum(["FREE_SCHEDULED_PAID_INSTANT", "FLAT_DAILY", "PERCENTAGE_CAPPED"])
    .optional(),
  partnerScheduledDailyFeeMinor: z.number().int().min(0).max(50000).optional(),
  partnerInstantCashoutFeeMinor: z.number().int().min(0).max(50000).optional(),
  partnerPayoutFeeBps: z.number().int().min(0).max(5000).optional(),
  partnerPayoutFeeCapMinor: z.number().int().min(0).max(50000).optional(),
  partnerWaiveFeeAboveTripsPerDay: z.number().int().min(0).max(100).optional(),
});

export function validateCustomizationSelection(
  groups: CustomizationGroup[],
  selectedOptionIds: string[]
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const group of groups) {
    const selectedCount = group.options.filter((opt) =>
      selectedOptionIds.includes(opt.id)
    ).length;
    if (selectedCount < group.minSelections) {
      errors[group.id] =
        group.minSelections === 1
          ? `Select at least 1 option for ${group.name}`
          : `Select at least ${group.minSelections} options for ${group.name}`;
    } else if (selectedCount > group.maxSelections) {
      errors[group.id] = `Select at most ${group.maxSelections} option(s) for ${group.name}`;
    }
  }
  return errors;
}
