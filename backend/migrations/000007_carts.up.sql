CREATE TABLE carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restaurant_id UUID NULL REFERENCES restaurants(id) ON DELETE SET NULL,
    delivery_address_id UUID NULL REFERENCES customer_addresses(id) ON DELETE SET NULL,
    applied_coupon_id UUID NULL REFERENCES coupons(id) ON DELETE SET NULL,
    special_instructions TEXT NULL,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_carts_updated_at BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    quantity SMALLINT NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    options_fingerprint CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cart_id, menu_item_id, options_fingerprint)
);

CREATE TRIGGER trg_cart_items_updated_at BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_item_customizations (
    cart_item_id UUID NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,
    option_id UUID NOT NULL REFERENCES menu_customization_options(id) ON DELETE CASCADE,
    PRIMARY KEY (cart_item_id, option_id)
);
