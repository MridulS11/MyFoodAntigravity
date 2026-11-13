package storage

import (
	"strings"
	"testing"
)

func TestBuildAndParseObjectKey(t *testing.T) {
	menuKey, err := BuildMenuObjectKey("outlet_123", "Paneer Tikka.jpg")
	if err != nil {
		t.Fatalf("unexpected error building menu key: %v", err)
	}
	if !strings.HasPrefix(menuKey, "Menu/outlet_123/") || !strings.HasSuffix(menuKey, "-Paneer-Tikka.jpg") {
		t.Fatalf("unexpected menu key format: %q", menuKey)
	}

	cat, sub, scope, err := ParseObjectKey(menuKey)
	if err != nil {
		t.Fatalf("unexpected error parsing menu key: %v", err)
	}
	if cat != CategoryMenu || sub != "" || scope != "outlet_123" {
		t.Fatalf("got (%v, %v, %q), want (Menu, '', outlet_123)", cat, sub, scope)
	}

	outletVerKey, err := BuildVerificationObjectKey(VerificationOutlet, "outlet_456", "../fssai cert.pdf")
	if err != nil {
		t.Fatalf("unexpected error building outlet verification key: %v", err)
	}
	if !strings.HasPrefix(outletVerKey, "Verification/Outlet/outlet_456/") || !strings.HasSuffix(outletVerKey, "-fssai-cert.pdf") {
		t.Fatalf("unexpected outlet verification key format: %q", outletVerKey)
	}
	cat, sub, scope, err = ParseObjectKey(outletVerKey)
	if err != nil || cat != CategoryVerification || sub != VerificationOutlet || scope != "outlet_456" {
		t.Fatalf("unexpected parse result for outlet verification: (%v, %v, %q, %v)", cat, sub, scope, err)
	}

	riderVerKey, err := BuildVerificationObjectKey(VerificationRider, "rider_789", "dl.png")
	if err != nil {
		t.Fatalf("unexpected error building rider verification key: %v", err)
	}
	if !strings.HasPrefix(riderVerKey, "Verification/Rider/rider_789/") || !strings.HasSuffix(riderVerKey, "-dl.png") {
		t.Fatalf("unexpected rider verification key format: %q", riderVerKey)
	}
	cat, sub, scope, err = ParseObjectKey(riderVerKey)
	if err != nil || cat != CategoryVerification || sub != VerificationRider || scope != "rider_789" {
		t.Fatalf("unexpected parse result for rider verification: (%v, %v, %q, %v)", cat, sub, scope, err)
	}

	if _, _, _, err := ParseObjectKey("Verification/outlet_123/file.png"); err == nil {
		t.Fatal("expected error for verification key missing Outlet/Rider sub-key")
	}
	if _, _, _, err := ParseObjectKey("Other/outlet_123/file.png"); err == nil {
		t.Fatal("expected error for invalid category prefix")
	}
	if _, _, _, err := ParseObjectKey("Menu/../secret.txt"); err == nil {
		t.Fatal("expected error for path traversal")
	}
}
