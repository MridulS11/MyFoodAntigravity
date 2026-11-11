# Master Test Case Catalog — Goodly Platform (`TEST_CASES.md`)

**Repository**: `https://github.com/MridulS11/MyFoodAntigravity.git`

## 1. Frontend Test Cases (`TC-FE-*` — Vitest & Playwright)

### 1.1 Customer Portal (`TC-FE-CUST-*`)
| Test Case ID | Feature / Screen | Test Description | Expected Result | Target Phase |
| :--- | :--- | :--- | :--- | :--- |
| `TC-FE-CUST-001` | Discovery Home (`/`) | Render hero (`Sunday Table`), promo banner, category filter pills, and nearby restaurant grid matching reference image `11.13.32 PM`. | All visual blocks render; clicking category pills filters the grid; screenshot captured. | Phase 1 |
| `TC-FE-CUST-002` | Address & Serviceability | Select a serviceable address (`Brooklyn, NY`) vs. an out-of-zone address in `AddressPickerModal`. | Serviceable address loads nearby restaurants; out-of-zone address renders clear out-of-service-area empty state. | Phase 1 / 3 |
| `TC-FE-CUST-003` | Restaurant Menu — Empty Bag | Load `/restaurants/sunday-table` with 0 items in bag (matching `11.13.44 PM`). | Header shows `Your bag 0`; right sticky card shows `"A little room for delicious."` | Phase 1 |
| `TC-FE-CUST-004` | Restaurant Menu — Add Item & Stepper | Click `+` on `Sunday rigatoni ($18.00)` (matching `11.14.01 PM`). | Dish row morphs to `[- 1 +]`; header updates to `Your bag 1`; right card shows `1 lovely thing`, `Subtotal $18.00`, and `Go to checkout →`. | Phase 1 |
| `TC-FE-CUST-005` | Dish Customization Validation | Open `ItemCustomizationModal` on a dish with required options (`min=1, max=2`) and click Add without selecting. | Zod validation blocks submission and highlights required group until valid options are selected. | Phase 1 |
| `TC-FE-CUST-006` | Multi-Restaurant Cart Guard (`FR-026`) | With `Sunday Table` item in bag, navigate to `Little Green Bowl` and click `+`. | `MultiRestaurantConflictModal` appears prompting to keep current bag or replace with `Little Green Bowl`. | Phase 1 / 3 |
| `TC-FE-CUST-007` | Browser Refresh & Session Persistence | Add items to bag, select address, reload browser (`page.reload()`). | Cart items, quantities, subtotal, and authenticated session remain intact after refresh. | Phase 1 / 3 |
| `TC-FE-CUST-008` | Checkout, Small-Cart Fee & Distance Price Breakdown | Complete checkout form with subtotal below vs. at/above `min_cart_threshold_minor`, apply coupon, select tip, verify breakdown. | `small_cart_fee_minor` applies **only** when subtotal `< min_cart_threshold_minor`; distance-based delivery fee, packaging, tax, tip, and discount match exact minor-unit total. | Phase 1 / 3 |
| `TC-FE-CUST-009` | Live Order Tracking & Delivery OTP Display | View `/orders/[id]/track` as WebSocket emits status and GPS location frames. | Stepper advances in real time; customer sees single-use **Delivery OTP** required for delivery completion. | Phase 1 / 5 |
| `TC-FE-CUST-010` | Responsive Viewports | Run Playwright across Desktop (`1440×900`), Tablet (`768×1024`), and Mobile (`390×844`). | Zero horizontal overflow; mobile menu page collapses right bag card into sticky bottom bag bar. | Phase 1 |
| `TC-FE-CUST-011` | 3-Category Ratings & App-Open Prompt | Open customer portal after an eligible `DELIVERED` order and also access from `/orders`. | Rating modal automatically prompts on app open; supports rating **1. Restaurant**, **2. Individual Menu Items** (below restaurant rating), and **3. Delivery Partner**; blocks duplicate submissions and respects edit policy window. | Phase 1 / 3 |

### 1.2 Outlet Owner & Branch Staff Portal (`TC-FE-REST-*`)
| Test Case ID | Feature / Screen | Test Description | Expected Result | Target Phase |
| :--- | :--- | :--- | :--- | :--- |
| `TC-FE-REST-001` | Onboarding & KYC Wizard | Submit outlet onboarding form with missing required fields vs. valid fields + documents. | Invalid fields show inline errors; valid submission transitions to `PENDING_REVIEW` screen. | Phase 1 / 3 |
| `TC-FE-REST-002` | Live Kitchen Display (KDS) & 5-Min Timeout | Receive `restaurant.new_order` frame; verify **5-minute acceptance countdown**, Customer Care alert state, and post-alert grace period banner; accept order with `20m` prep time. | Accepting transitions order to `RESTAURANT_ACCEPTED` and triggers simultaneous broadcast delivery offer; unaccepted orders after 5m alert Customer Care and enter grace period. | Phase 1 / 3 |
| `TC-FE-REST-003` | Menu, Flexible Scheduling & Hybrid Stock | Toggle dish availability switch OR finite stock counter and configure time-of-day / day-of-week menu schedule in `/restaurant/menu`. | Item immediately reflects `SOLD OUT` or schedule window status on Customer `/restaurants/sunday-table` page. | Phase 1 / 3 |
| `TC-FE-REST-004` | Multi-Outlet, Active Order Capacity & Branch Staff | Switch between outlets as `OUTLET_OWNER` (consolidated view vs. individual branch), configure `max_concurrent_orders` capacity limit, and invite `BRANCH_MANAGER` / `OUTLET_STAFF` with granular branch permissions. | `OUTLET_OWNER` sees consolidated cross-outlet metrics and 20% commission settlements; `BRANCH_MANAGER` is restricted to assigned branch and granted permissions. | Phase 1 / 3 |

### 1.3 Delivery Partner Portal (`TC-FE-DELIV-*`)
| Test Case ID | Feature / Screen | Test Description | Expected Result | Target Phase |
| :--- | :--- | :--- | :--- | :--- |
| `TC-FE-DELIV-001` | Online Toggle & GPS Permission | Toggle availability to `ONLINE_AVAILABLE` with browser geolocation granted vs. denied. | Granted starts GPS watch; denied blocks online status and displays permission help instructions. | Phase 1 / 5 |
| `TC-FE-DELIV-002` | Simultaneous Broadcast Offer & Atomic Claim | Receive simultaneous broadcast offer sent to all eligible partners; click `Accept Delivery`. | First partner to accept atomically acquires assignment and becomes `ON_DELIVERY` (busy); all other partners' offers expire immediately (`SUPERSEDED`). | Phase 1 / 5 |
| `TC-FE-DELIV-003` | Pickup, Transit & Rate-Limited Single-Use OTP Delivery | Progress through `Arrived at Outlet` $\rightarrow$ `Picked Up` $\rightarrow$ `Arrived at Customer` $\rightarrow$ enter single-use **Delivery OTP** (for both online and COD orders). | Delivery cannot complete without valid OTP; repeated wrong OTP attempts trigger rate-limiting cooldown; valid OTP marks order `DELIVERED` and credits base + distance earnings. | Phase 1 / 5 |

### 1.4 Platform Administration (`PLATFORM_ADMIN`) & Customer Care (`CUSTOMER_CARE`) Portal (`TC-FE-ADMIN-*`)
| Test Case ID | Feature / Screen | Test Description | Expected Result | Target Phase |
| :--- | :--- | :--- | :--- | :--- |
| `TC-FE-ADMIN-001` | `PLATFORM_ADMIN` vs. `CUSTOMER_CARE` Role Separation | Switch between `CUSTOMER_CARE` and `PLATFORM_ADMIN` and navigate to `/admin/commissions-pricing` and `/admin/dashboard`. | `CUSTOMER_CARE` can manage 5-minute acceptance timeout escalations, complaints, and authorized OTP overrides, but is strictly blocked from editing commissions, cart fees, or zones. | Phase 1 / 6 |
| `TC-FE-ADMIN-002` | KYC Verification Queue | Review pending outlet and delivery partner documents; approve one and reject one with notes. | Approved account can go online; rejected account sees Platform Admin rejection reason. | Phase 1 / 6 |
| `TC-FE-ADMIN-003` | 5-Min Timeout Escalation, Penalties & OTP Override | Inspect order exceeding 5-minute acceptance timeout in Customer Care queue; verify grace period, auditable `outlet_penalties` record, and authorized Delivery OTP exception override. | Timeout alerts Customer Care at 5m, waits grace period, applies auditable penalty if unaccepted, and logs all overrides to `admin_audit_logs`. | Phase 1 / 6 |
| `TC-FE-ADMIN-004` | 20% Commission Basis, Small-Cart Fee & Distance Pricing | Configure 20% default commission, commission calculation basis, minimum cart threshold, small-cart fee, and zone/systemwide distance delivery & partner payout rules. | Pricing and settlement calculations reflect updated rules while preserving immutable rate snapshots on historical orders. | Phase 1 / 6 |

---

## 2. Backend & Integration Test Cases (`TC-BE-*` — Go + PostgreSQL/Redis/RabbitMQ)

| Test Case ID | Module | Test Description | Expected Result | Target Phase |
| :--- | :--- | :--- | :--- | :--- |
| `TC-BE-AUTH-001` | `auth` | Register, verify OTP, login, rotate refresh token, and replay used refresh token. | Valid flow succeeds; replaying rotated refresh token revokes entire `token_family_id` (`401`). | Phase 2 |
| `TC-BE-GEO-001` | `discovery` | PostGIS `ST_Covers` and `ST_DWithin` queries across inside-zone, outside-zone, and outside-radius coordinates. | Returns only `APPROVED`, `is_active` restaurants whose zone covers the point and radius includes the point. | Phase 3 |
| `TC-BE-CACHE-001` | `menu` / `redis` | Fetch `/api/v1/restaurants/:slug` (cache miss $\rightarrow$ hit), then update dish price in DB. | `cache:restaurant:{id}:menu` is evicted on commit; subsequent GET returns updated price from DB. | Phase 3 |
| `TC-BE-CART-001` | `cart` | Backend calculation of subtotal, packaging, distance delivery fee, coupon discount, and tax in minor units. | Matches exact integer minor-unit arithmetic; tampering with frontend payload prices has zero effect. | Phase 3 |
| `TC-BE-ORD-001` | `orders` | Attempt every invalid state transition (e.g., `PENDING_PAYMENT` $\rightarrow$ `PREPARING`, `DELIVERED` $\rightarrow$ `CANCELLED`). | Backend rejects all invalid transitions with `409 INVALID_STATE_TRANSITION` and leaves DB unchanged. | Phase 3 |
| `TC-BE-OUTBOX-001` | `outbox` / `rabbitmq` | Commit order transaction, run `OutboxRelay`, consume event in worker, and replay identical `message_id`. | Event published to RabbitMQ; first delivery processed; replay skipped via `processed_messages`. | Phase 3 / 4 |
| `TC-BE-WS-001` | `websocket` | Connect to `/api/v1/ws`, subscribe to authorized vs. unauthorized `order:{id}` room, publish Redis event. | Authorized client receives frame in `<1s`; unauthorized client receives `403 FORBIDDEN`. | Phase 5 |

---

## 3. Mandatory End-to-End Business Workflow Test Cases (`TC-WF-*`)

| Test Case ID | Workflow Name | Verification Scope (UI + PostgreSQL Verification) | Target Phase |
| :--- | :--- | :--- | :--- |
| `TC-WF-001` | **Successful Order Checkout to Delivery** | Verifies `orders` (`DELIVERED`), `payments` (`CAPTURED`), `deliveries` (`DELIVERED`), `order_status_history` (all 7 transitions), `restaurant_settlements` (`ACCRUED`), and `delivery_partner_earnings` (`CREDITED`). | Phase 5 / 7 |
| `TC-WF-002` | **Restaurant Rejection & Auto-Refund** | Verifies restaurant reject transitions `orders.order_status = 'CANCELLED'`, creates `refunds` record (`PROCESSED`), and updates `orders.payment_status = 'REFUNDED'`. | Phase 4 |
| `TC-WF-003` | **Payment Failure & Retry** | Verifies failed attempt records `payment_transactions` failure while keeping order `PENDING_PAYMENT`; subsequent retry captures payment and transitions order to `CONFIRMED` with single inventory deduction. | Phase 4 |
| `TC-WF-004` | **Delivery Assignment Failure & Escalation** | Verifies partner reject + offer timeout marks assignment rows `REJECTED`/`EXPIRED`, retries next candidate, and transitions `deliveries.status = 'UNASSIGNABLE'` when no partners remain. | Phase 5 |
| `TC-WF-005` | **Concurrent Orders for Limited Inventory** | 10 concurrent goroutines ordering a dish with `available_quantity = 2`: verifies exactly 2 orders commit (`201`), 8 fail (`409`), and final `available_quantity == 0`. | Phase 3 |
| `TC-WF-006` | **Order Cancellation & Refund Race** | Concurrent customer cancel and restaurant status update: verifies `SELECT ... FOR UPDATE` serializes execution, restores stock if pre-prep, and prevents double refund. | Phase 4 |
| `TC-WF-007` | **Duplicate Order Submission** | 5 concurrent requests with same `(customer_id, idempotency_key)`: verifies `COUNT(*) FROM orders == 1` and identical `201` response payload returned. | Phase 3 |
| `TC-WF-008` | **Duplicate Payment Callbacks** | 5 concurrent identical `payment.captured` webhooks + `/verify` call: verifies `COUNT(*) FROM payment_transactions == 1` and single `order.confirmed` event. | Phase 4 |
| `TC-WF-009` | **Duplicate Delivery Assignment Attempts** | 5 concurrent partner `/accept` calls for same `delivery_id`: verifies `COUNT(*) FROM delivery_assignments WHERE status='ACCEPTED' == 1` and 4 receive `409`. | Phase 5 |
| `TC-WF-010` | **Server Restart & Recovery** | Terminate worker/API mid-outbox and mid-offer timeout; restart and verify all pending `outbox_events` publish and expired offers re-dispatch with zero data corruption. | Phase 5 / 7 |

---

## 4. Performance & Load Test Cases (`TC-PERF-*` — Grafana k6)

| Test Case ID | Workload Profile | Concurrency Ramp | Measured Metrics | Target Threshold (SRS 8.1) |
| :--- | :--- | :--- | :--- | :--- |
| `TC-PERF-001` | Discovery & Menu Read Load | `50` $\rightarrow$ `250` $\rightarrow$ `500` VUs over 5m | `p50, p95, p99`, RPS, error %, Redis hit %, DB pool, CPU/RAM | `p95 < 200ms`, Error rate `< 1%` |
| `TC-PERF-002` | Concurrent Checkout & Order Creation | `20` $\rightarrow$ `100` $\rightarrow$ `200` VUs over 5m | `p50, p95, p99`, RPS, DB lock wait time, RabbitMQ outbox lag | `p95 < 500ms`, 0 inconsistent Tx |
| `TC-PERF-003` | Live GPS Ingestion & WebSocket Fanout | `200` $\rightarrow$ `500` partners pinging every 3s + `500` customer WS listeners | WS status delay, GPS broadcast delay, Redis CPU/ops, API impact | Status `< 1s`, GPS `< 2s` |

---

## 5. Security Test Cases (`TC-SEC-*` — OWASP ZAP & Automated Security Suite)

| Test Case ID | Security Category | Test Method | Expected Result |
| :--- | :--- | :--- | :--- |
| `TC-SEC-001` | Unauthorized & RBAC Bypass | Access protected endpoints across all 4 portals with no token, expired token, or lower-privilege role token. | `401 Unauthorized` or `403 Forbidden` on 100% of unauthorized requests. |
| `TC-SEC-002` | Cross-User Data Exposure (IDOR) | Customer A requests Customer B's order/address/tracking; Restaurant A edits Restaurant B's menu; Partner A updates Partner B's delivery. | `403 Forbidden` (or scoped `404`); zero cross-tenant data leakage. |
| `TC-SEC-003` | SQL Injection & XSS | Inject SQLi payloads (`' OR 1=1--`) into search/filter params and XSS payloads (`<script>alert(1)</script>`) into reviews/notes. | Parameterized `pgx` queries neutralize SQLi; React auto-escaping + CSP block XSS execution. |
| `TC-SEC-004` | Rate Limiting & Brute Force | Exceed login (`>5/15m`) and OTP (`>3/10m`) thresholds. | `429 Too Many Requests` with `Retry-After` / `X-RateLimit-Reset` headers. |
| `TC-SEC-005` | Payment Webhook Forgery | Send `POST /api/v1/payments/webhooks/razorpay` with missing or invalid HMAC signature. | Rejected immediately with `401 Invalid Signature`; zero DB state mutation. |
| `TC-SEC-006` | OWASP ZAP Baseline & API Scan | Run `zap-baseline.py` and `zap-api-scan.py` against running stack. | Zero High or Medium severity alerts; HTML report archived in `artifacts/zap/`. |
