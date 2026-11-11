package discovery

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/modules/menu"
	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/httputil"
)

// Handler exposes public/customer discovery and restaurant menu endpoints.
type Handler struct {
	repo *Repository
}

// NewHandler creates a discovery Handler.
func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// RegisterRoutes attaches discovery endpoints to /api/v1 and /api/v1/customer/discovery.
func (h *Handler) RegisterRoutes(v1 *gin.RouterGroup) {
	mountDisc := func(prefix string) {
		disc := v1.Group(prefix)
		{
			disc.GET("/serviceability", h.serviceability)
			disc.GET("/feed", h.feed)
			disc.GET("/search", h.search)
		}
	}
	mountDisc("/discovery")
	mountDisc("/customer/discovery")
	v1.GET("/restaurants/:slugOrId", h.restaurantMenu)
	v1.GET("/customer/restaurants/:slugOrId", h.restaurantMenu)
}

func parseCoords(c *gin.Context) (float64, float64) {
	lat, err1 := strconv.ParseFloat(c.DefaultQuery("lat", "12.9784"), 64)
	lng, err2 := strconv.ParseFloat(c.DefaultQuery("lng", "77.6408"), 64)
	if err1 != nil || err2 != nil {
		return 12.9784, 77.6408
	}
	return lat, lng
}

func (h *Handler) serviceability(c *gin.Context) {
	lat, lng := parseCoords(c)
	ok, zone, err := h.repo.CheckServiceability(c.Request.Context(), lat, lng)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not check serviceability.", nil)
		return
	}
	httputil.OK(c, gin.H{"serviceable": ok, "zone": zone})
}

func (h *Handler) feed(c *gin.Context) {
	lat, lng := parseCoords(c)
	category := c.Query("category")
	sortBy := c.Query("sort")
	minRating, _ := strconv.ParseFloat(c.DefaultQuery("min_rating", "0"), 64)

	ok, zone, restaurants, err := h.repo.GetFeed(c.Request.Context(), lat, lng, category, sortBy, minRating)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load discovery feed.", nil)
		return
	}

	var spotlight *FeedRestaurant
	for i := range restaurants {
		if restaurants[i].Slug == "sunday-table" {
			spotlight = &restaurants[i]
			break
		}
	}
	if spotlight == nil && len(restaurants) > 0 {
		spotlight = &restaurants[0]
	}

	httputil.OK(c, gin.H{
		"serviceable":          ok,
		"zone":                 zone,
		"spotlight_restaurant": spotlight,
		"restaurants":          restaurants,
	})
}

func (h *Handler) search(c *gin.Context) {
	lat, lng := parseCoords(c)
	q := c.Query("q")
	restaurants, dishes, err := h.repo.Search(c.Request.Context(), q, lat, lng)
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Search failed.", nil)
		return
	}
	httputil.OK(c, gin.H{"restaurants": restaurants, "dishes": dishes})
}

func (h *Handler) restaurantMenu(c *gin.Context) {
	lat, lng := parseCoords(c)
	q := c.Query("q")
	data, err := h.repo.GetRestaurantMenu(c.Request.Context(), c.Param("slugOrId"), lat, lng, q)
	if errors.Is(err, menu.ErrNotFound) {
		httputil.Fail(c, http.StatusNotFound, "NOT_FOUND", "Restaurant not found.", nil)
		return
	}
	if err != nil {
		httputil.Fail(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not load restaurant menu.", nil)
		return
	}
	httputil.OK(c, data)
}
