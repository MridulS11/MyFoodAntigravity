CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(24) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    service_zone_id UUID NOT NULL REFERENCES service_zones(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) NOT NULL,
    order_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (order_status IN (
        'PENDING_PAYMENT', 'CONFIRMED', 'RESTAURANT_ACCEPTED', 'RESTAURANT_REJECTED',
        'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED',
        'CANCELLATION_REQUESTED', 'CANCELLED'
    )),
    payment_status VARCHAR(32) NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN (
        'UNPAID', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED',
        'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'
    )),
    delivery_status VARCHAR(32) NOT NULL DEFAULT 'ASSIGNMENT_PENDING' CHECK (delivery_status IN (
        'NOT_APPLICABLE', 'ASSIGNMENT_PENDING', 'PARTNER_OFFERED', 'PARTNER_ASSIGNED',
        'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_CUSTOMER',
        'DELIVERED', 'UNASSIGNABLE', 'CANCELLED'
    )),
    payment_method VARCHAR(32) NOT NULL CHECK (payment_method IN ('ONLINE', 'COD')),
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    item_subtotal_minor BIGINT NOT NULL CHECK (item_subtotal_minor >= 0),
    small_cart_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (small_cart_fee_minor >= 0),
    min_cart_threshold_snapshot_minor BIGINT NOT NULL DEFAULT 29900,
    packaging_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (packaging_fee_minor >= 0),
    delivery_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
    platform_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),
    discount_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount_minor >= 0),
    tax_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount_minor >= 0),
    tip_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (tip_amount_minor >= 0),
    total_payable_minor BIGINT NOT NULL CHECK (total_payable_minor >= 0),
    commission_rate_bps_snapshot INT NOT NULL DEFAULT 2000,
    commission_basis_snapshot VARCHAR(40) NOT NULL DEFAULT 'GROSS_FOOD_SUBTOTAL',
    coupon_id UUID NULL REFERENCES coupons(id) ON DELETE SET NULL,
    coupon_code_snapshot VARCHAR(40) NULL,
    delivery_address_snapshot JSONB NOT NULL,
    delivery_location GEOGRAPHY(Point, 4326) NOT NULL,
    pickup_location GEOGRAPHY(Point, 4326) NOT NULL,
    road_distance_meters INT NOT NULL DEFAULT 0,
    special_instructions TEXT NULL,
    estimated_prep_minutes SMALLINT NOT NULL DEFAULT 20,
    estimated_delivery_at TIMESTAMPTZ NULL,
    confirmed_at TIMESTAMPTZ NULL,
    accept_deadline_at TIMESTAMPTZ NULL,
    customer_care_alerted_at TIMESTAMPTZ NULL,
    grace_deadline_at TIMESTAMPTZ NULL,
    acceptance_escalation_state VARCHAR(32) NOT NULL DEFAULT 'NONE' CHECK (acceptance_escalation_state IN ('NONE', 'CUSTOMER_CARE_ALERTED', 'GRACE_PERIOD', 'PENALTY_APPLIED')),
    accepted_at TIMESTAMPTZ NULL,
    prepared_at TIMESTAMPTZ NULL,
    picked_up_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    cancellation_reason TEXT NULL,
    cancelled_by_role VARCHAR(32) NULL,
    rating_prompt_status VARCHAR(24) NOT NULL DEFAULT 'PENDING_DELIVERY' CHECK (rating_prompt_status IN ('PENDING_DELIVERY', 'ELIGIBLE_ON_APP_OPEN', 'PROMPT_DISMISSED', 'RATED')),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_orders_customer_idempotency UNIQUE (customer_id, idempotency_key)
);

CREATE INDEX idx_orders_customer_created ON orders (customer_id, created_at DESC);
CREATE INDEX idx_orders_customer_rating_prompt ON orders (customer_id, rating_prompt_status) WHERE rating_prompt_status = 'ELIGIBLE_ON_APP_OPEN';
CREATE INDEX idx_orders_restaurant_active ON orders (restaurant_id, order_status, created_at DESC);
CREATE INDEX idx_orders_acceptance_timeout ON orders (accept_deadline_at, grace_deadline_at) WHERE order_status = 'CONFIRMED';
CREATE INDEX idx_orders_pending_payment_timeout ON orders (created_at) WHERE order_status = 'PENDING_PAYMENT';
CREATE INDEX idx_orders_admin_live ON orders (service_zone_id, order_status, delivery_status);
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupon_usages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    discount_applied_minor BIGINT NOT NULL CHECK (discount_applied_minor >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'REDEEMED', 'RELEASED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coupon_usages_user_coupon ON coupon_usages (coupon_id, user_id) WHERE status IN ('RESERVED', 'REDEEMED');

CREATE TABLE outlet_penalties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    reason_code VARCHAR(64) NOT NULL DEFAULT 'ACCEPTANCE_TIMEOUT_AFTER_GRACE',
    penalty_rule_snapshot JSONB NOT NULL,
    penalty_amount_minor BIGINT NOT NULL CHECK (penalty_amount_minor >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    order_resolution_policy VARCHAR(40) NOT NULL DEFAULT 'AUTO_CANCEL_AND_REFUND',
    status VARCHAR(24) NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED', 'DEDUCTED_FROM_SETTLEMENT', 'WAIVED')),
    waived_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    waiver_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
    item_name_snapshot VARCHAR(160) NOT NULL,
    quantity SMALLINT NOT NULL CHECK (quantity > 0),
    unit_base_price_minor BIGINT NOT NULL,
    unit_customizations_price_minor BIGINT NOT NULL DEFAULT 0,
    line_total_minor BIGINT NOT NULL
);

CREATE TABLE order_item_customizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    option_id UUID NULL REFERENCES menu_customization_options(id) ON DELETE SET NULL,
    group_name_snapshot VARCHAR(120) NOT NULL,
    option_name_snapshot VARCHAR(120) NOT NULL,
    price_delta_minor BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_order_status VARCHAR(32) NULL,
    to_order_status VARCHAR(32) NOT NULL,
    from_payment_status VARCHAR(32) NULL,
    to_payment_status VARCHAR(32) NOT NULL,
    from_delivery_status VARCHAR(32) NULL,
    to_delivery_status VARCHAR(32) NOT NULL,
    actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(32) NOT NULL,
    reason TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_status_history_order ON order_status_history (order_id, created_at ASC);
