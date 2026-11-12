CREATE TABLE IF NOT EXISTS restaurant_owner_profiles (
    id UUID PRIMARY KEY,
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_name VARCHAR(160) NULL,
    id_document_type VARCHAR(40) NOT NULL DEFAULT 'PAN_CARD',
    id_document_number VARCHAR(80) NOT NULL,
    id_document_filename VARCHAR(255) NULL,
    verification_status VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW'
        CHECK (verification_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    review_notes TEXT NULL,
    reviewed_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-approve existing seeded/legacy restaurant owners who already have outlets
INSERT INTO restaurant_owner_profiles (
    id, user_id, organization_name, id_document_type, id_document_number,
    id_document_filename, verification_status, reviewed_at
)
SELECT DISTINCT r.owner_user_id, r.owner_user_id, COALESCE(NULLIF(r.brand_name, ''), r.name), 'PAN_CARD', 'VERIFIED-OWNER', 'demo-verified-owner-id.pdf', 'APPROVED', NOW()
FROM restaurants r
ON CONFLICT (user_id) DO NOTHING;
