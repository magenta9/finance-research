package quantdata_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"quant-data/internal/provider"
)

func TestLoadPolicyFileMissingUsesDefaultPolicy(t *testing.T) {
	policy, err := provider.LoadPolicyFile(filepath.Join(t.TempDir(), "missing-policy.json"))
	if err != nil {
		t.Fatalf("LoadPolicyFile returned error: %v", err)
	}
	assertPriceOrder(t, policy, "510300", "A", []string{"tushare", "akshare"})
}

func TestLoadPolicyFileReadsMarketOverrides(t *testing.T) {
	document := testPolicyDocument()
	document["priceProviderOrder"].(map[string]any)["A"] = []string{"akshare", "tushare"}
	path := writePolicyDocument(t, document)

	policy, err := provider.LoadPolicyFile(path)
	if err != nil {
		t.Fatalf("LoadPolicyFile returned error: %v", err)
	}
	assertPriceOrder(t, policy, "510300", "A", []string{"akshare", "tushare"})
}

func TestLoadPolicyFileRejectsUnknownProvider(t *testing.T) {
	document := testPolicyDocument()
	document["priceProviderOrder"].(map[string]any)["A"] = []string{"unknown-provider"}
	path := writePolicyDocument(t, document)

	_, err := provider.LoadPolicyFile(path)
	if err == nil || !strings.Contains(err.Error(), "unknown provider") {
		t.Fatalf("LoadPolicyFile error = %v, want unknown provider", err)
	}
}

func TestLoadPolicyFileRejectsUnknownMarket(t *testing.T) {
	document := testPolicyDocument()
	document["searchProviderOrder"].(map[string]any)["CRYPTO"] = []string{"yfinance"}
	path := writePolicyDocument(t, document)

	_, err := provider.LoadPolicyFile(path)
	if err == nil || !strings.Contains(err.Error(), "unsupported market") {
		t.Fatalf("LoadPolicyFile error = %v, want unsupported market", err)
	}
}

func TestLoadPolicyDiscoversToolInternalContractsFromRepoRoot(t *testing.T) {
	repoRoot := t.TempDir()
	policyDir := filepath.Join(repoRoot, "tools", "data", "quant-data", "contracts")
	if err := os.MkdirAll(policyDir, 0o700); err != nil {
		t.Fatalf("MkdirAll policy dir: %v", err)
	}
	document := testPolicyDocument()
	document["priceProviderOrder"].(map[string]any)["A"] = []string{"akshare", "tushare"}
	writePolicyDocumentAt(t, filepath.Join(policyDir, "market-data-policy.json"), document)

	originalWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalWorkingDir); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	})
	if err := os.Chdir(repoRoot); err != nil {
		t.Fatalf("Chdir repo root: %v", err)
	}
	t.Setenv("QUANT_DATA_POLICY_PATH", "")

	policy, err := provider.LoadPolicy()
	if err != nil {
		t.Fatalf("LoadPolicy returned error: %v", err)
	}
	assertPriceOrder(t, policy, "510300", "A", []string{"akshare", "tushare"})
}

func assertPriceOrder(t *testing.T, policy provider.Policy, symbol string, market string, want []string) {
	t.Helper()
	got := policy.PriceOrder(symbol, market)
	if len(got) != len(want) {
		t.Fatalf("PriceOrder = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("PriceOrder = %v, want %v", got, want)
		}
	}
}

func writePolicyDocument(t *testing.T, document map[string]any) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "market-data-policy.json")
	writePolicyDocumentAt(t, path, document)
	return path
}

func writePolicyDocumentAt(t *testing.T, path string, document map[string]any) {
	t.Helper()
	contents, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("Marshal policy: %v", err)
	}
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatalf("Write policy: %v", err)
	}
}

func testPolicyDocument() map[string]any {
	return map[string]any{
		"searchProviderOrder": map[string]any{
			"default":   []string{"tushare", "akshare", "yfinance"},
			"US":        []string{"yfinance"},
			"HK":        []string{"tushare", "yfinance"},
			"A":         []string{"tushare", "akshare"},
			"BOND":      []string{"tushare", "akshare"},
			"COMMODITY": []string{"tushare", "akshare"},
		},
		"priceProviderOrder": map[string]any{
			"default":             []string{"tushare", "yfinance"},
			"digitSymbolFallback": []string{"tushare"},
			"US":                  []string{"yfinance"},
			"HK":                  []string{"tushare", "yfinance"},
			"A":                   []string{"tushare", "akshare"},
			"BOND":                []string{"tushare", "akshare", "yfinance"},
			"COMMODITY":           []string{"tushare", "akshare"},
		},
		"fxProviderOrder": []string{"akshare", "yfinance", "frankfurter"},
		"sourcePriorityWeights": map[string]any{
			"price": map[string]any{
				"default":   map[string]int{"akshare": 10, "tushare": 30, "yfinance": 20},
				"US":        map[string]int{"akshare": 10, "tushare": 20, "yfinance": 30},
				"HK":        map[string]int{"akshare": 30, "tushare": 30, "yfinance": 20},
				"A":         map[string]int{"akshare": 10, "tushare": 30, "yfinance": 20},
				"BOND":      map[string]int{"akshare": 20, "tushare": 30, "yfinance": 10},
				"COMMODITY": map[string]int{"akshare": 20, "tushare": 30, "yfinance": 10},
			},
			"fx": map[string]int{"akshare": 30, "yfinance": 20, "frankfurter": 10},
		},
		"derivedSourcePenalty": 5,
	}
}
