# API Specification — Goodly Food Delivery Platform

## 1. API Design Conventions & Standards (SRS Section 9)

- **Base Path**: `/api/v1`
- **Documentation & Contract**: OpenAPI 3.0.3 (`backend/api/openapi/openapi.yaml`), served interactively via Swagger UI at `GET /swagger/index.html` in development and staging environments.
- **Authentication**:
  - `Authorization: Bearer <access_token>` (15-minute signed JWT containing `sub`, `roles[]`, `permissions[]`, `jti`) OR `HttpOnly; Secure; SameSite=Lax` cookie for first-party web portals.
  - Refresh token rotation via `POST /api/v1/auth/refresh` using `HttpOnly` cookie.
- **Idempotency (`SRS Section 9.3`)**:
  - All state-creating or financial `POST` endpoints (`POST /api/v1/orders`, `POST /api/v1/payments/initiate`, `POST /api/v1/admin/refunds`) **require** an `Idempotency-Key: <uuid>` request header.
- **Tracing & Rate Limiting Headers**:
  - Request/Response: `X-Correlation-ID: <uuid>`
  - Response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Monetary Values**: All monetary fields in API payloads are represented as integer minor units (`*_minor`, e.g., `1800` for `$18.00` or `₹18.00`) plus a formatted display helper or explicit `currency` field (`"USD"` or `"INR"`) so clients never perform floating-point financial math.

### Standard Response & Error Envelopes

```json
// Success Response (200 OK / 201 Created)
{
  "success": true,
  "data": { ... },
  "meta": {
    "correlation_id": "018f6a90-12c4-7000-8000-000000000001",
    "pagination": {
      "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0xMS0xMFQyMzowMDowMFoifQ==",
      "has_more": true,
      "limit": 20,
      "total_count": 142
    }
  }
}

// Standard Error Response (4xx / 5xx)
{
  "success": false,
  "error": {
    "code": "CART_PRICE_OR_AVAILABILITY_CHANGED",
    "message": "One or more items in your bag have changed price or availability.",
    "details": [
      {
        "field": "items[0].menu_item_id",
        "issue": "ITEM_UNAVAILABLE",
        "menu_item_id": "018f6a90-9999-7000-8000-000000000012",
        "name": "Burrata & tomatoes"
      }
    ],
    "correlation_id": "018f6a90-12c4-7000-8000-000000000001"
  }
}
```

---

## 2. Complete Endpoint Catalog by Business Domain

### 2.1 Authentication & Identity (`/api/v1/auth`)

| Method | Endpoint | Auth | Rate Limit | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | Public | 5 / 15m / IP | Register new customer, restaurant owner, or delivery partner account |
| `POST` | `/api/v1/auth/login` | Public | 5 / 15m / IP | Authenticate via email/phone + password; issues JWT + refresh cookie |
| `POST` | `/api/v1/auth/otp/send` | Public | 3 / 10m / Target | Send 6-digit SMS/Email OTP for registration, login, or step-up verification |
| `POST` | `/api/v1/auth/otp/verify` | Public | 5 / 10m / Target | Verify OTP code and return session tokens or verification grant |
| `POST` | `/api/v1/auth/refresh` | Refresh Cookie | 30 / 15m | Rotate refresh token and issue new short-lived access token |
| `POST` | `/api/v1/auth/logout` | Authenticated | 30 / 15m | Revoke active session in PostgreSQL and Redis |
| `POST` | `/api/v1/auth/password/forgot` | Public | 3 / 15m | Initiate password recovery flow |
| `POST` | `/api/v1/auth/password/reset` | Public | 5 / 15m | Reset password using verified token/OTP |
| `POST` | `/api/v1/auth/ws-ticket` | Authenticated | 20 / 1m | Issue single-use 30s ticket for `/api/v1/ws` WebSocket connection |

---

### 2.2 Customer Profile & Addresses (`/api/v1/customers`)

| Method | Endpoint | Auth Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/customers/me` | `CUSTOMER` | Fetch current customer profile, preferences, and default address |
| `PATCH` | `/api/v1/customers/me` | `CUSTOMER` | Update customer name, dietary preferences, or avatar (phone/email requires OTP grant) |
| `GET` | `/api/v1/customers/me/addresses` | `CUSTOMER` | List saved delivery addresses |
| `POST` | `/api/v1/customers/me/addresses` | `CUSTOMER` | Create saved address; backend validates coordinates & serviceability |
| `PATCH` | `/api/v1/customers/me/addresses/:id` | `CUSTOMER` | Update address or set `is_default = true` |
| `DELETE` | `/api/v1/customers/me/addresses/:id` | `CUSTOMER` | Soft-archive saved address |
| `GET` | `/api/v1/customers/me/favorites` | `CUSTOMER` | List favorited restaurants (`♡` button in reference UI) |
| `POST` | `/api/v1/customers/me/favorites/:restaurantId` | `CUSTOMER` | Add restaurant to favorites |
| `DELETE` | `/api/v1/customers/me/favorites/:restaurantId` | `CUSTOMER` | Remove restaurant from favorites |

---

### 2.3 Restaurant Discovery & Search (`/api/v1/discovery`)

| Method | Endpoint | Auth Role | Query Parameters | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/discovery/feed` | Public / `CUSTOMER` | `lat`, `lng`, `category`, `sort`, `free_delivery`, `min_rating`, `max_eta`, `dietary` | Returns hero feature (`Sunday Table`), category pills, and serviceable nearby restaurants (`FR-010`–`FR-016`) |
| `GET` | `/api/v1/discovery/search` | Public / `CUSTOMER` | `q`, `lat`, `lng`, `type=all\|restaurants\|dishes`, `cursor`, `limit` | Full-text + trigram search across serviceable restaurants and menu dishes (`FR-011`) |
| `GET` | `/api/v1/discovery/serviceability` | Public | `lat`, `lng` | Checks PostGIS `service_zones` containment and returns zone currency, active status, and base fees (`FR-015`) |
| `GET` | `/api/v1/restaurants/:slugOrId` | Public / `CUSTOMER` | `lat`, `lng`, `q` (in-menu search) | Returns full restaurant header, operating status, delivery fee/ETA for customer point, and categorized menu tree (`FR-013`, `FR-014`) |

#### Sample Response: `GET /api/v1/restaurants/sunday-table?lat=40.6782&lng=-73.9442`
```json
{
  "success": true,
  "data": {
    "restaurant": {
      "id": "018f6a90-0001-7000-8000-000000000001",
      "slug": "sunday-table",
      "name": "Sunday Table",
      "eyebrow": "NEIGHBORHOOD ITALIAN · EST. 2018",
      "description": "Fresh pasta, generous pours, and the kind of dinner that makes the whole table happy.",
      "cuisines": ["Italian", "Pasta", "Comfort food"],
      "rating_average": 4.9,
      "rating_count": 1240,
      "is_open": true,
      "is_serviceable": true,
      "estimated_delivery_min": 20,
      "estimated_delivery_max": 30,
      "delivery_fee_minor": 0,
      "currency": "USD",
      "promo_banner": "Good news: delivery is on us today.",
      "hero_image_url": "https://cdn.goodly.local/restaurants/sunday-table/hero.jpg"
    },
    "categories": [
      {
        "id": "018f6a90-0002-7000-8000-000000000001",
        "name": "Most loved",
        "subtitle": "The ones regulars come back for",
        "dish_count": 2,
        "items": [
          {
            "id": "018f6a90-0003-7000-8000-000000000001",
            "name": "Sunday rigatoni",
            "description": "Slow Sunday tomato sauce, pecorino, fresh basil",
            "badge_label": "A HOUSE FAVORITE",
            "dietary_tags": [],
            "base_price_minor": 1800,
            "is_available": true,
            "image_url": "https://cdn.goodly.local/dishes/sunday-rigatoni.jpg",
            "customization_groups": []
          }
        ]
      }
    ]
  }
}
```

---

### 2.4 Cart & Checkout Pricing (`/api/v1/cart`)

| Method | Endpoint | Auth Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cart` | `CUSTOMER` | Retrieve current cart with live item availability and calculated breakdown |
| `POST` | `/api/v1/cart/items` | `CUSTOMER` | Add item + selected `option_ids[]` to cart (`FR-017`, `FR-026`); returns `409 MULTI_RESTAURANT_CART_CONFLICT` if from another restaurant unless `replace_cart: true` is passed |
| `PATCH` | `/api/v1/cart/items/:cartItemId` | `CUSTOMER` | Update item quantity or customizations (`FR-018`) |
| `DELETE` | `/api/v1/cart/items/:cartItemId` | `CUSTOMER` | Remove item from cart (`FR-019`) |
| `DELETE` | `/api/v1/cart` | `CUSTOMER` | Clear entire cart |
| `POST` | `/api/v1/cart/coupon` | `CUSTOMER` | Validate and attach coupon code (`FR-023`) |
| `DELETE` | `/api/v1/cart/coupon` | `CUSTOMER` | Remove applied coupon |
| `POST` | `/api/v1/cart/validate-checkout` | `CUSTOMER` | Authoritatively validate restaurant open status, address serviceability, item availability, and prices (`FR-020`–`FR-025`), returning a signed `pricing_quote_hash` |

#### Sample Request & Response: `POST /api/v1/cart/validate-checkout`
```json
// Request
{
  "delivery_address_id": "018f6a90-0010-7000-8000-000000000099",
  "coupon_code": "WELCOMEGOODLY",
  "tip_amount_minor": 300
}

// Response (200 OK)
// Note: small_cart_fee_minor is applied ONLY when item_subtotal_minor < min_cart_threshold_minor
{
  "success": true,
  "data": {
    "is_valid": true,
    "restaurant_id": "018f6a90-0001-7000-8000-000000000001",
    "currency": "USD",
    "min_cart_threshold_minor": 1500,
    "breakdown": {
      "item_subtotal_minor": 1800,
      "small_cart_fee_minor": 0,
      "packaging_fee_minor": 100,
      "delivery_fee_minor": 0,
      "platform_fee_minor": 99,
      "discount_amount_minor": 0,
      "tax_amount_minor": 160,
      "tip_amount_minor": 300,
      "total_payable_minor": 2459
    },
    "estimated_delivery_min": 20,
    "estimated_delivery_max": 30,
    "pricing_quote_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "quote_expires_at": "2026-11-10T23:35:00Z"
  }
}
```

---

### 2.5 Order Management & Three-Category Ratings (`/api/v1/orders`)

| Method | Endpoint | Auth Role | Headers | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/orders` | `CUSTOMER` | `Idempotency-Key` | Create order in `PENDING_PAYMENT` state, enforce outlet `max_concurrent_orders` capacity, and reserve inventory (`FR-027`, `FR-028`) |
| `GET` | `/api/v1/orders` | `CUSTOMER` | — | Paginated customer order history (`FR-029`, `FR-038`) |
| `GET` | `/api/v1/orders/pending-rating-prompt` | `CUSTOMER` | — | Returns the most recent delivered order where `rating_prompt_status = 'ELIGIBLE_ON_APP_OPEN'` so the app automatically prompts for Restaurant, Delivery Partner, and optional Menu Item ratings on launch (Final Business Decisions §6) |
| `POST` | `/api/v1/orders/:id/dismiss-rating-prompt` | `CUSTOMER` | — | Dismiss automatic app-open rating prompt (order remains rateable from `/orders`) |
| `GET` | `/api/v1/orders/:id` | `CUSTOMER` / `OUTLET_OWNER` / `BRANCH_MANAGER` / `CUSTOMER_CARE` / `PLATFORM_ADMIN` | — | Detailed order state, items, status timeline, customer-only single-use Delivery OTP, and payment/delivery summary (`FR-030`) |
| `POST` | `/api/v1/orders/:id/cancel` | `CUSTOMER` | `Idempotency-Key` | Request cancellation according to stage policy (`FR-037`) |
| `POST` | `/api/v1/orders/:id/review` | `CUSTOMER` | — | Submit 3-category rating (`restaurant_rating`, `delivery_partner_rating`, and optional `item_ratings[]` for individual dishes) for a `DELIVERED` order; prevents duplicates (`UNIQUE(order_id)`) |
| `PATCH` | `/api/v1/orders/:id/review` | `CUSTOMER` | — | Edit existing rating within the configured `editable_until` policy window |
| `POST` | `/api/v1/orders/:id/complaint` | `CUSTOMER` | — | Raise a support complaint with optional evidence photos (`FR-100`) |

#### Sample Request & Response: `POST /api/v1/orders`
```json
// Request (Header: Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000)
{
  "delivery_address_id": "018f6a90-0010-7000-8000-000000000099",
  "payment_method": "ONLINE",
  "pricing_quote_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "tip_amount_minor": 300,
  "special_instructions": "Please ring the second-floor bell."
}

// Response (201 Created)
{
  "success": true,
  "data": {
    "order": {
      "id": "018f6a90-0500-7000-8000-000000000500",
      "order_number": "GD-20261110-8F4A",
      "order_status": "PENDING_PAYMENT",
      "payment_status": "PENDING",
      "delivery_status": "ASSIGNMENT_PENDING",
      "total_payable_minor": 2459,
      "currency": "USD",
      "version": 1,
      "created_at": "2026-11-10T23:20:10Z"
    },
    "payment_session": {
      "payment_id": "018f6a90-0600-7000-8000-000000000600",
      "provider": "RAZORPAY",
      "provider_order_id": "order_P9xK8m2L1qZ0vB",
      "amount_minor": 2459,
      "currency": "USD",
      "public_key": "rzp_test_xxxxxxxx"
    }
  }
}
```

---

### 2.6 Payments & Refunds (`/api/v1/payments`)

| Method | Endpoint | Auth Role | Headers | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/payments/initiate` | `CUSTOMER` | `Idempotency-Key` | Retry/re-initiate payment session for a `PENDING_PAYMENT` order (`FR-041`) |
| `POST` | `/api/v1/payments/verify` | `CUSTOMER` | — | Verify client-side checkout callback signature (`provider_order_id`, `provider_payment_id`, `signature`) (`FR-042`) |
| `POST` | `/api/v1/payments/webhooks/:provider` | Gateway HMAC | `X-Razorpay-Signature` / `x-webhook-signature` | Asynchronous server-to-server webhook ingestion for payment capture, failure, and refund events (`FR-042`, `FR-044`) |
| `GET` | `/api/v1/payments/orders/:orderId` | `CUSTOMER` / `ADMIN` | — | Fetch payment and refund status history (`FR-046`) |

---

### 2.7 Restaurant / Multi-Outlet Operations Portal APIs (`/api/v1/restaurants/me`, `/api/v1/outlets` & `/api/v1/menu`)

| Method | Endpoint | Auth Role & Branch Permission | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/restaurants/onboarding` | `OUTLET_OWNER` | Submit new outlet/branch onboarding application, location, and KYC document keys (`FR-070`) |
| `GET` | `/api/v1/outlets` | `OUTLET_OWNER` / `BRANCH_MANAGER` / `OUTLET_STAFF` | List all outlets owned by `OUTLET_OWNER` (consolidated access) or assigned to `BRANCH_MANAGER` / `OUTLET_STAFF` |
| `GET` | `/api/v1/restaurants/me` | `OUTLET_OWNER` / `BRANCH_MANAGER` / `OUTLET_STAFF` | Fetch active outlet profile, verification state, active order capacity (`active_orders_count` / `max_concurrent_orders`), and live kitchen status |
| `PATCH` | `/api/v1/restaurants/me` | `OUTLET_OWNER` / `outlet:capacity:configure` | Update outlet profile, prep time, minimum order, packaging fee, and **`max_concurrent_orders` capacity limit** (`FR-070`, Final Business Decisions §2) |
| `GET/POST/PATCH/DELETE` | `/api/v1/outlets/:outletId/staff` | `OUTLET_OWNER` | Invite `BRANCH_MANAGER` or `OUTLET_STAFF` to a specific branch and configure granular branch-scoped permissions (`outlet:orders:manage`, `outlet:menu:edit`, `outlet:inventory:toggle`, `outlet:hours:manage`, `outlet:capacity:configure`, `outlet:reports:view`) |
| `PATCH` | `/api/v1/restaurants/me/availability` | `OUTLET_OWNER` / `outlet:hours:manage` | Toggle `is_accepting_orders` (instant pause/resume with optional `paused_until`) (`FR-016`, `FR-074`) |
| `PUT` | `/api/v1/restaurants/me/operating-hours` | `OUTLET_OWNER` / `outlet:hours:manage` | Replace weekly operating schedule & holiday hours (`FR-074`) |
| `POST` | `/api/v1/menu/categories` | `OUTLET_OWNER` / `outlet:menu:edit` | Create menu category (`FR-071`) |
| `PATCH` | `/api/v1/menu/categories/:id` | `OUTLET_OWNER` / `outlet:menu:edit` | Update category title, subtitle, or display order (`FR-071`) |
| `DELETE` | `/api/v1/menu/categories/:id` | `OUTLET_OWNER` / `outlet:menu:edit` | Deactivate/delete empty menu category |
| `POST` | `/api/v1/menu/items` | `OUTLET_OWNER` / `outlet:menu:edit` | Create dish with price, tags, customization groups, and stock settings (supports both simple available/unavailable toggle and quantity-based inventory) (`FR-072`) |
| `PATCH` | `/api/v1/menu/items/:id` | `OUTLET_OWNER` / `outlet:menu:edit` | Edit dish details, price, or customizations (`FR-072`) |
| `PATCH` | `/api/v1/menu/items/:id/availability` | `OUTLET_OWNER` / `outlet:inventory:toggle` | Instant 1-click stock/availability toggle or finite quantity update (`FR-073`) |
| `GET/POST/DELETE` | `/api/v1/menu/schedules` | `OUTLET_OWNER` / `outlet:menu:edit` | Configure flexible time-of-day and day-of-week availability schedules for categories or dishes |
| `GET` | `/api/v1/restaurants/me/orders` | `OUTLET_OWNER` / `outlet:orders:manage` | List active incoming/preparing/ready orders (with 5-minute acceptance countdown and grace-period indicators) or historical orders (`FR-075`) |
| `POST` | `/api/v1/restaurants/me/orders/:id/accept` | `OUTLET_OWNER` / `outlet:orders:manage` | Accept `CONFIRMED` order with `estimated_prep_minutes`; triggers simultaneous broadcast delivery offer (`FR-032`) |
| `POST` | `/api/v1/restaurants/me/orders/:id/reject` | `OUTLET_OWNER` / `outlet:orders:manage` | Reject `CONFIRMED` order with mandatory `reason_code`; triggers customer refund (`FR-032`, `FR-039`) |
| `PATCH` | `/api/v1/restaurants/me/orders/:id/status` | `OUTLET_OWNER` / `outlet:orders:manage` | Transition order to `PREPARING` or `READY_FOR_PICKUP` (`FR-033`, `FR-076`) |
| `GET` | `/api/v1/restaurants/me/reports/sales` | `OUTLET_OWNER` / `outlet:reports:view` | Sales volume (per-branch or consolidated across all owner outlets), top dishes, and 20% commission breakdown (`FR-077`) |
| `GET` | `/api/v1/restaurants/me/settlements` | `OUTLET_OWNER` / `outlet:reports:view` | Payout history, per-order settlement ledger, and non-acceptance penalty ledger (`outlet_penalties`) (`FR-077`) |

---

### 2.8 Delivery Partner Portal, Broadcast Offers & OTP Proof of Delivery APIs (`/api/v1/delivery` & `/api/v1/tracking`)

| Method | Endpoint | Auth Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/delivery/onboarding` | `DELIVERY_PARTNER` | Submit partner profile, vehicle details, and license/KYC documents (`FR-078`) |
| `GET` | `/api/v1/delivery/me` | `DELIVERY_PARTNER` | Fetch partner profile, verification status, current shift state (`ONLINE_AVAILABLE` / `ON_DELIVERY`), and active delivery (`FR-078`) |
| `PATCH` | `/api/v1/delivery/me/availability` | `DELIVERY_PARTNER` | Toggle `ONLINE_AVAILABLE` / `OFFLINE` with initial GPS coordinates (`FR-049`, `FR-079`) |
| `GET` | `/api/v1/delivery/me/offers` | `DELIVERY_PARTNER` | List pending non-expired **broadcast delivery offers** sent simultaneously to all eligible partners (`FR-053`, `FR-080`, Final Business Decisions §5) |
| `POST` | `/api/v1/delivery/me/offers/:assignmentId/accept` | `DELIVERY_PARTNER` | **Atomically accept broadcast offer** (first valid acceptance acquires the assignment, sets partner `ON_DELIVERY`, and immediately expires all sibling offers for that delivery with `409 OFFER_ALREADY_CLAIMED` for slower clicks) (`FR-054`, `FR-056`) |
| `POST` | `/api/v1/delivery/me/offers/:assignmentId/reject` | `DELIVERY_PARTNER` | Dismiss/reject offer for this partner (`FR-054`, `FR-057`) |
| `PATCH` | `/api/v1/delivery/me/deliveries/:id/status` | `DELIVERY_PARTNER` | Update transit progress: `ARRIVED_AT_RESTAURANT` $\rightarrow$ `PICKED_UP` $\rightarrow$ `OUT_FOR_DELIVERY` $\rightarrow$ `ARRIVED_AT_CUSTOMER` (Note: `DELIVERED` is strictly blocked on this endpoint and requires `/verify-otp`) (`FR-081`–`FR-082`) |
| `POST` | `/api/v1/delivery/me/deliveries/:id/verify-otp` | `DELIVERY_PARTNER` | **Mandatory OTP Proof of Delivery** for every order (online & COD): backend verifies single-use, time-limited `otp_code` with rate-limiting on repeated wrong attempts before marking order `DELIVERED` (`FR-083`, Final Business Decisions §7) |
| `GET` | `/api/v1/delivery/me/history` | `DELIVERY_PARTNER` | Paginated completed deliveries (`FR-084`) |
| `GET` | `/api/v1/delivery/me/earnings` | `DELIVERY_PARTNER` | Daily/weekly earnings breakdown (Admin-configured base pay + distance-based per-unit pay + tips, less applicable daily payout fee once approved) (`FR-085`) |
| `POST` | `/api/v1/tracking/location` | `DELIVERY_PARTNER` | HTTP fallback for submitting GPS location (`lat`, `lng`, `speed`, `bearing`, `accuracy`) (`FR-059`, `FR-060`) |
| `GET` | `/api/v1/tracking/orders/:orderId` | `CUSTOMER` / `CUSTOMER_CARE` / `PLATFORM_ADMIN` | Authorised live tracking snapshot: partner location, route polyline, and dynamic ETA (`FR-062`, `FR-065`, `FR-068`) |

---

### 2.9 Platform Administration (`PLATFORM_ADMIN`) & Customer Care (`CUSTOMER_CARE`) APIs (`/api/v1/admin` & `/api/v1/care`)

Every operational endpoint enforces strict role separation (`PLATFORM_ADMIN` vs. `CUSTOMER_CARE`) and granular permission slugs (`SRS Section 3.4 & 4.11`, Final Business Decisions §1):

| Method | Endpoint | Allowed Role / Permission | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/care/timeout-alerts` | `CUSTOMER_CARE`, `PLATFORM_ADMIN` (`orders:timeout_escalate`) | Live queue of orders where an outlet did not accept within the **5-minute timeout** and entered the post-alert grace period (Final Business Decisions §4) |
| `POST` | `/api/v1/care/orders/:id/escalate-action` | `CUSTOMER_CARE`, `PLATFORM_ADMIN` (`orders:timeout_escalate`) | Contact outlet, record follow-up notes, or trigger resolution policy if grace period expires |
| `POST` | `/api/v1/care/deliveries/:id/override-otp` | `CUSTOMER_CARE`, `PLATFORM_ADMIN` (`delivery:override_otp`) | Separately authorized exception workflow to complete a delivery when OTP cannot be entered, requiring mandatory reason & audit log (Final Business Decisions §7) |
| `GET/PATCH` | `/api/v1/admin/users`, `/api/v1/admin/users/:id/status` | `PLATFORM_ADMIN` (`users:manage`) | Search users, inspect history, suspend/reactivate accounts (`FR-092`) |
| `GET/POST` | `/api/v1/admin/restaurants/verifications/:id/decision` | `PLATFORM_ADMIN` (`restaurants:verify`) | Review outlet KYC documents and approve/reject/suspend (`FR-093`) |
| `GET/POST` | `/api/v1/admin/delivery-partners/verifications/:id/decision` | `PLATFORM_ADMIN` (`partners:verify`) | Review partner license/KYC and approve/reject/suspend (`FR-094`) |
| `GET` | `/api/v1/admin/orders/live` | `PLATFORM_ADMIN`, `CUSTOMER_CARE` (`orders:monitor`) | Filterable live order monitor including 5-minute acceptance timeout alerts and stuck/unassignable orders (`FR-095`) |
| `POST` | `/api/v1/admin/orders/:id/intervene` | `PLATFORM_ADMIN`, `CUSTOMER_CARE` (`orders:intervene`) | Force cancel, trigger delivery reassignment broadcast, or override stuck state (`FR-095`, `FR-058`) |
| `GET` | `/api/v1/admin/deliveries/live` | `PLATFORM_ADMIN`, `CUSTOMER_CARE` (`orders:monitor`) | Real-time fleet map of active deliveries and online partners (`FR-096`) |
| `GET/POST` | `/api/v1/admin/refunds`, `/api/v1/admin/refunds/:id/approve` | `PLATFORM_ADMIN` (`refunds:approve`) | View payment transactions and issue/approve full or partial refunds (`FR-047`, `FR-097`) |
| `GET/PUT` | `/api/v1/admin/commissions`, `/api/v1/admin/delivery-charges` | `PLATFORM_ADMIN` (`commissions:configure`) | Configure **20% initial commission**, **commission calculation basis**, **minimum cart threshold & small-cart fee**, distance-based delivery fees (zone & systemwide defaults), and partner base + distance payout rates (`FR-098`, Final Business Decisions §3 & §8) |
| `GET/POST` | `/api/v1/admin/outlet-penalties` | `PLATFORM_ADMIN` (`commissions:configure`) | Inspect auditable non-acceptance penalty ledger (`outlet_penalties`) and configure timeout/grace/penalty parameters |
| `GET/POST/PATCH` | `/api/v1/admin/promotions`, `/api/v1/admin/coupons` | `PLATFORM_ADMIN` (`promotions:manage`) | Create/manage promotional campaigns and coupon rules (`FR-099`) |
| `GET/POST/PATCH` | `/api/v1/admin/service-zones` | `PLATFORM_ADMIN` (`zones:manage`) | Manage PostGIS polygon service areas (`SRS Section 3.4`) |
| `GET/PATCH` | `/api/v1/admin/complaints`, `/api/v1/admin/complaints/:id/resolve` | `CUSTOMER_CARE`, `PLATFORM_ADMIN` (`complaints:resolve`) | Review customer complaints, chat thread, and trigger resolution/refund (`FR-100`) |
| `GET` | `/api/v1/admin/reports/overview` | `PLATFORM_ADMIN` (`reports:view`) | GMV, order conversion, cancellation rates, SLA metrics, settlement totals (`FR-101`) |
| `GET` | `/api/v1/admin/audit-logs` | `PLATFORM_ADMIN` (`audit_logs:view`) | Immutable chronological log of all sensitive admin and Customer Care actions (`FR-102`) |
| `GET/PUT` | `/api/v1/admin/settings` | `PLATFORM_ADMIN` (`settings:manage`) | Platform-wide operational toggles, 5-minute acceptance timeout, grace period, and rating-edit window (`SRS Section 3.4`) |

---

## 3. WebSocket Protocol Specification (`WSS /api/v1/ws`)

### 3.1 Connection & Room Subscription
- **URL**: `wss://<host>/api/v1/ws?ticket=<single_use_ticket>`
- **Client $\rightarrow$ Server Frames**:
  ```json
  // 1. Subscribe to authorised room
  { "type": "room.subscribe", "payload": { "room": "order:018f6a90-0500-7000-8000-000000000500" } }

  // 2. Delivery Partner GPS Location Update (Max 1 frame per 2 seconds; rate-limited FR-067)
  {
    "type": "tracking.ping_location",
    "payload": {
      "delivery_id": "018f6a90-0700-7000-8000-000000000700",
      "lat": 40.679512,
      "lng": -73.945891,
      "speed_mps": 6.4,
      "bearing_degrees": 142.0,
      "accuracy_meters": 8.5,
      "recorded_at": "2026-11-10T23:28:15Z"
    }
  }
  ```

- **Server $\rightarrow$ Client Event Frames**:
  ```json
  // 1. Order Status Transition (Sent to order:{id}, restaurant:{id}, admin:live)
  {
    "type": "order.status_updated",
    "event_id": "018f6a90-0900-7000-8000-000000000901",
    "timestamp": "2026-11-10T23:25:00Z",
    "payload": {
      "order_id": "018f6a90-0500-7000-8000-000000000500",
      "order_number": "GD-20261110-8F4A",
      "order_status": "PREPARING",
      "payment_status": "CAPTURED",
      "delivery_status": "PARTNER_ASSIGNED",
      "version": 4,
      "estimated_delivery_at": "2026-11-10T23:45:00Z"
    }
  }

  // 2. Live Delivery Location & ETA Broadcast (Sent to order:{id}, admin:live)
  {
    "type": "tracking.location_updated",
    "timestamp": "2026-11-10T23:28:15Z",
    "payload": {
      "order_id": "018f6a90-0500-7000-8000-000000000500",
      "delivery_id": "018f6a90-0700-7000-8000-000000000700",
      "lat": 40.679512,
      "lng": -73.945891,
      "bearing_degrees": 142.0,
      "eta_minutes": 9,
      "distance_remaining_meters": 1450
    }
  }

  // 3. Incoming Order Alert (Sent to restaurant:{id})
  {
    "type": "restaurant.new_order",
    "timestamp": "2026-11-10T23:20:45Z",
    "payload": {
      "order_id": "018f6a90-0500-7000-8000-000000000500",
      "order_number": "GD-20261110-8F4A",
      "item_count": 2,
      "total_minor": 2459,
      "accept_deadline_at": "2026-11-10T23:25:45Z"
    }
  }

  // 4. Delivery Assignment Offer (Sent to partner:{id})
  {
    "type": "delivery.offer_received",
    "timestamp": "2026-11-10T23:22:10Z",
    "payload": {
      "assignment_id": "018f6a90-0800-7000-8000-000000000800",
      "order_number": "GD-20261110-8F4A",
      "restaurant_name": "Sunday Table",
      "pickup_address": "241 Smith St, Brooklyn, NY",
      "dropoff_neighborhood": "Park Slope, Brooklyn",
      "distance_to_pickup_meters": 650,
      "total_trip_meters": 2100,
      "estimated_payout_minor": 650,
      "expires_at": "2026-11-10T23:22:55Z"
    }
  }
  ```
