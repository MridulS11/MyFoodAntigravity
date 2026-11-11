package menu

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/database"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/search"
)

var (
	ErrNotFound = errors.New("menu resource not found")
)

// CustomizationOption mirrors an add-on / choice inside a customization group.
type CustomizationOption struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	PriceDeltaMinor int64  `json:"price_delta_minor"`
	IsDefault       bool   `json:"is_default"`
	IsAvailable     bool   `json:"is_available"`
}

// CustomizationGroup enforces min/max option rules on a menu item.
type CustomizationGroup struct {
	ID            string                `json:"id"`
	Name          string                `json:"name"`
	MinSelections int                   `json:"min_selections"`
	MaxSelections int                   `json:"max_selections"`
	IsRequired    bool                  `json:"is_required"`
	Options       []CustomizationOption `json:"options"`
}

// MenuItem represents a dish + hybrid inventory & rich search metadata.
type MenuItem struct {
	ID                  string               `json:"id"`
	RestaurantID        string               `json:"restaurant_id"`
	CategoryID          string               `json:"category_id"`
	Name                string               `json:"name"`
	Description         string               `json:"description"`
	BadgeLabel          *string              `json:"badge_label,omitempty"`
	VegClassification   string               `json:"veg_classification"`
	DietaryTags         []string             `json:"dietary_tags"`
	CuisineType         *string              `json:"cuisine_type,omitempty"`
	SpiceLevel          string               `json:"spice_level"`
	CaloriesKcal        *int                 `json:"calories_kcal,omitempty"`
	ServingSize         *string              `json:"serving_size,omitempty"`
	PrepTimeMinutes     *int                 `json:"prep_time_minutes,omitempty"`
	Ingredients         []string             `json:"ingredients"`
	Allergens           []string             `json:"allergens"`
	SearchKeywords      []string             `json:"search_keywords"`
	IsRecommended       bool                 `json:"is_recommended"`
	BasePriceMinor      int64                `json:"base_price_minor"`
	Currency            string               `json:"currency"`
	ImageURL            *string              `json:"image_url,omitempty"`
	IsAvailable         bool                 `json:"is_available"`
	IsActive            bool                 `json:"is_active"`
	TrackInventory      bool                 `json:"track_inventory"`
	AvailableQuantity   int                  `json:"available_quantity"`
	CustomizationGroups []CustomizationGroup `json:"customization_groups"`
}

// RichMenuItemInput carries both core and extended culinary/search/customization fields for a dish.
type RichMenuItemInput struct {
	CategoryID          string
	Name                string
	Description         string
	BadgeLabel          *string
	BasePriceMinor      int64
	TrackInventory      bool
	AvailableQuantity   int
	ImageURL            *string
	VegClassification   string
	DietaryTags         []string
	CuisineType         *string
	SpiceLevel          string
	CaloriesKcal        *int
	ServingSize         *string
	PrepTimeMinutes     *int
	Ingredients         []string
	Allergens           []string
	SearchKeywords      []string
	IsRecommended       bool
	CustomizationGroups []CustomizationGroup
	HasCustomizations   bool
}

// MenuCategory holds ordered dishes inside a section.
type MenuCategory struct {
	ID           string     `json:"id"`
	RestaurantID string     `json:"restaurant_id"`
	Name         string     `json:"name"`
	Subtitle     *string    `json:"subtitle,omitempty"`
	DisplayOrder int        `json:"display_order"`
	IsActive     bool       `json:"is_active"`
	Items        []MenuItem `json:"items"`
}

// ScheduleWindow defines flexible time-of-day / day-of-week visibility.
type ScheduleWindow struct {
	ID           string  `json:"id"`
	OutletID     string  `json:"outlet_id"`
	CategoryID   *string `json:"category_id,omitempty"`
	MenuItemID   *string `json:"menu_item_id,omitempty"`
	ScheduleName string  `json:"schedule_name"`
	DaysOfWeek   []int16 `json:"days_of_week"`
	StartTime    string  `json:"start_time"`
	EndTime      string  `json:"end_time"`
	IsActive     bool    `json:"is_active"`
}

// Repository manages menus, schedules, inventory, Redis cache invalidation, and OpenSearch sync.
type Repository struct {
	pool   *pgxpool.Pool
	rdb    *platformredis.Client
	search *search.Client
}

// NewRepository constructs a menu Repository.
func NewRepository(pool *pgxpool.Pool, rdb *platformredis.Client) *Repository {
	return &Repository{pool: pool, rdb: rdb}
}

// SetSearchClient attaches an OpenSearch/Elasticsearch client for automatic index sync on menu mutations.
func (r *Repository) SetSearchClient(sc *search.Client) {
	r.search = sc
}

// GetRestaurantMenuTree loads all categories, items, inventory, and customization trees for outletID.
func (r *Repository) GetRestaurantMenuTree(ctx context.Context, outletID string, onlyActive bool, searchQuery string) ([]MenuCategory, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, restaurant_id, name, subtitle, display_order, is_active
		FROM menu_categories
		WHERE restaurant_id = $1 AND ($2 = FALSE OR is_active = TRUE)
		ORDER BY display_order ASC, created_at ASC
	`, outletID, onlyActive)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var categories []MenuCategory
	catIndex := map[string]int{}
	for rows.Next() {
		var c MenuCategory
		if err := rows.Scan(&c.ID, &c.RestaurantID, &c.Name, &c.Subtitle, &c.DisplayOrder, &c.IsActive); err != nil {
			return nil, err
		}
		c.Items = []MenuItem{}
		catIndex[c.ID] = len(categories)
		categories = append(categories, c)
	}

	itemRows, err := r.pool.Query(ctx, `
		SELECT mi.id, mi.restaurant_id, mi.category_id, mi.name, COALESCE(mi.description, ''),
		       mi.badge_label, mi.veg_classification, mi.dietary_tags, mi.cuisine_type, mi.spice_level,
		       mi.calories_kcal, mi.serving_size, mi.prep_time_minutes,
		       mi.ingredients, mi.allergens, mi.search_keywords, mi.is_recommended,
		       mi.base_price_minor, mi.currency,
		       mi.image_url, mi.is_available, mi.is_active,
		       COALESCE(inv.track_inventory, FALSE), COALESCE(inv.available_quantity, 0)
		FROM menu_items mi
		LEFT JOIN menu_item_inventory inv ON inv.menu_item_id = mi.id
		WHERE mi.restaurant_id = $1
		  AND ($2 = FALSE OR mi.is_active = TRUE)
		  AND ($3 = '' OR mi.name ILIKE '%' || $3 || '%' OR COALESCE(mi.description,'') ILIKE '%' || $3 || '%' OR EXISTS (SELECT 1 FROM unnest(mi.search_keywords) kw WHERE kw ILIKE '%' || $3 || '%'))
		ORDER BY mi.display_order ASC, mi.created_at ASC
	`, outletID, onlyActive, searchQuery)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()

	itemToCatPos := map[string][2]int{}
	for itemRows.Next() {
		var it MenuItem
		if err := itemRows.Scan(
			&it.ID, &it.RestaurantID, &it.CategoryID, &it.Name, &it.Description,
			&it.BadgeLabel, &it.VegClassification, &it.DietaryTags, &it.CuisineType, &it.SpiceLevel,
			&it.CaloriesKcal, &it.ServingSize, &it.PrepTimeMinutes,
			&it.Ingredients, &it.Allergens, &it.SearchKeywords, &it.IsRecommended,
			&it.BasePriceMinor, &it.Currency,
			&it.ImageURL, &it.IsAvailable, &it.IsActive,
			&it.TrackInventory, &it.AvailableQuantity,
		); err != nil {
			return nil, err
		}
		normalizeMenuItemArrays(&it)
		it.CustomizationGroups = []CustomizationGroup{}
		if cIdx, ok := catIndex[it.CategoryID]; ok {
			pos := len(categories[cIdx].Items)
			categories[cIdx].Items = append(categories[cIdx].Items, it)
			itemToCatPos[it.ID] = [2]int{cIdx, pos}
		}
	}

	// Hydrate customization groups & options in 1 query each per outlet
	grpRows, err := r.pool.Query(ctx, `
		SELECT mcg.id, mcg.menu_item_id, mcg.name, mcg.min_selections, mcg.max_selections, mcg.is_required
		FROM menu_customization_groups mcg
		JOIN menu_items mi ON mi.id = mcg.menu_item_id
		WHERE mi.restaurant_id = $1
		ORDER BY mcg.display_order ASC
	`, outletID)
	if err != nil {
		return nil, err
	}
	defer grpRows.Close()

	grpMap := map[string]*CustomizationGroup{}
	grpOwnerItem := map[string]string{}
	for grpRows.Next() {
		var g CustomizationGroup
		var itemID string
		if err := grpRows.Scan(&g.ID, &itemID, &g.Name, &g.MinSelections, &g.MaxSelections, &g.IsRequired); err != nil {
			return nil, err
		}
		g.Options = []CustomizationOption{}
		grpMap[g.ID] = &g
		grpOwnerItem[g.ID] = itemID
	}

	optRows, err := r.pool.Query(ctx, `
		SELECT mco.id, mco.group_id, mco.name, mco.price_delta_minor, mco.is_default, mco.is_available
		FROM menu_customization_options mco
		JOIN menu_customization_groups mcg ON mcg.id = mco.group_id
		JOIN menu_items mi ON mi.id = mcg.menu_item_id
		WHERE mi.restaurant_id = $1
		ORDER BY mco.display_order ASC
	`, outletID)
	if err != nil {
		return nil, err
	}
	defer optRows.Close()

	for optRows.Next() {
		var o CustomizationOption
		var grpID string
		if err := optRows.Scan(&o.ID, &grpID, &o.Name, &o.PriceDeltaMinor, &o.IsDefault, &o.IsAvailable); err != nil {
			return nil, err
		}
		if g, ok := grpMap[grpID]; ok {
			g.Options = append(g.Options, o)
		}
	}

	for grpID, g := range grpMap {
		if loc, ok := itemToCatPos[grpOwnerItem[grpID]]; ok {
			categories[loc[0]].Items[loc[1]].CustomizationGroups = append(
				categories[loc[0]].Items[loc[1]].CustomizationGroups,
				*g,
			)
		}
	}

	if onlyActive && searchQuery != "" {
		var filtered []MenuCategory
		for _, c := range categories {
			if len(c.Items) > 0 {
				filtered = append(filtered, c)
			}
		}
		return filtered, nil
	}
	if categories == nil {
		categories = []MenuCategory{}
	}
	return categories, nil
}

// CreateCategory adds a new menu section and invalidates outlet caches.
func (r *Repository) CreateCategory(ctx context.Context, outletID, name string, subtitle *string) (*MenuCategory, error) {
	catID := uuid.NewString()
	var cat MenuCategory
	err := r.pool.QueryRow(ctx, `
		INSERT INTO menu_categories (id, restaurant_id, name, subtitle, display_order)
		VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(display_order)+1 FROM menu_categories WHERE restaurant_id = $2), 1))
		RETURNING id, restaurant_id, name, subtitle, display_order, is_active
	`, catID, outletID, name, subtitle).Scan(&cat.ID, &cat.RestaurantID, &cat.Name, &cat.Subtitle, &cat.DisplayOrder, &cat.IsActive)
	if err != nil {
		return nil, err
	}
	cat.Items = []MenuItem{}
	r.InvalidateOutletMenuCache(ctx, outletID)
	return &cat, nil
}

func normalizeMenuItemArrays(it *MenuItem) {
	if it.DietaryTags == nil {
		it.DietaryTags = []string{}
	}
	if it.Ingredients == nil {
		it.Ingredients = []string{}
	}
	if it.Allergens == nil {
		it.Allergens = []string{}
	}
	if it.SearchKeywords == nil {
		it.SearchKeywords = []string{}
	}
	if strings.TrimSpace(it.VegClassification) == "" {
		it.VegClassification = "VEG"
	}
	if strings.TrimSpace(it.SpiceLevel) == "" {
		it.SpiceLevel = "NONE"
	}
	if it.CustomizationGroups == nil {
		it.CustomizationGroups = []CustomizationGroup{}
	}
}

func cleanStringSlice(vals []string) []string {
	out := make([]string, 0, len(vals))
	seen := map[string]bool{}
	for _, v := range vals {
		t := strings.TrimSpace(v)
		if t == "" {
			continue
		}
		key := strings.ToLower(t)
		if !seen[key] {
			seen[key] = true
			out = append(out, t)
		}
	}
	return out
}

func normalizeRichInput(in RichMenuItemInput) RichMenuItemInput {
	in.DietaryTags = cleanStringSlice(in.DietaryTags)
	in.Ingredients = cleanStringSlice(in.Ingredients)
	in.Allergens = cleanStringSlice(in.Allergens)
	in.SearchKeywords = cleanStringSlice(in.SearchKeywords)
	switch strings.ToUpper(strings.TrimSpace(in.VegClassification)) {
	case "NON_VEG", "EGG_ONLY":
		in.VegClassification = strings.ToUpper(strings.TrimSpace(in.VegClassification))
	default:
		in.VegClassification = "VEG"
	}
	switch strings.ToUpper(strings.TrimSpace(in.SpiceLevel)) {
	case "MILD", "MEDIUM", "HOT", "EXTRA_HOT":
		in.SpiceLevel = strings.ToUpper(strings.TrimSpace(in.SpiceLevel))
	default:
		in.SpiceLevel = "NONE"
	}
	return in
}

func replaceItemCustomizationsTx(ctx context.Context, tx pgx.Tx, itemID string, groups []CustomizationGroup) error {
	if _, err := tx.Exec(ctx, `DELETE FROM menu_customization_groups WHERE menu_item_id = $1`, itemID); err != nil {
		return err
	}
	for gIdx, g := range groups {
		gName := strings.TrimSpace(g.Name)
		if gName == "" {
			continue
		}
		gid := uuid.NewString()
		minSel := g.MinSelections
		maxSel := g.MaxSelections
		if maxSel < minSel || maxSel <= 0 {
			maxSel = 1
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_customization_groups (id, menu_item_id, name, min_selections, max_selections, is_required, display_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, gid, itemID, gName, minSel, maxSel, g.IsRequired, gIdx+1); err != nil {
			return err
		}
		for oIdx, opt := range g.Options {
			oName := strings.TrimSpace(opt.Name)
			if oName == "" {
				continue
			}
			oid := uuid.NewString()
			if _, err := tx.Exec(ctx, `
				INSERT INTO menu_customization_options (id, group_id, name, price_delta_minor, is_default, is_available, display_order)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, oid, gid, oName, opt.PriceDeltaMinor, opt.IsDefault, true, oIdx+1); err != nil {
				return err
			}
		}
	}
	return nil
}

// CreateMenuItem inserts a new dish + inventory record + invalidates outlet cache.
func (r *Repository) CreateMenuItem(ctx context.Context, outletID, categoryID, name, description string, badgeLabel *string, basePriceMinor int64, trackInv bool, availQty int) (*MenuItem, error) {
	return r.CreateRichMenuItem(ctx, outletID, RichMenuItemInput{
		CategoryID:        categoryID,
		Name:              name,
		Description:       description,
		BadgeLabel:        badgeLabel,
		BasePriceMinor:    basePriceMinor,
		TrackInventory:    trackInv,
		AvailableQuantity: availQty,
	})
}

// CreateRichMenuItem creates a dish with full culinary, dietary, allergen, search keyword, and customization metadata.
func (r *Repository) CreateRichMenuItem(ctx context.Context, outletID string, rawIn RichMenuItemInput) (*MenuItem, error) {
	in := normalizeRichInput(rawIn)
	itemID := uuid.NewString()
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_items (
				id, restaurant_id, category_id, name, description, badge_label,
				veg_classification, dietary_tags, cuisine_type, spice_level, calories_kcal, serving_size,
				prep_time_minutes, ingredients, allergens, search_keywords, is_recommended,
				base_price_minor, currency, image_url
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'INR', $19)
		`, itemID, outletID, in.CategoryID, in.Name, in.Description, in.BadgeLabel,
			in.VegClassification, in.DietaryTags, in.CuisineType, in.SpiceLevel, in.CaloriesKcal, in.ServingSize,
			in.PrepTimeMinutes, in.Ingredients, in.Allergens, in.SearchKeywords, in.IsRecommended,
			in.BasePriceMinor, in.ImageURL); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_item_inventory (menu_item_id, track_inventory, available_quantity)
			VALUES ($1, $2, $3)
		`, itemID, in.TrackInventory, in.AvailableQuantity); err != nil {
			return err
		}
		if in.HasCustomizations {
			if err := replaceItemCustomizationsTx(ctx, tx, itemID, in.CustomizationGroups); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	r.InvalidateOutletMenuCache(ctx, outletID)
	return r.GetMenuItem(ctx, itemID)
}

// UpdateMenuItem updates an existing dish inside an outlet and invalidates Redis cache.
func (r *Repository) UpdateMenuItem(ctx context.Context, outletID, itemID, categoryID, name, description string, badgeLabel *string, basePriceMinor int64, trackInv bool, availQty int) (*MenuItem, error) {
	return r.UpdateRichMenuItem(ctx, outletID, itemID, RichMenuItemInput{
		CategoryID:        categoryID,
		Name:              name,
		Description:       description,
		BadgeLabel:        badgeLabel,
		BasePriceMinor:    basePriceMinor,
		TrackInventory:    trackInv,
		AvailableQuantity: availQty,
	})
}

// UpdateRichMenuItem updates an existing dish with full culinary/search metadata and optional customization groups.
func (r *Repository) UpdateRichMenuItem(ctx context.Context, outletID, itemID string, rawIn RichMenuItemInput) (*MenuItem, error) {
	in := normalizeRichInput(rawIn)
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE menu_items
			SET category_id = $3, name = $4, description = $5, badge_label = $6,
			    base_price_minor = $7, veg_classification = $8, dietary_tags = $9, cuisine_type = $10,
			    spice_level = $11, calories_kcal = $12, serving_size = $13,
			    prep_time_minutes = $14, ingredients = $15, allergens = $16,
			    search_keywords = $17, is_recommended = $18,
			    image_url = COALESCE($19, image_url),
			    version = version + 1
			WHERE id = $1 AND restaurant_id = $2
		`, itemID, outletID, in.CategoryID, in.Name, in.Description, in.BadgeLabel,
			in.BasePriceMinor, in.VegClassification, in.DietaryTags, in.CuisineType, in.SpiceLevel,
			in.CaloriesKcal, in.ServingSize, in.PrepTimeMinutes, in.Ingredients,
			in.Allergens, in.SearchKeywords, in.IsRecommended, in.ImageURL)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_item_inventory (menu_item_id, track_inventory, available_quantity)
			VALUES ($1, $2, $3)
			ON CONFLICT (menu_item_id) DO UPDATE
			SET track_inventory = EXCLUDED.track_inventory, available_quantity = EXCLUDED.available_quantity
		`, itemID, in.TrackInventory, in.AvailableQuantity); err != nil {
			return err
		}
		if in.HasCustomizations {
			if err := replaceItemCustomizationsTx(ctx, tx, itemID, in.CustomizationGroups); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	r.InvalidateOutletMenuCache(ctx, outletID)
	return r.GetMenuItem(ctx, itemID)
}

// GetMenuItem fetches a single menu item with its inventory state, metadata, and customization groups.
func (r *Repository) GetMenuItem(ctx context.Context, itemID string) (*MenuItem, error) {
	var it MenuItem
	err := r.pool.QueryRow(ctx, `
		SELECT mi.id, mi.restaurant_id, mi.category_id, mi.name, COALESCE(mi.description, ''),
		       mi.badge_label, mi.veg_classification, mi.dietary_tags, mi.cuisine_type, mi.spice_level,
		       mi.calories_kcal, mi.serving_size, mi.prep_time_minutes,
		       mi.ingredients, mi.allergens, mi.search_keywords, mi.is_recommended,
		       mi.base_price_minor, mi.currency,
		       mi.image_url, mi.is_available, mi.is_active,
		       COALESCE(inv.track_inventory, FALSE), COALESCE(inv.available_quantity, 0)
		FROM menu_items mi
		LEFT JOIN menu_item_inventory inv ON inv.menu_item_id = mi.id
		WHERE mi.id = $1
	`, itemID).Scan(
		&it.ID, &it.RestaurantID, &it.CategoryID, &it.Name, &it.Description,
		&it.BadgeLabel, &it.VegClassification, &it.DietaryTags, &it.CuisineType, &it.SpiceLevel,
		&it.CaloriesKcal, &it.ServingSize, &it.PrepTimeMinutes,
		&it.Ingredients, &it.Allergens, &it.SearchKeywords, &it.IsRecommended,
		&it.BasePriceMinor, &it.Currency,
		&it.ImageURL, &it.IsAvailable, &it.IsActive,
		&it.TrackInventory, &it.AvailableQuantity,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	grpRows, err := r.pool.Query(ctx, `
		SELECT id, name, min_selections, max_selections, is_required
		FROM menu_customization_groups
		WHERE menu_item_id = $1
		ORDER BY display_order ASC
	`, itemID)
	if err == nil {
		defer grpRows.Close()
		grpIdx := map[string]int{}
		for grpRows.Next() {
			var g CustomizationGroup
			if grpRows.Scan(&g.ID, &g.Name, &g.MinSelections, &g.MaxSelections, &g.IsRequired) == nil {
				g.Options = []CustomizationOption{}
				grpIdx[g.ID] = len(it.CustomizationGroups)
				it.CustomizationGroups = append(it.CustomizationGroups, g)
			}
		}
		optRows, oErr := r.pool.Query(ctx, `
			SELECT mco.id, mco.group_id, mco.name, mco.price_delta_minor, mco.is_default, mco.is_available
			FROM menu_customization_options mco
			JOIN menu_customization_groups mcg ON mcg.id = mco.group_id
			WHERE mcg.menu_item_id = $1
			ORDER BY mco.display_order ASC
		`, itemID)
		if oErr == nil {
			defer optRows.Close()
			for optRows.Next() {
				var o CustomizationOption
				var gid string
				if optRows.Scan(&o.ID, &gid, &o.Name, &o.PriceDeltaMinor, &o.IsDefault, &o.IsAvailable) == nil {
					if idx, ok := grpIdx[gid]; ok {
						it.CustomizationGroups[idx].Options = append(it.CustomizationGroups[idx].Options, o)
					}
				}
			}
		}
	}

	normalizeMenuItemArrays(&it)
	return &it, nil
}

// ToggleAvailability updates 1-click availability or finite quantity and invalidates Redis cache immediately.
func (r *Repository) ToggleAvailability(ctx context.Context, outletID, itemID string, isAvailable bool, availQty *int) (*MenuItem, error) {
	err := database.WithTx(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE menu_items SET is_available = $3, version = version + 1
			WHERE id = $1 AND restaurant_id = $2
		`, itemID, outletID, isAvailable)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if availQty != nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO menu_item_inventory (menu_item_id, track_inventory, available_quantity)
				VALUES ($1, TRUE, $2)
				ON CONFLICT (menu_item_id) DO UPDATE SET available_quantity = EXCLUDED.available_quantity
			`, itemID, *availQty); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	r.InvalidateOutletMenuCache(ctx, outletID)
	return r.GetMenuItem(ctx, itemID)
}

// ListSchedules lists flexible menu schedules configured for an outlet.
func (r *Repository) ListSchedules(ctx context.Context, outletID string) ([]ScheduleWindow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, outlet_id, category_id, menu_item_id, schedule_name, days_of_week,
		       start_time::text, end_time::text, is_active
		FROM menu_schedules
		WHERE outlet_id = $1
		ORDER BY start_time ASC
	`, outletID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []ScheduleWindow
	for rows.Next() {
		var w ScheduleWindow
		if err := rows.Scan(&w.ID, &w.OutletID, &w.CategoryID, &w.MenuItemID, &w.ScheduleName, &w.DaysOfWeek, &w.StartTime, &w.EndTime, &w.IsActive); err != nil {
			return nil, err
		}
		list = append(list, w)
	}
	if list == nil {
		list = []ScheduleWindow{}
	}
	return list, nil
}

// InvalidateOutletMenuCache deletes cached restaurant menu entries from Redis and syncs OpenSearch immediately after write commits.
func (r *Repository) InvalidateOutletMenuCache(ctx context.Context, outletID string) {
	if r.search != nil {
		_ = r.search.SyncOutlet(ctx, r.pool, outletID)
	}
	if r.rdb == nil || r.rdb.Raw() == nil {
		return
	}
	var slug string
	_ = r.pool.QueryRow(ctx, `SELECT slug FROM restaurants WHERE id = $1`, outletID).Scan(&slug)
	keys := []string{"menu:outlet:" + outletID}
	if slug != "" {
		keys = append(keys, "menu:slug:"+slug)
	}
	_ = r.rdb.Raw().Del(ctx, keys...).Err()
}
