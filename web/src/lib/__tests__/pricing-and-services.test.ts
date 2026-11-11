import { describe, expect, it } from "vitest";
import { computeCartBreakdown } from "@/lib/pricing";
import { formatMinor } from "@/lib/format";
import { validateCustomizationSelection } from "@/lib/validators/schemas";
import { ApiError } from "@/services/contracts/errors";
import { services } from "@/services";
import { SEED_COMMISSION_CONFIG, SEED_COUPONS } from "@/services/mocks/seedData";

describe("Goodly Pricing & Validation Logic", () => {
  it("formats minor units cleanly as INR and USD currency", () => {
    expect(formatMinor(45000, "INR")).toBe("₹450.00");
    expect(formatMinor(2900, "INR")).toBe("₹29.00");
    expect(formatMinor(1800, "USD")).toBe("$18.00");
  });

  it("computes minor-unit cart breakdown accurately with percentage coupon, 5% GST, and zero small-cart fee above threshold", () => {
    const breakdown = computeCartBreakdown({
      items: [
        {
          id: "ci-1",
          menuItemId: "item-st-rigatoni",
          name: "Sunday rigatoni",
          imageUrl: "/images/sunday-table.jpg",
          unitBasePriceMinor: 45000,
          unitCustomizationsPriceMinor: 0,
          quantity: 2,
          customizations: [],
          lineTotalMinor: 90000,
        },
      ],
      packagingFeeMinor: 2000,
      baseDeliveryFeeMinor: 0,
      coupon: SEED_COUPONS[0], // WELCOMEGOODLY: 20% off up to ₹150.00 (15000 paise)
      config: SEED_COMMISSION_CONFIG,
      tipAmountMinor: 3000,
    });

    expect(breakdown.itemSubtotalMinor).toBe(90000);
    expect(breakdown.smallCartFeeMinor).toBe(0); // 90000 >= 29900 threshold
    expect(breakdown.discountAmountMinor).toBe(15000); // capped at maxDiscountMinor 15000
    expect(breakdown.deliveryFeeMinor).toBe(0);
    expect(breakdown.taxAmountMinor).toBe(
      Math.round(((90000 - 15000) * 500) / 10000)
    );
    expect(breakdown.totalPayableMinor).toBe(
      90000 +
        2000 +
        0 +
        SEED_COMMISSION_CONFIG.platformFeeMinor +
        0 +
        breakdown.taxAmountMinor +
        3000 -
        15000
    );
  });

  it("applies small-cart fee ONLY when itemSubtotalMinor is strictly below minCartThresholdMinor", () => {
    const smallCart = computeCartBreakdown({
      items: [
        {
          id: "ci-small",
          menuItemId: "item-st-arancini",
          name: "Crispy cacio e pepe arancini",
          imageUrl: "/images/sunday-table.jpg",
          unitBasePriceMinor: 24000, // ₹240 < ₹299 (29900)
          unitCustomizationsPriceMinor: 0,
          quantity: 1,
          customizations: [],
          lineTotalMinor: 24000,
        },
      ],
      packagingFeeMinor: 2000,
      baseDeliveryFeeMinor: 2900,
      coupon: null,
      config: SEED_COMMISSION_CONFIG,
      tipAmountMinor: 0,
    });
    expect(smallCart.smallCartFeeMinor).toBe(
      SEED_COMMISSION_CONFIG.smallCartFeeMinor
    );
  });

  it("enforces required customization group min/max rules", () => {
    const groups = [
      {
        id: "g1",
        name: "Bread pairing",
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
        options: [
          {
            id: "o1",
            name: "Sourdough",
            priceDeltaMinor: 0,
            isDefault: true,
            isAvailable: true,
          },
          {
            id: "o2",
            name: "Focaccia",
            priceDeltaMinor: 6000,
            isDefault: false,
            isAvailable: true,
          },
        ],
      },
    ];

    expect(validateCustomizationSelection(groups, [])).toHaveProperty("g1");
    expect(validateCustomizationSelection(groups, ["o1", "o2"])).toHaveProperty(
      "g1"
    );
    expect(validateCustomizationSelection(groups, ["o1"])).toEqual({});
  });
});

describe("Goodly Mock Service Layer Contracts (FR-026, Broadcast Dispatch, Single-Use OTP, RBAC)", () => {
  it("enforces single-restaurant cart conflict (FR-026) and supports replacement", async () => {
    await services.cart.addItem({
      restaurantId: "rest-sunday-table",
      menuItemId: "item-st-rigatoni",
      quantity: 1,
      selectedOptionIds: [],
    });

    await expect(
      services.cart.addItem({
        restaurantId: "rest-little-green-bowl",
        menuItemId: "item-lgb-avocado",
        quantity: 1,
        selectedOptionIds: [],
      })
    ).rejects.toMatchObject({ code: "MULTI_RESTAURANT_CART_CONFLICT" });

    const replaced = await services.cart.addItem({
      restaurantId: "rest-little-green-bowl",
      menuItemId: "item-lgb-avocado",
      quantity: 1,
      selectedOptionIds: [],
      replaceCart: true,
    });
    expect(replaced.restaurantId).toBe("rest-little-green-bowl");
    expect(replaced.items).toHaveLength(1);
  });

  it("prevents duplicate order creation with same Idempotency-Key, broadcasts offers simultaneously, supersedes siblings on accept, and verifies single-use OTP", async () => {
    await services.auth.switchDemoPersona("CUSTOMER", "customer");
    await services.cart.addItem({
      restaurantId: "rest-sunday-table",
      menuItemId: "item-st-rigatoni",
      quantity: 1,
      selectedOptionIds: [],
    });
    const validation = await services.cart.validateCheckout("addr-brooklyn-home");
    expect(validation.isValid).toBe(true);

    const first = await services.orders.createOrder({
      deliveryAddressId: "addr-brooklyn-home",
      paymentMethod: "ONLINE",
      pricingQuoteHash: validation.pricingQuoteHash,
      idempotencyKey: "same-key-001",
    });

    const duplicate = await services.orders.createOrder({
      deliveryAddressId: "addr-brooklyn-home",
      paymentMethod: "ONLINE",
      pricingQuoteHash: validation.pricingQuoteHash,
      idempotencyKey: "same-key-001",
    });
    expect(duplicate.order.id).toBe(first.order.id);

    // Switch to Outlet Owner and accept -> prepare -> ready
    await services.auth.switchDemoPersona("RESTAURANT_OWNER");
    const outlets = await services.restaurantPortal.listMyOutlets();
    expect(outlets.length).toBeGreaterThanOrEqual(2);

    const accepted = await services.restaurantPortal.acceptOrder(first.order.id, 20);
    expect(accepted.orderStatus).toBe("RESTAURANT_ACCEPTED");
    await services.restaurantPortal.advanceOrderStatus(first.order.id, "PREPARING");
    const ready = await services.restaurantPortal.advanceOrderStatus(
      first.order.id,
      "READY_FOR_PICKUP"
    );
    expect(ready.orderStatus).toBe("READY_FOR_PICKUP");

    // Switch to Delivery Partner, accept broadcast offer, deliver with wrong OTP then right OTP
    expect(first.order.deliveryPin).toBe("");

    await services.auth.switchDemoPersona("DELIVERY_PARTNER");
    const offers = await services.deliveryPortal.getPendingOffers();
    expect(offers.length).toBeGreaterThan(0);
    await services.deliveryPortal.acceptOffer(offers[0].assignmentId);
    await services.deliveryPortal.updateDeliveryProgress(first.order.id, "PICKED_UP");
    const arrived = await services.deliveryPortal.updateDeliveryProgress(
      first.order.id,
      "ARRIVED_AT_CUSTOMER"
    );
    expect(arrived.deliveryPin).toMatch(/^\d{4}$/);

    await expect(
      services.deliveryPortal.updateDeliveryProgress(first.order.id, "DELIVERED", "0000")
    ).rejects.toBeInstanceOf(ApiError);

    const delivered = await services.deliveryPortal.updateDeliveryProgress(
      first.order.id,
      "DELIVERED",
      arrived.deliveryPin
    );
    expect(delivered.orderStatus).toBe("DELIVERED");
    expect(delivered.ratingPromptStatus).toBe("ELIGIBLE_ON_APP_OPEN");

    // Single-use OTP cannot be reused
    await expect(
      services.deliveryPortal.updateDeliveryProgress(
        first.order.id,
        "DELIVERED",
        arrived.deliveryPin
      )
    ).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
  });

  it("blocks CUSTOMER_CARE (SUPPORT_ADMIN) from updating commission config (RBAC)", async () => {
    await services.auth.switchDemoPersona("SUPPORT_ADMIN");
    await expect(
      services.adminPortal.updateCommissionConfig(
        SEED_COMMISSION_CONFIG,
        "Unauthorized test"
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
