CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    brand_name VARCHAR(160) NULL,
    branch_name VARCHAR(160) NULL,
    service_zone_id UUID NOT NULL REFERENCES service_zones(id) ON DELETE RESTRICT,
    slug VARCHAR(160) UNIQUE NOT NULL,
    name VARCHAR(160) NOT NULL,
    eyebrow VARCHAR(160) NULL,
    tagline VARCHAR(255) NULL,
    description TEXT NULL,
    cuisines TEXT[] NOT NULL DEFAULT '{}',
    established_year SMALLINT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL,
    address_line1 VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    max_delivery_radius_meters INT NOT NULL DEFAULT 7000 CHECK (max_delivery_radius_meters > 0),
    hero_image_url TEXT NULL,
    logo_image_url TEXT NULL,
    verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (verification_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_accepting_orders BOOLEAN NOT NULL DEFAULT FALSE,
    pause_reason VARCHAR(120) NULL,
    paused_until TIMESTAMPTZ NULL,
    max_concurrent_orders INT NULL CHECK (max_concurrent_orders IS NULL OR max_concurrent_orders > 0),
    active_orders_count INT NOT NULL DEFAULT 0 CHECK (active_orders_count >= 0),
    avg_prep_time_minutes SMALLINT NOT NULL DEFAULT 20 CHECK (avg_prep_time_minutes > 0),
    min_order_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (min_order_amount_minor >= 0),
    packaging_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (packaging_fee_minor >= 0),
    commission_rate_bps INT NULL CHECK (commission_rate_bps IS NULL OR (commission_rate_bps >= 0 AND commission_rate_bps <= 5000)),
    commission_calculation_basis VARCHAR(40) NULL CHECK (commission_calculation_basis IS NULL OR commission_calculation_basis IN ('GROSS_FOOD_SUBTOTAL', 'NET_AFTER_OUTLET_DISCOUNT', 'SUBTOTAL_PLUS_PACKAGING')),
    rating_average NUMERIC(3,2) NOT NULL DEFAULT 0.00,
    rating_count INT NOT NULL DEFAULT 0,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(tagline, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_restaurants_owner ON restaurants (owner_user_id);
CREATE INDEX idx_restaurants_location_gist ON restaurants USING GIST (location);
CREATE INDEX idx_restaurants_discovery ON restaurants (service_zone_id, verification_status, is_active, is_accepting_orders);
CREATE INDEX idx_restaurants_cuisines_gin ON restaurants USING GIN (cuisines);
CREATE INDEX idx_restaurants_search_gin ON restaurants USING GIN (search_vector);
CREATE INDEX idx_restaurants_name_trgm ON restaurants USING GIN (name gin_trgm_ops);
CREATE TRIGGER trg_restaurants_updated_at BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, restaurant_id)
);

CREATE TABLE outlet_staff_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_code VARCHAR(32) NOT NULL CHECK (role_code IN ('BRANCH_MANAGER', 'OUTLET_STAFF')),
    permissions TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'REVOKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (outlet_id, user_id)
);

CREATE INDEX idx_outlet_staff_user ON outlet_staff_assignments (user_id, status);
CREATE TRIGGER trg_outlet_staff_updated_at BEFORE UPDATE ON outlet_staff_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE restaurant_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100) NOT NULL,
    file_key TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    review_notes TEXT NULL,
    reviewed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE restaurant_operating_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    slot_number SMALLINT NOT NULL DEFAULT 1,
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (restaurant_id, day_of_week, slot_number)
);

CREATE TABLE outlet_holiday_closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    closure_date DATE NOT NULL,
    open_time TIME NULL,
    close_time TIME NULL,
    is_full_day_closed BOOLEAN NOT NULL DEFAULT TRUE,
    reason VARCHAR(160) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (outlet_id, closure_date)
);
