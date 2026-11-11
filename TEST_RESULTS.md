# Test Execution Results Ledger — Goodly Platform (`TEST_RESULTS.md`)

**Repository**: `https://github.com/MridulS11/MyFoodAntigravity.git`  
**Current Project Stage**: **Phase 4 Complete — Ready for Phase Gate 4 & Google Maps Keys for Phase 5**  
**Last Executed**: 2026-11-11T23:23:32+05:30

> [!IMPORTANT]
> **Integrity Policy**: Only tests empirically executed after our final edit are marked `PASSED`. Phase 5–7 flows (Live Delivery Broadcast Dispatch/WebSockets, Admin Operations Consoles, `k6` load benchmarks, and `OWASP ZAP` scans) remain `NOT_YET_IMPLEMENTED` until Phases 5–7.

---

## 1. Summary Status by Test Suite (Phase 4 Completion)

| Suite Category | Total Defined Cases | Passed | Failed | Skipped | Not Yet Implemented |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Frontend Portal Tests (`TC-FE-*`)** | 20 | 14 | 0 | 0 | 6 *(pending Phase 5–6 backend routes)* |
| **Phase 2 Go Tests (`auth`, `database`, `middleware`, `redis`)** | 6 | 6 | 0 | 0 | 0 |
| **Phase 3 Go Pricing, State Machine & Concurrency Tests (`cart`, `orders`)** | 3 | 3 | 0 | 0 | 0 |
| **Phase 4 Go Payments, Webhooks, Reconciler & Ledger Tests (`payments`)** | 2 | 2 | 0 | 0 | 0 |
| **Remaining Backend & Concurrency Tests (`TC-BE-*`)** | 2 | 0 | 0 | 0 | 2 |
| **Mandatory Business Workflows (`TC-WF-*`)** | 10 | 0 | 0 | 0 | 10 |
| **Performance & Load Tests (`TC-PERF-*`)** | 3 | 0 | 0 | 0 | 3 |
| **Security & OWASP ZAP Tests (`TC-SEC-*`)** | 6 | 0 | 0 | 0 | 6 |
| **Total** | **52** | **25** | **0** | **0** | **27** |

### Arrival-Triggered Delivery OTP, Live KDS/Delivery Wiring & JSON Error Handling (2026-11-11)
- **Arrival-Triggered OTP Rule ([delivery/orders.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/modules/delivery/orders.go), [orders_test.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/modules/delivery/orders_test.go))**:
  - Updated OTP lifecycle so `delivery_otp_hint` & `delivery_otps` are generated **strictly when the Delivery Partner marks `ARRIVED_AT_CUSTOMER`** for paid `ONLINE` orders (never at payment capture, never at restaurant accept, never for `COD`, never `"0000"`).
  - Implemented live `/delivery/{offers,offers/:id/accept,offers/:id/reject,active,orders/:orderId,orders/:orderId/stage,orders/:orderId/location,earnings}` endpoints and wired them into `httpDeliveryPortalService` in [httpServices.ts](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/services/api/httpServices.ts) and [delivery/active/[id]/page.tsx](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/app/(delivery)/delivery/active/%5Bid%5D/page.tsx).
- **Interactive Online Payment Simulator & KDS `PATCH` / JSON Safety Fix ([checkout/page.tsx](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/app/(customer)/checkout/page.tsx), [orders/handler.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/modules/orders/handler.go), [httpServices.ts](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/services/api/httpServices.ts))**:
  - Fixed `httpRestaurantPortalService.advanceOrderStatus` (`POST` -> `PATCH` + backend alias for both `PATCH` and `POST`) eliminating `"Unexpected non-whitespace character after JSON at position 4"` caused by `"404 page not found"`, and hardened `apiRequest` to safely read text before JSON parsing.
  - Added `payment-simulator-modal` on `/checkout` (`UPI / Card / Netbanking`, simulate success vs decline -> retry flow) prior to navigating to `/orders/:id/track`.
- **Verified After Final Edits**:
  - Backend: `go vet ./...`, `go test -p 1 -count=1 -race ./...` (including `delivery`, `payments`, `orders`, `admin`, `auth`, `cart`, `database` `20/20` migrations), `go build ./...`, and `go run ./cmd/seed --action=reset` **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`15/15` Playwright E2E) **PASSED**.
  - Live HTTP (`:8080` + `:3000` + worker): Verified full live `ONLINE` order (`NO OTP` after pay capture & KDS accept) -> KDS `PATCH /restaurant/orders/:id/status` (`PREPARING` -> `READY_FOR_PICKUP`) -> Delivery partner accept -> `ARRIVED_AT_CUSTOMER` (`6532`) -> Customer tracking sees `6532` -> `DELIVERED` consumes OTP; verified all 5 UI routes (`/`, `/checkout`, `/restaurant/orders`, `/delivery/dashboard`, `/admin/payments`) return HTTP `200`.

### Phase 4 Completion Pass: Automated Refund Settlement, Admin Payments Console, Live Checkout Payment & Retry Flow (2026-11-11)
- **Automated `PENDING` Refund Reconciliation ([reconciler.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/modules/payments/reconciler.go))**:
  - Added `ProcessPendingRefunds` + `RunOnce` (`ReconcileOnce` + `ProcessPendingRefunds`) and wired `Reconciler.Run` in `cmd/worker` so `PENDING` refunds created by order cancellations, restaurant rejections, or late webhook captures are settled via `provider.IssueRefund`, transitioned to `PROCESSED`, update `payments` & `orders` to `REFUNDED`/`PARTIALLY_REFUNDED`, write `REFUND` ledger entries, and emit `refund.processed` outbox events.
- **Payment Gateway & Live Sandbox/Admin APIs ([provider.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/platform/providers/paymentgw/provider.go), [razorpay.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/platform/providers/paymentgw/razorpay.go), [repository.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/modules/payments/repository.go), [handler.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/modules/payments/handler.go))**:
  - Fixed `InitiatePaymentSession` retry response to return `r.provider.PublicKey()`; added `SignCallback` and sandbox `pay_sandbox_*`/`pay_mock_*` refund handling on `RazorpayProvider`.
  - Added non-production `POST /api/v1/customer/payments/sandbox-capture` and `POST /api/v1/customer/payments/sandbox-fail`, plus RBAC-gated (`RequireLivePermission("refunds:approve")`) `GET /api/v1/admin/payments` and `POST /api/v1/admin/payments/reconcile`.
- **Frontend Live Payment & Admin Ledger Wiring ([httpServices.ts](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/services/api/httpServices.ts), [page.tsx](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/app/(admin)/admin/payments/page.tsx))**:
  - Wired `httpOrderService.createOrder` and `httpOrderService.retryPayment` to execute `/customer/payments/initiate`, `/sandbox-fail`, and `/sandbox-capture` in live mode.
  - Wired `httpAdminPortalService.{listPaymentsAndRefunds,issueRefund,reconcilePayments}` (`Idempotency-Key` header on refunds), added `"Run Reconciliation & Pending Refunds"` trigger, and fixed refund modal currency label from `USD` to `INR ₹`.
- **Verified After Final Edits**:
  - Backend: `go vet ./...`, `go test -p 1 -count=1 -race ./...` (all packages passing including extended `payments_test.go` steps 7–9), `go build ./...`, and `go run ./cmd/seed --action=reset` **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`15/15` Playwright E2E) **PASSED**.
  - Live HTTP (`:8080` + `:3000`): Verified `alice@goodly.local` ONLINE order (`GD-20261111-6289`) -> `/customer/payments/initiate` (`200`) -> `/customer/payments/sandbox-fail` (`FAILED`) -> `/customer/payments/sandbox-capture` (`pay_sandbox_3e30838c4468`, `CAPTURED`) -> `/customer/orders/:id/cancel` (`REFUND_PENDING`) -> Admin `GET /api/v1/admin/payments` -> `POST /api/v1/admin/payments/reconcile` (`processed_refunds_count: 1`) -> `REFUNDED` + `PROCESSED` (`rfnd_sandbox_3e30838c4468`), and `http://127.0.0.1:3000/admin/payments` returned `200`.

### OpenSearch / Elasticsearch Search Engine, Food Taxonomy Synonyms & Rich Outlet Dish Metadata (2026-11-11)
- **OpenSearch Container & Client ([opensearch.go](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/backend/internal/platform/search/opensearch.go))**:
  - Added `opensearch` (`opensearchproject/opensearch:2.18.0`, `:9200`) to `backend/docker-compose.yml` (`goodly-opensearch`) and `OPENSEARCH_URL` to `config.Load()`.
  - Built `goodly_restaurants_v1` & `goodly_menu_items_v1` indices with `goodly_food_synonym_graph` (`synonym_graph`) + English stemming + `fuzziness: "AUTO"` across dish names, cuisines, categories, ingredients, dietary tags, allergens, custom keywords, and customization options — so querying broad families like `pasta` locates `penne`, `spaghetti`, `fettuccine`, `rigatoni`, `fusilli`, `lasagna`, etc.
  - Added `ReindexAll` on `cmd/api` startup and automatic `SyncOutlet` hooks on menu/category writes in `menu.Repository`, plus PostgreSQL advisory lock (`pg_advisory_lock`) in `database.RunMigrations`.
- **Rich Outlet Dish Authoring (`000018_rich_menu_item_metadata`, [menu/page.tsx](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/app/(restaurant)/restaurant/menu/page.tsx))**:
  - Extended `menu_items` with `cuisine_type`, `spice_level`, `calories_kcal`, `serving_size`, `ingredients`, `allergens`, `search_keywords`, and `is_recommended`, plus dynamic `customization_groups` & options persistence on `POST`/`PUT /api/v1/restaurant/menu/items`.
- **Verified After Final Edits**:
  - Backend: `go vet ./...`, `go build ./...`, `go test -count=1 -race ./...` (including `18/18` idempotent migrations, `TestOpenSearchFoodSynonymsAndClusterIntegration`, and `TestOpenSearchSynonymSearchAndRichMenuItemIntegration`), and `go run ./cmd/seed --action=reset` **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`15/15` Playwright E2E) **PASSED**.
  - Live HTTP (`:8080` + `:9200` + `:3000`): `/health/ready` returned `{"opensearch":"up","postgres":"up","redis":"up","status":"ready"}`; `GET /api/v1/customer/discovery/search?q=pasta&lat=12.9784&lng=77.6408` returned `Sunday Table` + `['Crispy cacio e pepe arancini', 'Sunday rigatoni']`; `/search?q=pasta` and `/restaurant/menu` returned `200`.

### Admin Users & Accounts Sub-Menus, Detail Inspector, Granular Category RBAC, Super Admin Role Deletion & Management Role Editing (2026-11-11)
- **Migration `000017_granular_admin_directory_permissions`**: Added 11 granular permissions (`users:customers:view`, `users:customers:manage`, `users:owners:view`, `users:owners:manage`, `users:outlets:view`, `users:outlets:manage`, `users:management:view`, `users:management:manage`, `users:delivery:view`, `users:delivery:manage`, `roles:manage`) plus `user_admin_permissions` table (`updated_by`, `updated_at`), unioned cleanly into `GetUserByID` in `auth/repository.go`.
- **Backend RBAC, Role Deletion, Management Role Editor & Category Directory (`backend/internal/modules/admin/directory.go`, `handler.go`)**:
  - Added `RequireLiveAnyPermission` (`auth/middleware.go`) and `authorizeTargetUserManage` so category-scoped admins (`users:<category>:view/manage`) can access only their granted directory endpoints and actions.
  - Added `DELETE /api/v1/admin/roles/:roleId` (`deleteRole`, Super Admin `PLATFORM_ADMIN` only, guarding core roles with `400 PROTECTED_ROLE`), `PATCH /api/v1/admin/users/:userId/roles` (`updateManagementUserRoles`, blocking self-modification `400 CANNOT_MODIFY_SELF_ROLE`), `GET /api/v1/admin/directory/{customers,owners,outlets,management,delivery}`, `GET /api/v1/admin/users/:userId/detail`, and `GET /api/v1/admin/outlets/:outletId/detail`.
- **Admin UI (`web/src/app/(admin)/layout.tsx`, `admin/users/page.tsx`, `admin/roles/page.tsx`)**:
  - Added **Customer**, **Owners**, **Outlets**, **Management**, and **Delivery** sub-menus in the Admin sidebar and `/admin/users` sub-tab bar with granular RBAC gating, section-specific row detail drawer (`directory-detail-drawer`), and inline Management Role & Granular Permissions editor (`mgmt-role-editor`).
  - Grouped all permissions by category in `/admin/roles` and added Super Admin **Delete Role** controls (`delete-role-*`).
- **Verified After Final Edits**:
  - Backend: `go vet ./...`, `go build ./...`, `go test -count=1 -race ./...` (all packages including `TestMigrationsIdempotentUpAndDown` `17/17` migrations and `TestAdminDirectorySubmenusRoleChangeAndRoleDeletionIntegration`), and `go run ./cmd/seed --action=reset` **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`14/14` Playwright E2E) **PASSED**.
  - Live HTTP (`:8080` + `:3000`): Verified `elena@goodly.local` login, `GET /api/v1/admin/directory/{customers,owners,outlets,management,delivery}` (`200`), `GET /api/v1/admin/users/:id/detail` (`200`), `POST` + `DELETE /api/v1/admin/roles` (`200`), and `http://localhost:3000/` & `/admin/users` (`200`).

### Admin Portal User Account Deletion Fix (`HARD_DELETE` + `SOFT_DELETE`) (2026-11-11)
- **Root Cause & Fix**:
  - In `backend/internal/modules/admin/handler.go` (`deleteUser`), soft-deleting users with foreign-key references (`restaurants.owner_user_id`, `orders.customer_id`, etc.) failed with `SQLSTATE 22001` (`value too long for type character varying(20)`) because `scrubPhone` was sliced to 22 characters while `users.phone` is `VARCHAR(20)`. Additionally, `DELETE FROM delivery_partners` ran without a `SAVEPOINT`, risking a `25P02` aborted transaction before the `23503` handler.
  - Updated `deleteUser` to use a 20-char scrubbed phone (`"del-" + cleanID[:16]`), wrap `DELETE FROM delivery_partners` in `SAVEPOINT try_del_dp`, clean `restaurant_owner_profiles`, deactivate owned outlets & set rider profiles offline on soft-delete, and filter deleted owners' outlets out of `listOutlets`.
  - Updated `web/src/app/(admin)/admin/users/page.tsx` with loading state (`deletingId`) and an inline error alert banner.
- **Verified After Final Edits**:
  - Backend: `go vet ./...`, `go build ./...`, and `go test -count=1 -race ./...` (including soft-delete of an outlet owner in `TestBrevoMailerAndOpenAdminRegistrationIntegration`) **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`13/13` Playwright) **PASSED**.
  - Live HTTP (`:8080` + `:3000`): Verified `DELETE /api/v1/admin/users/01900001-0000-7000-8000-000000000002` (`SOFT_DELETE` -> `200 OK`) and `DELETE /api/v1/admin/users/01900001-0000-7000-8000-000000000001` (`HARD_DELETE` -> `200 OK`), followed by `cmd/seed --action=reset` and `http://localhost:3000` (`200`).

### Restaurant Owner Profile & KYC Gate, Duplicate Outlet Name -> Branch Prompt, Two-Level Dropdowns & Admin Owner/Outlet KYC Sub-Tabs (2026-11-11)
- **Migration `000016_restaurant_owner_profiles`**: Added `restaurant_owner_profiles` table (`organization_name` optional, `id_document_type`, `id_document_number`, `id_document_filename`, `verification_status` `PENDING_REVIEW | APPROVED | REJECTED | SUSPENDED`) and seeded `APPROVED` profile for pre-existing demo owners (`marco@sundaytable.local`).
- **Owner KYC Gate & Duplicate Outlet Name Enforcement**:
  - Added `GET /api/v1/restaurant/owner-profile` & `POST /api/v1/restaurant/owner-profile` (`restaurants/handler.go`), plus `403 OWNER_KYC_REQUIRED` gate on `POST /api/v1/restaurant/onboarding` until Admin approves Owner KYC.
  - Added `409 DUPLICATE_OUTLET_NAME` check (`HasDuplicateOutletName`) when creating a `NEW_OUTLET` matching an existing outlet name; frontend [onboarding/page.tsx](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/app/(restaurant)/restaurant/onboarding/page.tsx) shows Owner Profile + Demo ID upload first, simplifies Outlet creation to Outlet Name + Branch Name, and prompts `"Add Branch under '<Name>'"` (`duplicate-outlet-prompt`) on matching outlet names.
- **Two-Level Left Sidebar Dropdown & Admin Sub-Options**:
  - Updated [layout.tsx](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/app/(restaurant)/layout.tsx) sidebar with Outlet selector (`outlet-group-select`) + conditional Location/Branch selector (`outlet-branch-select` when multiple branches exist).
  - Updated `/admin/restaurants` ([restaurants/page.tsx](file:///Users/m/.gemini/antigravity/scratch/goodly-food-delivery/web/src/app/(admin)/admin/restaurants/page.tsx)) and Admin API (`GET /admin/restaurant-owners`, `POST /admin/restaurant-owners/:ownerId/verify`) with **`Owner KYC`** (`tab-owner-kyc`) and **`Outlet KYC`** (`tab-outlet-kyc`) sub-tabs.
- **Automated & Live Verification After Final Edits**:
  - Backend: `go vet ./...`, `go build ./...`, and `go test -count=1 -race ./...` (including `16/16` idempotent migrations and 3 integration suites in `admin`) **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`13/13` Playwright on `:3001` mock mode) **PASSED**.
  - Live HTTP (`:8080` + `:3000`): Verified `GET /api/v1/restaurant/owner-profile` (`APPROVED`), `POST /api/v1/restaurant/onboarding` with duplicate outlet name returning `409 DUPLICATE_OUTLET_NAME`, `GET /api/v1/admin/restaurant-owners`, and `http://localhost:3000` (`200`).

### Kitchen Live Wiring, Multi-Outlet & Branch Scoping, and Menu Visibility Gate (2026-11-11)
- **Live Portal Wiring (`Kitchen Paused` -> `Session expired` fix & Discovery/Menu wiring)**:
  - Completed `httpRestaurantPortalService` (active outlet selector persistence via `goodly_active_outlet_id`, `getMyRestaurant` loading menu categories, `toggleAcceptingOrders`, `updateOperatingHours`, `updateOutletCapacity`, `createCategory`, `upsertMenuItem` + `PUT /restaurant/menu/items/:id`, `toggleMenuItemAvailability`, `listRestaurantOrders`, `acceptOrder`, `rejectOrder`, `advanceOrderStatus`, `getSettlementsAndReviews`, `updateOutletRole`, multi-outlet `inviteBranchStaff`, `listBranchStaff("all")`) and `httpDiscoveryService` (`checkServiceability`, `getFeed`, `search`, `getRestaurantMenu`) in `web/src/services/api/httpServices.ts`, eliminating silent mock `localStorage` fallbacks in `NEXT_PUBLIC_API_MODE=live`.
- **Multi-Outlet vs. Existing-Branch Onboarding + Outlet/Branch User & Role Scoping**:
  - Updated `web/src/app/(restaurant)/restaurant/onboarding/page.tsx` so Outlet Setup branches cleanly into **"Add New Outlet"** (`subchoice-new-outlet`) vs. **"Add Branch to Existing Outlet"** (`subchoice-existing-branch`).
  - Added backend `POST /api/v1/restaurant/staff/invite` (`assignStaffMulti`), `GET /api/v1/restaurant/staff` (`listAllStaff`), and `outlet_name`/`brand_name`/`branch_name` on `StaffAssignment` (`restaurants/repository.go`, `restaurants/handler.go`) plus multi-branch Outlet $\rightarrow$ Branch access matrix on `/restaurant/team`.
- **Customer Menu Visibility Gate**:
  - Updated `discovery/repository.go` (`GetFeed` and `Search`) and `mockServices.ts` (`hasActiveMenuItem`) so approved outlets remain hidden from customer discovery/search until at least one active menu item is added.
- **Automated & Live Verification After Final Edits**:
  - Backend: `go vet ./...`, `go build ./...`, and `go test -count=1 -race ./...` (including `TestMenuVisibilityAndMultiOutletStaffScopingIntegration`) **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`12/12` Playwright on `:3001` mock mode) **PASSED**.
  - Live HTTP (`:8080` + `:3000`): Verified HttpOnly cookie login on `/api/v1/restaurant/auth/login` -> `PATCH /api/v1/restaurant/me/availability` (`is_accepting_orders: true`), `GET /api/v1/restaurant/menu`, `GET /api/v1/restaurant/staff`, `GET /api/v1/customer/discovery/feed`, and `http://localhost:3000` (`200`).

### Brevo Verified Sender, Non-Blocking Async HTTP/2 Mailer & Live Mode Wiring (2026-11-11)
- **Brevo Root Cause Diagnostics & Live Delivery Check**:
  - Updated `BREVO_SENDER_EMAIL` in `backend/.env` to the account's active verified Brevo sender (`mridulsharma118@gmail.com`) after verifying prior `noreply@goodly.in` requests were rejected by Brevo (`/v3/smtp/statistics/events`). Verified Brevo delivery (`201` -> `delivered` in ~0.33s, subsequently `opened`).
  - Added HTTP/2 connection pooling (`MaxIdleConnsPerHost: 10`, `ForceAttemptHTTP2: true`) in `mailer.NewBrevoMailer` plus non-blocking `DispatchAsyncOrSync` for live sends; verified `POST /api/v1/customer/auth/register` completes in `223.5ms` while Brevo dispatches asynchronously in ~0.7s.
  - Enabled `NEXT_PUBLIC_API_MODE=live` in `web/.env.local` and wired live HTTP portal clients (`httpAuthService`, `httpRestaurantPortalService`, `httpDeliveryPortalService`, `httpAdminPortalService`) cleanly so the UI on `:3000` calls `:8080` directly.
- **Automated Verification After Final Edits**:
  - Backend: `go vet ./...`, `go build ./...`, and `go test -count=1 -race -v ./...` **PASSED**.
  - Frontend: `npx tsc --noEmit`, `npm run lint` (`0` errors, `8` warnings), `npm run test:unit` (`8/8` Vitest), and `npm run test:e2e` (`11/11` Playwright on `:3001` mock mode) **PASSED**.

### OTP-Gated Registration Storage & Admin User Deletion (2026-11-11)
- **Backend (`go vet ./...`, `go test -count=1 -race -v ./...`, `go build ./...`)**: **PASSED** (`0` errors, `15/15` idempotent migrations including `000015_pending_registrations_and_user_delete`):
  - `TestAuthAndPostGISAddressIntegration`, `TestIsolatedPortalAuthenticationCookiesAndOnboardingFlags`, and `TestBrevoMailerAndOpenAdminRegistrationIntegration`: Verified that `/auth/register` stages unverified signups in `pending_registrations` (without writing `users`), login before OTP returns `401`, `/otp/verify` persists the user account and grants login, and `DELETE /api/v1/admin/users/:userId` removes user accounts cleanly while blocking self-deletion (`400 CANNOT_DELETE_SELF`).
  - **Live `:8080` API Check**: Verified abandoning OTP on `POST /api/v1/customer/auth/register` leaves `check-email` returning `exists: false` and `POST /api/v1/customer/auth/login` returning `401`, and `DELETE /api/v1/admin/users/{self}` returns `400 CANNOT_DELETE_SELF`.
- **Frontend (`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`)**: **PASSED** (`0` TS errors, `0` ESLint errors, `8/8` Vitest unit tests, `11/11` Playwright E2E):
  - Verified registering without submitting OTP (`cancel-otp-to-login-btn`) stores no credentials and rejects login (`unique-email-onboarding-banner`), whereas completing OTP `123456` persists the account.
  - Verified Admin can delete user accounts from `/admin/users` (`delete-user-user-admin-invited` $\rightarrow$ `confirm-delete-user-user-admin-invited`).

### Restaurant Portal Pre-Invite Lockout & Brevo Transactional Mailer / Open Admin Registration (2026-11-11)
- **Backend (`go vet ./...`, `go test -count=1 -race -v ./...`, `go build ./...`)**: **PASSED** (0 errors):
  - `TestOnboardingInvitationsCustomRolesAndApprovalGatesIntegration` (`internal/modules/admin`): Verified unaccepted or unapproved invited restaurant staff receive `403` across `/api/v1/restaurants/me`, `/api/v1/restaurants/me?outlet_id=...`, `/api/v1/outlets/roles` (`GET`/`POST`), and `/api/v1/restaurants/me/settlements` until invitation acceptance + owner approval.
  - **Live `:8080` Restaurant Lockout Check**: Signed in as `staff.invited@goodly.local` -> `GET /api/v1/restaurant/outlets` returned `[]`, and `/api/v1/restaurants/me`, `/api/v1/outlets/roles`, `/api/v1/restaurant/menu`, `/api/v1/restaurant/orders`, `/api/v1/restaurants/me/settlements` all returned `403 REST_ACCESS_LOCKED` / `RESTAURANT_ACCESS_LOCKED`.
- **Frontend (`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`)**: **PASSED** (`10/10` Playwright E2E, `8/8` Vitest, `0` ESLint errors):
  - Playwright E2E test `"Invited outlet staff must accept invitation, then await owner/admin approval"` verified that before accepting her invite (and after accepting while `PENDING_APPROVAL`), `/restaurant/orders` locks out KDS (`restaurant-no-access-panel` visible, `LIVE KITCHEN DISPLAY SYSTEM` hidden), and unlocks `/restaurant/orders` once Owner approves.
- **Backend (`go vet ./...`, `go test -count=1 -race -v ./...`, `go build ./...`)**: **PASSED** (0 errors):
  - `TestBrevoMailerSendsAPIKeyAndJSONPayload` (`internal/platform/providers/mailer`): **PASS** (Verifies Brevo v3 HTTP JSON payload, `api-key` header, OTP verification email, and Onboarding/KYC status email).
  - `TestIsolatedPortalAuthenticationCookiesAndOnboardingFlags` (`internal/modules/auth`): **PASS** (Open `/admin/auth/register` & `/admin/auth/login` issue `goodly_admin_*` cookie with `onboarding_required: true` and 0 admin permissions (`403` on protected ops), while cross-portal isolation holds).
  - `TestBrevoMailerAndOpenAdminRegistrationIntegration` (`internal/modules/admin`): **PASS** (OTP emails captured on open admin registration + restaurant/rider registration, email-target OTP verification, outlet & rider `PENDING_REVIEW` onboarding emails + `APPROVED` KYC emails, open admin pre-invite zero-access `403`, and `pre_approved: true` auto-activation upon invitation accept).
  - `TestMigrationsIdempotentUpAndDown` (`internal/platform/database`): **PASS** (`14/14` up/down/up migrations including `000014_admin_invite_preapproved`).
  - **Live `:8080` HTTP + Brevo verification**: `cmd/api` initialized `BrevoMailer` with `BREVO_KEY` (`sender_email: noreply@goodly.in`), dispatched live OTP email on `POST /api/v1/admin/auth/register` (`brevo email dispatched`), enforced `403` on `GET /api/v1/admin/orders/monitor` before invite, and granted `200` access immediately after accepting a `pre_approved: true` Admin invitation.
- **Frontend (`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`)**: **PASSED**:
  - ESLint: `0` errors (`8` pre-existing `@next/next/no-img-element` warnings).
  - Vitest: `8/8` unit tests passed across `2` files.
  - Playwright E2E (`10/10` passed): Includes `/admin/register` open signup -> OTP verification -> `admin-no-access-panel` (0 admin permissions, showing registered email) -> Admin sends pre-approved invitation -> candidate logs into `/admin/login`, accepts in `pending-invitations-banner`, and unlocks `/admin/dashboard`.

### Authentication, Isolated Portal Sessions, Custom Roles, Invitations & Onboarding (2026-11-11)
- **Backend (`go vet ./...`, `go test -count=1 -race -v ./...`, `cmd/seed --action=reset`)**: **PASSED**:
  - `TestIsolatedPortalAuthenticationCookiesAndOnboardingFlags` (`internal/modules/auth`): **PASS** (Separate `/api/v1/{customer,restaurant,delivery,admin}/auth/*` cookies & JWT `portal` claims; cross-portal cookies rejected `401 PORTAL_SESSION_MISMATCH`; portal-scoped logout leaves sibling portals logged in; unique unregistered email check flags `onboarding_recommended: true`; `/admin/auth/login` rejects unauthorized customers `403`).
  - `TestOnboardingInvitationsCustomRolesAndApprovalGatesIntegration` (`internal/modules/admin`): **PASS** (Multi-location branch onboarding, custom outlet role creation, phone-mapped outlet staff invitation $\rightarrow$ pre-accept 403 $\rightarrow$ premature owner approval 400 $\rightarrow$ invitee accept $\rightarrow$ still 403 $\rightarrow$ owner approval 200; delivery partner skip onboarding `NOT_SUBMITTED` warning + 403 `ONLINE_AVAILABLE` $\rightarrow$ Admin approval $\rightarrow$ 200 `ONLINE_AVAILABLE`; Super Admin custom role + email invitation $\rightarrow$ invitee accept $\rightarrow$ Admin approval $\rightarrow$ granular permission enforcement).
  - `TestMigrationsIdempotentUpAndDown` (`internal/platform/database`): **PASS** (`13/13` up/down/up migrations).
  - **Live HTTP verification (`cmd/api` on `:8080`)**:
    - Isolated logins on `/customer/auth/login`, `/restaurant/auth/login`, `/delivery/auth/login`, `/admin/auth/login` minted distinct portal cookies (`goodly_customer_*`, `goodly_restaurant_*`, `goodly_delivery_*`, `goodly_admin_*`); cross-portal matrix verified (`200` on matching portal, `401` on foreign portal).
    - `rider.pending@goodly.local` $\rightarrow$ `GET /api/v1/delivery/me` returned `NOT_SUBMITTED`, `can_receive_orders: false`, `"You are not receiving orders due to onboarding verification pending"`.
- **Frontend (`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`)**: **PASSED**:
  - Vitest: `8/8` unit tests passed.
  - Playwright E2E (`9/9` passed across `phase1-portals.spec.ts` + `auth-onboarding-rbac.spec.ts`):
    - Unauthenticated portal routes redirect to `/restaurant/login`, `/delivery/login`, `/admin/login`; checkout asks unauthenticated shoppers to sign in on `/auth/login`.
    - Page reload keeps active cookie sessions logged in; Restaurant and Delivery sessions run concurrently; Restaurant logout revokes ONLY Restaurant without signing out Delivery.
    - Entering a unique unregistered email on login displays `unique-email-onboarding-banner` leading straight into account creation & onboarding.
    - Delivery partner skipping onboarding sees `delivery-pending-warning` in sticky header & disabled online toggle.
    - Invited outlet staff accepts invitation $\rightarrow$ Owner approves on `/restaurant/team` $\rightarrow$ becomes `Active`.
    - Invited ops admin accepts invitation $\rightarrow$ Super Admin creates custom role & approves on `/admin/roles`.

### Phase 4 Automated Command Results (Executed After Final Edit)
- **`go vet ./...`** & **`go build ./cmd/api ./cmd/ws ./cmd/worker ./cmd/seed`**: **PASSED** (0 errors)
- **`go test -count=1 -race -v ./...`**: **ALL PASSED** (uncached):
  - `TestCommissionCalculationBasesAndPartnerEarnings` (`payments`): **PASS** (20% commission calculations across `GROSS_FOOD_SUBTOTAL`, `NET_AFTER_OUTLET_DISCOUNT`, and `FOOD_PLUS_PACKAGING`, plus delivery partner distance earnings & optional `₹20` daily payout fee)
  - `TestPhase4WebhooksReconciliationRefundsAndLedgersIntegration` (`payments` live PostgreSQL/PostGIS/Redis): **PASS**:
    - Tampered `X-Razorpay-Signature` rejection (`401`)
    - 10 concurrent identical `payment.captured` webhooks $\rightarrow$ **strictly 1 `payment_transactions` row, 1 `PAYMENT_CAPTURE` ledger entry, and 1 `order.confirmed` outbox event**; order confirmed & payment `CAPTURED`
    - Refund RBAC (`CUSTOMER_CARE` blocked `403`; `PLATFORM_ADMIN` with `refunds:approve` succeeds `201`) + double-refund over-balance rejection (`400 REFUND_EXCEEDS_BALANCE`)
    - Simulated lost webhook recovered by `Reconciler.ReconcileOnce` background reconciliation worker
    - Late `payment.captured` webhook arriving on an already `CANCELLED` order $\rightarrow$ order stays `CANCELLED` & automatic `LATE_PAYMENT_AFTER_CANCEL` refund queued
    - Settlement accrual (`AccrueDeliveryFinancials`): 20% commission (`2000` bps = `9000` paise on `45000`) & net payout `38000` paise recorded in `restaurant_settlements`
  - All Phase 2 & Phase 3 Go suites (`auth`, `cart`, `orders`, `database`, `middleware`, `redis`): **PASS**
- **Live End-to-End Phase 4 HTTP Flow (`cmd/api` on `:8080` + `cmd/worker` connected to RabbitMQ)**:
  - `GET /health/ready` (`postgres: up`, `redis: up`) $\rightarrow$ Fresh Customer Register/Login $\rightarrow$ Indiranagar Address $\rightarrow$ `POST /api/v1/cart/items` $\rightarrow$ `POST /api/v1/orders` (`PENDING_PAYMENT` / `UNPAID`) $\rightarrow$ `POST /api/v1/payments/initiate` (`order_mock_...` / `rzp_test_local_sandbox`) $\rightarrow$ HMAC-signed `POST /api/v1/payments/webhooks/razorpay` (`acknowledged: true`, `deduplicated: false`) $\rightarrow$ Order transitioned to `CONFIRMED` & Payment `CAPTURED` (**PASSED**).

### Phase 3 Automated Command Results (Verified Still Passing in Full Run Above)
- **`go vet ./...`** & **`go build ./cmd/api ./cmd/ws ./cmd/worker ./cmd/seed`**: **PASSED** (0 errors)
- **`go test -count=1 -race -v ./...`**: **ALL PASSED** (uncached):
  - `TestComputeBreakdownSmallCartFeeAndCoupons` (`cart`): **PASS** (Minor-unit INR totals, `small_cart_fee_minor` applied strictly below `₹299`, capped `%` coupons, `5%` GST)
  - `TestOrderStateMachineMatrix` (`orders`): **PASS** (Valid transitions, invalid transition rejection, pre-prep cancellation policy)
  - `TestPhase3DiscoveryInventoryIdempotencyRacesAndTimeoutIntegration` (`orders` live PostgreSQL/PostGIS/Redis): **PASS**:
    - PostGIS serviceability (`Indiranagar` inside vs. `Mysuru Road` outside)
    - Redis menu cache population + instant invalidation on item availability toggle
    - Concurrent checkout race on `available_quantity = 1` $\rightarrow$ **exact 1 `201` + 1 `409 ITEM_OUT_OF_STOCK`**
    - Duplicate `POST /api/v1/orders` with identical `Idempotency-Key` $\rightarrow$ `idempotent_replay: true`
    - Concurrent Restaurant `Accept` vs. `Reject` race $\rightarrow$ optimistic lock serialization (`200` + `409`)
    - 5-minute acceptance timeout escalation (`CUSTOMER_CARE_ALERTED` + `complaints` escalation ticket) $\rightarrow$ grace expiry $\rightarrow$ `outlet_penalties` row (`APPLIED`) + auto-cancel + stock restore
  - All Phase 2 suites (`auth`, `database`, `middleware`, `redis`): **PASS**
- **Live End-to-End Phase 3 HTTP Flow (`cmd/api` on `:8080` + `cmd/worker` connected to RabbitMQ)**:
  - `GET /api/v1/discovery/feed?lat=12.9784&lng=77.6408` $\rightarrow$ `3` spots, spotlight `Sunday Table`
  - Customer Login $\rightarrow$ `POST /api/v1/cart/items` $\rightarrow$ `POST /api/v1/cart/validate-checkout` (`53050` paise) $\rightarrow$ `POST /api/v1/orders` (`GD-20261110-5369 CONFIRMED`)
  - Outlet Owner Login $\rightarrow$ `GET /api/v1/outlets` (`3` outlets) $\rightarrow$ `accept` $\rightarrow$ `PREPARING` $\rightarrow$ `READY_FOR_PICKUP` (**PASSED**)
- **Frontend (`web/`)**: `npx tsc --noEmit`, `npm run lint` (0 errors), and `npm run test:unit` (8/8 Vitest tests) **PASSED**.

---

## 2. Phase 1 Detailed Test Execution Matrix

| Test Case ID | Feature Tested | Expected Result | Actual Result | Status | Evidence / Screenshot | Bugs Discovered & Fixes Applied |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| `TC-FE-CUST-001` | Customer Discovery Home (`/`) | Renders Goodly hero, promo bar, pills & grid matching `11.13.32 PM` in Bengaluru, KA (`INR ₹`) | Vitest + Playwright verified hero CTA, category filtering, and 3-column nearby grid | `PASSED` | `web/test-results/screenshots/01-customer-home-desktop.png` | **Bug #1**: Initial Playwright run on `127.0.0.1` hit Next.js 16 cross-origin HMR/chunk block. **Fix**: Added `allowedDevOrigins` in `next.config.ts` & switched Playwright `baseURL` to `localhost:3000`. |
| `TC-FE-CUST-002` | Address & Serviceability | Serviceable (`Bengaluru, KA`) vs. out-of-zone (`Mysuru Road`) UI handling | Switching to out-of-zone address displays `out-of-zone-banner` cleanly | `PASSED` | Playwright Test #2 | Verified cleanly |
| `TC-FE-CUST-003` | Restaurant Menu — Empty Bag | Matches `11.13.44 PM` empty order card | Header bag `0` and `"A little room for delicious."` verified | `PASSED` | `web/test-results/screenshots/02-restaurant-menu-empty-bag.png` | **Bug #2**: Footer `PortalSwitcher` initially highlighted both `Customer` and `Restaurant KDS` on `/restaurants/sunday-table` due to `startsWith("/restaurant")`. **Fix**: Scoped prefix matching in `PortalSwitcher.tsx`. |
| `TC-FE-CUST-004` | Restaurant Menu — Active Bag | Matches `11.14.01 PM` stepper & `Your bag 1` (`₹450.00`) | Clicking `+` rendered `[- 1 +]` stepper, `Your bag 1`, and `₹450.00` sticky subtotal | `PASSED` | `web/test-results/screenshots/03-restaurant-menu-active-bag.png` | Verified cleanly |
| `TC-FE-CUST-005` | Dish Customization Validation | Enforces min/max selection rules | `validateCustomizationSelection` unit test verified required & max selection errors | `PASSED` | Vitest `pricing-and-services.test.ts` | Modal UI tested with Vitest schema validator; live API persistence deferred to Phase 3 |
| `TC-FE-CUST-006` | Multi-Restaurant Cart Guard | Prompts before replacing bag items | `Start a new bag?` conflict modal verified in both Vitest and Playwright | `PASSED` | Playwright Test #2 | Verified cleanly |
| `TC-FE-CUST-007` | Browser Refresh Persistence | Cart & session survive page reload | `page.reload()` preserved `Your bag 1` and `₹450.00` subtotal via `localStorage` mock DB (`v2`) | `PASSED` | Playwright Test #1 | Verified cleanly |
| `TC-FE-CUST-008` | Checkout, Small-Cart Fee & Price Breakdown | Minor-unit breakdown (`5% GST`, `smallCartFeeMinor` only below `₹299` threshold) & order creation | Vitest verified minor-unit GST/coupon/small-cart/tip math; Playwright completed checkout to `/orders/.../track` | `PASSED` *(Mock)* | Playwright Test #1 + Vitest | Live Razorpay webhook verification scheduled for Phase 4 |
| `TC-FE-CUST-009` | Live Order Tracking, Map & Single-Use OTP | Tracking map, stepper & 4-digit single-use Delivery OTP | Verified map, lifecycle stepper & 4-digit `deliveryPin` render | `PASSED` *(Mock)* | `web/test-results/screenshots/04-customer-live-tracking.png` | Real-time Go WebSockets + Google Maps integration scheduled for Phase 5 |
| `TC-FE-CUST-010` | Responsive Viewports | Desktop (`1440px`), Tablet (`768px`), Mobile (`390px`) | Zero horizontal overflow (`scrollWidth <= innerWidth`) verified across Desktop, Tablet, and Mobile | `PASSED` | `web/test-results/screenshots/08-customer-home-mobile.png` | Verified cleanly |
| `TC-FE-REST-002` | Restaurant Live KDS Kanban & 5m SLA | Multi-outlet switcher, 5m acceptance SLA badge, Accept/Preparing/Ready transitions | Accepted `ord-seed-active-1` and moved across KDS columns in Playwright | `PASSED` *(Mock)* | `web/test-results/screenshots/05-restaurant-kds.png` | Live backend persistence scheduled for Phase 3 |
| `TC-FE-DELIV-002` | Simultaneous Broadcast Offer | Broadcast offer sent to all eligible nearby partners; first accept claims & supersedes siblings | Accepted broadcast offer in Playwright and navigated to `/delivery/active/ord-seed-active-1` | `PASSED` *(Mock)* | `web/test-results/screenshots/06-delivery-dashboard-offer.png` | Live backend dispatch scheduled for Phase 5 |
| `TC-FE-DELIV-003` | Pickup, Transit & Single-Use OTP Delivery | Step progression & rate-limited single-use 4-digit OTP verify | Progressed all 4 delivery stages, verified wrong OTP rejection & single-use lock in Vitest, and OTP `4821` completion in Playwright | `PASSED` *(Mock)* | Playwright Test #3 + Vitest | Live backend persistence scheduled for Phase 5 |
| `TC-FE-ADMIN-001` | Platform Admin vs. Customer Care RBAC & Economics | `CUSTOMER_CARE` blocked from `/admin/commissions-pricing`; `PLATFORM_ADMIN` configures 20% commission, small-cart fee, penalty rule & daily partner payout fee rule | `CUSTOMER_CARE` (`SUPPORT_ADMIN`) blocked with `403` (`admin-rbac-denied`); `PLATFORM_ADMIN` (`SUPER_ADMIN`) permitted | `PASSED` *(Mock)* | `web/test-results/screenshots/07-admin-dashboard.png` | Live Go RBAC middleware scheduled for Phase 2 & 6 |
| `TC-FE-REST-001`, `003`, `004`, `TC-FE-DELIV-001`, `TC-FE-ADMIN-002`, `003` | Remaining Portal Forms & Backend-Coupled Flows | End-to-end backend validation | UI pages implemented and compiled cleanly (`next build`); full backend-coupled E2E verification pending Phases 3–6 | `NOT_YET_IMPLEMENTED` | — | — |
| `TC-BE-*`, `TC-WF-*`, `TC-PERF-*`, `TC-SEC-*` | Backend, Workflows, k6, OWASP ZAP | Scheduled for Phases 2–7 | Awaiting Go backend & Docker infrastructure phases | `NOT_YET_IMPLEMENTED` | — | — |

---

## 3. Phase 1 Acceptance Criteria Assessment
- [x] All 4 web portals (**Customer**, **Restaurant**, **Delivery Partner**, **Administration**) implemented in Next.js + TypeScript + React.
- [x] Supplied Goodly reference screenshots faithfully reproduced across Home Discovery and Restaurant Menu (empty and active bag states).
- [x] Responsive desktop, tablet, and mobile-browser layouts verified without horizontal overflow.
- [x] Mock data and stateful cross-portal simulation strictly isolated behind `src/services/contracts/` interfaces.
- [x] Zero failing tests and zero unresolved Critical/High defects in `KNOWN_ISSUES.md`.
- **Phase 1 Status**: **SATISFIED — Ready for Project Owner Review & Approval before Phase 2.**
