DROP TABLE IF EXISTS user_admin_permissions CASCADE;

DELETE FROM admin_permissions WHERE slug IN (
    'users:customers:view',
    'users:customers:manage',
    'users:owners:view',
    'users:owners:manage',
    'users:outlets:view',
    'users:outlets:manage',
    'users:management:view',
    'users:management:manage',
    'users:delivery:view',
    'users:delivery:manage',
    'roles:manage'
);
