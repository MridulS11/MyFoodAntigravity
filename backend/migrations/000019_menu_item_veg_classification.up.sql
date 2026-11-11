-- Migration 000019: Explicit Veg / Non-Veg / Non-Veg (Only Egg) classification per menu item

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS veg_classification VARCHAR(20) NOT NULL DEFAULT 'VEG';

ALTER TABLE menu_items
    DROP CONSTRAINT IF EXISTS menu_items_veg_classification_check;

ALTER TABLE menu_items
    ADD CONSTRAINT menu_items_veg_classification_check
    CHECK (veg_classification IN ('VEG', 'NON_VEG', 'EGG_ONLY'));
