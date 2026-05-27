package provider

import "testing"

func TestResolveKnownIndexAliasUsesVerifiedDividendIndices(t *testing.T) {
	tests := []struct {
		query string
		want  string
	}{
		{query: "中证红利", want: "000922.CSI"},
		{query: " 红利低波 ", want: "h30269.CSI"},
	}

	for _, test := range tests {
		t.Run(test.query, func(t *testing.T) {
			got, ok := resolveKnownIndexAlias(test.query)
			if !ok {
				t.Fatalf("resolveKnownIndexAlias(%q) did not resolve", test.query)
			}
			if got != test.want {
				t.Fatalf("resolveKnownIndexAlias(%q) = %q, want %q", test.query, got, test.want)
			}
		})
	}
}

func TestInferTushareAssetTypeKeepsExplicitTsCodesOnTheirAssetClass(t *testing.T) {
	tests := []struct {
		tsCode string
		want   string
	}{
		{tsCode: "600519.SH", want: "E"},
		{tsCode: "510300.SH", want: "FD"},
		{tsCode: "000016.SH", want: "I"},
		{tsCode: "399006.SZ", want: "I"},
		{tsCode: "899050.BJ", want: "I"},
		{tsCode: "430047.BJ", want: "E"},
	}

	for _, test := range tests {
		t.Run(test.tsCode, func(t *testing.T) {
			if got := inferTushareAssetType(test.tsCode); got != test.want {
				t.Fatalf("inferTushareAssetType(%q) = %q, want %q", test.tsCode, got, test.want)
			}
		})
	}
}

func TestNormalizeTushareCodeSupportsBeijingExchangeSymbols(t *testing.T) {
	tests := []struct {
		symbol string
		want   string
	}{
		{symbol: "899050", want: "899050.BJ"},
		{symbol: "430047", want: "430047.BJ"},
		{symbol: "899050.BJ", want: "899050.BJ"},
	}

	for _, test := range tests {
		t.Run(test.symbol, func(t *testing.T) {
			if got := normalizeTushareCode(test.symbol); got != test.want {
				t.Fatalf("normalizeTushareCode(%q) = %q, want %q", test.symbol, got, test.want)
			}
		})
	}
}

func TestDedupeAssetsUsesTsCodeMetadata(t *testing.T) {
	assets := []Asset{
		{
			Symbol:   "510300.SH",
			Market:   "A",
			Metadata: map[string]any{"tsCode": "510300.SH"},
		},
		{
			Symbol:   "510300",
			Market:   "A",
			Metadata: map[string]any{"tsCode": "510300.SH"},
		},
	}

	deduped := dedupeAssets(assets)
	if len(deduped) != 1 {
		t.Fatalf("dedupeAssets() returned %d assets, want 1: %#v", len(deduped), deduped)
	}
}
