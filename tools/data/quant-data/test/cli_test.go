package quantdata_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"quant-data/internal/app"
	"quant-data/internal/store"
)

func TestHelpJSON(t *testing.T) {
	stdout, stderr, code := runCommand([]string{"help", "--json"}, "")
	if code != 0 {
		t.Fatalf("expected exit 0, got %d stderr=%s", code, stderr)
	}

	var help app.HelpDocument
	if err := json.Unmarshal(stdout, &help); err != nil {
		t.Fatalf("invalid help JSON: %v", err)
	}
	if help.ContractVersion != app.ContractVersion {
		t.Fatalf("contract version = %q, want %q", help.ContractVersion, app.ContractVersion)
	}
	if len(help.Methods) != len(app.RequiredMethods) {
		t.Fatalf("method count = %d, want %d", len(help.Methods), len(app.RequiredMethods))
	}
}

func TestEnvelopeSchemaIncludesEmittedMaintenanceCodes(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "contracts", "quant-data-cli", "envelope.schema.json"))
	if err != nil {
		t.Fatalf("read envelope schema: %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(content, &schema); err != nil {
		t.Fatalf("parse envelope schema: %v", err)
	}

	properties := schema["properties"].(map[string]any)
	maintenanceError := properties["maintenanceError"].(map[string]any)
	errorProperties := maintenanceError["properties"].(map[string]any)
	codeProperty := errorProperties["code"].(map[string]any)
	enumValues := codeProperty["enum"].([]any)
	codes := map[string]bool{}
	for _, value := range enumValues {
		codes[value.(string)] = true
	}

	for _, code := range []string{app.MaintenanceCodeConfigRequired, app.MaintenanceCodeConfigInsecure, app.MaintenanceCodeInvalidCommandInput, app.MaintenanceCodeProviderUnavailable, app.MaintenanceCodeStoreRepairRequired} {
		if !codes[code] {
			t.Fatalf("envelope schema missing maintenanceError code %s", code)
		}
	}
}

func TestDataMethodReturnsConfigRequiredEnvelope(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())

	envelope := runJSONCommand(t, "search-assets", `{"query":"沪深300"}`)
	if envelope.OK {
		t.Fatalf("expected ok=false envelope")
	}
	if envelope.MaintenanceError == nil || envelope.MaintenanceError.Code != app.MaintenanceCodeConfigRequired {
		t.Fatalf("expected CONFIG_REQUIRED, got %#v", envelope.MaintenanceError)
	}
}

func TestDataMethodRejectsMalformedJSONAsInvalidInput(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())

	envelope := runJSONCommand(t, "search-assets", `{"query":`)
	if envelope.OK {
		t.Fatalf("expected ok=false envelope")
	}
	if envelope.MaintenanceError == nil || envelope.MaintenanceError.Code != app.MaintenanceCodeInvalidCommandInput {
		t.Fatalf("expected INVALID_COMMAND_INPUT, got %#v", envelope.MaintenanceError)
	}
}

func TestDataMethodHardensInsecureConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("QUANT_DATA_HOME", home)

	configDir := filepath.Join(home, "config")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}
	configPath := filepath.Join(configDir, "provider.json")
	if err := os.WriteFile(configPath, []byte(`{"token":"test"}`), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	envelope := runJSONCommand(t, "search-assets", `{"query":"沪深300"}`)
	if envelope.MaintenanceError == nil || envelope.MaintenanceError.Code != app.MaintenanceCodeConfigRequired {
		t.Fatalf("expected CONFIG_REQUIRED for missing TUSHARE_TOKEN, got %#v", envelope.MaintenanceError)
	}
	info, err := os.Stat(configPath)
	if err != nil {
		t.Fatalf("stat config: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected config to be hardened to 0600, got %o", info.Mode().Perm())
	}
}

func TestPriceSeriesEnvelopeIncludesRoutingProvenance(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())
	t.Setenv("QUANT_DATA_FIXTURE_PROVIDER", "1")

	envelope := runJSONCommand(t, "get-price-series", `{"symbol":"SPY","market":"US","start":"2026-05-01","end":"2026-05-03"}`)
	if !envelope.OK {
		t.Fatalf("expected ok=true envelope, got error %#v", envelope.MaintenanceError)
	}
	provenance := envelope.ResultProvenance
	if provenance["sourceId"] != "quant-data-fixture" {
		t.Fatalf("sourceId = %#v, want quant-data-fixture", provenance["sourceId"])
	}
	if provenance["selectedSource"] != "quant-data-fixture" {
		t.Fatalf("selectedSource = %#v, want quant-data-fixture", provenance["selectedSource"])
	}
	attempted := provenance["attemptedProviders"].([]any)
	if len(attempted) != 1 || attempted[0] != "quant-data-fixture" {
		t.Fatalf("attemptedProviders = %#v, want [quant-data-fixture]", attempted)
	}
}

func TestSearchAssetsEnvelopeIncludesRoutingProvenance(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())
	t.Setenv("QUANT_DATA_FIXTURE_PROVIDER", "1")

	envelope := runJSONCommand(t, "search-assets", `{"query":"SPY","market":"US"}`)
	if !envelope.OK {
		t.Fatalf("expected ok=true envelope, got error %#v", envelope.MaintenanceError)
	}
	if assets := envelope.Data.([]any); len(assets) != 1 {
		t.Fatalf("expected data to remain an asset array, got %#v", envelope.Data)
	}
	provenance := envelope.ResultProvenance
	if provenance["sourceId"] != "quant-data-fixture" {
		t.Fatalf("sourceId = %#v, want quant-data-fixture", provenance["sourceId"])
	}
	if provenance["selectedSource"] != "quant-data-fixture" {
		t.Fatalf("selectedSource = %#v, want quant-data-fixture", provenance["selectedSource"])
	}
	attempted := provenance["attemptedProviders"].([]any)
	if len(attempted) != 1 || attempted[0] != "quant-data-fixture" {
		t.Fatalf("attemptedProviders = %#v, want [quant-data-fixture]", attempted)
	}
}

func TestCommandValidationRejectsInvalidInput(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())

	tests := []struct {
		name   string
		method string
		input  string
		field  string
	}{
		{name: "search missing query", method: "search-assets", input: `{}`, field: "query"},
		{name: "search malformed query", method: "search-assets", input: `{"query":true}`, field: "query"},
		{name: "search malformed exact match", method: "search-assets", input: `{"query":"SPY","exactMatch":"true"}`, field: "exactMatch"},
		{name: "price missing symbol", method: "get-price-series", input: `{"start":"2025-01-01","end":"2025-01-31"}`, field: "symbol"},
		{name: "price invalid start", method: "get-price-series", input: `{"symbol":"510300","start":"20250101","end":"2025-01-31"}`, field: "start"},
		{name: "price invalid range", method: "get-price-series", input: `{"symbol":"510300","start":"2025-02-01","end":"2025-01-31"}`, field: "end"},
		{name: "fx missing pair", method: "get-fx-rates", input: `{"start":"2025-01-01","end":"2025-01-31"}`, field: "pair"},
		{name: "fx invalid pair", method: "get-fx-rates", input: `{"pair":"USDCNY","start":"2025-01-01","end":"2025-01-31"}`, field: "pair"},
		{name: "fx incomplete pair", method: "get-fx-rates", input: `{"pair":"USD/","start":"2025-01-01","end":"2025-01-31"}`, field: "pair"},
		{name: "fx multi slash pair", method: "get-fx-rates", input: `{"pair":"USD/CNY/JPY","start":"2025-01-01","end":"2025-01-31"}`, field: "pair"},
		{name: "fundamentals missing symbol", method: "get-fundamentals", input: `{}`, field: "symbol"},
		{name: "flow missing symbol", method: "get-flow-sentiment", input: `{}`, field: "symbol"},
		{name: "news missing symbol", method: "search-news-catalysts", input: `{}`, field: "symbol"},
		{name: "announcements missing symbol", method: "search-announcements", input: `{}`, field: "symbol"},
		{name: "market source missing url", method: "fetch-market-source", input: `{}`, field: "url"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			envelope := runJSONCommand(t, test.method, test.input)
			if envelope.OK {
				t.Fatalf("expected ok=false envelope")
			}
			assertMaintenanceField(t, envelope, app.MaintenanceCodeInvalidCommandInput, test.field)
		})
	}
}

func TestReadCommandValidationRejectsInvalidInput(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())

	tests := []struct {
		name   string
		method string
		input  string
		field  string
	}{
		{name: "read prices missing asset", method: "read-prices", input: `{}`, field: "assetId"},
		{name: "read prices partial range", method: "read-prices", input: `{"assetId":"asset-1","start":"2026-01-01"}`, field: "end"},
		{name: "read price freshness invalid max age", method: "read-price-freshness", input: `{"assetId":"asset-1","maxAgeHours":0}`, field: "maxAgeHours"},
		{name: "read price freshness malformed max age", method: "read-price-freshness", input: `{"assetId":"asset-1","maxAgeHours":"abc"}`, field: "maxAgeHours"},
		{name: "read fx rates invalid pair", method: "read-fx-rates", input: `{"pair":"USDCNY","start":"2026-01-01","end":"2026-01-02"}`, field: "pair"},
		{name: "read fx latest incomplete pair", method: "read-fx-latest", input: `{"pair":"/CNY","onOrBeforeDate":"2026-01-01"}`, field: "pair"},
		{name: "read fx latest invalid date", method: "read-fx-latest", input: `{"pair":"USD/CNY","onOrBeforeDate":"20260101"}`, field: "onOrBeforeDate"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			envelope := runJSONCommand(t, test.method, test.input)
			if envelope.OK {
				t.Fatalf("expected ok=false envelope")
			}
			assertMaintenanceField(t, envelope, app.MaintenanceCodeInvalidCommandInput, test.field)
		})
	}
}

func TestReadCommandsReturnPersistedRowsWithoutProviderConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("QUANT_DATA_HOME", home)
	seedPersistedRows(t, home)

	readEnvelope := runJSONCommand(t, "read-prices", `{"assetId":"asset-510300","start":"2026-05-11","end":"2026-05-14"}`)
	if !readEnvelope.OK {
		t.Fatalf("expected read-prices ok=true, got %#v", readEnvelope.MaintenanceError)
	}
	readData := readEnvelope.Data.(map[string]any)
	if prices := readData["prices"].([]any); len(prices) == 0 {
		t.Fatalf("expected persisted prices, got %#v", readData)
	}

	boundsEnvelope := runJSONCommand(t, "read-price-bounds", `{"assetId":"asset-510300"}`)
	boundsData := boundsEnvelope.Data.(map[string]any)
	bounds := boundsData["bounds"].(map[string]any)
	if bounds["earliestDate"] == nil || bounds["latestDate"] == nil {
		t.Fatalf("expected price bounds, got %#v", bounds)
	}

	freshnessEnvelope := runJSONCommand(t, "read-price-freshness", `{"assetId":"asset-510300","maxAgeHours":24}`)
	freshnessData := freshnessEnvelope.Data.(map[string]any)
	if freshnessData["fresh"] != true {
		t.Fatalf("expected fresh=true, got %#v", freshnessData)
	}

	fxEnvelope := runJSONCommand(t, "read-fx-rates", `{"pair":"USD/CNY","start":"2026-05-11","end":"2026-05-14"}`)
	fxData := fxEnvelope.Data.(map[string]any)
	if rates := fxData["rates"].([]any); len(rates) == 0 {
		t.Fatalf("expected persisted fx rates, got %#v", fxData)
	}

	latestFxEnvelope := runJSONCommand(t, "read-fx-latest", `{"pair":"USD/CNY","onOrBeforeDate":"2026-05-14"}`)
	latestFxData := latestFxEnvelope.Data.(map[string]any)
	if latestFxData["rate"] == nil {
		t.Fatalf("expected latest fx rate, got %#v", latestFxData)
	}

	fxBoundsEnvelope := runJSONCommand(t, "read-fx-bounds", `{"pair":"USD/CNY"}`)
	fxBoundsData := fxBoundsEnvelope.Data.(map[string]any)
	fxBounds := fxBoundsData["bounds"].(map[string]any)
	if fxBounds["earliestDate"] == nil || fxBounds["latestDate"] == nil {
		t.Fatalf("expected fx bounds, got %#v", fxBounds)
	}
}

func TestStatusReturnsSuccessfulEnvelope(t *testing.T) {
	home := t.TempDir()
	t.Setenv("QUANT_DATA_HOME", home)

	envelope := runJSONCommand(t, "status", "")
	if !envelope.OK {
		t.Fatalf("expected ok=true envelope")
	}
	if _, err := os.Stat(filepath.Join(home, "quant-data.sqlite3")); err != nil {
		t.Fatalf("expected sqlite store to be created: %v", err)
	}
	data := envelope.Data.(map[string]any)
	stats := data["stats"].(map[string]any)
	if stats["priceRowCount"] != float64(0) || stats["fxRateRowCount"] != float64(0) || stats["latestPriceFetchAt"] != nil {
		t.Fatalf("unexpected empty stats: %#v", stats)
	}
}

func TestStatusReturnsExternalDataStats(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())
	seedPersistedRows(t, os.Getenv("QUANT_DATA_HOME"))

	envelope := runJSONCommand(t, "status", "")
	if !envelope.OK {
		t.Fatalf("expected ok=true envelope")
	}
	data := envelope.Data.(map[string]any)
	stats := data["stats"].(map[string]any)
	if stats["priceRowCount"].(float64) == 0 {
		t.Fatalf("expected nonzero price stats, got %#v", stats)
	}
	if stats["fxRateRowCount"].(float64) == 0 {
		t.Fatalf("expected nonzero fx stats, got %#v", stats)
	}
	if stats["latestPriceFetchAt"] == nil {
		t.Fatalf("expected latestPriceFetchAt, got %#v", stats)
	}
}

func TestRebuildUpdatesMaintenanceStatus(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())

	envelope := runJSONCommand(t, "rebuild", "")
	if !envelope.OK {
		t.Fatalf("expected ok=true envelope")
	}
	if envelope.MaintenanceStatus["lastAction"] != "hard-rebuild" {
		t.Fatalf("expected hard-rebuild status, got %#v", envelope.MaintenanceStatus)
	}
}

func TestDeletePricesRemovesPersistedFixtureRows(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())
	seedPersistedRows(t, os.Getenv("QUANT_DATA_HOME"))

	deleteInput := `{"assetId":"asset-510300","start":"2026-05-11","end":"2026-05-14"}`
	envelope := runJSONCommand(t, "delete-prices", deleteInput)
	if !envelope.OK {
		t.Fatalf("expected delete ok=true, got %#v", envelope.MaintenanceError)
	}
	data := envelope.Data.(map[string]any)
	if deletedRows, ok := data["deletedRows"].(float64); !ok || deletedRows == 0 {
		t.Fatalf("expected deletedRows > 0, got %#v", data["deletedRows"])
	}
}

func TestDeletePricesRequiresDateRange(t *testing.T) {
	t.Setenv("QUANT_DATA_HOME", t.TempDir())

	envelope := runJSONCommand(t, "delete-prices", `{"assetId":"asset-510300"}`)
	if envelope.OK {
		t.Fatalf("expected ok=false envelope")
	}
	if envelope.MaintenanceError == nil || envelope.MaintenanceError.Code != app.MaintenanceCodeInvalidCommandInput {
		t.Fatalf("expected INVALID_COMMAND_INPUT, got %#v", envelope.MaintenanceError)
	}
}

func TestUnknownMethodReturnsEnvelope(t *testing.T) {
	envelope := runJSONCommand(t, "unknown-method", "")
	if envelope.MaintenanceError == nil || envelope.MaintenanceError.Code != app.MaintenanceCodeInvalidCommandInput {
		t.Fatalf("expected INVALID_COMMAND_INPUT, got %#v", envelope.MaintenanceError)
	}
}

func runCommand(args []string, input string) ([]byte, string, int) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := app.Run(args, bytes.NewBufferString(input), &stdout, &stderr)
	return stdout.Bytes(), stderr.String(), code
}

func runJSONCommand(t *testing.T, method string, input string) app.Envelope {
	t.Helper()
	stdout, stderr, code := runCommand([]string{method}, input)
	if code != 0 {
		t.Fatalf("expected %s exit 0, got %d stderr=%s", method, code, stderr)
	}
	var envelope app.Envelope
	if err := json.Unmarshal(stdout, &envelope); err != nil {
		t.Fatalf("invalid envelope JSON: %v", err)
	}
	return envelope
}

func assertMaintenanceField(t *testing.T, envelope app.Envelope, code string, field string) {
	t.Helper()
	if envelope.MaintenanceError == nil || envelope.MaintenanceError.Code != code {
		t.Fatalf("expected %s, got %#v", code, envelope.MaintenanceError)
	}
	details := envelope.MaintenanceError.Details.(map[string]any)
	if details["field"] != field {
		t.Fatalf("field = %#v, want %s", details["field"], field)
	}
}

func seedPersistedRows(t *testing.T, home string) {
	t.Helper()

	dataStore, err := store.Open(home, app.StoreVersion)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer dataStore.Close()

	closeValue := 3.21
	adjustedCloseValue := 3.18
	if err := dataStore.SavePrices([]store.PriceInput{{
		AssetID:       "asset-510300",
		Date:          "2026-05-11",
		Open:          &closeValue,
		High:          &closeValue,
		Low:           &closeValue,
		Close:         &closeValue,
		AdjustedClose: &adjustedCloseValue,
		Source:        "seed-test",
	}}); err != nil {
		t.Fatalf("save prices: %v", err)
	}
	if err := dataStore.SaveFxRates([]store.FxRateInput{{
		Pair:   "USD/CNY",
		Date:   "2026-05-11",
		Rate:   7.25,
		Source: "seed-test",
	}}); err != nil {
		t.Fatalf("save fx rates: %v", err)
	}
}
