package provider

import "testing"

type stubMarketBackend struct {
	priceCalls    int
	priceResult   PriceSeriesResult
	priceWarnings []string
}

func (backend *stubMarketBackend) ID() string {
	return "stub"
}

func (backend *stubMarketBackend) SearchAssets(query string, market string, assetClass string, exactMatch bool) ([]Asset, []string) {
	return nil, nil
}

func (backend *stubMarketBackend) GetPriceSeries(symbol string, market string, start string, end string) (PriceSeriesResult, []string) {
	backend.priceCalls++
	return backend.priceResult, backend.priceWarnings
}

func (backend *stubMarketBackend) GetFxRates(pair string, start string, end string) (FxRatesResult, []string) {
	return FxRatesResult{}, nil
}

func TestWithCalculationCloseUsesAdjustedClose(t *testing.T) {
	adjusted := 10.5
	closeValue := 11.0

	row := withCalculationClose(PriceRow{AdjustedClose: &adjusted, Close: &closeValue})

	if row.CalculationClose == nil || *row.CalculationClose != adjusted {
		t.Fatalf("calculationClose = %#v, want adjusted close %v", row.CalculationClose, adjusted)
	}
}

func TestWithCalculationCloseFallsBackToClose(t *testing.T) {
	closeValue := 11.0

	row := withCalculationClose(PriceRow{Close: &closeValue})

	if row.CalculationClose == nil || *row.CalculationClose != closeValue {
		t.Fatalf("calculationClose = %#v, want close %v", row.CalculationClose, closeValue)
	}
}

func TestFixtureProviderSuppliesCalculationClose(t *testing.T) {
	result := NewFixtureProvider().GetPriceSeries("SPY", "US", "2026-05-01", "2026-05-03")

	if len(result.Prices) == 0 {
		t.Fatalf("expected fixture prices")
	}
	for _, row := range result.Prices {
		if row.CalculationClose == nil {
			t.Fatalf("fixture row missing calculationClose: %#v", row)
		}
	}
}

func TestAggregatePriceSeriesStopsAfterFirstProviderWithRows(t *testing.T) {
	closeValue := 12.3
	first := &stubMarketBackend{
		priceResult: PriceSeriesResult{
			Symbol: "510300.SH",
			Prices: []PriceRow{{Date: "2026-05-01", Close: &closeValue, Source: tushareSource}},
		},
	}
	second := &stubMarketBackend{
		priceResult: PriceSeriesResult{
			Symbol: "510300.SS",
			Prices: []PriceRow{{Date: "2026-05-01", Close: &closeValue, Source: yfinanceSource}},
		},
	}

	result := aggregatePriceSeries(
		"510300.SH",
		"A",
		[]string{tushareSource, yfinanceSource},
		map[string]marketBackend{
			tushareSource:  first,
			yfinanceSource: second,
		},
		DefaultPolicy(),
		"2026-05-01",
		"2026-05-03",
	)

	if first.priceCalls != 1 {
		t.Fatalf("first backend calls = %d, want 1", first.priceCalls)
	}
	if second.priceCalls != 0 {
		t.Fatalf("second backend calls = %d, want 0", second.priceCalls)
	}
	if len(result.AttemptedSources) != 1 || result.AttemptedSources[0] != tushareSource {
		t.Fatalf("attempted sources = %#v, want [%q]", result.AttemptedSources, tushareSource)
	}
	if len(result.Prices) != 1 || result.Prices[0].CalculationClose == nil || *result.Prices[0].CalculationClose != closeValue {
		t.Fatalf("prices = %#v, want one row with calculationClose %v", result.Prices, closeValue)
	}
}

func TestAggregatePriceSeriesFallsBackWhenEarlierProviderHasNoRows(t *testing.T) {
	closeValue := 12.3
	first := &stubMarketBackend{priceResult: PriceSeriesResult{Symbol: "510300.SH"}}
	second := &stubMarketBackend{
		priceResult: PriceSeriesResult{
			Symbol: "510300.SS",
			Prices: []PriceRow{{Date: "2026-05-01", Close: &closeValue, Source: yfinanceSource}},
		},
	}

	result := aggregatePriceSeries(
		"510300.SH",
		"A",
		[]string{tushareSource, yfinanceSource},
		map[string]marketBackend{
			tushareSource:  first,
			yfinanceSource: second,
		},
		DefaultPolicy(),
		"2026-05-01",
		"2026-05-03",
	)

	if first.priceCalls != 1 || second.priceCalls != 1 {
		t.Fatalf("backend calls = (%d, %d), want (1, 1)", first.priceCalls, second.priceCalls)
	}
	if len(result.AttemptedSources) != 2 {
		t.Fatalf("attempted sources = %#v, want two providers", result.AttemptedSources)
	}
	if result.Symbol != "510300.SS" {
		t.Fatalf("symbol = %q, want second provider symbol", result.Symbol)
	}
}
