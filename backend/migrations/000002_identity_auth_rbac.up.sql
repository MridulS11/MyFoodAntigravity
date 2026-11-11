CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    avatar_url TEXT NULL,
    is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
    last_login_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_status ON users (status);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    granted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE admin_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT NULL
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES admin_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_family_id UUID NOT NULL,
    refresh_token_hash CHAR(64) UNIQUE NOT NULL,
    user_agent TEXT NULL,
    ip_address INET NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_sessions_user_active ON auth_sessions (user_id, expires_at) WHERE is_revoked = FALSE;
CREATE INDEX idx_auth_sessions_family ON auth_sessions (token_family_id);

CREATE TABLE otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    target VARCHAR(255) NOT NULL,
    purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('REGISTER', 'LOGIN', 'PASSWORD_RESET', 'SENSITIVE_ACTION', 'DELIVERY_PIN')),
    otp_hash CHAR(64) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_target_purpose ON otp_verifications (target, purpose, expires_at) WHERE consumed_at IS NULL;

-- Seed canonical platform roles and permissions
INSERT INTO roles (code, name, description) VALUES
    ('CUSTOMER', 'Customer', 'End user browsing restaurants and placing food orders'),
    ('OUTLET_OWNER', 'Outlet Owner', 'Restaurant/outlet group owner with multi-branch management access'),
    ('BRANCH_MANAGER', 'Branch Manager', 'Branch-scoped restaurant manager'),
    ('OUTLET_STAFF', 'Outlet Staff', 'Branch-scoped kitchen staff member'),
    ('DELIVERY_PARTNER', 'Delivery Partner', 'Independent courier accepting and completing deliveries'),
    ('CUSTOMER_CARE', 'Customer Care', 'Support role for complaints, timeout escalations, and delivery exceptions'),
    ('PLATFORM_ADMIN', 'Platform Admin', 'App/platform owner with full administrative governance'),
    ('OPS_ADMIN', 'Operations Admin', 'Operations and fleet governance administrator'),
    ('FINANCE_ADMIN', 'Finance Admin', 'Refunds, commissions, and settlement administrator');

INSERT INTO admin_permissions (slug, description) VALUES
    ('users:manage', 'Search, inspect, suspend, or reactivate user accounts'),
    ('restaurants:verify', 'Approve, reject, or suspend restaurant/outlet KYC applications'),
    ('partners:verify', 'Approve, reject, or suspend delivery partner KYC applications'),
    ('orders:monitor', 'View live operational order and fleet queues'),
    ('orders:intervene', 'Manually cancel/refund or reassign stuck orders'),
    ('orders:timeout_escalate', 'Act on 5-minute acceptance timeout escalation alerts'),
    ('delivery:override_otp', 'Authorize OTP proof-of-delivery exception override'),
    ('refunds:approve', 'Issue and approve full or partial customer refunds'),
    ('commissions:configure', 'Configure commission rates, calculation basis, small-cart fees, penalties, and payouts'),
    ('promotions:manage', 'Create and manage promotional campaigns and coupons'),
    ('zones:manage', 'Create and configure PostGIS service zones'),
    ('complaints:resolve', 'Review and resolve customer complaints'),
    ('reports:view', 'Access platform GMV, SLA, and financial reports'),
    ('audit_logs:view', 'Inspect immutable administrative audit logs'),
    ('settings:manage', 'Modify global platform timeouts and operational flags');

-- Grant all permissions to PLATFORM_ADMIN
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN admin_permissions p WHERE r.code = 'PLATFORM_ADMIN';

-- Grant restricted operational & support permissions to CUSTOMER_CARE (Final Business Decisions §1 & §4)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN admin_permissions p ON p.slug IN (
    'orders:monitor',
    'orders:intervene',
    'orders:timeout_escalate',
    'delivery:override_otp',
    'complaints:resolve'
) WHERE r.code = 'CUSTOMER_CARE';

-- Grant operational permissions to OPS_ADMIN
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN admin_permissions p ON p.slug IN (
    'restaurants:verify',
    'partners:verify',
    'orders:monitor',
    'orders:intervene',
    'orders:timeout_escalate',
    'zones:manage',
    'complaints:resolve',
    'reports:view'
) WHERE r.code = 'OPS_ADMIN';

-- Grant financial permissions to FINANCE_ADMIN
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN admin_permissions p ON p.slug IN (
    'refunds:approve',
    'commissions:configure',
    'promotions:manage',
    'reports:view',
    'audit_logs:view'
) WHERE r.code = 'FINANCE_ADMIN';
