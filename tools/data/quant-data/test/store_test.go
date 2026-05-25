package quantdata_test

import (
	"testing"
	"time"

	"quant-data/internal/store"
)

func floatPtr(value float64) *float64 {
	return &value
}

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	dataStore, err := store.Open(t.TempDir(), 1)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
	return dataStore
}

func TestSavePricesFillsSameSourceGapsWithoutDroppingExistingFields(t *testing.T) {
	dataStore := openTestStore(t)

	if err := dataStore.SavePrices([]store.PriceInput{{
		AdjustedClose: floatPtr(10),
		AssetID:       "asset-1",
		Close:         floatPtr(10),
		Date:          "2026-01-02",
		Low:           floatPtr(9),
		Source:        "akshare",
	}}); err != nil {
		t.Fatalf("save existing: %v", err)
	}
	if err := dataStore.SavePrices([]store.PriceInput{{
		AssetID: "asset-1",
		Date:    "2026-01-02",
		High:    floatPtr(10.5),
		Open:    floatPtr(10.1),
		Source:  "akshare",
	}}); err != nil {
		t.Fatalf("save incoming: %v", err)
	}

	rows, err := dataStore.GetPriceRange("asset-1", "2026-01-02", "2026-01-02")
	if err != nil {
		t.Fatalf("get price range: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %#v, want one row", rows)
	}
	row := rows[0]
	if row.Open == nil || *row.Open != 10.1 || row.High == nil || *row.High != 10.5 {
		t.Fatalf("expected incoming gaps to be filled, got %#v", row)
	}
	if row.Low == nil || *row.Low != 9 || row.Close == nil || *row.Close != 10 || row.AdjustedClose == nil || *row.AdjustedClose != 10 {
		t.Fatalf("expected existing fields to be preserved, got %#v", row)
	}
	if row.Source != "akshare" {
		t.Fatalf("source = %q, want akshare", row.Source)
	}
}

func TestSavePricesKeepsMoreCompleteExistingRowAcrossSources(t *testing.T) {
	dataStore := openTestStore(t)

	if err := dataStore.SavePrices([]store.PriceInput{{
		AdjustedClose: floatPtr(10),
		AssetID:       "asset-1",
		Close:         floatPtr(10),
		Date:          "2026-01-02",
		High:          floatPtr(10.5),
		Low:           floatPtr(9.5),
		Open:          floatPtr(10.1),
		Source:        "tushare",
	}}); err != nil {
		t.Fatalf("save existing: %v", err)
	}
	if err := dataStore.SavePrices([]store.PriceInput{{
		AssetID: "asset-1",
		Close:   floatPtr(10),
		Date:    "2026-01-02",
		Source:  "yfinance-derived",
	}}); err != nil {
		t.Fatalf("save incoming: %v", err)
	}

	rows, err := dataStore.GetPriceRange("asset-1", "2026-01-02", "2026-01-02")
	if err != nil {
		t.Fatalf("get price range: %v", err)
	}
	row := rows[0]
	if row.Source != "tushare" {
		t.Fatalf("source = %q, want tushare", row.Source)
	}
	if row.High == nil || *row.High != 10.5 || row.Low == nil || *row.Low != 9.5 || row.Open == nil || *row.Open != 10.1 {
		t.Fatalf("expected complete existing row to be preserved, got %#v", row)
	}
}

func TestSavePricesReplacesLessCompleteExistingRowAcrossSources(t *testing.T) {
	dataStore := openTestStore(t)

	if err := dataStore.SavePrices([]store.PriceInput{{
		AssetID: "asset-1",
		Close:   floatPtr(10),
		Date:    "2026-01-02",
		Source:  "akshare",
	}}); err != nil {
		t.Fatalf("save existing: %v", err)
	}
	if err := dataStore.SavePrices([]store.PriceInput{{
		AdjustedClose: floatPtr(11),
		AssetID:       "asset-1",
		Close:         floatPtr(11),
		Date:          "2026-01-02",
		High:          floatPtr(11.5),
		Low:           floatPtr(10.5),
		Open:          floatPtr(10.8),
		Source:        "tushare",
	}}); err != nil {
		t.Fatalf("save incoming: %v", err)
	}

	rows, err := dataStore.GetPriceRange("asset-1", "2026-01-02", "2026-01-02")
	if err != nil {
		t.Fatalf("get price range: %v", err)
	}
	row := rows[0]
	if row.Source != "tushare" {
		t.Fatalf("source = %q, want tushare", row.Source)
	}
	if row.AdjustedClose == nil || *row.AdjustedClose != 11 || row.High == nil || *row.High != 11.5 {
		t.Fatalf("expected more complete incoming row, got %#v", row)
	}
}

func TestPriceReadModelReturnsRowsBoundsAndFreshness(t *testing.T) {
	dataStore := openTestStore(t)

	if err := dataStore.SavePrices([]store.PriceInput{
		{AssetID: "asset-1", Close: floatPtr(10), Date: "2026-01-02", Source: "akshare"},
		{AssetID: "asset-1", Close: floatPtr(11), Date: "2026-01-03", Source: "akshare"},
		{AssetID: "asset-2", Close: floatPtr(20), Date: "2026-01-03", Source: "akshare"},
	}); err != nil {
		t.Fatalf("save prices: %v", err)
	}

	rows, err := dataStore.ListPricesByAsset("asset-1")
	if err != nil {
		t.Fatalf("list prices: %v", err)
	}
	if len(rows) != 2 || rows[0].Date != "2026-01-02" || rows[1].Date != "2026-01-03" {
		t.Fatalf("unexpected listed rows: %#v", rows)
	}
	if rows[0].FetchedAt == "" {
		t.Fatalf("expected fetchedAt to be populated: %#v", rows[0])
	}

	rangeRows, err := dataStore.GetPriceRange("asset-1", "2026-01-03", "2026-01-03")
	if err != nil {
		t.Fatalf("get price range: %v", err)
	}
	if len(rangeRows) != 1 || rangeRows[0].Date != "2026-01-03" {
		t.Fatalf("unexpected range rows: %#v", rangeRows)
	}

	bounds, err := dataStore.GetPriceDateBounds("asset-1")
	if err != nil {
		t.Fatalf("get price date bounds: %v", err)
	}
	if bounds.EarliestDate == nil || *bounds.EarliestDate != "2026-01-02" || bounds.LatestDate == nil || *bounds.LatestDate != "2026-01-03" {
		t.Fatalf("unexpected bounds: %#v", bounds)
	}

	fresh, err := dataStore.IsPriceFresh("asset-1", 24, time.Now().UTC())
	if err != nil {
		t.Fatalf("is price fresh: %v", err)
	}
	if !fresh {
		t.Fatalf("expected recently saved rows to be fresh")
	}
}

func TestFxReadModelReturnsLatestBoundsAndRange(t *testing.T) {
	dataStore := openTestStore(t)

	if err := dataStore.SaveFxRates([]store.FxRateInput{
		{Date: "2026-01-02", Pair: "USD/CNY", Rate: 7.1, Source: "fixture"},
		{Date: "2026-01-03", Pair: "USD/CNY", Rate: 7.2, Source: "fixture"},
		{Date: "2026-01-03", Pair: "EUR/CNY", Rate: 8.1, Source: "fixture"},
	}); err != nil {
		t.Fatalf("save fx rates: %v", err)
	}

	latestRate, err := dataStore.GetLatestFxRate("USD/CNY", "2026-01-02")
	if err != nil {
		t.Fatalf("get latest fx rate: %v", err)
	}
	if latestRate == nil || latestRate.Date != "2026-01-02" || latestRate.Rate != 7.1 {
		t.Fatalf("unexpected latest rate: %#v", latestRate)
	}

	rangeRows, err := dataStore.GetFxRange("USD/CNY", "2026-01-02", "2026-01-03")
	if err != nil {
		t.Fatalf("get fx range: %v", err)
	}
	if len(rangeRows) != 2 || rangeRows[0].Date != "2026-01-02" || rangeRows[1].Date != "2026-01-03" {
		t.Fatalf("unexpected range rows: %#v", rangeRows)
	}

	bounds, err := dataStore.GetFxDateBounds("USD/CNY")
	if err != nil {
		t.Fatalf("get fx date bounds: %v", err)
	}
	if bounds.EarliestDate == nil || *bounds.EarliestDate != "2026-01-02" || bounds.LatestDate == nil || *bounds.LatestDate != "2026-01-03" {
		t.Fatalf("unexpected bounds: %#v", bounds)
	}
}
