-- Migration 000013: Invitations, custom platform & outlet roles, and skippable delivery onboarding support

ALTER TABLE roles
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS platform_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NULL,
    phone VARCHAR(20) NULL,
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    custom_permissions TEXT[] NULL,
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_ACCEPTANCE'
        CHECK (status IN ('PENDING_ACCEPTANCE', 'PENDING_ADMIN_APPROVAL', 'ACTIVE', 'DECLINED', 'REVOKED')),
    accepted_at TIMESTAMPTZ NULL,
    approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_platform_invitations_email ON platform_invitations (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_invitations_phone ON platform_invitations (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_invitations_user ON platform_invitations (user_id, status) WHERE user_id IS NOT NULL;
CREATE TRIGGER trg_platform_invitations_updated_at
    BEFORE UPDATE ON platform_invitations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS outlet_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_user_id, name)
);

CREATE TRIGGER trg_outlet_roles_updated_at
    BEFORE UPDATE ON outlet_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE outlet_staff_assignments
    DROP CONSTRAINT IF EXISTS outlet_staff_assignments_outlet_id_user_id_key,
    DROP CONSTRAINT IF EXISTS outlet_staff_assignments_role_code_check,
    DROP CONSTRAINT IF EXISTS outlet_staff_assignments_status_check;

ALTER TABLE outlet_staff_assignments
    ALTER COLUMN user_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS invited_email VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS invited_phone VARCHAR(20) NULL,
    ADD COLUMN IF NOT EXISTS outlet_role_id UUID NULL REFERENCES outlet_roles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS outlet_role_name VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS approved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL;

ALTER TABLE outlet_staff_assignments
    ADD CONSTRAINT outlet_staff_assignments_role_code_check
        CHECK (role_code IN ('BRANCH_MANAGER', 'OUTLET_STAFF', 'CUSTOM')),
    ADD CONSTRAINT outlet_staff_assignments_status_check
        CHECK (status IN ('INVITED', 'PENDING_ACCEPTANCE', 'PENDING_APPROVAL', 'ACTIVE', 'DECLINED', 'REVOKED'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_outlet_staff_outlet_user
    ON outlet_staff_assignments (outlet_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outlet_staff_outlet_email
    ON outlet_staff_assignments (outlet_id, LOWER(invited_email)) WHERE invited_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_outlet_staff_outlet_phone
    ON outlet_staff_assignments (outlet_id, invited_phone) WHERE invited_phone IS NOT NULL;
