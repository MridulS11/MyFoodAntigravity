import { expect, test } from "@playwright/test";

test.describe("Phase 1 — Goodly 4-Portal Frontend & Visual Verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Only clear once if flagged, or let Playwright fresh contexts handle isolation
    });
  });

  test("TC-FE-CUST-001/003/004/007/008: Customer Discovery, Sunday Table Menu, Bag Stepper, Refresh Persistence & Checkout", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("goodly").first()).toBeVisible();
    await expect(page.getByTestId("hero-cta-button")).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/01-customer-home-desktop.png",
      fullPage: true,
    });

    // Navigate to Sunday Table
    await page.getByTestId("hero-cta-button").click();
    await expect(page).toHaveURL(/\/restaurants\/sunday-table/);
    await expect(page.getByText("A little room for delicious.")).toBeVisible();
    await expect(page.getByTestId("header-bag-count")).toHaveText("0");
    await page.screenshot({
      path: "test-results/screenshots/02-restaurant-menu-empty-bag.png",
      fullPage: true,
    });

    // Add Sunday rigatoni -> inline stepper + header bag 1 + sticky subtotal ₹450.00
    await page.getByTestId("add-dish-item-st-rigatoni").click();
    await expect(page.getByTestId("stepper-item-st-rigatoni")).toBeVisible();
    await expect(page.getByTestId("qty-item-st-rigatoni")).toHaveText("1");
    await expect(page.getByTestId("header-bag-count")).toHaveText("1");
    await expect(page.getByTestId("sticky-bag-subtotal")).toHaveText("₹450.00");
    await page.screenshot({
      path: "test-results/screenshots/03-restaurant-menu-active-bag.png",
      fullPage: true,
    });

    // Browser refresh persistence (TC-FE-CUST-007)
    await page.reload();
    await expect(page.getByTestId("header-bag-count")).toHaveText("1");
    await expect(page.getByTestId("sticky-bag-subtotal")).toHaveText("₹450.00");

    // Go to checkout -> redirected to Customer Sign In -> returns to checkout & places order
    await page.getByTestId("go-to-checkout-btn").click();
    await expect(page).toHaveURL(/\/checkout/);
    await page.getByTestId("checkout-signin-link").click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await page.getByRole("button", { name: /Customer \(Alice\)/i }).click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByTestId("checkout-total")).toBeVisible();
    await page.getByTestId("place-order-btn").click();

    // Interactive simulated payment gateway opens instead of jumping straight to /track
    await expect(page.getByTestId("payment-simulator-modal")).toBeVisible();
    await page.getByTestId("sim-pay-fail-btn").click();
    await expect(page.getByTestId("payment-failed-banner")).toBeVisible();

    await page.getByRole("button", { name: "Retry Payment Now" }).click();
    await expect(page.getByTestId("payment-simulator-modal")).toBeVisible();
    await page.getByTestId("sim-pay-success-btn").click();

    await expect(page).toHaveURL(/\/orders\/.+\/track/);
    await expect(page.getByTestId("delivery-pin-display")).toHaveCount(0);
    await expect(page.getByTestId("awaiting-arrival-otp-badge")).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/04-customer-live-tracking.png",
      fullPage: true,
    });
  });

  test("TC-FE-CUST-002 & TC-FE-CUST-006: Out-of-zone address and Multi-Restaurant Cart Conflict", async ({
    page,
  }) => {
    await page.goto("/restaurants/sunday-table");
    await page.getByTestId("add-dish-item-st-rigatoni").click();
    await expect(page.getByTestId("header-bag-count")).toHaveText("1");

    await page.goto("/restaurants/little-green-bowl");
    await page.getByTestId("add-dish-item-lgb-avocado").click();
    await expect(page.getByText("Start a new bag?")).toBeVisible();
    await page.getByRole("button", { name: "Replace bag" }).click();
    await expect(page.getByTestId("header-bag-count")).toHaveText("1");

    // Out of zone check (sign in as Customer to pick saved Mysuru Road out-of-zone address)
    await page.goto("/auth/login");
    await page.getByRole("button", { name: /Customer \(Alice\)/i }).click();
    await expect(page).toHaveURL("/");
    await page.getByTestId("address-picker-trigger").click();
    await page.getByTestId("select-address-addr-out-of-zone").click();
    await expect(page.getByTestId("out-of-zone-banner")).toBeVisible();
  });

  test("TC-FE-REST/DELIV/ADMIN: Cross-Portal Order Fulfillment & RBAC Enforcement", async ({
    page,
  }) => {
    // 1. Restaurant KDS Portal (isolated login)
    await page.goto("/restaurant/login");
    await page.getByRole("button", { name: /Restaurant \(Sunday Table\)/i }).click();
    await expect(page).toHaveURL(/\/restaurant\/orders/);
    await expect(page.getByText("LIVE KITCHEN DISPLAY SYSTEM")).toBeVisible();
    await page.screenshot({
      path: "test-results/screenshots/05-restaurant-kds.png",
      fullPage: true,
    });

    // Accept seeded order ord-seed-active-1
    await page.getByTestId("kds-accept-ord-seed-active-1").click();
    await expect(page.getByTestId("kds-start-prep-ord-seed-active-1")).toBeVisible();
    await page.getByTestId("kds-start-prep-ord-seed-active-1").click();
    await page.getByTestId("kds-mark-ready-ord-seed-active-1").click();

    // 2. Delivery Partner Portal (isolated login)
    await page.goto("/delivery/login");
    await page.getByRole("button", { name: /Delivery Partner \(Devon\)/i }).click();
    await expect(page).toHaveURL(/\/delivery\/dashboard/);
    await page.screenshot({
      path: "test-results/screenshots/06-delivery-dashboard-offer.png",
      fullPage: true,
    });

    const acceptOfferBtn = page.locator("[data-testid^='accept-offer-']").first();
    await expect(acceptOfferBtn).toBeVisible();
    await acceptOfferBtn.click();
    await expect(page).toHaveURL(/\/delivery\/active\/ord-seed-active-1/);

    await page.getByTestId("btn-arrived-restaurant").click();
    await page.getByTestId("btn-picked-up").click();
    await page.getByTestId("btn-out-for-delivery").click();
    await page.getByTestId("btn-arrived-customer").click();
    await page.getByTestId("delivery-pin-input").fill("4821");
    await page.getByTestId("btn-complete-delivery").click();
    await expect(page).toHaveURL(/\/delivery\/earnings/);

    // 3. Admin Portal & RBAC verification (isolated login)
    await page.goto("/admin/login");
    await page.getByRole("button", { name: /Super Admin \(Elena\)/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await page.screenshot({
      path: "test-results/screenshots/07-admin-dashboard.png",
      fullPage: true,
    });

    // Verify Support Admin cannot access commissions-pricing
    await page.getByTestId("switch-support-admin").click();
    await page.goto("/admin/commissions-pricing");
    await expect(page.getByTestId("admin-rbac-denied")).toBeVisible();
  });

  test("TC-FE-CUST-010: Responsive Tablet (768px) & Mobile (390px) Layout Check", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/restaurants/sunday-table");
    await expect(page.getByRole("heading", { name: "Most loved" })).toBeVisible();
    const tabletOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(tabletOverflow).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("hero-cta-button")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: "test-results/screenshots/08-customer-home-mobile.png",
      fullPage: true,
    });
  });
});
