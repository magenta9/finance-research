package store

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type ConfigStatus struct {
	Exists        bool
	Secure        bool
	InsecurePaths []string
}

type ProviderConfig struct {
	Providers map[string]ProviderSettings
}

type ProviderSettings struct {
	Token string
}

func (config ProviderConfig) Provider(providerID string) ProviderSettings {
	if config.Providers == nil {
		return ProviderSettings{}
	}
	return config.Providers[strings.ToLower(strings.TrimSpace(providerID))]
}

func CheckProviderConfig(configDir string) (ConfigStatus, error) {
	status := ConfigStatus{Secure: true}

	entries, err := os.ReadDir(configDir)
	if err != nil {
		if os.IsNotExist(err) {
			return status, nil
		}
		return status, err
	}

	for _, entry := range entries {
		path := filepath.Join(configDir, entry.Name())

		info, err := os.Lstat(path)
		if err != nil {
			return status, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			status.Exists = true
			status.Secure = false
			status.InsecurePaths = append(status.InsecurePaths, path)
			continue
		}
		if info.IsDir() {
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}

		status.Exists = true
		if isInsecureConfigMode(info.Mode()) {
			if err := os.Chmod(path, 0o600); err != nil {
				status.Secure = false
				status.InsecurePaths = append(status.InsecurePaths, path)
			}
		}
	}

	return status, nil
}

func LoadProviderConfig(configDir string) (ProviderConfig, error) {
	path := filepath.Join(configDir, "provider.json")
	contents, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ProviderConfig{}, fmt.Errorf("provider.json is missing")
		}
		return ProviderConfig{}, err
	}

	var raw map[string]any
	if err := json.Unmarshal(contents, &raw); err != nil {
		return ProviderConfig{}, fmt.Errorf("provider.json is not valid JSON: %w", err)
	}

	providers, err := readProviderSettings(raw)
	if err != nil {
		return ProviderConfig{}, err
	}

	token := readConfigString(raw, "TUSHARE_TOKEN")
	if token != "" {
		settings := providers["tushare"]
		settings.Token = token
		providers["tushare"] = settings
	}

	token = providers["tushare"].Token
	if token == "" {
		return ProviderConfig{}, fmt.Errorf("provider.json is missing TUSHARE_TOKEN")
	}

	return ProviderConfig{Providers: providers}, nil
}

func readProviderSettings(raw map[string]any) (map[string]ProviderSettings, error) {
	providers := map[string]ProviderSettings{}
	value, ok := raw["providers"]
	if !ok || value == nil {
		return providers, nil
	}
	sections, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("provider.json providers must be an object")
	}
	for providerID, rawSection := range sections {
		providerID = strings.ToLower(strings.TrimSpace(providerID))
		if providerID != "tushare" {
			return nil, fmt.Errorf("provider.json contains unknown provider section %q", providerID)
		}
		section, ok := rawSection.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("provider.json provider section %q must be an object", providerID)
		}
		providers[providerID] = ProviderSettings{Token: readConfigString(section, "token")}
	}
	return providers, nil
}

func readConfigString(raw map[string]any, key string) string {
	value, ok := raw[key]
	if !ok || value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func isInsecureConfigMode(mode fs.FileMode) bool {
	return mode.Perm()&0o077 != 0
}
