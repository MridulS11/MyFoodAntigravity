DROP TABLE IF EXISTS pending_registrations;

ALTER TABLE users
    DROP COLUMN IF EXISTS deleted_at;
