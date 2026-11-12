CREATE TABLE delivery_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    service_zone_id UUID NOT NULL REFERENCES service_zones(id) ON DELETE RESTRICT,
    vehicle_type VARCHAR(32) NOT NULL CHECK (vehicle_type IN ('BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR')),
    vehicle_make_model VARCHAR(100) NULL,
    license_plate VARCHAR(32) NULL,
    verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (verification_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    availability_status VARCHAR(32) NOT NULL DEFAULT 'OFFLINE' CHECK (availability_status IN ('OFFLINE', 'ONLINE_AVAILABLE', 'ON_DELIVERY')),
    is_busy BOOLEAN NOT NULL DEFAULT FALSE,
    active_deliveries_count SMALLINT NOT NULL DEFAULT 0 CHECK (active_deliveries_count >= 0),
    max_concurrent_deliveries SMALLINT NOT NULL DEFAULT 1,
    last_known_location GEOGRAPHY(Point, 4326) NULL,
    last_location_at TIMESTAMPTZ NULL,
    rating_average NUMERIC(3,2) NOT NULL DEFAULT 5.00,
    rating_count INT NOT NULL DEFAULT 0,
    total_deliveries_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_delivery_partners_zone_avail ON delivery_partners (service_zone_id, verification_status, availability_status, is_busy);
CREATE INDEX idx_delivery_partners_location_gist ON delivery_partners USING GIST (last_known_location);
CREATE TRIGGER trg_delivery_partners_updated_at BEFORE UPDATE ON delivery_partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE delivery_partner_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id UUID NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    file_key TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    partner_id UUID NULL REFERENCES delivery_partners(id) ON DELETE RESTRICT,
    reassigned_from_partner_id UUID NULL REFERENCES delivery_partners(id) ON DELETE SET NULL,
    reassignment_count SMALLINT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'ASSIGNMENT_PENDING' CHECK (status IN (
        'ASSIGNMENT_PENDING', 'PARTNER_OFFERED', 'PARTNER_ASSIGNED',
        'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'OUT_FOR_DELIVERY',
        'ARRIVED_AT_CUSTOMER', 'DELIVERED', 'UNASSIGNABLE', 'CANCELLED'
    )),
    pickup_location GEOGRAPHY(Point, 4326) NOT NULL,
    dropoff_location GEOGRAPHY(Point, 4326) NOT NULL,
    broadcast_wave_count SMALLINT NOT NULL DEFAULT 0,
    assigned_at TIMESTAMPTZ NULL,
    arrived_restaurant_at TIMESTAMPTZ NULL,
    picked_up_at TIMESTAMPTZ NULL,
    arrived_customer_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_deliveries_updated_at BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE delivery_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
    broadcast_wave SMALLINT NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED_REASSIGNED')),
    distance_to_pickup_meters INT NOT NULL DEFAULT 0,
    estimated_payout_minor BIGINT NOT NULL DEFAULT 0,
    offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ NULL,
    rejection_reason VARCHAR(100) NULL
);

CREATE INDEX idx_delivery_assignments_partner_active ON delivery_assignments (partner_id, status, expires_at) WHERE status = 'OFFERED';
CREATE INDEX idx_delivery_assignments_delivery_active ON delivery_assignments (delivery_id, status) WHERE status = 'OFFERED';
CREATE UNIQUE INDEX uq_delivery_single_accepted ON delivery_assignments (delivery_id) WHERE status = 'ACCEPTED';

CREATE TABLE delivery_otps (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    delivery_id UUID UNIQUE NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    otp_hash CHAR(64) NOT NULL,
    failed_attempts SMALLINT NOT NULL DEFAULT 0,
    max_attempts SMALLINT NOT NULL DEFAULT 5,
    rate_limited_until TIMESTAMPTZ NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ NULL,
    verified_by_partner_id UUID NULL REFERENCES delivery_partners(id) ON DELETE SET NULL,
    exception_override_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    exception_override_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE delivery_tracking_history (
    id BIGSERIAL,
    delivery_id UUID NOT NULL,
    order_id UUID NOT NULL,
    partner_id UUID NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    speed_mps REAL NULL,
    bearing_degrees REAL NULL,
    accuracy_meters REAL NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE delivery_tracking_history_y2026m11 PARTITION OF delivery_tracking_history
    FOR VALUES FROM ('2026-11-01T00:00:00Z') TO ('2026-12-01T00:00:00Z');
CREATE TABLE delivery_tracking_history_default PARTITION OF delivery_tracking_history DEFAULT;
