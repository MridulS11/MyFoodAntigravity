# Requirements Clarifications & Final Business Decisions Matrix — Goodly Platform

## 1. Authoritative Final Business Decisions (Incorporated Across Architecture, Schema & UI)

The following business decisions from **Final Business Decisions — Food Delivery Platform** (`MoreDecisions.docx`) are locked as the authoritative specification and supersede any conflicting provisional defaults:

| Section | Domain | Approved Authoritative Rule | Architectural & Schema Enforcement |
| :--- | :--- | :--- | :--- |
| **§1** | **Terminology & Roles** | • **`Admin` (`PLATFORM_ADMIN`)** = Platform owner / app owner.<br/>• **`Owner` (`OUTLET_OWNER`)** = Restaurant/outlet owner.<br/>• **`Customer Care` (`CUSTOMER_CARE`)** = Separate operational support role with restricted permissions.<br/>• Must never be confused across DB, RBAC, or UI. | Enforced via distinct `roles.code` values (`PLATFORM_ADMIN`, `CUSTOMER_CARE`, `OUTLET_OWNER`, `BRANCH_MANAGER`, `OUTLET_STAFF`, `DELIVERY_PARTNER`, `CUSTOMER`) and strict permission checks on `/api/v1/admin/*` vs. `/api/v1/care/*` vs. `/api/v1/outlets/*`. |
| **§2** | **Multi-Outlet & Granular Branch Staff Operations** | • Multiple outlets (branches) supported under a single `OUTLET_OWNER` account with consolidated owner access.<br/>• `Owner` can invite `BRANCH_MANAGER` and `OUTLET_STAFF` with granular, branch-specific permissions.<br/>• Each outlet owner can configure an optional/toggleable **maximum simultaneous active orders** (`max_concurrent_orders`) limit.<br/>• Flexible **menu scheduling** (time-of-day / day-of-week), operating hours, holiday hours, pause/resume, prep time, and **hybrid item availability** (quantity-based inventory OR simple available/unavailable toggle). | Enforced via `restaurants.owner_user_id` (1-to-many branches), `outlet_staff_assignments` (`outlet_id`, `role_code`, `permissions TEXT[]`), `restaurants.max_concurrent_orders` & `active_orders_count`, `menu_schedules`, `outlet_holiday_closures`, and `menu_item_inventory.track_inventory`. |
| **§3** | **Cart Fee & Delivery Pricing** | • Platform `Admin` configures `min_cart_threshold_minor` and `small_cart_fee_minor`, applied **only** when order subtotal falls below the configured threshold.<br/>• Delivery charges are **distance-based**; `Admin` controls pricing parameters supporting both **delivery zones** and **systemwide defaults**.<br/>• Delivery partner earnings use **base pay + distance-based per-unit payments**, controlled by Platform `Admin`. | Enforced in `delivery_charge_rules` (`service_zone_id NULL` for systemwide default vs. zone UUID), `orders.small_cart_fee_minor`, and `delivery_partner_earnings` (`base_payout_minor` + `distance_payout_minor`). |
| **§4** | **Restaurant Acceptance Timeout & Escalation** | • Default acceptance timeout is **5 minutes** (`300s`, configurable by Platform `Admin`).<br/>• If an outlet does not respond within 5 minutes $\rightarrow$ **Customer Care is alerted**.<br/>• System waits an additional **configurable grace period**.<br/>• If the outlet still fails to respond $\rightarrow$ an **Admin-configured penalty** is recorded in an auditable financial/operational record (`outlet_penalties`), customer receives accurate status updates, and the configured order-resolution policy executes. | Enforced via `orders.accept_deadline_at`, `customer_care_alerted_at`, `grace_deadline_at`, `acceptance_escalation_state`, and the auditable `outlet_penalties` table. |
| **§5** | **Broadcast Delivery Assignment** | • **All eligible delivery partners** receive the same delivery offer **simultaneously**.<br/>• The **first valid acceptance atomically acquires** the assignment; all other outstanding offers for that delivery **expire immediately** (`SUPERSEDED`).<br/>• Assigned partner becomes **busy** (`ON_DELIVERY`) until completion.<br/>• Supports reassignment if an assignment is cancelled or invalidated. | Enforced via simultaneous `OFFERED` rows in `delivery_assignments`, row-level locking on `deliveries` (`WHERE partner_id IS NULL`), `UNIQUE (delivery_id) WHERE status = 'ACCEPTED'`, and immediate sibling expiration. |
| **§6** | **Three-Category Ratings & App-Open Prompt** | • Three independent rating categories:<br/>  1. **Restaurant**<br/>  2. **Delivery Partner**<br/>  3. **Individual Food / Menu Items** (optional, displayed below the restaurant rating option).<br/>• Automatically prompts when customer opens the app after an eligible delivery, and also accessible from **Order History**.<br/>• Prevents duplicate submissions and maintains a configurable rating-edit policy. | Enforced via `reviews` (`UNIQUE (order_id)`, `restaurant_rating`, `delivery_partner_rating`, `editable_until`), `order_item_ratings` (`UNIQUE (order_item_id)`), and `orders.rating_prompt_status`. |
| **§7** | **OTP-Based Proof of Delivery** | • Applies to **every order** (`ONLINE` and `COD`).<br/>• Customer shares OTP with delivery partner; partner enters OTP to confirm delivery.<br/>• Backend-controlled, secure, time-limited, single-use, with **rate-limiting** on repeated wrong attempts.<br/>• Delivery status must **never** be marked `DELIVERED` before OTP verification, except via a separately authorized exception process (`delivery:override_otp`). | Enforced via `delivery_otps` (`otp_hash`, `failed_attempts`, `max_attempts`, `rate_limited_until`, `expires_at`, `verified_at`, `exception_override_by_user_id`). |
| **§8** | **Commission & Earnings** | • Initial restaurant commission is **20%** (`2000 bps`).<br/>• Platform `Admin` can configure commission rules granularly, including a **configurable calculation basis** (`GROSS_FOOD_SUBTOTAL`, `NET_AFTER_OUTLET_DISCOUNT`, `SUBTOTAL_PLUS_PACKAGING`).<br/>• All applicable rates and calculation snapshots are preserved immutably in historical order and settlement records. | Enforced via `commission_configs.default_commission_bps = 2000`, `calculation_basis`, and immutable snapshot columns on `orders` and `restaurant_settlements`. |

---

## 2. Section 9 Financial Calculation Rules — Approved as Platform Admin Configurable

Both Section 9 calculation rules are approved to be **fully configurable by the Platform Admin (`PLATFORM_ADMIN`)** via the Admin Portal (`/admin/commissions-pricing` and `/admin/settings`) with immutable rule snapshots on every historical order/settlement/payout record:

1. **Admin-Configurable Restaurant Non-Acceptance Penalty Rule**:
   - Platform `Admin` can select the calculation mode (`PERCENTAGE_OF_SUBTOTAL`, `FLAT_AMOUNT`, or `HYBRID`) and configure:
     - `penalty_bps` (e.g., `1000` = `10%` of order food subtotal)
     - `flat_penalty_minor` (e.g., `10000` paise = `₹100.00`)
     - `min_penalty_minor` (floor, e.g., `5000` paise = `₹50.00`) and `max_penalty_minor` (cap, e.g., `30000` paise = `₹300.00`)
   - Applied automatically when an outlet fails to respond within the **5-minute acceptance timeout** (`accept_deadline_at`) AND fails to respond during the subsequent **Customer Care grace period** (`grace_deadline_at`). Recorded in `outlet_penalties` with `penalty_rule_snapshot JSONB`.

2. **Admin-Configurable Daily Delivery Partner Payout Fee Rule**:
   - Platform `Admin` can configure the daily payout fee parameters in `delivery_charge_rules.partner_daily_payout_fee_config`:
     - `fee_mode`: `FLAT_FEE`, `PERCENTAGE_CAPPED`, or `FREE_SCHEDULED_PAID_INSTANT`
     - `scheduled_daily_fee_minor` (e.g., `0` paise = `₹0.00` for scheduled EOD sweep)
     - `instant_cashout_fee_minor` (e.g., `1000` paise = `₹10.00`)
     - `fee_percentage_bps` and `max_fee_cap_minor`
     - `waive_above_daily_trips_count` (e.g., waive fee if partner completes $\ge 5$ trips that day) and `min_payout_sweep_threshold_minor` (e.g., `₹200.00`).

---

## 3. Core Marketplace Model & Geography (Confirmed)

1. **Multi-Outlet Marketplace Mediator Model (Like Zomato / Swiggy / Uber Eats)**:
   - **Goodly** is a multi-sided marketplace mediator connecting:
     - **Customers (`CUSTOMER`)** who browse nearby registered outlets and place orders.
     - **Multiple Independent Restaurant / Outlet Owners (`OUTLET_OWNER`)** who onboard their brand(s) and one or more physical branches/outlets onto the platform, manage menus/schedules/stock, and can invite branch-scoped `BRANCH_MANAGER`s and `OUTLET_STAFF`.
     - **Independent Delivery Partners (`DELIVERY_PARTNER`)** who receive simultaneous broadcast delivery offers, pick up from the outlet, and complete deliveries via single-use OTP verification.
     - **Platform Owner (`PLATFORM_ADMIN`) & Customer Care (`CUSTOMER_CARE`)** who govern the marketplace, verify KYC/FSSAI documents, configure the **20% marketplace commission**, small-cart fees, and distance-based delivery pricing, and handle 5-minute acceptance timeout escalations and customer support.
2. **Primary Geography & Currency — India (`INR ₹`, `Asia/Kolkata`)**:
   - The active geography for the platform is **India** (e.g., Bengaluru, Mumbai, Delhi NCR service zones), using **Indian Rupees (`INR ₹`, stored in integer paise minor units)**, `+91` phone numbers, `Asia/Kolkata` (`IST`) timezone, FSSAI/GSTIN restaurant KYC, and Indian payment methods (`Razorpay` / `Cashfree` — UPI, Cards, Netbanking, and COD).
3. **Single-Outlet Cart Policy (`FR-026`)**: A customer's cart holds items from one outlet at a time; adding a dish from another outlet triggers `MultiRestaurantConflictModal` prompting to keep the current bag or start a fresh bag.
4. **Visual Design System**: Retains the exact **Goodly Design System** from your reference screenshots (`#FCF9F0` warm cream, `#1E1F1C` charcoal ink, `#DEC146` warm gold, `#5F8E63` sage, `#CBEAD0` soft mint) while localizing locations and currency to **India (`INR ₹`)**.
