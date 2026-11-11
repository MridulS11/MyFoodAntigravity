# Risk, Concurrency & Consistency Design — Goodly Platform

## 1. Core Consistency Invariants (SRS Section 5.3 & 8.2)

1. **PostgreSQL Is the Sole System of Record**: Every financial figure, order state, inventory count, and delivery assignment is durably committed in PostgreSQL before any external confirmation is returned. Redis is never authoritative (`SRS Section 7.3`).
2. **Single Owner of Order State**: Only the `orders` module may execute `INSERT` or `UPDATE` statements against the `orders` and `order_status_history` tables (`SRS Section 5.3`).
3. **Consistency Over Ambiguity**: When concurrent operations conflict (e.g., a customer clicks Cancel at the exact millisecond a restaurant clicks Start Preparing), the backend serializes the two requests at the database row level; the first commits and the second receives a deterministic `409 CONFLICT` with the updated order state (`NFR-019`).

---

## 2. Summary Matrix of Reliability Mechanisms

| Mechanism | Where Required | Enforcement Layer |
| :--- | :--- | :--- |
| **Database ACID Transactions** | Order creation, payment verification, restaurant accept/reject, delivery offer acceptance, delivery completion, cancellation & refund initiation | PostgreSQL `BEGIN ... COMMIT` via `TxManager.WithTx(ctx)` |
| **HTTP Idempotency Keys** | `POST /api/v1/orders`, `POST /api/v1/payments/initiate`, `POST /api/v1/orders/:id/cancel`, `POST /api/v1/admin/refunds` | `idempotency_records` table + `UNIQUE (customer_id, idempotency_key)` on `orders` |
| **Pessimistic Row Locking (`SELECT ... FOR UPDATE`)** | Inventory reservation, coupon usage increment, order cancellation vs. preparation race, delivery assignment claim | PostgreSQL row-level locks acquired in deterministic PK order |
| **Optimistic Concurrency (`version` column)** | Order state transitions (`orders.version`), payment status transitions (`payments.version`), delivery progression (`deliveries.version`) | `UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $2` |
| **Transactional Outbox** | All cross-module domain events (`order.created`, `payment.captured`, `order.restaurant_accepted`, `order.cancelled`, `delivery.assigned`, `order.delivered`) | `outbox_events` written in the same PostgreSQL transaction as the state change |
| **Consumer Deduplication** | Every RabbitMQ consumer handler (`q.orders.notifications`, `q.delivery.dispatch`, `q.payments.refunds`, `q.finance.settlements`) | `INSERT INTO processed_messages (message_id, consumer_group) ON CONFLICT DO NOTHING` |
| **Bounded Retries & DLQ** | Asynchronous RabbitMQ consumers and outbound webhook/notification calls | Exponential backoff retry queues (`5s`, `30s`, `300s`, max 5 attempts) $\rightarrow$ `goodly.dlq` |
| **Active Reconciliation Jobs** | Stuck `PENDING_PAYMENT` orders, stuck `PROCESSING` refunds, expired `OFFERED` delivery assignments, un-relayed `outbox_events` | Scheduled background workers in `cmd/worker` |

---

## 3. Detailed Handling of the 11 Critical Failure & Race Scenarios

### Scenario 1: Duplicate Order Submissions (`NFR-011`)
- **Trigger**: A customer double-clicks "Place Order & Pay", experiences a flaky mobile network retry, or refreshes during checkout submission.
- **Protection Mechanism**:
  1. The frontend generates a deterministic UUIDv4 `Idempotency-Key` when entering the checkout confirmation step and attaches it to `POST /api/v1/orders`.
  2. Inside a PostgreSQL transaction, the backend executes:
     ```sql
     INSERT INTO idempotency_records (user_id, idempotency_key, request_path, request_hash, locked_until)
     VALUES ($1, $2, '/api/v1/orders', $3, NOW() + INTERVAL '60 seconds')
     ON CONFLICT (user_id, idempotency_key) DO NOTHING;
     ```
  3. If `0 rows` are inserted:
     - If the existing record has `response_status IS NOT NULL`, the backend immediately returns the cached `201 Created` order payload without re-running business logic.
     - If `response_status IS NULL` (first request is still in flight), the backend returns `409 REQUEST_IN_PROGRESS`.
     - If the client sends the same `Idempotency-Key` with a different `request_hash` (different payload), the backend returns `422 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
  4. As a second hard database barrier, the `orders` table enforces `CONSTRAINT uq_orders_customer_idempotency UNIQUE (customer_id, idempotency_key)`.

---

### Scenario 2: Duplicate Payment Callbacks (`FR-044`, `NFR-012`)
- **Trigger**: Both the frontend `POST /api/v1/payments/verify` callback and the payment gateway's server-to-server webhook (`POST /api/v1/payments/webhooks/:provider`) arrive simultaneously, or the gateway delivers the same `payment.captured` webhook 3 times.
- **Protection Mechanism**:
  1. **Cryptographic Verification First**: Both endpoints verify the gateway's HMAC-SHA256 signature before touching the database.
  2. **Event Deduplication**: Webhook events insert into `payment_transactions` with `UNIQUE (provider, provider_event_id)`. Duplicate deliveries hit the conflict constraint and immediately return `200 OK` to stop gateway retries.
  3. **Serialized State Transition**: Inside the DB transaction, the handler locks `SELECT id, status, order_id FROM payments WHERE provider_order_id = $1 FOR UPDATE`.
     - If `payments.status == 'CAPTURED'`, the transaction is a no-op and returns `200 OK` (`idempotent success`).
     - If `payments.status IN ('INITIATED', 'AUTHORIZED', 'FAILED')`, it transitions `payments.status = 'CAPTURED'`, transitions `orders.payment_status = 'CAPTURED'` and `orders.order_status = 'CONFIRMED'`, writes `order_status_history`, clears the customer's active cart, and inserts `outbox_events (event_type = 'order.confirmed')`.

---

### Scenario 3: Payment Success with Order-Update Failure (`FR-048`, `NFR-015`, `NFR-018`)
- **Trigger**: The customer's money is debited at the payment gateway, but the customer's browser closes before calling `/verify` AND our server experiences a temporary restart/network blip when the gateway webhook fires.
- **Protection Mechanism (3-Layer Defense)**:
  ```mermaid
  sequenceDiagram
      participant GW as Payment Gateway
      participant API as Go Webhook Handler
      participant PG as PostgreSQL
      participant Recon as Payment Reconciler (cmd/worker)

      Note over GW,API: Layer 1: Atomic DB Commit of Payment + Order State
      GW->>API: Webhook (payment.captured)
      API->>PG: Single ACID Tx: Update payments + Update orders + Insert outbox_events
      alt DB Commit Fails (Transient Error)
          API-->>GW: Return 500 Internal Error (Gateway automatically retries webhook with backoff)
      end

      Note over GW,Recon: Layer 2: Active Polling Reconciliation Worker (Every 2 mins)
      Recon->>PG: SELECT * FROM payments WHERE status IN ('INITIATED','AUTHORIZED') AND created_at < NOW() - INTERVAL '3 minutes'
      loop For each unresolved payment
          Recon->>GW: GET /v1/orders/{provider_order_id}/payments
          alt Gateway reports CAPTURED
              Recon->>PG: Execute same ACID Capture + Order Confirm Tx (sets reconciled_at = NOW())
          else Gateway reports FAILED and Order > 15m old
              Recon->>PG: Mark payment FAILED, Order CANCELLED, release reserved inventory
          end
      end
  ```
  - **Layer 3 (Late Payment on Expired Order)**: If an order expired after 15 minutes (`order_status == 'CANCELLED'`) and a late bank capture webhook arrives afterward, the state machine detects `orders.order_status == 'CANCELLED'` and automatically creates a `refunds` record (`reason_code = 'LATE_CAPTURE_ON_EXPIRED_ORDER'`) and queues an immediate full refund via `outbox_events` so the customer is never charged for an unfulfilled order.

---

### Scenario 4: Concurrent Outlet Order Acceptance & 5-Minute Acceptance Timeout Escalation (`SRS Section 5.2 & 5.3`, Final Business Decisions §4)
- **Trigger**:
  - *Race A*: Two kitchen tablets logged into the same outlet click "Accept" (or one clicks "Accept" while another clicks "Reject") simultaneously.
  - *Race B*: An outlet fails to respond within the **5-minute default acceptance timeout** (`accept_deadline_at`), triggering a **Customer Care alert** (`CUSTOMER_CARE_ALERTED`) and a **configurable grace period** (`grace_deadline_at`), and the outlet clicks "Accept" at the exact millisecond the grace-period expiration worker applies the non-acceptance penalty (`outlet_penalties`).
- **Protection Mechanism**:
  - **Two-Stage Timeout & Grace-Period Escalation**:
    1. When an order enters `CONFIRMED`, `accept_deadline_at = NOW() + INTERVAL '5 minutes'` (configurable by `PLATFORM_ADMIN`).
    2. If `order_status == 'CONFIRMED'` at `accept_deadline_at`, the background timeout worker sets `acceptance_escalation_state = 'CUSTOMER_CARE_ALERTED'`, `customer_care_alerted_at = NOW()`, and `grace_deadline_at = NOW() + $grace_period_seconds`, and pushes a high-priority alert to the **Customer Care** portal (`ws:care:alerts`).
    3. If the outlet still fails to respond by `grace_deadline_at`, the worker locks `SELECT * FROM orders WHERE id = $1 FOR UPDATE`, verifies `order_status == 'CONFIRMED'`, records an auditable penalty row in `outlet_penalties`, updates the customer with accurate status, and executes the configured resolution policy.
  - **Optimistic & Row-Level Serialization**:
    ```sql
    UPDATE orders
    SET order_status = 'RESTAURANT_ACCEPTED',
        accepted_at = NOW(),
        estimated_prep_minutes = $4,
        version = version + 1,
        updated_at = NOW()
    WHERE id = $1
      AND restaurant_id = $2
      AND order_status = 'CONFIRMED'
      AND version = $3
    RETURNING id, version;
    ```
  - Exactly one transaction matches `order_status = 'CONFIRMED' AND version = $3` and commits. Any concurrent tablet click or timeout worker transaction affects `0 rows`, rolls back, and returns `409 ORDER_STATE_CONFLICT`.

---

### Scenario 5: Inventory Changes During Checkout (`FR-020`, `NFR-014`)
- **Trigger**: A restaurant has only `1` portion of `Burrata & tomatoes` remaining (or manually toggles `Sunday rigatoni` to Out of Stock in the KDS) while two customers are on the Checkout page simultaneously.
- **Protection Mechanism**:
  1. **Pre-Checkout Validation (`POST /api/v1/cart/validate-checkout`)**: Queries PostgreSQL directly (bypassing Redis) to verify `restaurants.is_accepting_orders = TRUE`, `menu_items.is_available = TRUE`, and `menu_item_inventory.available_quantity >= cart_qty`.
  2. **Atomic Lock & Reservation During Order Creation (`POST /api/v1/orders`)**:
     - Inside the order creation transaction, requested `menu_item_id`s are sorted in ascending UUID order (preventing multi-item deadlocks) and locked via:
       ```sql
       SELECT mi.id, mi.is_available, mi.base_price_minor, inv.track_inventory, inv.available_quantity
       FROM menu_items mi
       LEFT JOIN menu_item_inventory inv ON inv.menu_item_id = mi.id
       WHERE mi.id = ANY($1::uuid[])
       ORDER BY mi.id ASC
       FOR UPDATE;
       ```
     - If any item has `is_available = FALSE` or `(track_inventory = TRUE AND available_quantity < requested_qty)`, the entire transaction rolls back and returns `409 ITEM_OUT_OF_STOCK` naming the specific dish.
     - Otherwise, `available_quantity` is decremented and `reserved_quantity` is incremented inside the same transaction. If `available_quantity` reaches `0`, `menu_items.is_available` is flipped to `FALSE` and Redis cache `cache:restaurant:{id}:menu` is invalidated.
     - If payment subsequently fails or times out after 15 minutes, the expiration worker restores `available_quantity` and decrements `reserved_quantity`.

---

### Scenario 6: Cancellation and Refund Races (`FR-037`, `FR-045`, `NFR-015`)
- **Trigger**: A customer requests order cancellation at the exact moment the restaurant transitions the order to `PREPARING` (where free cancellation policy changes), or an Admin and the automated system both trigger a refund for the same cancelled order.
- **Protection Mechanism**:
  1. **Row-Level Serialization on `orders`**: Both cancellation and restaurant status endpoints acquire `SELECT * FROM orders WHERE id = $1 FOR UPDATE` first.
  2. **Deterministic Cancellation Policy Evaluation**: Once the lock is held, the cancellation service inspects the locked `order_status`:
     - If `order_status IN ('PENDING_PAYMENT', 'CONFIRMED')`: Immediate cancellation allowed (`100%` refund if paid).
     - If `order_status IN ('RESTAURANT_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY')`: Follows configured stage policy (confirmed with owner in `REQUIREMENTS_CLARIFICATIONS.md` — e.g., requires Admin/Support intervention or applies cancellation fee).
  3. **Double-Refund Prevention**:
     - Before inserting into `refunds`, the transaction locks `SELECT * FROM payments WHERE order_id = $1 FOR UPDATE` and sums existing non-failed refunds: `SELECT COALESCE(SUM(amount_minor), 0) FROM refunds WHERE payment_id = $1 AND status != 'FAILED'`.
     - A check enforces `existing_refunded_minor + new_refund_minor <= payments.amount_minor`.
     - Furthermore, each refund passes a deterministic `idempotency_key` (`refund:order:{order_id}:full`) to both the `refunds` table (`UNIQUE (idempotency_key)`) and the payment gateway Refund API.

---

### Scenario 7: Duplicate Message Delivery in RabbitMQ (`NFR-017`)
- **Trigger**: RabbitMQ delivers messages with **at-least-once** semantics; a network glitch during `BasicAck` or worker restart causes `order.confirmed` or `order.delivered` to be redelivered.
- **Protection Mechanism**:
  - Every published message carries a stable UUID `message_id` equal to `outbox_events.id`.
  - Every consumer (`cmd/worker`) wraps its handler in a PostgreSQL transaction that begins with:
    ```sql
    INSERT INTO processed_messages (message_id, consumer_group, processed_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (message_id, consumer_group) DO NOTHING
    RETURNING message_id;
    ```
  - If `RETURNING` yields no row, the consumer knows this exact message was already committed by `consumer_group`, commits the no-op transaction, and sends `BasicAck` to RabbitMQ.
  - Additionally, downstream domain operations (`restaurant_settlements` has `UNIQUE (order_id)`, `delivery_partner_earnings` has `UNIQUE (delivery_id)`) have natural schema idempotency constraints.

---

### Scenario 8: Redis Cache Invalidation & Redis Failure Recovery (`SRS Section 2.4 & 7.3`)
- **Trigger**: A menu price or restaurant availability changes in PostgreSQL, or the Redis instance restarts/flushes memory.
- **Protection Mechanism**:
  1. **Dual Eviction**: Menu/restaurant writes evict `cache:restaurant:{id}:*` synchronously after DB commit AND emit an outbox event consumed by `q.cache.invalidation` for guaranteed eventual eviction.
  2. **Cache-Aside Fallback on Redis Outage**: If Redis is unreachable or empty after a restart:
     - Read APIs (`discovery`, `menu`) log a warning metric (`redis_cache_miss_or_error_total`) and fall back transparently to PostgreSQL queries.
     - Checkout, Order, and Payment mutations never depend on cached data in Redis.
     - Online delivery partners automatically repopulate `delivery:active_partners` within `3–5 seconds` on their next regular GPS heartbeat ping.

---

### Scenario 9: Simultaneous Broadcast Delivery Offers, Atomic First-Accept & OTP Proof of Delivery (`FR-054`–`FR-058`, `NFR-013`, Final Business Decisions §5 & §7)
- **Trigger**:
  - *Race A (Simultaneous Broadcast Acceptance)*: All eligible delivery partners (`ONLINE_AVAILABLE`, verified, not busy, within zone/radius) receive the same delivery offer **simultaneously**. Three partners click "Accept" within 5 milliseconds of one another.
  - *Race B (Reassignment / Unassignable Escalation)*: An assigned partner cancels before pickup, or all broadcast offers expire without acceptance (`FR-057`, `FR-058`).
  - *Security Invariant (OTP Proof of Delivery)*: A delivery partner attempts to mark an online or COD order `DELIVERED` without customer OTP or brute-forces OTP codes.
- **Protection Mechanism**:
  ```mermaid
  sequenceDiagram
      participant Disp as Broadcast Dispatch Worker
      participant PG as PostgreSQL
      participant PA as Partner A
      participant PB as Partner B
      participant Admin as Customer Care / Admin Live Ops

      Disp->>PG: Insert 'OFFERED' delivery_assignments for ALL eligible partners (PA, PB, PC...)
      Note over PA,PB: Partner A and Partner B click Accept simultaneously
      par Partner A Accept Request
          PA->>PG: SELECT * FROM deliveries WHERE id=$1 FOR UPDATE
          PA->>PG: Verify partner_id IS NULL & assignment='OFFERED' & expires_at > NOW()
          PA->>PG: Set deliveries.partner_id=PA, mark PA assignment='ACCEPTED', mark PA 'ON_DELIVERY' (busy)
          PA->>PG: UPDATE delivery_assignments SET status='SUPERSEDED' WHERE delivery_id=$1 AND id != PA_assign_id
      and Partner B Accept Request
          PB->>PG: SELECT * FROM deliveries WHERE id=$1 FOR UPDATE (Blocks until PA commits)
          PB-->>PB: Sees deliveries.partner_id IS NOT NULL -> Returns 409 OFFER_ALREADY_CLAIMED
      end

      Note over Disp,Admin: Reassignment or All Broadcast Waves Expired
      alt Assigned Partner Cancels / Invalidated
          Disp->>PG: Clear deliveries.partner_id, increment reassignment_count, broadcast fresh wave to eligible partners
      else No Partner Accepts After Broadcast Waves
          Disp->>PG: UPDATE deliveries SET status='UNASSIGNABLE'; UPDATE orders SET delivery_status='UNASSIGNABLE'
          Disp->>Admin: Emit high-priority WebSocket alert to Customer Care & Admin Attention Queue
      end
  ```
  - **Mandatory Backend-Controlled OTP Proof of Delivery**:
    - Every order (both `ONLINE` and `COD`) generates a cryptographically random OTP whose HMAC-SHA256 hash is stored in `delivery_otps` (`expires_at`, `max_attempts = 5`, `rate_limited_until`).
    - `PATCH .../deliveries/:id/status` strictly rejects `status = 'DELIVERED'`. Completion requires `POST /api/v1/delivery/me/deliveries/:id/verify-otp`, which locks `delivery_otps FOR UPDATE`, enforces rate-limiting on failed attempts, consumes the single-use OTP (`verified_at = NOW()`), and only then transitions `deliveries` and `orders` to `DELIVERED` (unless overridden via the separately authorized `POST /api/v1/care/deliveries/:id/override-otp` endpoint with mandatory audit log).

---

### Scenario 10: WebSocket Disconnections (`FR-066`)
- **Trigger**: Customer or Restaurant browser switches Wi-Fi/cellular networks, puts tab to sleep, or load balancer rotates a `cmd/ws` container.
- **Protection Mechanism**:
  1. **Client Heartbeat & Auto-Reconnect**: Client detects missed `PING`/`PONG` within 10s and reconnects using exponential backoff (`1s, 2s, 4s, 8s, max 15s` with random jitter).
  2. **Mandatory State Reconciliation on Reconnect**: Because WebSockets are an ephemeral push transport (not a durable queue), every time the client `WebSocketManager` establishes or re-establishes a connection, it immediately triggers TanStack Query refetches for active resources (`GET /api/v1/orders/:id`, `GET /api/v1/tracking/orders/:id`, `GET /api/v1/restaurants/me/orders`). This guarantees that even if an order transitioned from `PREPARING` $\rightarrow$ `READY_FOR_PICKUP` while the client was offline for 20 seconds, the UI immediately snaps to the authoritative PostgreSQL state upon reconnection.

---

### Scenario 11: Recovery After Server Restarts (`NFR-018`, `SRS Section 8.3`)
- **Trigger**: An application container (`cmd/api`, `cmd/ws`, or `cmd/worker`) crashes (`SIGKILL`/`OOM`) or is rolling-restarted during deployment while transactions or background workflows are mid-flight.
- **Protection Mechanism**:
  1. **Uncommitted PostgreSQL Transactions**: Automatically rolled back by PostgreSQL upon TCP connection drop; no partial order or payment records can exist (`NFR-009`).
  2. **Committed DB Transaction Before Outbox Publish**: If `cmd/api` committed the order and `outbox_events` row (`status = 'PENDING'`) and crashed 1 millisecond later, the `OutboxRelay` in `cmd/worker` picks up the `PENDING` row on its next 200ms tick and publishes it to RabbitMQ. Zero events are lost.
  3. **RabbitMQ Consumer Crash Mid-Processing**: Because consumers use **manual acknowledgements** (`autoAck = false`) and only send `BasicAck` *after* committing their PostgreSQL transaction (including `processed_messages`), RabbitMQ automatically redelivers any unacknowledged message to another healthy `cmd/worker` instance as soon as the dead consumer's AMQP channel closes.
  4. **In-Flight Delivery Offers Across Restarts**: Offer deadlines (`expires_at TIMESTAMPTZ`) are persisted in PostgreSQL (`delivery_assignments`), not held in Go memory timers (`time.AfterFunc`). On startup and every 5 seconds, `cmd/worker` queries `WHERE status = 'OFFERED' AND expires_at <= NOW() FOR UPDATE SKIP LOCKED` and triggers re-dispatch deterministically.
