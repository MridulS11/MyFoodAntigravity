CREATE TABLE menu_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    subtitle VARCHAR(255) NULL,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_categories_rest_order ON menu_categories (restaurant_id, display_order);
CREATE TRIGGER trg_menu_categories_updated_at BEFORE UPDATE ON menu_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    description TEXT NULL,
    badge_label VARCHAR(60) NULL,
    dietary_tags TEXT[] NOT NULL DEFAULT '{}',
    base_price_minor BIGINT NOT NULL CHECK (base_price_minor >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    image_url TEXT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    prep_time_minutes SMALLINT NULL,
    rating_average NUMERIC(3,2) NOT NULL DEFAULT 0.00,
    rating_count INT NOT NULL DEFAULT 0,
    display_order INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_items_rest_cat ON menu_items (restaurant_id, category_id, display_order) WHERE is_active = TRUE;
CREATE INDEX idx_menu_items_name_trgm ON menu_items USING GIN (name gin_trgm_ops);
CREATE TRIGGER trg_menu_items_updated_at BEFORE UPDATE ON menu_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE menu_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id UUID NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
    menu_item_id UUID NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    schedule_name VARCHAR(80) NOT NULL,
    days_of_week SMALLINT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (category_id IS NOT NULL OR menu_item_id IS NOT NULL)
);

CREATE TABLE menu_item_inventory (
    menu_item_id UUID PRIMARY KEY REFERENCES menu_items(id) ON DELETE CASCADE,
    track_inventory BOOLEAN NOT NULL DEFAULT FALSE,
    available_quantity INT NOT NULL DEFAULT 0 CHECK (available_quantity >= 0),
    reserved_quantity INT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    daily_reset_quantity INT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_menu_item_inventory_updated_at BEFORE UPDATE ON menu_item_inventory FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE menu_customization_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    min_selections SMALLINT NOT NULL DEFAULT 0,
    max_selections SMALLINT NOT NULL DEFAULT 1 CHECK (max_selections >= min_selections),
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0
);

CREATE TABLE menu_customization_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES menu_customization_groups(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    price_delta_minor BIGINT NOT NULL DEFAULT 0 CHECK (price_delta_minor >= 0),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0
);
