CREATE TABLE promotional_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    description TEXT NULL,
    banner_text VARCHAR(255) NULL,
    funded_by VARCHAR(32) NOT NULL DEFAULT 'PLATFORM' CHECK (funded_by IN ('PLATFORM', 'RESTAURANT', 'SHARED')),
    restaurant_share_bps INT NOT NULL DEFAULT 0 CHECK (restaurant_share_bps BETWEEN 0 AND 10000),
    budget_limit_minor BIGINT NULL,
    budget_spent_minor BIGINT NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES promotional_campaigns(id) ON DELETE CASCADE,
    restaurant_id UUID NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    code VARCHAR(40) UNIQUE NOT NULL,
    title VARCHAR(180) NULL,
    discount_type VARCHAR(24) NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FLAT_AMOUNT', 'FREE_DELIVERY')),
    discount_value BIGINT NOT NULL CHECK (discount_value >= 0),
    max_discount_minor BIGINT NULL,
    min_order_subtotal_minor BIGINT NOT NULL DEFAULT 0,
    first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
    max_total_uses INT NULL,
    current_uses INT NOT NULL DEFAULT 0,
    max_uses_per_user INT NOT NULL DEFAULT 1,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE delivery_charge_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_zone_id UUID NULL REFERENCES service_zones(id) ON DELETE CASCADE,
    min_cart_threshold_minor BIGINT NOT NULL DEFAULT 29900,
    small_cart_fee_minor BIGINT NOT NULL DEFAULT 2900,
    base_fee_minor BIGINT NOT NULL DEFAULT 2900,
    base_distance_meters INT NOT NULL DEFAULT 2000,
    per_km_fee_minor BIGINT NOT NULL DEFAULT 800,
    free_delivery_threshold_minor BIGINT NULL DEFAULT 59900,
    surge_multiplier_bps INT NOT NULL DEFAULT 10000,
    partner_base_payout_minor BIGINT NOT NULL DEFAULT 3500,
    partner_per_km_payout_minor BIGINT NOT NULL DEFAULT 1000,
    partner_daily_payout_fee_config JSONB NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE commission_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_zone_id UUID NULL REFERENCES service_zones(id) ON DELETE CASCADE,
    default_commission_bps INT NOT NULL DEFAULT 2000 CHECK (default_commission_bps BETWEEN 0 AND 5000),
    calculation_basis VARCHAR(40) NOT NULL DEFAULT 'GROSS_FOOD_SUBTOTAL' CHECK (calculation_basis IN ('GROSS_FOOD_SUBTOTAL', 'NET_AFTER_OUTLET_DISCOUNT', 'SUBTOTAL_PLUS_PACKAGING')),
    tax_rate_bps INT NOT NULL DEFAULT 500,
    platform_fee_minor BIGINT NOT NULL DEFAULT 900,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL
);
