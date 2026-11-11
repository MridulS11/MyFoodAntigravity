DROP INDEX IF EXISTS idx_menu_items_dietary_tags;
DROP INDEX IF EXISTS idx_menu_items_ingredients;
DROP INDEX IF EXISTS idx_menu_items_search_keywords;

ALTER TABLE menu_items
    DROP CONSTRAINT IF EXISTS menu_items_spice_level_check,
    DROP COLUMN IF EXISTS is_recommended,
    DROP COLUMN IF EXISTS search_keywords,
    DROP COLUMN IF EXISTS allergens,
    DROP COLUMN IF EXISTS ingredients,
    DROP COLUMN IF EXISTS serving_size,
    DROP COLUMN IF EXISTS calories_kcal,
    DROP COLUMN IF EXISTS spice_level,
    DROP COLUMN IF EXISTS cuisine_type;
