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
