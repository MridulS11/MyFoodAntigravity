import { expect, test } from "@playwright/test";

test.describe("Auth, Isolated Portal Sessions, Onboarding Prompts, Invitations & Approval Gates", () => {
  test("Unauthenticated guards, isolated portal cookies, reload persistence & portal-scoped logout", async ({
    page,
  }) => {
    // 1. Visiting protected portal routes without cookies asks user to sign in on that portal
    await page.goto("/restaurant/orders");
    await expect(page).toHaveURL(/\/restaurant\/login/);

    await page.goto("/delivery/dashboard");
    await expect(page).toHaveURL(/\/delivery\/login/);

    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/admin\/login/);

    // 2. Sign into Restaurant -> reload stays logged in; sign into Delivery simultaneously
    await page.goto("/restaurant/login");
    await page.getByRole("button", { name: /Restaurant \(Sunday Table\)/i }).click();
    await expect(page).toHaveURL(/\/restaurant\/orders/);
    await page.reload();
    await expect(page).toHaveURL(/\/restaurant\/orders/);

    await page.goto("/delivery/login");
    await page.getByRole("button", { name: /Delivery Partner \(Devon\)/i }).click();
    await expect(page).toHaveURL(/\/delivery\/dashboard/);

    // Restaurant session remains active in parallel, then logging out of Restaurant only affects Restaurant
    await page.goto("/restaurant/orders");
    await expect(page).toHaveURL(/\/restaurant\/orders/);
    await page.getByTestId("restaurant-logout-btn").click();
    await expect(page).toHaveURL(/\/restaurant\/login/);

    await page.goto("/restaurant/orders");
    await expect(page).toHaveURL(/\/restaurant\/login/);
    await expect(page.getByRole("button", { name: /Sign in to restaurant portal/i })).toBeVisible();

    await page.goto("/delivery/dashboard");
    await expect(page).toHaveURL(/\/delivery\/dashboard/);
  });

  test("Unique unregistered email on login prompts account setup & onboarding", async ({
    page,
  }) => {
    await page.goto("/restaurant/login");
    const emailInput = page.locator("input").first();
    await emailInput.fill("brand.new.bistro@goodly.in");
    await page.getByRole("button", { name: /Sign in to restaurant portal/i }).click();
    await expect(page.getByTestId("unique-email-onboarding-banner")).toBeVisible();
    await page.getByTestId("unique-email-onboarding-cta").click();
    await expect(page.getByRole("button", { name: /Create Account & Continue/i })).toBeVisible();
  });

  test("Delivery partner skipping onboarding sees persistent header warning sign", async ({
    page,
  }) => {
    await page.goto("/delivery/login");
    await page.getByRole("button", { name: /Pending Courier \(Arjun\)/i }).click();
    await expect(page).toHaveURL(/\/delivery\/dashboard/);
    await expect(page.getByTestId("delivery-pending-warning")).toContainText(
      "You are not receiving orders due to onboarding verification pending"
    );
    await expect(page.getByTestId("header-onboarding-warning-pill")).toBeVisible();
    await expect(page.getByTestId("partner-availability-toggle")).toBeDisabled();
  });

  test("Invited outlet staff must accept invitation, then await owner/admin approval", async ({
    page,
  }) => {
    // 1. Invited staff signs in on isolated restaurant login -> locked out of /restaurant/orders before accepting invite
    await page.goto("/restaurant/login");
    await page
      .getByRole("button", { name: /Invited Outlet Staff \(Meera\)/i })
      .click();
    await expect(page).toHaveURL(/\/restaurant\/onboarding/);
    await expect(page.getByTestId("work-at-outlet-panel")).toBeVisible();
    await expect(page.getByTestId("pending-invitations-banner")).toBeVisible();

    await page.goto("/restaurant/orders");
    await expect(page.getByTestId("restaurant-no-access-panel")).toBeVisible();
    await expect(page.getByText(/LIVE KITCHEN DISPLAY SYSTEM/i)).not.toBeVisible();

    await page.getByTestId("accept-invite-staff-3-invited").click();
    await expect(page.getByTestId("pending-invitations-banner")).toContainText(
      "Accepted · Needs approval"
    );
    // Still locked out while awaiting Owner/Admin approval
    await expect(page.getByTestId("restaurant-no-access-panel")).toBeVisible();

    // 2. Owner signs in, navigates to Users & Roles, approves access
    await page.goto("/restaurant/login");
    await page.getByRole("button", { name: /Restaurant \(Sunday Table\)/i }).click();
    await expect(page).toHaveURL(/\/restaurant\/orders/);
    await page.goto("/restaurant/team");
    await page.getByTestId("approve-staff-staff-3-invited").click();
    await expect(page.getByText("Meera Joshi")).toBeVisible();

    // 3. Approved staff can now access /restaurant/orders KDS cleanly
    await page.goto("/restaurant/login");
    await page
      .getByRole("button", { name: /Invited Outlet Staff \(Meera\)/i })
      .click();
    await page.goto("/restaurant/orders");
    await expect(page.getByTestId("restaurant-no-access-panel")).not.toBeVisible();
    await expect(page.getByText(/LIVE KITCHEN DISPLAY SYSTEM/i)).toBeVisible();
  });

  test("Admin invitation acceptance -> Super Admin custom role & approval gate", async ({
    page,
  }) => {
    // 1. Invited ops candidate signs in on isolated admin login -> stays in zero-access mode until accepted+approved
    await page.goto("/admin/login");
    await page
      .getByRole("button", { name: /Invited Ops Admin \(Vikramaditya\)/i })
      .click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByTestId("admin-no-access-panel")).toBeVisible();
    await page.getByTestId("accept-invite-plat-inv-1").click();
    await expect(
      page.getByText(/awaiting Admin\/Owner approval before workspace access unlocks/i)
    ).toBeVisible();

    // 2. Super Admin signs in, creates custom role, and approves accepted admin invitation
    await page.goto("/admin/login");
    await page.getByRole("button", { name: /Super Admin \(Elena\)/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await page.goto("/admin/roles");

    await page.getByPlaceholder(/Bengaluru Ops Lead/i).fill("City Escalation Desk");
    await page.getByRole("button", { name: /Create Custom Role/i }).click();
    await expect(page.getByText("City Escalation Desk", { exact: true })).toBeVisible();

    await page.getByTestId("approve-admin-inv-plat-inv-1").click();
    await expect(page.getByTestId("approve-admin-inv-plat-inv-1")).not.toBeVisible();
  });

  test("Open Admin registration & pre-invite login -> zero access until invited & accepted", async ({
    page,
  }) => {
    // 1. Filling signup without entering OTP MUST NOT persist credentials or permit login
    await page.goto("/admin/register");
    await page.getByPlaceholder("Your full name").fill("Neeraj Ops");
    await page.getByPlaceholder("you@domain.in").fill("neeraj.ops@goodly.in");
    await page.locator('input[type="password"]').fill("password123");
    await page.getByRole("button", { name: /Create Account & Continue/i }).click();

    await expect(page.getByText(/Verify OTP sent to/i)).toBeVisible();
    await page.getByTestId("cancel-otp-to-login-btn").click();

    // Trying to log in right after abandoning OTP fails because credentials were not stored
    const preOtpInputs = page.locator("form input");
    await preOtpInputs.nth(0).fill("neeraj.ops@goodly.in");
    await preOtpInputs.nth(1).fill("password123");
    await page.getByRole("button", { name: /Sign in to admin portal/i }).click();
    await expect(page.getByTestId("unique-email-onboarding-banner")).toBeVisible();

    // 2. Complete signup WITH valid OTP -> credentials stored and zero-access /admin/dashboard opens
    await page.getByTestId("unique-email-onboarding-cta").click();
    await page.getByPlaceholder("Your full name").fill("Neeraj Ops");
    await page.locator('input[type="password"]').fill("password123");
    await page.getByRole("button", { name: /Create Account & Continue/i }).click();
    await expect(page.getByText(/Verify OTP sent to/i)).toBeVisible();
    await page.getByTestId("otp-code-input").fill("123456");
    await page.getByRole("button", { name: /Verify & Start Onboarding/i }).click();

    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByTestId("admin-no-access-panel")).toBeVisible();
    await expect(page.getByTestId("admin-no-access-panel").getByText("neeraj.ops@goodly.in")).toBeVisible();

    // 3. Super Admin logs in, invites neeraj.ops@goodly.in (pre-approved on accept), then logs out
    await page.goto("/admin/login");
    await page.getByRole("button", { name: /Super Admin \(Elena\)/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await page.goto("/admin/roles");
    await page.getByPlaceholder("ops.member@goodly.in").fill("neeraj.ops@goodly.in");
    await page.getByRole("button", { name: /Send Admin Invitation/i }).click();
    await page.getByTestId("admin-logout-btn").click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("button", { name: /Sign in to admin portal/i })).toBeVisible();

    // 4. Neeraj signs in on /admin/login, sees invitation, accepts -> dashboard unlocks immediately
    const inputs = page.locator("form input");
    await inputs.nth(0).fill("neeraj.ops@goodly.in");
    await expect(inputs.nth(0)).toHaveValue("neeraj.ops@goodly.in");
    await inputs.nth(1).fill("password123");
    await page.getByRole("button", { name: /Sign in to admin portal/i }).click();

    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByTestId("admin-no-access-panel")).toBeVisible();
    await expect(page.getByTestId("pending-invitations-banner")).toBeVisible();
    await page.getByTestId("pending-invitations-banner").getByRole("button", { name: "Accept" }).click();

    await expect(page.getByTestId("admin-no-access-panel")).not.toBeVisible();
  });

  test("Admin portal user directory can permanently delete user accounts", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByRole("button", { name: /Super Admin \(Elena\)/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    await page.goto("/admin/users");
    await expect(page.getByText("admin.invited@goodly.local")).toBeVisible();
    await page.getByTestId("delete-user-user-admin-invited").click();
    await page.getByTestId("confirm-delete-user-user-admin-invited").click();

    await expect(page.getByText("admin.invited@goodly.local")).not.toBeVisible();
  });

  test("Multi-outlet vs existing-branch onboarding, outlet/branch staff scoping, online toggle, and menu visibility gate", async ({ page }) => {
    // 1. Owner signs in via dummy credentials on /restaurant/login
    await page.goto("/restaurant/login");
    await page.getByRole("button", { name: /Restaurant \(Sunday Table\)/i }).click();
    await expect(page).toHaveURL(/\/restaurant\//);

    // 2. Onboarding branches into Add New Outlet vs Add Branch to Existing Outlet
    await page.goto("/restaurant/onboarding?mode=create");
    await expect(page.getByTestId("subchoice-new-outlet")).toBeVisible();
    await expect(page.getByTestId("subchoice-existing-branch")).toBeVisible();

    await page.getByTestId("subchoice-new-outlet").click();
    await page.getByTestId("new-outlet-name-input").fill("Copper Bowl Hospitality");
    await page.getByTestId("branch-name-input").fill("Koramangala Flagship");
    await page.getByRole("button", { name: "Submit Outlet for Review", exact: true }).click();
    await expect(page.locator("main").getByText("Copper Bowl Hospitality").first()).toBeVisible();

    // Entering same Outlet Name again prompts user to add a branch instead of duplicate outlet
    await page.getByTestId("new-outlet-name-input").fill("Copper Bowl Hospitality");
    await expect(page.getByTestId("duplicate-outlet-prompt")).toBeVisible();
    await page.getByTestId("switch-to-add-branch-btn").click();
    await expect(page.getByTestId("existing-outlet-select")).toHaveValue("Copper Bowl Hospitality");
    await page.getByTestId("branch-name-input").fill("HSR Sector 2");
    await page.getByRole("button", { name: "Add Branch Location", exact: true }).click();
    await expect(page.locator("main").getByText("HSR Sector 2").first()).toBeVisible();

    // Two-level left sidebar dropdown: Outlet selector first, then Location selector when multiple branches
    await expect(page.getByTestId("outlet-group-select")).toBeVisible();
    await page.getByTestId("outlet-group-select").selectOption("Copper Bowl Hospitality");
    await expect(page.getByTestId("outlet-branch-select")).toBeVisible();

    // 3. Team & Roles shows expandable Outlet & Branch Access Scope overlay
    await page.goto("/restaurant/team");
    await expect(page.getByTestId("scope-overlay-trigger")).toBeVisible();
    await expect(page.getByTestId("outlet-scope-overlay")).toBeHidden();
    await page.getByTestId("scope-overlay-trigger").click();
    await expect(page.getByTestId("outlet-scope-overlay")).toBeVisible();
    await expect(page.getByTestId("scope-outlet-Copper Bowl Hospitality")).toBeVisible();
    await page.getByTestId("scope-overlay-done-btn").click();
    await expect(page.getByTestId("outlet-scope-overlay")).toBeHidden();

    // 4. Approve Copper Bowl Hospitality (HSR Sector 2) under Admin Restaurant KYC -> Outlet KYC tab
    await page.goto("/admin/login");
    await page.getByRole("button", { name: /Super Admin \(Elena\)/i }).click();
    await page.goto("/admin/restaurants");
    await expect(page.getByTestId("tab-owner-kyc")).toBeVisible();
    await page.getByTestId("tab-outlet-kyc").click();
    await page
      .locator("div.bg-white")
      .filter({ hasText: "HSR Sector 2" })
      .getByRole("button", { name: /Approve/i })
      .click();

    // Customer discovery does NOT show Copper Bowl Hospitality HSR before it has at least 1 menu item
    await page.goto("/");
    await expect(page.getByText("Sunday Table").first()).toBeVisible();
    await expect(page.getByText("Copper Bowl Hospitality · HSR Sector 2")).not.toBeVisible();

    // Switch via Outlet -> Location dropdowns on /restaurant/menu -> toggle online -> add 1 dish -> visible on `/`
    await page.goto("/restaurant/menu");
    await page.getByTestId("outlet-group-select").selectOption("Copper Bowl Hospitality");
    await page.getByTestId("outlet-branch-select").selectOption({ label: "HSR Sector 2" });
    await expect(page.locator("aside div").filter({ hasText: /^HSR Sector 2$/ })).toBeVisible();
    await expect(page.locator("aside").getByText("Verified")).toBeVisible();
    await expect(page.getByTestId("menu-empty-visibility-notice")).toBeVisible();
    await page.getByTestId("kitchen-online-toggle").click();
    await expect(page.getByTestId("kitchen-online-toggle")).toContainText("Accepting Orders");

    await page.getByPlaceholder("New category name (e.g. Desserts)...").fill("Rice Bowls");
    await page.getByRole("button", { name: /Add Category/i }).click();
    await page.getByRole("button", { name: /Add new dish/i }).click();
    await page.getByTestId("dish-name-input").fill("Smoked Copper Bowl");
    await page.getByTestId("dish-desc-input").fill("Slow charred paneer and jasmine rice");
    await page.getByRole("button", { name: /Save dish/i }).click();

    await page.goto("/");
    await expect(page.getByText("Copper Bowl Hospitality · HSR Sector 2").first()).toBeVisible();
  });

  test("New restaurant owner must complete Owner Profile (optional org + demo ID) & Admin Owner KYC approval before adding outlets", async ({
    page,
  }) => {
    // 1. Register a brand-new OUTLET_OWNER with OTP verification
    await page.goto("/restaurant/register");
    await page.getByPlaceholder("Your full name").fill("Asha Verma");
    await page.locator("form input").nth(1).fill("+91-98111-22334");
    await page.getByPlaceholder("you@domain.in").fill("asha.owner@goodly.in");
    await page.locator('input[type="password"]').fill("password123");
    await page.getByRole("button", { name: /Create Account & Continue/i }).click();
    await page.getByTestId("otp-code-input").fill("123456");
    await page.getByRole("button", { name: /Verify & Start Onboarding/i }).click();

    await expect(page).toHaveURL(/\/restaurant\/onboarding/);
    await expect(page.getByTestId("owner-kyc-card")).toBeVisible();
    // Outlet creation is LOCKED until owner KYC is approved
    await expect(page.getByTestId("outlet-setup-locked-banner")).toBeVisible();

    // Submit Owner Profile (leaving optional Organization Name blank as independent owner + Demo ID upload)
    await page.getByTestId("owner-id-number-input").fill("INDPAN8899K");
    await page.getByTestId("attach-demo-id-btn").click();
    await page.getByTestId("submit-owner-kyc-btn").click();
    await expect(page.getByTestId("owner-kyc-pending-banner")).toBeVisible();
    await expect(page.getByTestId("outlet-setup-locked-banner")).toBeVisible();

    // 2. Super Admin reviews & approves Owner under Restaurant KYC -> Owner KYC tab
    await page.goto("/admin/login");
    await page.getByRole("button", { name: /Super Admin \(Elena\)/i }).click();
    await page.goto("/admin/restaurants");
    await page.getByTestId("tab-owner-kyc").click();
    await expect(page.getByText("Asha Verma")).toBeVisible();
    await expect(page.getByText("Independent Owner")).toBeVisible();
    await page
      .locator('[data-testid^="admin-owner-"]')
      .filter({ hasText: "Asha Verma" })
      .getByRole("button", { name: /Approve Owner KYC/i })
      .click();

    // 3. Owner signs back in & can now add outlets!
    await page.goto("/restaurant/login");
    const inputs = page.locator("form input");
    await inputs.nth(0).fill("asha.owner@goodly.in");
    await inputs.nth(1).fill("password123");
    await page.getByRole("button", { name: /Sign in to restaurant portal/i }).click();
    await page.goto("/restaurant/onboarding?mode=create");
    await expect(page.getByTestId("owner-kyc-approved-badge")).toBeVisible();
    await expect(page.getByTestId("new-outlet-name-input")).toBeVisible();
  });

  test("Admin Users & Accounts category sub-menus, detail inspector, Super Admin role deletion, and management role editing", async ({
    page,
  }) => {
    await page.goto("/admin/login");
    await page.getByRole("button", { name: /Super Admin \(Elena\)/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    // 1. Expandable Restaurant KYC & Users & Accounts sub-menus in sidebar
    await expect(page.getByTestId("admin-subnav-owner-kyc")).toBeHidden();
    await page.getByTestId("toggle-subnav-restaurants").click();
    await expect(page.getByTestId("admin-subnav-owner-kyc")).toBeVisible();
    await expect(page.getByTestId("admin-subnav-outlet-kyc")).toBeVisible();
    await page.getByTestId("admin-subnav-outlet-kyc").click();
    await expect(page).toHaveURL(/\/admin\/restaurants\?tab=outlets/);
    await page.getByTestId("toggle-subnav-restaurants").click();
    await expect(page.getByTestId("admin-subnav-owner-kyc")).toBeHidden();

    await expect(page.getByTestId("admin-subnav-customers")).toBeHidden();
    await page.getByTestId("toggle-subnav-users").click();
    await expect(page.getByTestId("admin-subnav-customers")).toBeVisible();
    await expect(page.getByTestId("admin-subnav-owners")).toBeVisible();
    await expect(page.getByTestId("admin-subnav-outlets")).toBeVisible();
    await expect(page.getByTestId("admin-subnav-management")).toBeVisible();
    await expect(page.getByTestId("admin-subnav-delivery")).toBeVisible();

    // 2. Navigate Customers -> Owners -> Outlets -> Delivery and inspect section-relevant drawers
    await page.getByTestId("admin-subnav-customers").click();
    await expect(page).toHaveURL(/category=customers/);
    await page.getByTestId("dir-row-user-cust-1").click();
    await expect(page.getByTestId("directory-detail-drawer")).toContainText("Customer Activity");

    await page.getByTestId("admin-subnav-owners").click();
    await expect(page).toHaveURL(/category=owners/);
    await expect(page.getByText("Sunday Table").first()).toBeVisible();

    await page.getByTestId("admin-subnav-outlets").click();
    await expect(page).toHaveURL(/category=outlets/);
    await page.locator('[data-testid^="dir-outlet-row-"]').first().click();
    await expect(page.getByTestId("directory-detail-drawer")).toContainText("OUTLET INSPECTOR");

    await page.getByTestId("admin-subnav-delivery").click();
    await expect(page).toHaveURL(/category=delivery/);
    await page.getByTestId("dir-row-user-deliv-1").click();
    await expect(page.getByTestId("directory-detail-drawer")).toContainText("Courier Profile");

    // 3. Roles & Invitations: grouped granular permissions + Super Admin Role Deletion
    await page.goto("/admin/roles");
    await expect(page.getByTestId("create-role-perm-groups")).toContainText(
      "Users & Accounts · Customers"
    );
    await expect(page.getByTestId("create-role-perm-users:customers:view")).toBeVisible();
    await expect(page.getByTestId("create-role-perm-users:delivery:manage")).toBeVisible();

    await page.getByPlaceholder("e.g. Bengaluru Ops Lead").fill("Temp Regional Lead");
    await page.getByTestId("create-role-perm-users:customers:view").click();
    await page.getByRole("button", { name: /Create Custom Role/i }).click();

    // Delete the newly created custom role (non-core)
    const tempRoleCard = page
      .locator('[data-testid^="role-card-"]')
      .filter({ hasText: "Temp Regional Lead" });
    await expect(tempRoleCard).toBeVisible();
    await tempRoleCard.getByRole("button", { name: /Delete Role/i }).click();
    await tempRoleCard.getByRole("button", { name: /Confirm Delete/i }).click();
    await expect(
      page.locator('[data-testid^="role-card-"]').filter({ hasText: "Temp Regional Lead" })
    ).toHaveCount(0);

    // 4. Management sub-menu: authorized admin can change an existing management user's role & granular permissions
    await page.goto("/admin/users?category=management");
    await page.getByTestId("edit-mgmt-role-user-admin-support").click();
    await expect(page.getByTestId("mgmt-role-editor")).toBeVisible();
    await page.getByTestId("mgmt-perm-users:owners:view").check();
    await page.getByTestId("save-mgmt-role-btn").click();
    await expect(page.getByTestId("mgmt-role-editor")).toContainText("users:owners:view");
  });

  test("Outlet rep can add rich dish metadata & customizations and customer 'pasta' search locates penne, spaghetti, fettuccine, and rigatoni", async ({
    page,
  }) => {
    await page.goto("/restaurant/login");
    await page.getByRole("button", { name: /Restaurant \(Sunday Table\)/i }).click();
    await page.goto("/restaurant/menu");

    for (const dish of [
      {
        name: "Penne Arrabbiata",
        desc: "Spicy crushed San Marzano tomato with basil",
        vegClass: "VEG",
        cuisine: "Italian",
        ingredients: "Durum wheat, Tomato, Garlic",
        keywords: "spicy italian bowl",
      },
      {
        name: "Fettuccine Alfredo",
        desc: "Wide egg ribbons tossed in aged parmesan cream",
        vegClass: "EGG_ONLY",
        cuisine: "Italian",
        ingredients: "Parmesan, Cream, Egg, Butter",
        keywords: "creamy comfort dish",
      },
    ]) {
      await page.getByRole("button", { name: /Add new dish/i }).click();
      await page.getByTestId(`veg-class-${dish.vegClass}`).click();
      await page.getByTestId("dish-name-input").fill(dish.name);
      await page.getByTestId("dish-desc-input").fill(dish.desc);
      await page.getByTestId("dish-cuisine-input").fill(dish.cuisine);
      await page.getByTestId("dietary-tag-Vegetarian").click();
      await page.getByTestId("dish-ingredients-input").fill(dish.ingredients);
      await page.getByTestId("dish-keywords-input").fill(dish.keywords);
      await page.getByRole("button", { name: /Save dish/i }).click();
      await expect(page.getByText(dish.name).first()).toBeVisible();
    }
    await expect(page.getByTestId("veg-badge-EGG_ONLY").first()).toBeVisible();

    await page.goto("/");
    const headerSearch = page.getByTestId("header-search-input");
    await headerSearch.fill("pasta");
    await headerSearch.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=pasta/);

    // No duplicate search box inside main content, and top filters appear right below header
    await expect(page.getByTestId("search-top-filters")).toBeVisible();
    await expect(page.locator("main input[type='search']")).toHaveCount(0);

    await expect(page.getByText("Sunday rigatoni").first()).toBeVisible();
    await expect(page.getByText("Penne Arrabbiata").first()).toBeVisible();
    await expect(page.getByText("Fettuccine Alfredo").first()).toBeVisible();
    await expect(page.getByTestId("veg-badge-EGG_ONLY").first()).toBeVisible();

    // Verify connected filter logic: Vegan auto-selects Veg, Non-Veg disables Vegan
    await page.getByTestId("filter-diet-vegan").click();
    await page.getByTestId("filter-veg-NON_VEG").click();
    await expect(page.getByTestId("filter-diet-vegan")).toBeDisabled();
    await page.getByTestId("filter-veg-EGG_ONLY").click();
    await expect(page.getByTestId("filter-diet-vegan")).toBeDisabled();
    await expect(page.getByText("Fettuccine Alfredo").first()).toBeVisible();
  });
});
