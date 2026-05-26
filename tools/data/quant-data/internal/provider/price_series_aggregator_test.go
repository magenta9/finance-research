package provider

import "testing"

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
