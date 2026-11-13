-- Allow custom user-defined location tags and enforce per-user uniqueness (case-insensitive) on active addresses.
ALTER TABLE customer_addresses
    DROP CONSTRAINT IF EXISTS customer_addresses_label_check;

ALTER TABLE customer_addresses
    DROP CONSTRAINT IF EXISTS customer_addresses_label_nonempty;

ALTER TABLE customer_addresses
    ADD CONSTRAINT customer_addresses_label_nonempty
    CHECK (char_length(btrim(label)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_addresses_user_label
    ON customer_addresses (user_id, LOWER(btrim(label)))
    WHERE is_archived = FALSE;
