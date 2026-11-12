-- Migration 000018: Rich culinary, dietary, allergen, search keyword, and customization search metadata on menu_items

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS cuisine_type VARCHAR(80),
    ADD COLUMN IF NOT EXISTS spice_level VARCHAR(24) NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS calories_kcal INT,
    ADD COLUMN IF NOT EXISTS serving_size VARCHAR(80),
    ADD COLUMN IF NOT EXISTS ingredients TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS allergens TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS search_keywords TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE menu_items
    DROP CONSTRAINT IF EXISTS menu_items_spice_level_check;
ALTER TABLE menu_items
    ADD CONSTRAINT menu_items_spice_level_check
    CHECK (spice_level IN ('NONE', 'MILD', 'MEDIUM', 'HOT', 'EXTRA_HOT'));

CREATE INDEX IF NOT EXISTS idx_menu_items_search_keywords ON menu_items USING gin (search_keywords);
CREATE INDEX IF NOT EXISTS idx_menu_items_ingredients ON menu_items USING gin (ingredients);
CREATE INDEX IF NOT EXISTS idx_menu_items_dietary_tags ON menu_items USING gin (dietary_tags);
