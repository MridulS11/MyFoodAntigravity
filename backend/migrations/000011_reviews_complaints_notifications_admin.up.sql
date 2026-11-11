CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
    partner_id UUID NULL REFERENCES delivery_partners(id) ON DELETE SET NULL,
    restaurant_rating SMALLINT NOT NULL CHECK (restaurant_rating BETWEEN 1 AND 5),
    delivery_partner_rating SMALLINT NULL CHECK (delivery_partner_rating BETWEEN 1 AND 5),
    restaurant_comment TEXT NULL,
    delivery_partner_comment TEXT NULL,
    restaurant_reply TEXT NULL,
    replied_at TIMESTAMPTZ NULL,
    edit_count SMALLINT NOT NULL DEFAULT 0,
    editable_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_item_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID UNIQUE NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_order_item_ratings_updated_at BEFORE UPDATE ON order_item_ratings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(24) UNIQUE NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    raised_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category VARCHAR(64) NOT NULL CHECK (category IN ('MISSING_ITEM', 'WRONG_ORDER', 'QUALITY_ISSUE', 'LATE_DELIVERY', 'BILLING_ISSUE', 'ACCEPTANCE_TIMEOUT_ESCALATION')),
    priority VARCHAR(24) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED')),
    description TEXT NOT NULL,
    evidence_image_urls TEXT[] NOT NULL DEFAULT '{}',
    assigned_care_or_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    resolution_notes TEXT NULL,
    linked_refund_id UUID NULL REFERENCES refunds(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_complaints_updated_at BEFORE UPDATE ON complaints FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE complaint_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sender_role VARCHAR(32) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(24) NOT NULL CHECK (channel IN ('IN_APP', 'WEB_PUSH', 'SMS', 'EMAIL')),
    event_type VARCHAR(64) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    action_url TEXT NULL,
    delivery_status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED')),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    actor_role VARCHAR(50) NOT NULL,
    permission_used VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_entity_type VARCHAR(64) NOT NULL,
    target_entity_id VARCHAR(128) NOT NULL,
    before_state JSONB NULL,
    after_state JSONB NULL,
    reason TEXT NULL,
    ip_address INET NULL,
    correlation_id VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_logs_created ON admin_audit_logs (created_at DESC);

CREATE TABLE platform_configs (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT NOT NULL,
    updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_configs (key, value, description) VALUES
    ('acceptance_timeout_seconds', '300'::jsonb, '5-minute initial restaurant acceptance deadline before Customer Care alert'),
    ('acceptance_grace_period_seconds', '180'::jsonb, 'Post-alert grace period before non-acceptance penalty applies'),
    ('non_acceptance_penalty_rule', '{"mode":"PERCENTAGE_OF_SUBTOTAL","bps":1000,"flat_minor":10000,"min_minor":5000,"max_minor":30000}'::jsonb, 'Admin-configurable restaurant non-acceptance penalty formula'),
    ('partner_daily_payout_fee_rule', '{"mode":"FREE_SCHEDULED_PAID_INSTANT","scheduled_fee_minor":0,"instant_fee_minor":1000,"bps":100,"cap_minor":1500}'::jsonb, 'Admin-configurable daily delivery partner payout fee calculation');
