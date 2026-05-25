package quantdata_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"quant-data/internal/store"
)

func TestLoadProviderConfigReadsTopLevelTushareToken(t *testing.T) {
	configDir := writeProviderConfig(t, `{"TUSHARE_TOKEN":"top-level-token"}`)

	config, err := store.LoadProviderConfig(configDir)
	if err != nil {
		t.Fatalf("LoadProviderConfig returned error: %v", err)
	}
	if got := config.Provider("tushare").Token; got != "top-level-token" {
		t.Fatalf("tushare token = %q, want top-level-token", got)
	}
}

func TestLoadProviderConfigReadsStructuredTushareToken(t *testing.T) {
	configDir := writeProviderConfig(t, `{"providers":{"tushare":{"token":"structured-token"}}}`)

	config, err := store.LoadProviderConfig(configDir)
	if err != nil {
		t.Fatalf("LoadProviderConfig returned error: %v", err)
	}
	if got := config.Provider("tushare").Token; got != "structured-token" {
		t.Fatalf("tushare token = %q, want structured-token", got)
	}
}

func TestLoadProviderConfigRejectsUnknownProviderSection(t *testing.T) {
	configDir := writeProviderConfig(t, `{"TUSHARE_TOKEN":"token","providers":{"unknown":{"token":"secret"}}}`)

	_, err := store.LoadProviderConfig(configDir)
	if err == nil || !strings.Contains(err.Error(), "unknown provider section") {
		t.Fatalf("LoadProviderConfig error = %v, want unknown provider section", err)
	}
}

func TestLoadProviderConfigRequiresTushareCredential(t *testing.T) {
	configDir := writeProviderConfig(t, `{"providers":{"tushare":{"token":""}}}`)

	_, err := store.LoadProviderConfig(configDir)
	if err == nil || !strings.Contains(err.Error(), "missing TUSHARE_TOKEN") {
		t.Fatalf("LoadProviderConfig error = %v, want missing TUSHARE_TOKEN", err)
	}
}

func writeProviderConfig(t *testing.T, contents string) string {
	t.Helper()
	configDir := filepath.Join(t.TempDir(), "config")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "provider.json"), []byte(contents), 0o600); err != nil {
		t.Fatalf("write provider config: %v", err)
	}
	return configDir
}
