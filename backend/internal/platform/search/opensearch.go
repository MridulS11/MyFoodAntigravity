package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	IndexRestaurants = "goodly_restaurants_v1"
	IndexMenuItems   = "goodly_menu_items_v1"
)

// FoodSynonyms defines domain food-family synonym equivalences used by OpenSearch's
// synonym_graph filter so broader category queries (e.g. "pasta", "pizza", "biryani")
// locate every specific dish variety (penne, spaghetti, fettuccine, rigatoni, etc.).
var FoodSynonyms = []string{
	"pasta, penne, spaghetti, fettuccine, rigatoni, fusilli, linguine, macaroni, tagliatelle, ravioli, lasagna, tortellini, gnocchi, farfalle, alfredo, carbonara, bolognese, arrabbiata, aglio olio, cacio e pepe",
	"pizza, margherita, pepperoni, quattro formaggi, napoletana, neapolitan, sourdough pizza, calzone",
	"burger, cheeseburger, veggie burger, smash burger, slider",
	"biryani, pulao, pilaf, dum biryani, hyderabadi biryani, lucknowi biryani",
	"curry, masala, tikka masala, korma, vindaloo, makhani, butter chicken, kadai",
	"bread, naan, garlic naan, roti, paratha, kulcha, focaccia, sourdough, ciabatta, brioche",
	"noodles, ramen, udon, hakka noodles, chowmein, pad thai, pho, soba",
	"bowl, rice bowl, grain bowl, poke, buddha bowl, bibimbap, burrito bowl",
	"salad, caesar, caprese, greek salad, greens",
	"dessert, cake, tiramisu, brownie, cheesecake, pastry, gelato, ice cream, gulab jamun, rasmalai",
	"coffee, espresso, latte, cappuccino, americano, cold brew, flat white, mocha",
	"tea, chai, matcha, green tea, iced tea",
	"chicken, wings, nuggets, tenders, peri peri, tandoori chicken, roast chicken",
	"paneer, cottage cheese",
	"vegan, plant based, plant-based",
	"vegetarian, veg",
	"egg, only egg, non-veg (only egg), eggitarian",
	"gluten free, gluten-free, gf",
}

// GeoPoint represents an OpenSearch geo_point object.
type GeoPoint struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

// RestaurantDoc is the OpenSearch document representation of an approved outlet.
type RestaurantDoc struct {
	ID                      string   `json:"id"`
	Slug                    string   `json:"slug"`
	Name                    string   `json:"name"`
	BrandName               string   `json:"brand_name"`
	BranchName              string   `json:"branch_name"`
	Eyebrow                 string   `json:"eyebrow"`
	Tagline                 string   `json:"tagline"`
	Description             string   `json:"description"`
	Cuisines                []string `json:"cuisines"`
	City                    string   `json:"city"`
	ServiceZoneID           string   `json:"service_zone_id"`
	VerificationStatus      string   `json:"verification_status"`
	IsActive                bool     `json:"is_active"`
	IsAcceptingOrders       bool     `json:"is_accepting_orders"`
	HasActiveMenu           bool     `json:"has_active_menu"`
	MaxDeliveryRadiusMeters int      `json:"max_delivery_radius_meters"`
	Location                GeoPoint `json:"location"`
}

// MenuItemDoc is the OpenSearch document representation of a dish with full culinary/search metadata.
type MenuItemDoc struct {
	ID                           string   `json:"id"`
	RestaurantID                 string   `json:"restaurant_id"`
	RestaurantName               string   `json:"restaurant_name"`
	RestaurantSlug               string   `json:"restaurant_slug"`
	ServiceZoneID                string   `json:"service_zone_id"`
	RestaurantVerificationStatus string   `json:"restaurant_verification_status"`
	RestaurantIsActive           bool     `json:"restaurant_is_active"`
	CategoryID                   string   `json:"category_id"`
	CategoryName                 string   `json:"category_name"`
	Name                         string   `json:"name"`
	Description                  string   `json:"description"`
	BadgeLabel                   string   `json:"badge_label"`
	VegClassification            string   `json:"veg_classification"`
	VegLabel                     string   `json:"veg_label"`
	CuisineType                  string   `json:"cuisine_type"`
	SpiceLevel                   string   `json:"spice_level"`
	ServingSize                  string   `json:"serving_size"`
	DietaryTags                  []string `json:"dietary_tags"`
	Ingredients                  []string `json:"ingredients"`
	Allergens                    []string `json:"allergens"`
	SearchKeywords               []string `json:"search_keywords"`
	CustomizationText            []string `json:"customization_text"`
	IsAvailable                  bool     `json:"is_available"`
	IsActive                     bool     `json:"is_active"`
	IsRecommended                bool     `json:"is_recommended"`
	BasePriceMinor               int64    `json:"base_price_minor"`
	Location                     GeoPoint `json:"location"`
}

// SearchHits returns ordered matched document IDs from OpenSearch.
type SearchHits struct {
	RestaurantIDs []string
	MenuItemIDs   []string
	Engine        string
}

// Client manages OpenSearch/Elasticsearch index schema, bulk/single document sync, and queries.
type Client struct {
	baseURL string
	http    *http.Client

	mu          sync.Mutex
	initialized bool
}

// NewClient creates an OpenSearch/Elasticsearch REST client (returns nil if baseURL is empty).
func NewClient(baseURL string) *Client {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		return nil
	}
	return &Client{
		baseURL: trimmed,
		http:    &http.Client{Timeout: 4 * time.Second},
	}
}

// Ping verifies OpenSearch/Elasticsearch cluster responsiveness.
func (c *Client) Ping(ctx context.Context) error {
	if c == nil {
		return fmt.Errorf("opensearch unconfigured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/_cluster/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("opensearch health status %d", resp.StatusCode)
	}
	return nil
}

// EnsureIndices creates goodly_restaurants_v1 and goodly_menu_items_v1 with the synonym analyzer if absent.
func (c *Client) EnsureIndices(ctx context.Context) error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.initialized {
		return nil
	}

	settings := map[string]any{
		"number_of_shards":   1,
		"number_of_replicas": 0,
		"analysis": map[string]any{
			"filter": map[string]any{
				"goodly_food_synonym_graph": map[string]any{
					"type":     "synonym_graph",
					"synonyms": FoodSynonyms,
				},
			},
			"analyzer": map[string]any{
				"goodly_food_index": map[string]any{
					"type":      "custom",
					"tokenizer": "standard",
					"filter":    []string{"lowercase", "asciifolding", "porter_stem"},
				},
				"goodly_food_search": map[string]any{
					"type":      "custom",
					"tokenizer": "standard",
					"filter":    []string{"lowercase", "asciifolding", "goodly_food_synonym_graph", "porter_stem"},
				},
			},
		},
	}

	analyzedText := map[string]any{
		"type":            "text",
		"analyzer":        "goodly_food_index",
		"search_analyzer": "goodly_food_search",
	}

	restBody := map[string]any{
		"settings": settings,
		"mappings": map[string]any{
			"properties": map[string]any{
				"id":                         map[string]any{"type": "keyword"},
				"slug":                       map[string]any{"type": "keyword"},
				"name":                       analyzedText,
				"brand_name":                 analyzedText,
				"branch_name":                analyzedText,
				"eyebrow":                    analyzedText,
				"tagline":                    analyzedText,
				"description":                analyzedText,
				"cuisines":                   analyzedText,
				"city":                       analyzedText,
				"service_zone_id":            map[string]any{"type": "keyword"},
				"verification_status":        map[string]any{"type": "keyword"},
				"is_active":                  map[string]any{"type": "boolean"},
				"is_accepting_orders":        map[string]any{"type": "boolean"},
				"has_active_menu":            map[string]any{"type": "boolean"},
				"max_delivery_radius_meters": map[string]any{"type": "integer"},
				"location":                   map[string]any{"type": "geo_point"},
			},
		},
	}

	itemBody := map[string]any{
		"settings": settings,
		"mappings": map[string]any{
			"properties": map[string]any{
				"id":                             map[string]any{"type": "keyword"},
				"restaurant_id":                  map[string]any{"type": "keyword"},
				"restaurant_name":                analyzedText,
				"restaurant_slug":                map[string]any{"type": "keyword"},
				"service_zone_id":                map[string]any{"type": "keyword"},
				"restaurant_verification_status": map[string]any{"type": "keyword"},
				"restaurant_is_active":           map[string]any{"type": "boolean"},
				"category_id":                    map[string]any{"type": "keyword"},
				"category_name":                  analyzedText,
				"name":                           analyzedText,
				"description":                    analyzedText,
				"badge_label":                    analyzedText,
				"veg_classification":             map[string]any{"type": "keyword"},
				"veg_label":                      analyzedText,
				"cuisine_type":                   analyzedText,
				"spice_level":                    map[string]any{"type": "keyword"},
				"serving_size":                   map[string]any{"type": "keyword"},
				"dietary_tags":                   analyzedText,
				"ingredients":                    analyzedText,
				"allergens":                      analyzedText,
				"search_keywords":                analyzedText,
				"customization_text":             analyzedText,
				"is_available":                   map[string]any{"type": "boolean"},
				"is_active":                      map[string]any{"type": "boolean"},
				"is_recommended":                 map[string]any{"type": "boolean"},
				"base_price_minor":               map[string]any{"type": "long"},
				"location":                       map[string]any{"type": "geo_point"},
			},
		},
	}

	if err := c.createIndexIfMissing(ctx, IndexRestaurants, restBody); err != nil {
		return err
	}
	if err := c.createIndexIfMissing(ctx, IndexMenuItems, itemBody); err != nil {
		return err
	}
	c.initialized = true
	return nil
}

func (c *Client) createIndexIfMissing(ctx context.Context, indexName string, schema map[string]any) error {
	headReq, err := http.NewRequestWithContext(ctx, http.MethodHead, c.baseURL+"/"+indexName, nil)
	if err != nil {
		return err
	}
	headResp, err := c.http.Do(headReq)
	if err != nil {
		return err
	}
	headResp.Body.Close()
	if headResp.StatusCode == http.StatusOK {
		return nil
	}

	payload, _ := json.Marshal(schema)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, c.baseURL+"/"+indexName, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 && resp.StatusCode != http.StatusBadRequest {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("create index %s failed (%d): %s", indexName, resp.StatusCode, string(raw))
	}
	if resp.StatusCode == http.StatusBadRequest {
		raw, _ := io.ReadAll(resp.Body)
		if !strings.Contains(string(raw), "resource_already_exists_exception") {
			return fmt.Errorf("create index %s failed (400): %s", indexName, string(raw))
		}
	}
	return nil
}

// ReindexAll indexes all active restaurants and menu items from PostgreSQL into OpenSearch.
func (c *Client) ReindexAll(ctx context.Context, pool *pgxpool.Pool) error {
	if c == nil || pool == nil {
		return nil
	}
	if err := c.EnsureIndices(ctx); err != nil {
		return err
	}

	rRows, err := pool.Query(ctx, `
		SELECT r.id, r.slug, r.name, COALESCE(r.brand_name, ''), COALESCE(r.branch_name, ''),
		       COALESCE(r.eyebrow, ''), COALESCE(r.tagline, ''), COALESCE(r.description, ''),
		       r.cuisines, r.city, r.service_zone_id, r.verification_status,
		       r.is_active, r.is_accepting_orders, r.max_delivery_radius_meters,
		       ST_Y(r.location::geometry), ST_X(r.location::geometry),
		       EXISTS (SELECT 1 FROM menu_items mi WHERE mi.restaurant_id = r.id AND mi.is_active = TRUE)
		FROM restaurants r
		JOIN users u ON u.id = r.owner_user_id
		WHERE u.deleted_at IS NULL
	`)
	if err != nil {
		return err
	}
	defer rRows.Close()

	var bulkLines []string
	for rRows.Next() {
		var d RestaurantDoc
		var lat, lng float64
		if err := rRows.Scan(
			&d.ID, &d.Slug, &d.Name, &d.BrandName, &d.BranchName,
			&d.Eyebrow, &d.Tagline, &d.Description,
			&d.Cuisines, &d.City, &d.ServiceZoneID, &d.VerificationStatus,
			&d.IsActive, &d.IsAcceptingOrders, &d.MaxDeliveryRadiusMeters,
			&lat, &lng, &d.HasActiveMenu,
		); err != nil {
			continue
		}
		if d.Cuisines == nil {
			d.Cuisines = []string{}
		}
		d.Location = GeoPoint{Lat: lat, Lon: lng}
		meta, _ := json.Marshal(map[string]any{"index": map[string]any{"_index": IndexRestaurants, "_id": d.ID}})
		docJSON, _ := json.Marshal(d)
		bulkLines = append(bulkLines, string(meta), string(docJSON))
	}
	rRows.Close()

	mRows, err := pool.Query(ctx, `
		SELECT mi.id, mi.restaurant_id, r.name, r.slug, r.service_zone_id,
		       r.verification_status, r.is_active, mi.category_id, COALESCE(mc.name, ''),
		       mi.name, COALESCE(mi.description, ''), COALESCE(mi.badge_label, ''),
		       mi.veg_classification, COALESCE(mi.cuisine_type, ''), mi.spice_level, COALESCE(mi.serving_size, ''),
		       mi.dietary_tags, mi.ingredients, mi.allergens, mi.search_keywords,
		       COALESCE((
		         SELECT ARRAY_AGG(DISTINCT txt)
		         FROM (
		           SELECT mcg.name AS txt FROM menu_customization_groups mcg WHERE mcg.menu_item_id = mi.id
		           UNION ALL
		           SELECT mco.name AS txt FROM menu_customization_options mco
		           JOIN menu_customization_groups mcg ON mcg.id = mco.group_id
		           WHERE mcg.menu_item_id = mi.id
		         ) sub
		       ), '{}'),
		       mi.is_available, mi.is_active, mi.is_recommended, mi.base_price_minor,
		       ST_Y(r.location::geometry), ST_X(r.location::geometry)
		FROM menu_items mi
		JOIN restaurants r ON r.id = mi.restaurant_id
		LEFT JOIN menu_categories mc ON mc.id = mi.category_id
		JOIN users u ON u.id = r.owner_user_id
		WHERE u.deleted_at IS NULL
	`)
	if err != nil {
		return err
	}
	defer mRows.Close()

	for mRows.Next() {
		var d MenuItemDoc
		var lat, lng float64
		if err := mRows.Scan(
			&d.ID, &d.RestaurantID, &d.RestaurantName, &d.RestaurantSlug, &d.ServiceZoneID,
			&d.RestaurantVerificationStatus, &d.RestaurantIsActive, &d.CategoryID, &d.CategoryName,
			&d.Name, &d.Description, &d.BadgeLabel,
			&d.VegClassification, &d.CuisineType, &d.SpiceLevel, &d.ServingSize,
			&d.DietaryTags, &d.Ingredients, &d.Allergens, &d.SearchKeywords,
			&d.CustomizationText, &d.IsAvailable, &d.IsActive, &d.IsRecommended, &d.BasePriceMinor,
			&lat, &lng,
		); err != nil {
			continue
		}
		switch d.VegClassification {
		case "NON_VEG":
			d.VegLabel = "Non-Veg"
		case "EGG_ONLY":
			d.VegLabel = "Non-Veg (Only Egg) Egg Only Eggitarian"
		default:
			d.VegClassification = "VEG"
			d.VegLabel = "Veg Vegetarian"
		}
		if d.DietaryTags == nil {
			d.DietaryTags = []string{}
		}
		if d.Ingredients == nil {
			d.Ingredients = []string{}
		}
		if d.Allergens == nil {
			d.Allergens = []string{}
		}
		if d.SearchKeywords == nil {
			d.SearchKeywords = []string{}
		}
		if d.CustomizationText == nil {
			d.CustomizationText = []string{}
		}
		d.Location = GeoPoint{Lat: lat, Lon: lng}
		meta, _ := json.Marshal(map[string]any{"index": map[string]any{"_index": IndexMenuItems, "_id": d.ID}})
		docJSON, _ := json.Marshal(d)
		bulkLines = append(bulkLines, string(meta), string(docJSON))
	}
	mRows.Close()

	if len(bulkLines) == 0 {
		return nil
	}
	body := strings.Join(bulkLines, "\n") + "\n"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/_bulk?refresh=true", strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("opensearch bulk failed (%d): %s", resp.StatusCode, string(raw))
	}
	return nil
}

// SyncOutlet synchronizes one outlet and all its menu items cleanly into OpenSearch.
func (c *Client) SyncOutlet(ctx context.Context, pool *pgxpool.Pool, outletID string) error {
	if c == nil || pool == nil || strings.TrimSpace(outletID) == "" {
		return nil
	}
	if err := c.EnsureIndices(ctx); err != nil {
		return err
	}
	// Delete stale docs for this outlet first so deleted/deactivated items disappear immediately
	_, _ = c.postJSON(ctx, "/"+IndexMenuItems+"/_delete_by_query?refresh=true", map[string]any{
		"query": map[string]any{"term": map[string]any{"restaurant_id": outletID}},
	})
	// Re-index fresh snapshot from PostgreSQL (fast & consistent)
	return c.ReindexAll(ctx, pool)
}

// Search executes synonym-expanded, fuzzy-tolerant OpenSearch queries across restaurants and menu items.
func (c *Client) Search(ctx context.Context, q, zoneID string, lat, lng float64) (*SearchHits, error) {
	if c == nil {
		return nil, fmt.Errorf("opensearch disabled")
	}
	if err := c.EnsureIndices(ctx); err != nil {
		return nil, err
	}

	term := strings.TrimSpace(q)

	restQuery := map[string]any{
		"size": 50,
		"query": map[string]any{
			"bool": map[string]any{
				"filter": []any{
					map[string]any{"term": map[string]any{"service_zone_id": zoneID}},
					map[string]any{"term": map[string]any{"verification_status": "APPROVED"}},
					map[string]any{"term": map[string]any{"is_active": true}},
					map[string]any{"term": map[string]any{"has_active_menu": true}},
				},
			},
		},
	}
	if term != "" {
		restQuery["query"].(map[string]any)["bool"].(map[string]any)["must"] = []any{
			map[string]any{
				"bool": map[string]any{
					"minimum_should_match": 1,
					"should": []any{
						map[string]any{
							"multi_match": map[string]any{
								"query":    term,
								"fields":   []string{"name^4", "brand_name^3", "branch_name^2", "cuisines^3", "description^1.5", "city"},
								"analyzer": "goodly_food_search",
							},
						},
						map[string]any{
							"multi_match": map[string]any{
								"query":     term,
								"fields":    []string{"name^3", "cuisines^2", "description"},
								"fuzziness": "AUTO",
							},
						},
					},
				},
			},
		}
	}

	restIDs, err := c.runIDSearch(ctx, IndexRestaurants, restQuery)
	if err != nil {
		return nil, err
	}

	var itemIDs []string
	if term != "" {
		itemQuery := map[string]any{
			"size": 50,
			"query": map[string]any{
				"bool": map[string]any{
					"filter": []any{
						map[string]any{"term": map[string]any{"service_zone_id": zoneID}},
						map[string]any{"term": map[string]any{"restaurant_verification_status": "APPROVED"}},
						map[string]any{"term": map[string]any{"restaurant_is_active": true}},
						map[string]any{"term": map[string]any{"is_active": true}},
					},
					"must": []any{
						map[string]any{
							"bool": map[string]any{
								"minimum_should_match": 1,
								"should": []any{
									map[string]any{
										"multi_match": map[string]any{
											"query": term,
											"fields": []string{
												"name^5",
												"search_keywords^4",
												"cuisine_type^3.5",
												"category_name^3",
												"ingredients^2.5",
												"veg_label^2.5",
												"dietary_tags^2",
												"customization_text^2",
												"badge_label^1.5",
												"description^1.5",
												"allergens",
												"restaurant_name^1.2",
											},
											"analyzer": "goodly_food_search",
										},
									},
									map[string]any{
										"multi_match": map[string]any{
											"query": term,
											"fields": []string{
												"name^4",
												"search_keywords^3",
												"cuisine_type^2",
												"category_name^2",
												"ingredients^1.5",
												"description",
											},
											"fuzziness": "AUTO",
										},
									},
								},
							},
						},
					},
				},
			},
		}
		itemIDs, err = c.runIDSearch(ctx, IndexMenuItems, itemQuery)
		if err != nil {
			return nil, err
		}
	}

	return &SearchHits{
		RestaurantIDs: restIDs,
		MenuItemIDs:   itemIDs,
		Engine:        "opensearch",
	}, nil
}

func (c *Client) runIDSearch(ctx context.Context, indexName string, query map[string]any) ([]string, error) {
	raw, err := c.postJSON(ctx, "/"+indexName+"/_search", query)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Hits struct {
			Hits []struct {
				ID string `json:"_id"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(parsed.Hits.Hits))
	for _, h := range parsed.Hits.Hits {
		if h.ID != "" {
			ids = append(ids, h.ID)
		}
	}
	return ids, nil
}

func (c *Client) postJSON(ctx context.Context, path string, body any) ([]byte, error) {
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("opensearch %s error (%d): %s", path, resp.StatusCode, string(raw))
	}
	return raw, nil
}
