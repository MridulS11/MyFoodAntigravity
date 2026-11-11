CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider VARCHAR(32) NOT NULL CHECK (provider IN ('RAZORPAY', 'CASHFREE', 'STRIPE', 'COD')),
    provider_order_id VARCHAR(128) UNIQUE NULL,
    provider_payment_id VARCHAR(128) UNIQUE NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(32) NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
    payment_instrument VARCHAR(64) NULL,
    failure_code VARCHAR(64) NULL,
    failure_message TEXT NULL,
    captured_at TIMESTAMPTZ NULL,
    reconciled_at TIMESTAMPTZ NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_payments_active_order ON payments (order_id) WHERE status IN ('INITIATED', 'AUTHORIZED', 'CAPTURED');
CREATE INDEX idx_payments_unreconciled ON payments (status, created_at) WHERE status IN ('INITIATED', 'AUTHORIZED');
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    provider VARCHAR(32) NOT NULL,
    provider_event_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    amount_minor BIGINT NOT NULL,
    raw_payload JSONB NOT NULL,
    signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_tx_provider_event UNIQUE (provider, provider_event_id)
);

CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    provider_refund_id VARCHAR(128) UNIQUE NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    refund_type VARCHAR(24) NOT NULL CHECK (refund_type IN ('FULL', 'PARTIAL')),
    reason_code VARCHAR(64) NOT NULL,
    notes TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED')),
    initiated_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    initiated_by_role VARCHAR(32) NOT NULL,
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_refunds_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE restaurant_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    gross_food_amount_minor BIGINT NOT NULL,
    packaging_fee_minor BIGINT NOT NULL DEFAULT 0,
    restaurant_promo_discount_minor BIGINT NOT NULL DEFAULT 0,
    commission_calculation_basis_snapshot VARCHAR(40) NOT NULL DEFAULT 'GROSS_FOOD_SUBTOTAL',
    commissionable_base_amount_minor BIGINT NOT NULL,
    platform_commission_bps INT NOT NULL DEFAULT 2000,
    platform_commission_minor BIGINT NOT NULL,
    penalty_deduction_minor BIGINT NOT NULL DEFAULT 0,
    tax_withheld_minor BIGINT NOT NULL DEFAULT 0,
    net_payout_minor BIGINT NOT NULL,
    settlement_status VARCHAR(32) NOT NULL DEFAULT 'ACCRUED' CHECK (settlement_status IN ('ACCRUED', 'PAYOUT_SCHEDULED', 'PAID', 'REVERSED')),
    payout_batch_id VARCHAR(64) NULL,
    settled_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE delivery_partner_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID UNIQUE NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    partner_id UUID NOT NULL REFERENCES delivery_partners(id) ON DELETE RESTRICT,
    base_payout_minor BIGINT NOT NULL,
    per_km_rate_snapshot_minor BIGINT NOT NULL DEFAULT 1000,
    distance_meters_snapshot INT NOT NULL DEFAULT 0,
    distance_payout_minor BIGINT NOT NULL DEFAULT 0,
    surge_bonus_minor BIGINT NOT NULL DEFAULT 0,
    tip_amount_minor BIGINT NOT NULL DEFAULT 0,
    gross_earning_minor BIGINT NOT NULL,
    daily_payout_fee_minor BIGINT NOT NULL DEFAULT 0,
    net_earning_minor BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'CREDITED' CHECK (status IN ('CREDITED', 'PAID', 'ADJUSTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE financial_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    reference_type VARCHAR(32) NOT NULL CHECK (reference_type IN ('PAYMENT_CAPTURE', 'REFUND', 'SETTLEMENT_ACCRUAL', 'OUTLET_PENALTY', 'PARTNER_EARNING')),
    reference_id UUID NOT NULL,
    debit_account VARCHAR(64) NOT NULL,
    credit_account VARCHAR(64) NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
