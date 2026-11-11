package search_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/MridulS11/MyFoodAntigravity/backend/internal/platform/search"
)

func TestOpenSearchFoodSynonymsAndClusterIntegration(t *testing.T) {
	url := os.Getenv("OPENSEARCH_URL")
	if url == "" {
		url = "http://localhost:9200"
	}
	client := search.NewClient(url)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := client.Ping(ctx); err != nil {
		t.Skipf("opensearch not reachable at %s (%v); skipping live cluster test", url, err)
	}

	require.NoError(t, client.EnsureIndices(ctx))
	// Check FoodSynonyms contains pasta -> penne, spaghetti, fettuccine, rigatoni
	foundPasta := false
	for _, s := range search.FoodSynonyms {
		if assert.NotEmpty(t, s) && len(s) > 0 {
			if containsAllTerms(s, "pasta", "penne", "spaghetti", "fettuccine", "rigatoni") {
				foundPasta = true
			}
		}
	}
	assert.True(t, foundPasta, "FoodSynonyms must map pasta to penne, spaghetti, fettuccine, and rigatoni")
}

func containsAllTerms(haystack string, terms ...string) bool {
	for _, term := range terms {
		found := false
		for i := 0; i+len(term) <= len(haystack); i++ {
			if haystack[i:i+len(term)] == term {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}
