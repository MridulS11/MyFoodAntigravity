DROP INDEX IF EXISTS uq_outlet_staff_outlet_phone;
DROP INDEX IF EXISTS uq_outlet_staff_outlet_email;
DROP INDEX IF EXISTS uq_outlet_staff_outlet_user;

DELETE FROM outlet_staff_assignments WHERE user_id IS NULL;

ALTER TABLE outlet_staff_assignments
    DROP CONSTRAINT IF EXISTS outlet_staff_assignments_status_check,
    DROP CONSTRAINT IF EXISTS outlet_staff_assignments_role_code_check,
    DROP COLUMN IF EXISTS approved_at,
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS accepted_at,
    DROP COLUMN IF EXISTS outlet_role_name,
    DROP COLUMN IF EXISTS outlet_role_id,
    DROP COLUMN IF EXISTS invited_phone,
    DROP COLUMN IF EXISTS invited_email,
    ALTER COLUMN user_id SET NOT NULL;

UPDATE outlet_staff_assignments SET status = 'ACTIVE' WHERE status NOT IN ('INVITED', 'ACTIVE', 'REVOKED');
UPDATE outlet_staff_assignments SET role_code = 'OUTLET_STAFF' WHERE role_code NOT IN ('BRANCH_MANAGER', 'OUTLET_STAFF');

ALTER TABLE outlet_staff_assignments
    ADD CONSTRAINT outlet_staff_assignments_role_code_check CHECK (role_code IN ('BRANCH_MANAGER', 'OUTLET_STAFF')),
    ADD CONSTRAINT outlet_staff_assignments_status_check CHECK (status IN ('INVITED', 'ACTIVE', 'REVOKED')),
    ADD CONSTRAINT outlet_staff_assignments_outlet_id_user_id_key UNIQUE (outlet_id, user_id);

DROP TRIGGER IF EXISTS trg_outlet_roles_updated_at ON outlet_roles;
DROP TABLE IF EXISTS outlet_roles;

DROP TRIGGER IF EXISTS trg_platform_invitations_updated_at ON platform_invitations;
DROP TABLE IF EXISTS platform_invitations;

ALTER TABLE roles
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS is_system;
