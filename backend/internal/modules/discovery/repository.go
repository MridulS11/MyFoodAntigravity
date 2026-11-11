package discovery

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/menu"
	platformredis "github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/redis"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/search"
)

// ZoneInfo describes a matched active service_zone.
type ZoneInfo struct {
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	City                  string `json:"city"`
	Timezone              string `json:"timezone"`
	Currency              string `json:"currency"`
	BaseDeliveryFeeMinor  int64  `json:"base_delivery_fee_minor"`
	MinCartThresholdMinor int64  `json:"min_cart_threshold_minor"`
	SmallCartFeeMinor     int64  `json:"small_cart_fee_minor"`
}

// FeedRestaurant summarizes an outlet in the customer discovery feed.
type FeedRestaurant struct {
	ID                   string   `json:"id"`
	Slug                 string   `json:"slug"`
	Name                 string   `json:"name"`
	Eyebrow              *string  `json:"eyebrow,omitempty"`
	Tagline              *string  `json:"tagline,omitempty"`
	Description          *string  `json:"description,omitempty"`
	Cuisines             []string `json:"cuisines"`
	HeroImageURL         *string  `json:"hero_image_url,omitempty"`
	IsAcceptingOrders    bool     `json:"is_accepting_orders"`
	AvgPrepTimeMinutes   int      `json:"avg_prep_time_minutes"`
	EstimatedDeliveryMin int      `json:"estimated_delivery_min"`
	EstimatedDeliveryMax int      `json:"estimated_delivery_max"`
	DeliveryFeeMinor     int64    `json:"delivery_fee_minor"`
	MinCartThresholdMinor int64   `json:"min_cart_threshold_minor"`
	PackagingFeeMinor    int64    `json:"packaging_fee_minor"`
	Currency             string   `json:"currency"`
	RatingAverage        float64  `json:"rating_average"`
	RatingCount          int      `json:"rating_count"`
	DistanceMeters       int      `json:"distance_meters"`
}

// DishHit pairs a matched dish with its parent outlet.
type DishHit struct {
	Item       menu.MenuItem  `json:"item"`
	Restaurant FeedRestaurant `json:"restaurant"`
}

// RestaurantWithMenu combines full outlet details and active categorized dishes.
type RestaurantWithMenu struct {
	Restaurant FeedRestaurant      `json:"restaurant"`
	Categories []menu.MenuCategory `json:"categories"`
}

// Repository executes PostGIS discovery/search queries with OpenSearch and Redis read-through caching.
type Repository struct {
	pool     *pgxpool.Pool
	menuRepo *menu.Repository
	rdb      *platformredis.Client
	search   *search.Client
}

// NewRepository constructs a discovery Repository.
func NewRepository(pool *pgxpool.Pool, menuRepo *menu.Repository, rdb *platformredis.Client) *Repository {
	return &Repository{pool: pool, menuRepo: menuRepo, rdb: rdb}
}

// SetSearchClient attaches an OpenSearch/Elasticsearch client for full-text & synonym discovery search.
func (r *Repository) SetSearchClient(sc *search.Client) {
	r.search = sc
}

// CheckServiceability uses PostGIS ST_Covers to find an active zone containing (lat, lng).
func (r *Repository) CheckServiceability(ctx context.Context, lat, lng float64) (bool, *ZoneInfo, error) {
	var z ZoneInfo
	err := r.pool.QueryRow(ctx, `
		SELECT id, name, city, timezone, currency, base_delivery_fee_minor, min_cart_threshold_minor, small_cart_fee_minor
		FROM service_zones
		WHERE is_active = TRUE
		  AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		LIMIT 1
	`, lng, lat).Scan(&z.ID, &z.Name, &z.City, &z.Timezone, &z.Currency, &z.BaseDeliveryFeeMinor, &z.MinCartThresholdMinor, &z.SmallCartFeeMinor)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return true, &z, nil
}

// GetFeed queries approved active outlets within ST_DWithin radius for a serviceable point.
func (r *Repository) GetFeed(ctx context.Context, lat, lng float64, category, sortBy string, minRating float64) (bool, *ZoneInfo, []FeedRestaurant, error) {
	ok, zone, err := r.CheckServiceability(ctx, lat, lng)
	if err != nil || !ok {
		return ok, zone, []FeedRestaurant{}, err
	}

	orderClause := "r.rating_average DESC, dist_m ASC"
	switch sortBy {
	case "fastest":
		orderClause = "r.avg_prep_time_minutes ASC, dist_m ASC"
	case "rating":
		orderClause = "r.rating_average DESC"
	}

	rows, err := r.pool.Query(ctx, `
		SELECT r.id, r.slug, r.name, r.eyebrow, r.tagline, r.description, r.cuisines,
		       r.hero_image_url, r.is_accepting_orders, r.avg_prep_time_minutes,
		       r.packaging_fee_minor, r.rating_average::float8, r.rating_count,
		       ROUND(ST_Distance(r.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography))::int AS dist_m
		FROM restaurants r
		WHERE r.service_zone_id = $3
		  AND r.verification_status = 'APPROVED'
		  AND r.is_active = TRUE
		  AND EXISTS (
			SELECT 1 FROM menu_items mi
			WHERE mi.restaurant_id = r.id AND mi.is_active = TRUE
		  )
		  AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, r.max_delivery_radius_meters)
		  AND ($4 = '' OR $4 = 'all' OR EXISTS (SELECT 1 FROM unnest(r.cuisines) c WHERE LOWER(c) = LOWER($4)))
		  AND ($5 <= 0 OR r.rating_average >= $5)
		ORDER BY `+orderClause,
		lng, lat, zone.ID, category, minRating,
	)
	if err != nil {
		return true, zone, nil, err
	}
	defer rows.Close()

	var list []FeedRestaurant
	for rows.Next() {
		var fr FeedRestaurant
		if err := rows.Scan(
			&fr.ID, &fr.Slug, &fr.Name, &fr.Eyebrow, &fr.Tagline, &fr.Description, &fr.Cuisines,
			&fr.HeroImageURL, &fr.IsAcceptingOrders, &fr.AvgPrepTimeMinutes,
			&fr.PackagingFeeMinor, &fr.RatingAverage, &fr.RatingCount, &fr.DistanceMeters,
		); err != nil {
			return true, zone, nil, err
		}
		if fr.Cuisines == nil {
			fr.Cuisines = []string{}
		}
		fr.Currency = zone.Currency
		fr.DeliveryFeeMinor = zone.BaseDeliveryFeeMinor
		fr.MinCartThresholdMinor = zone.MinCartThresholdMinor
		fr.EstimatedDeliveryMin = fr.AvgPrepTimeMinutes
		fr.EstimatedDeliveryMax = fr.AvgPrepTimeMinutes + 12
		list = append(list, fr)
	}
	if list == nil {
		list = []FeedRestaurant{}
	}
	return true, zone, list, nil
}

// Search executes OpenSearch (with food-family synonyms & fuzziness) and falls back cleanly to PostgreSQL if OpenSearch is unavailable.
func (r *Repository) Search(ctx context.Context, q string, lat, lng float64) ([]FeedRestaurant, []DishHit, error) {
	ok, zone, allRest, err := r.GetFeed(ctx, lat, lng, "", "", 0)
	if err != nil || !ok {
		return []FeedRestaurant{}, []DishHit{}, err
	}

	restLookup := map[string]FeedRestaurant{}
	for _, fr := range allRest {
		restLookup[fr.ID] = fr
	}

	// Primary path: OpenSearch/Elasticsearch synonym-expanded & fuzzy search
	if r.search != nil {
		if hits, sErr := r.search.Search(ctx, q, zone.ID, lat, lng); sErr == nil && hits != nil {
			var restMatches []FeedRestaurant
			seenRest := map[string]bool{}
			for _, id := range hits.RestaurantIDs {
				if fr, exists := restLookup[id]; exists && !seenRest[id] {
					seenRest[id] = true
					restMatches = append(restMatches, fr)
				}
			}
			var dishHits []DishHit
			seenItems := map[string]bool{}
			for _, itemID := range hits.MenuItemIDs {
				if seenItems[itemID] {
					continue
				}
				seenItems[itemID] = true
				if item, gErr := r.menuRepo.GetMenuItem(ctx, itemID); gErr == nil {
					if rest, exists := restLookup[item.RestaurantID]; exists {
						dishHits = append(dishHits, DishHit{Item: *item, Restaurant: rest})
					}
				}
			}
			if restMatches == nil {
				restMatches = []FeedRestaurant{}
			}
			if dishHits == nil {
				dishHits = []DishHit{}
			}
			return restMatches, dishHits, nil
		}
	}

	// Fallback path: PostgreSQL trigram/ILIKE/metadata array matching
	rows, err := r.pool.Query(ctx, `
		SELECT r.id
		FROM restaurants r
		WHERE r.service_zone_id = $1
		  AND r.verification_status = 'APPROVED'
		  AND r.is_active = TRUE
		  AND EXISTS (
			SELECT 1 FROM menu_items mi
			WHERE mi.restaurant_id = r.id AND mi.is_active = TRUE
		  )
		  AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, r.max_delivery_radius_meters)
		  AND (
			$4 = '' OR r.name ILIKE '%' || $4 || '%'
			OR COALESCE(r.description,'') ILIKE '%' || $4 || '%'
			OR EXISTS (SELECT 1 FROM unnest(r.cuisines) c WHERE c ILIKE '%' || $4 || '%')
		  )
	`, zone.ID, lng, lat, q)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	matchedIDs := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, nil, err
		}
		matchedIDs[id] = true
	}

	var restMatches []FeedRestaurant
	for _, fr := range allRest {
		if q == "" || matchedIDs[fr.ID] {
			restMatches = append(restMatches, fr)
		}
	}

	var dishHits []DishHit
	if q != "" {
		dRows, err := r.pool.Query(ctx, `
			SELECT mi.id, mi.restaurant_id
			FROM menu_items mi
			JOIN restaurants r ON r.id = mi.restaurant_id
			LEFT JOIN menu_categories mc ON mc.id = mi.category_id
			WHERE r.service_zone_id = $1
			  AND r.verification_status = 'APPROVED'
			  AND r.is_active = TRUE
			  AND mi.is_active = TRUE
			  AND (
				mi.name ILIKE '%' || $2 || '%'
				OR COALESCE(mi.description,'') ILIKE '%' || $2 || '%'
				OR COALESCE(mi.cuisine_type,'') ILIKE '%' || $2 || '%'
				OR COALESCE(mc.name,'') ILIKE '%' || $2 || '%'
				OR EXISTS (SELECT 1 FROM unnest(mi.search_keywords) kw WHERE kw ILIKE '%' || $2 || '%')
				OR EXISTS (SELECT 1 FROM unnest(mi.ingredients) ing WHERE ing ILIKE '%' || $2 || '%')
				OR EXISTS (SELECT 1 FROM unnest(mi.dietary_tags) dt WHERE dt ILIKE '%' || $2 || '%')
				OR mi.veg_classification ILIKE '%' || $2 || '%'
			  )
			LIMIT 25
		`, zone.ID, q)
		if err != nil {
			return nil, nil, err
		}
		defer dRows.Close()

		for dRows.Next() {
			var itemID, restID string
			if err := dRows.Scan(&itemID, &restID); err != nil {
				return nil, nil, err
			}
			if rest, ok := restLookup[restID]; ok {
				if item, gErr := r.menuRepo.GetMenuItem(ctx, itemID); gErr == nil {
					dishHits = append(dishHits, DishHit{Item: *item, Restaurant: rest})
				}
			}
		}
	}

	if restMatches == nil {
		restMatches = []FeedRestaurant{}
	}
	if dishHits == nil {
		dishHits = []DishHit{}
	}
	return restMatches, dishHits, nil
}

// GetRestaurantMenu returns outlet details and active categorized dishes using Redis cache on full-menu reads.
func (r *Repository) GetRestaurantMenu(ctx context.Context, slugOrID string, lat, lng float64, query string) (*RestaurantWithMenu, error) {
	cacheKey := "menu:slug:" + slugOrID
	if query == "" && r.rdb != nil && r.rdb.Raw() != nil {
		if cached, err := r.rdb.Raw().Get(ctx, cacheKey).Bytes(); err == nil {
			var hit RestaurantWithMenu
			if uErr := json.Unmarshal(cached, &hit); uErr == nil {
				return &hit, nil
			}
		}
	}

	var fr FeedRestaurant
	var currency string
	var baseDelivery, minCart int64
	err := r.pool.QueryRow(ctx, `
		SELECT r.id, r.slug, r.name, r.eyebrow, r.tagline, r.description, r.cuisines,
		       r.hero_image_url, r.is_accepting_orders, r.avg_prep_time_minutes,
		       r.packaging_fee_minor, r.rating_average::float8, r.rating_count,
		       ROUND(ST_Distance(r.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography))::int AS dist_m,
		       sz.currency, sz.base_delivery_fee_minor, sz.min_cart_threshold_minor
		FROM restaurants r
		JOIN service_zones sz ON sz.id = r.service_zone_id
		WHERE r.slug = $1 OR r.id::text = $1
		LIMIT 1
	`, slugOrID, lng, lat).Scan(
		&fr.ID, &fr.Slug, &fr.Name, &fr.Eyebrow, &fr.Tagline, &fr.Description, &fr.Cuisines,
		&fr.HeroImageURL, &fr.IsAcceptingOrders, &fr.AvgPrepTimeMinutes,
		&fr.PackagingFeeMinor, &fr.RatingAverage, &fr.RatingCount, &fr.DistanceMeters,
		&currency, &baseDelivery, &minCart,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, menu.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if fr.Cuisines == nil {
		fr.Cuisines = []string{}
	}
	fr.Currency = currency
	fr.DeliveryFeeMinor = baseDelivery
	fr.MinCartThresholdMinor = minCart
	fr.EstimatedDeliveryMin = fr.AvgPrepTimeMinutes
	fr.EstimatedDeliveryMax = fr.AvgPrepTimeMinutes + 12

	cats, err := r.menuRepo.GetRestaurantMenuTree(ctx, fr.ID, true, query)
	if err != nil {
		return nil, err
	}

	res := &RestaurantWithMenu{Restaurant: fr, Categories: cats}
	if query == "" && r.rdb != nil && r.rdb.Raw() != nil {
		if encoded, mErr := json.Marshal(res); mErr == nil {
			_ = r.rdb.Raw().Set(ctx, cacheKey, encoded, 5*time.Minute).Err()
		}
	}
	return res, nil
}
