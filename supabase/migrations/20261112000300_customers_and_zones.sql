CREATE TABLE customer_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    dietary_preferences TEXT[] NOT NULL DEFAULT '{}',
    default_address_id UUID NULL,
    total_orders_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_customer_profiles_updated_at BEFORE UPDATE ON customer_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label VARCHAR(50) NOT NULL CHECK (label IN ('Home', 'Work', 'Other')),
    recipient_name VARCHAR(150) NOT NULL,
    recipient_phone VARCHAR(20) NOT NULL,
    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255) NULL,
    landmark VARCHAR(255) NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country_code CHAR(2) NOT NULL DEFAULT 'IN',
    delivery_instructions TEXT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_addresses_user ON customer_addresses (user_id) WHERE is_archived = FALSE;
CREATE INDEX idx_customer_addresses_location_gist ON customer_addresses USING GIST (location);

CREATE TABLE service_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) UNIQUE NOT NULL,
    city VARCHAR(100) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    boundary GEOGRAPHY(Polygon, 4326) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    base_delivery_fee_minor BIGINT NOT NULL DEFAULT 2900 CHECK (base_delivery_fee_minor >= 0),
    min_cart_threshold_minor BIGINT NOT NULL DEFAULT 29900 CHECK (min_cart_threshold_minor >= 0),
    small_cart_fee_minor BIGINT NOT NULL DEFAULT 2900 CHECK (small_cart_fee_minor >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_zones_boundary_gist ON service_zones USING GIST (boundary);
CREATE TRIGGER trg_service_zones_updated_at BEFORE UPDATE ON service_zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();
