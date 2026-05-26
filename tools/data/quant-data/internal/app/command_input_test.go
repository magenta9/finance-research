package app

import "testing"

func TestNormalizeCommandInputHasSpecsForDataMethods(t *testing.T) {
	commandMethods := map[string]bool{
		"repair":  true,
		"rebuild": true,
		"status":  true,
	}
	for _, method := range RequiredMethods {
		if commandMethods[method] {
			continue
		}
		if _, ok := commandInputSpecs[method]; !ok {
			t.Fatalf("commandInputSpecs missing method %q", method)
		}
	}
}

func TestNormalizeCommandInputAcceptsStringifiedNumber(t *testing.T) {
	input, err := normalizeCommandInput("read-price-freshness", map[string]any{"assetId": "asset-1", "maxAgeHours": "24"})
	if err != nil {
		t.Fatalf("normalizeCommandInput returned error: %#v", err)
	}
	if input["maxAgeHours"] != float64(24) {
		t.Fatalf("maxAgeHours = %#v, want 24", input["maxAgeHours"])
	}
}

func TestNormalizeCommandInputRejectsInvalidNumber(t *testing.T) {
	_, err := normalizeCommandInput("read-price-freshness", map[string]any{"assetId": "asset-1", "maxAgeHours": "abc"})
	if err == nil {
		t.Fatalf("expected normalization error")
	}
	if err.Code != MaintenanceCodeInvalidCommandInput || err.Details.(map[string]any)["field"] != "maxAgeHours" {
		t.Fatalf("unexpected error: %#v", err)
	}
	if err.Message != "must be a number" {
		t.Fatalf("message = %q, want must be a number", err.Message)
	}
}

func TestNormalizeCommandInputRejectsInvalidBool(t *testing.T) {
	_, err := normalizeCommandInput("search-assets", map[string]any{"query": "SPY", "exactMatch": "true"})
	if err == nil {
		t.Fatalf("expected normalization error")
	}
	if err.Code != MaintenanceCodeInvalidCommandInput || err.Details.(map[string]any)["field"] != "exactMatch" {
		t.Fatalf("unexpected error: %#v", err)
	}
}

func TestNormalizeCommandInputRejectsCompoundStringField(t *testing.T) {
	_, err := normalizeCommandInput("search-assets", map[string]any{"query": map[string]any{"symbol": "SPY"}})
	if err == nil {
		t.Fatalf("expected normalization error")
	}
	if err.Code != MaintenanceCodeInvalidCommandInput || err.Details.(map[string]any)["field"] != "query" {
		t.Fatalf("unexpected error: %#v", err)
	}
	if err.Message != "must be a string" {
		t.Fatalf("message = %q, want must be a string", err.Message)
	}
}
