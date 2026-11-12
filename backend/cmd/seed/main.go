package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/config"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/auth"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/telemetry"
)

func main() {
	action := flag.String("action", "seed", "seed or reset")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}
	logger := telemetry.NewLogger("goodly-seed", cfg.AppEnv)

	if *action == "reset" && (cfg.AppEnv == "production" || cfg.AppEnv == "prod") {
		logger.Error("REFUSING to reset database in production environment")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("connect db failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := database.RunMigrations(ctx, pool, cfg.MigrationsDir); err != nil {
		logger.Error("run migrations failed", "error", err)
		os.Exit(1)
	}

	if *action == "reset" {
		if _, err := pool.Exec(ctx, `
			TRUNCATE TABLE
				outbox_events, processed_messages, idempotency_records,
				admin_audit_logs, notifications, complaint_messages, complaints,
				order_item_ratings, reviews, financial_ledger_entries,
				delivery_partner_earnings, restaurant_settlements, refunds,
				payment_transactions, payments, delivery_otps, delivery_assignments,
				deliveries, delivery_partner_documents, delivery_partners,
				order_status_history, order_item_customizations, order_items,
				outlet_penalties, coupon_usages, orders,
				cart_item_customizations, cart_items, carts,
				menu_customization_options, menu_customization_groups,
				menu_item_inventory, menu_schedules, menu_items, menu_categories,
				outlet_holiday_closures, restaurant_operating_hours, restaurant_documents,
				outlet_staff_assignments, outlet_roles, customer_favorites, restaurants,
				customer_addresses, customer_profiles, service_zones,
				platform_invitations, otp_verifications, auth_sessions, user_roles, users
			RESTART IDENTITY CASCADE;
		`); err != nil {
			logger.Error("truncate failed", "error", err)
			os.Exit(1)
		}
		logger.Info("database truncated for clean test reset")
	}

	if err := seedBaselineData(ctx, pool); err != nil {
		logger.Error("seed failed", "error", err)
		os.Exit(1)
	}
	logger.Info("seed completed successfully (India INR + Bengaluru/Mumbai zones + demo personas)")
}

func seedBaselineData(ctx context.Context, pool interface {
	BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
}) error {
	pwHash, err := auth.HashPassword("password123")
	if err != nil {
		return err
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 0. Ensure canonical roles & admin permissions exist (idempotent self-healing after TRUNCATE ... CASCADE)
	if _, err := tx.Exec(ctx, `
		INSERT INTO roles (code, name, description, is_system) VALUES
			('CUSTOMER', 'Customer', 'End user browsing restaurants and placing food orders', TRUE),
			('OUTLET_OWNER', 'Outlet Owner', 'Restaurant/outlet group owner with multi-branch management access', TRUE),
			('BRANCH_MANAGER', 'Branch Manager', 'Branch-scoped restaurant manager', TRUE),
			('OUTLET_STAFF', 'Outlet Staff', 'Branch-scoped kitchen staff member', TRUE),
			('DELIVERY_PARTNER', 'Delivery Partner', 'Independent courier accepting and completing deliveries', TRUE),
			('CUSTOMER_CARE', 'Customer Care', 'Support role for complaints, timeout escalations, and delivery exceptions', TRUE),
			('PLATFORM_ADMIN', 'Platform Admin', 'App/platform owner with full administrative governance', TRUE),
			('OPS_ADMIN', 'Operations Admin', 'Operations and fleet governance administrator', TRUE),
			('FINANCE_ADMIN', 'Finance Admin', 'Refunds, commissions, and settlement administrator', TRUE)
		ON CONFLICT (code) DO NOTHING;

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
			('settings:manage', 'Modify global platform timeouts and operational flags'),
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

		INSERT INTO role_permissions (role_id, permission_id)
		SELECT r.id, p.id FROM roles r CROSS JOIN admin_permissions p WHERE r.code = 'PLATFORM_ADMIN'
		ON CONFLICT DO NOTHING;

		INSERT INTO role_permissions (role_id, permission_id)
		SELECT r.id, p.id FROM roles r JOIN admin_permissions p ON p.slug IN (
			'orders:monitor', 'orders:intervene', 'orders:timeout_escalate', 'delivery:override_otp', 'complaints:resolve'
		) WHERE r.code = 'CUSTOMER_CARE'
		ON CONFLICT DO NOTHING;

		INSERT INTO role_permissions (role_id, permission_id)
		SELECT r.id, p.id FROM roles r JOIN admin_permissions p ON p.slug IN (
			'restaurants:verify', 'partners:verify', 'orders:monitor', 'orders:intervene', 'orders:timeout_escalate', 'zones:manage', 'complaints:resolve', 'reports:view'
		) WHERE r.code = 'OPS_ADMIN'
		ON CONFLICT DO NOTHING;

		INSERT INTO role_permissions (role_id, permission_id)
		SELECT r.id, p.id FROM roles r JOIN admin_permissions p ON p.slug IN (
			'refunds:approve', 'commissions:configure', 'promotions:manage', 'reports:view', 'audit_logs:view'
		) WHERE r.code = 'FINANCE_ADMIN'
		ON CONFLICT DO NOTHING;
	`); err != nil {
		return fmt.Errorf("seed canonical roles/permissions: %w", err)
	}

	// 1. Seed India Service Zones (Bengaluru Central & Mumbai West)
	zones := []struct {
		id, name, city, polyWKT    string
		baseFee, minCart, smallFee int64
	}{
		{
			id:       "01900000-0000-7000-8000-000000000001",
			name:     "Bengaluru Central (Indiranagar · Koramangala · HSR)",
			city:     "Bengaluru, KA",
			polyWKT:  "POLYGON((77.5700 12.9000, 77.7000 12.9000, 77.7000 13.0200, 77.5700 13.0200, 77.5700 12.9000))",
			baseFee:  2900,
			minCart:  29900,
			smallFee: 2900,
		},
		{
			id:       "01900000-0000-7000-8000-000000000002",
			name:     "Mumbai West (Bandra · Lower Parel)",
			city:     "Mumbai, MH",
			polyWKT:  "POLYGON((72.7900 18.9900, 72.8800 18.9900, 72.8800 19.1000, 72.7900 19.1000, 72.7900 18.9900))",
			baseFee:  3500,
			minCart:  29900,
			smallFee: 2900,
		},
	}

	for _, z := range zones {
		if _, err := tx.Exec(ctx, `
			INSERT INTO service_zones (id, name, city, timezone, currency, boundary, is_active, base_delivery_fee_minor, min_cart_threshold_minor, small_cart_fee_minor)
			VALUES ($1, $2, $3, 'Asia/Kolkata', 'INR', ST_GeogFromText($4), TRUE, $5, $6, $7)
			ON CONFLICT (id) DO NOTHING
		`, z.id, z.name, z.city, z.polyWKT, z.baseFee, z.minCart, z.smallFee); err != nil {
			return fmt.Errorf("seed zone %s: %w", z.name, err)
		}
	}

	// 2. Seed Demo Accounts across all canonical roles
	demoUsers := []struct {
		id, email, phone, fullName, role string
	}{
		{"01900001-0000-7000-8000-000000000001", "alice@goodly.local", "+91-98450-10101", "Ananya Sharma", "CUSTOMER"},
		{"01900001-0000-7000-8000-000000000002", "marco@sundaytable.local", "+91-98450-20202", "Vikram Malhotra (Outlet Owner)", "OUTLET_OWNER"},
		{"01900001-0000-7000-8000-000000000003", "branch.indiranagar@sundaytable.local", "+91-98450-20299", "Karan Rao (Branch Manager)", "BRANCH_MANAGER"},
		{"01900001-0000-7000-8000-000000000004", "devon@goodly.local", "+91-98450-30303", "Rohan Verma", "DELIVERY_PARTNER"},
		{"01900001-0000-7000-8000-000000000005", "priya@goodly.local", "+91-98450-40404", "Priya Nair (Customer Care)", "CUSTOMER_CARE"},
		{"01900001-0000-7000-8000-000000000006", "elena@goodly.local", "+91-98450-50505", "Siddharth Mehta (Platform Admin)", "PLATFORM_ADMIN"},
		{"01900001-0000-7000-8000-000000000007", "staff.invited@goodly.local", "+91-98450-20311", "Meera Joshi (Invited Outlet Staff)", "CUSTOMER"},
		{"01900001-0000-7000-8000-000000000008", "rider.pending@goodly.local", "+91-98450-30311", "Arjun Das (Pending Rider Onboarding)", "DELIVERY_PARTNER"},
		{"01900001-0000-7000-8000-000000000009", "admin.invited@goodly.local", "+91-98450-40511", "Vikramaditya Roy (Invited Ops Admin)", "CUSTOMER"},
	}

	for _, u := range demoUsers {
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (id, email, phone, password_hash, full_name, is_email_verified, is_phone_verified, status)
			VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, 'ACTIVE')
			ON CONFLICT (email) DO NOTHING
		`, u.id, u.email, u.phone, pwHash, u.fullName); err != nil {
			return fmt.Errorf("seed user %s: %w", u.email, err)
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id)
			SELECT u.id, r.id FROM users u JOIN roles r ON r.code = $2 WHERE u.email = $1
			ON CONFLICT DO NOTHING
		`, u.email, u.role); err != nil {
			return fmt.Errorf("seed role %s: %w", u.role, err)
		}

		if u.role == "OUTLET_OWNER" {
			if _, err := tx.Exec(ctx, `
				INSERT INTO restaurant_owner_profiles (
					id, user_id, organization_name, id_document_type, id_document_number,
					id_document_filename, verification_status, reviewed_at
				)
				VALUES ($1, $1, 'Sunday Table Group', 'PAN_CARD', 'ABCDE1234F', 'demo-pan-verified.pdf', 'APPROVED', NOW())
				ON CONFLICT (user_id) DO NOTHING
			`, u.id); err != nil {
				return fmt.Errorf("seed owner profile %s: %w", u.email, err)
			}
		}

		if u.role == "CUSTOMER" {
			if _, err := tx.Exec(ctx, `
				INSERT INTO customer_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING
			`, u.id); err != nil {
				return err
			}
			// Seed default Bengaluru Indiranagar Home address + Out-of-zone address
			if _, err := tx.Exec(ctx, `
				INSERT INTO customer_addresses (id, user_id, label, recipient_name, recipient_phone, address_line1, city, state, postal_code, country_code, location, is_default)
				VALUES
				('01900002-0000-7000-8000-000000000001', $1, 'Home', 'Ananya Sharma', '+91-98450-10101', '742 12th Main Rd, HAL 2nd Stage, Indiranagar', 'Bengaluru', 'KA', '560038', 'IN', ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography, TRUE),
				('01900002-0000-7000-8000-000000000002', $1, 'Other', 'Ananya Sharma', '+91-98450-10101', 'Highway Toll Plaza, Mysuru Road', 'Ramanagara', 'KA', '562159', 'IN', ST_SetSRID(ST_MakePoint(77.2800, 12.7200), 4326)::geography, FALSE)
				ON CONFLICT (id) DO NOTHING
			`, u.id); err != nil {
				return fmt.Errorf("seed addresses: %w", err)
			}
		}
	}

	// 3. Seed Commission Config (20% initial rate, 5% GST) & Delivery Pricing Rules
	if _, err := tx.Exec(ctx, `
		INSERT INTO commission_configs (id, default_commission_bps, calculation_basis, tax_rate_bps, platform_fee_minor)
		VALUES ('01900003-0000-7000-8000-000000000001', 2000, 'GROSS_FOOD_SUBTOTAL', 500, 900)
		ON CONFLICT (id) DO NOTHING
	`); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO delivery_charge_rules (id, service_zone_id, min_cart_threshold_minor, small_cart_fee_minor, base_fee_minor, base_distance_meters, per_km_fee_minor, free_delivery_threshold_minor, partner_base_payout_minor, partner_per_km_payout_minor)
		VALUES ('01900004-0000-7000-8000-000000000001', '01900000-0000-7000-8000-000000000001', 29900, 2900, 2900, 2000, 800, 59900, 3500, 1000)
		ON CONFLICT (id) DO NOTHING
	`); err != nil {
		return err
	}

	// 4. Seed Multi-Outlet Bengaluru Restaurants, Menus, Customizations, Stock & Coupons
	outlets := []struct {
		id, brand, branch, slug, name, eyebrow, tagline, desc string
		cuisines                                              []string
		addr, postal                                          string
		lat, lng                                              float64
		pkgMinor                                              int64
		maxConc                                               int
	}{
		{
			"01900010-0000-7000-8000-000000000001", "Sunday Table Group", "Indiranagar Flagship",
			"sunday-table", "Sunday Table", "NEIGHBORHOOD ITALIAN · EST. 2018",
			"Fresh pasta, generous pours, and the kind of dinner that makes the whole table happy.",
			"Handmade rigatoni, wood-fired focaccia, and bright seasonal salads from our 100 Feet Road Indiranagar kitchen.",
			[]string{"Italian", "Pasta", "Pizza", "Comfort food"},
			"241, 100 Feet Rd, Indiranagar", "560038", 12.9784, 77.6408, 2000, 15,
		},
		{
			"01900010-0000-7000-8000-000000000002", "Sunday Table Group", "Koramangala Branch",
			"sunday-table-koramangala", "Sunday Table — Koramangala", "NEIGHBORHOOD ITALIAN · KORAMANGALA",
			"Our 80 Feet Road outpost serving fresh pasta and sourdough pizzas.",
			"Full Sunday Table Italian menu dispatched rapidly across Koramangala and HSR Layout.",
			[]string{"Italian", "Pasta", "Pizza"},
			"80 Feet Rd, 4th Block, Koramangala", "560034", 12.9352, 77.6245, 2000, 12,
		},
		{
			"01900010-0000-7000-8000-000000000003", "Little Green Bowl", "Indiranagar",
			"little-green-bowl", "Little Green Bowl", "SEASONAL PLANT KITCHEN",
			"Bright, nourishing grain bowls & cold-pressed tonics.",
			"Crisp farm greens, herb-roasted millets, and house-made dressings crafted fresh every hour.",
			[]string{"Healthy", "Salads", "Asian"},
			"12th Main Rd, HAL 2nd Stage, Indiranagar", "560038", 12.9718, 77.6411, 1500, 15,
		},
	}

	for _, o := range outlets {
		if _, err := tx.Exec(ctx, `
			INSERT INTO restaurants (id, owner_user_id, brand_name, branch_name, service_zone_id, slug, name, eyebrow, tagline, description, cuisines, phone, email, address_line1, city, state, postal_code, location, verification_status, is_active, is_accepting_orders, max_concurrent_orders, avg_prep_time_minutes, packaging_fee_minor, commission_rate_bps, rating_average, rating_count)
			VALUES ($1, '01900001-0000-7000-8000-000000000002', $2, $3, '01900000-0000-7000-8000-000000000001', $4, $5, $6, $7, $8, $9, '+91-80-4112-8900', 'kitchen@goodly.local', $10, 'Bengaluru', 'KA', $11, ST_SetSRID(ST_MakePoint($12, $13), 4326)::geography, 'APPROVED', TRUE, TRUE, $14, 20, $15, 2000, 4.90, 1240)
			ON CONFLICT (id) DO NOTHING
		`, o.id, o.brand, o.branch, o.slug, o.name, o.eyebrow, o.tagline, o.desc, o.cuisines, o.addr, o.postal, o.lng, o.lat, o.maxConc, o.pkgMinor); err != nil {
			return fmt.Errorf("seed outlet %s: %w", o.slug, err)
		}
	}

	// Assign Karan Rao as active Branch Manager + Meera Joshi as pending outlet invitation + custom Kitchen Lead role
	if _, err := tx.Exec(ctx, `
		INSERT INTO outlet_roles (id, owner_user_id, name, description, permissions)
		VALUES ('01900012-0000-7000-8000-000000000001', '01900001-0000-7000-8000-000000000002', 'Kitchen Shift Lead', 'Live KDS & item stock toggles only', ARRAY['outlet:orders:manage','outlet:inventory:toggle'])
		ON CONFLICT (owner_user_id, name) DO NOTHING
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO outlet_staff_assignments (id, outlet_id, user_id, invited_email, invited_phone, invited_by_owner_id, role_code, outlet_role_id, outlet_role_name, permissions, status)
		VALUES
		('01900011-0000-7000-8000-000000000001', '01900010-0000-7000-8000-000000000001', '01900001-0000-7000-8000-000000000003', 'branch.indiranagar@sundaytable.local', '+91-98450-20299', '01900001-0000-7000-8000-000000000002', 'BRANCH_MANAGER', NULL, 'Branch Manager', ARRAY['outlet:orders:manage','outlet:inventory:toggle','outlet:hours:manage'], 'ACTIVE'),
		('01900011-0000-7000-8000-000000000002', '01900010-0000-7000-8000-000000000001', '01900001-0000-7000-8000-000000000007', 'staff.invited@goodly.local', '+91-98450-20311', '01900001-0000-7000-8000-000000000002', 'CUSTOM', '01900012-0000-7000-8000-000000000001', 'Kitchen Shift Lead', ARRAY['outlet:orders:manage','outlet:inventory:toggle'], 'PENDING_ACCEPTANCE')
		ON CONFLICT (outlet_id, user_id) WHERE user_id IS NOT NULL DO NOTHING
	`); err != nil {
		return err
	}

	// Seed Approved Delivery Partner (Rohan Verma) + Pending Platform Invitation (Vikramaditya Roy)
	if _, err := tx.Exec(ctx, `
		INSERT INTO delivery_partners (id, user_id, service_zone_id, vehicle_type, vehicle_make_model, license_plate, verification_status, availability_status)
		VALUES ('01900013-0000-7000-8000-000000000001', '01900001-0000-7000-8000-000000000004', '01900000-0000-7000-8000-000000000001', 'SCOOTER', 'Ather 450X', 'KA-03-EV-4821', 'APPROVED', 'ONLINE_AVAILABLE')
		ON CONFLICT (user_id) DO NOTHING
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO platform_invitations (id, email, phone, user_id, role_id, invited_by, status)
		SELECT '01900014-0000-7000-8000-000000000001', 'admin.invited@goodly.local', '+91-98450-40511', '01900001-0000-7000-8000-000000000009', id, '01900001-0000-7000-8000-000000000006', 'PENDING_ACCEPTANCE'
		FROM roles WHERE code = 'OPS_ADMIN'
		ON CONFLICT (id) DO NOTHING
	`); err != nil {
		return err
	}

	// Seed Sunday Table Indiranagar menu categories & dishes
	if _, err := tx.Exec(ctx, `
		INSERT INTO menu_categories (id, restaurant_id, name, subtitle, display_order)
		VALUES
		('01900020-0000-7000-8000-000000000001', '01900010-0000-7000-8000-000000000001', 'Most loved', 'The ones regulars come back for', 1),
		('01900020-0000-7000-8000-000000000002', '01900010-0000-7000-8000-000000000001', 'From the kitchen', 'Wood-fired breads and sharable starters', 2)
		ON CONFLICT (id) DO NOTHING
	`); err != nil {
		return err
	}

	items := []struct {
		id, catID, name, desc, badge string
		price                        int64
		track                        bool
		qty                          int
	}{
		{"01900021-0000-7000-8000-000000000001", "01900020-0000-7000-8000-000000000001", "Sunday rigatoni", "Slow Sunday tomato sauce, pecorino, fresh basil", "A HOUSE FAVORITE", 45000, false, 0},
		{"01900021-0000-7000-8000-000000000002", "01900020-0000-7000-8000-000000000001", "Burrata & tomatoes", "Heirloom tomatoes, torn basil, grilled sourdough", "VEGETARIAN", 39000, true, 12},
		{"01900021-0000-7000-8000-000000000003", "01900020-0000-7000-8000-000000000002", "Crispy cacio e pepe arancini", "Saffron risotto spheres stuffed with aged pecorino", "CHEF SPECIAL", 24000, true, 15},
	}
	for _, it := range items {
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_items (id, restaurant_id, category_id, name, description, badge_label, base_price_minor, currency)
			VALUES ($1, '01900010-0000-7000-8000-000000000001', $2, $3, $4, $5, $6, 'INR')
			ON CONFLICT (id) DO NOTHING
		`, it.id, it.catID, it.name, it.desc, it.badge, it.price); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_item_inventory (menu_item_id, track_inventory, available_quantity)
			VALUES ($1, $2, $3) ON CONFLICT (menu_item_id) DO NOTHING
		`, it.id, it.track, it.qty); err != nil {
			return err
		}
	}

	// Seed Promotions & Coupons (WELCOMEGOODLY + FREEDELIVERY)
	if _, err := tx.Exec(ctx, `
		INSERT INTO promotional_campaigns (id, name, description, starts_at, ends_at, is_active)
		VALUES ('01900030-0000-7000-8000-000000000001', 'Bengaluru Launch Campaign', 'Welcome & free delivery promo', NOW() - INTERVAL '1 day', NOW() + INTERVAL '365 days', TRUE)
		ON CONFLICT (id) DO NOTHING
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO coupons (id, campaign_id, code, title, discount_type, discount_value, max_discount_minor, min_order_subtotal_minor, starts_at, ends_at, is_active)
		VALUES
		('01900031-0000-7000-8000-000000000001', '01900030-0000-7000-8000-000000000001', 'WELCOMEGOODLY', '20% off up to ₹150.00', 'PERCENTAGE', 2000, 15000, 29900, NOW() - INTERVAL '1 day', NOW() + INTERVAL '365 days', TRUE),
		('01900031-0000-7000-8000-000000000002', '01900030-0000-7000-8000-000000000001', 'FREEDELIVERY', 'Free delivery on orders ₹249+', 'FREE_DELIVERY', 0, NULL, 24900, NOW() - INTERVAL '1 day', NOW() + INTERVAL '365 days', TRUE)
		ON CONFLICT (code) DO NOTHING
	`); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
