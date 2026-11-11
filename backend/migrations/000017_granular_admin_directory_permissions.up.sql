INSERT INTO admin_permissions (slug, description) VALUES
    ('users:customers:view', 'View Customers directory and inspect customer profile details'),
    ('users:customers:manage', 'Suspend, reactivate, or delete Customer accounts'),
    ('users:owners:view', 'View Restaurant Owners directory, KYC and owned outlets'),
    ('users:owners:manage', 'Manage Restaurant Owner accounts, status and deletions'),
    ('users:outlets:view', 'View Outlets directory, branches and branch staff'),
    ('users:outlets:manage', 'Manage Outlet staff access, assignments and account statuses'),
    ('users:management:view', 'View Management and Admin accounts directory'),
    ('users:management:manage', 'Change Management user roles/permissions and manage admin accounts'),
    ('users:delivery:view', 'View Delivery Partners directory and trip details'),
    ('users:delivery:manage', 'Manage Delivery Partner accounts, status and deletions'),
    ('roles:manage', 'Create, update, and delete Admin roles and granular permissions')
ON CONFLICT (slug) DO NOTHING;

-- Ensure Super Admin (PLATFORM_ADMIN) automatically holds all newly added permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN admin_permissions p
WHERE r.code = 'PLATFORM_ADMIN'
ON CONFLICT DO NOTHING;

-- Per-user direct granular permission overrides for Management accounts
CREATE TABLE IF NOT EXISTS user_admin_permissions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
