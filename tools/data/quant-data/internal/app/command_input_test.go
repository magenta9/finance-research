package app

import (
	"bytes"
	"encoding/json"
	"testing"
)

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

func TestNormalizeCommandInputCanonicalizesFxPair(t *testing.T) {
	input, err := normalizeCommandInput("read-fx-latest", map[string]any{"pair": " usd / cny ", "onOrBeforeDate": "2026-05-14"})
	if err != nil {
		t.Fatalf("normalizeCommandInput returned error: %#v", err)
	}
	if input["pair"] != "USD/CNY" {
		t.Fatalf("pair = %#v, want USD/CNY", input["pair"])
	}
}

func TestNormalizeCommandInputCanonicalizesMarketAndAssetClass(t *testing.T) {
	input, err := normalizeCommandInput("search-assets", map[string]any{"query": "SPY", "market": " us ", "assetClass": " EQUITY "})
	if err != nil {
		t.Fatalf("normalizeCommandInput returned error: %#v", err)
	}
	if input["market"] != "US" {
		t.Fatalf("market = %#v, want US", input["market"])
	}
	if input["assetClass"] != "equity" {
		t.Fatalf("assetClass = %#v, want equity", input["assetClass"])
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

func TestNormalizeCommandInputRejectsNonFiniteNumber(t *testing.T) {
	_, err := normalizeCommandInput("read-price-freshness", map[string]any{"assetId": "asset-1", "maxAgeHours": "NaN"})
	if err == nil {
		t.Fatalf("expected normalization error")
	}
	if err.Message != "must be a finite number" {
		t.Fatalf("message = %q, want must be a finite number", err.Message)
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

func TestUnknownStoreOnlyMethodIsInvalidCommandInput(t *testing.T) {
	var stdout bytes.Buffer
	runStoreOnlyMethod("unexpected-store-method", map[string]any{}, nil, emptyMaintenanceStatus(), &stdout)

	var envelope Envelope
	if err := json.Unmarshal(stdout.Bytes(), &envelope); err != nil {
		t.Fatalf("invalid envelope JSON: %v", err)
	}
	if envelope.MaintenanceError == nil || envelope.MaintenanceError.Code != MaintenanceCodeInvalidCommandInput {
		t.Fatalf("expected INVALID_COMMAND_INPUT, got %#v", envelope.MaintenanceError)
	}
}
