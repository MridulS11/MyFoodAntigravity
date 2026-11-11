ALTER TABLE menu_items
    DROP CONSTRAINT IF EXISTS menu_items_veg_classification_check,
    DROP COLUMN IF EXISTS veg_classification;
