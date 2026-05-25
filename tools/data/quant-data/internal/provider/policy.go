package provider

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Policy struct {
	SearchProviderOrder map[string][]string
	PriceProviderOrder  map[string][]string
	FxProviderOrder     []string
	PriceWeights        map[string]map[string]int
	FxWeights           map[string]int
	DerivedPenalty      int
}

type policyDocument struct {
	SearchProviderOrder  map[string][]string          `json:"searchProviderOrder"`
	PriceProviderOrder   map[string][]string          `json:"priceProviderOrder"`
	FxProviderOrder      []string                     `json:"fxProviderOrder"`
	SourcePriorityWeight policySourcePriorityDocument `json:"sourcePriorityWeights"`
	DerivedPenalty       int                          `json:"derivedSourcePenalty"`
}

type policySourcePriorityDocument struct {
	Price map[string]map[string]int `json:"price"`
	Fx    map[string]int            `json:"fx"`
}

func DefaultPolicy() Policy {
	return Policy{
		SearchProviderOrder: map[string][]string{
			"DEFAULT":   {"tushare", "akshare", "yfinance"},
			"US":        {"yfinance"},
			"HK":        {"tushare", "yfinance"},
			"A":         {"tushare", "akshare"},
			"BOND":      {"tushare", "akshare"},
			"COMMODITY": {"tushare", "akshare"},
		},
		PriceProviderOrder: map[string][]string{
			"DEFAULT":               {"tushare", "yfinance"},
			"DIGIT_SYMBOL_FALLBACK": {"tushare"},
			"US":                    {"yfinance"},
			"HK":                    {"tushare", "yfinance"},
			"A":                     {"tushare", "akshare"},
			"BOND":                  {"tushare", "akshare", "yfinance"},
			"COMMODITY":             {"tushare", "akshare"},
		},
		FxProviderOrder: []string{"akshare", "yfinance", "frankfurter"},
		PriceWeights: map[string]map[string]int{
			"DEFAULT":   {"akshare": 10, "tushare": 30, "yfinance": 20},
			"US":        {"akshare": 10, "tushare": 20, "yfinance": 30},
			"HK":        {"akshare": 30, "tushare": 30, "yfinance": 20},
			"A":         {"akshare": 10, "tushare": 30, "yfinance": 20},
			"BOND":      {"akshare": 20, "tushare": 30, "yfinance": 10},
			"COMMODITY": {"akshare": 20, "tushare": 30, "yfinance": 10},
		},
		FxWeights:      map[string]int{"akshare": 30, "yfinance": 20, "frankfurter": 10},
		DerivedPenalty: 5,
	}
}

func LoadPolicy() (Policy, error) {
	policyPath := strings.TrimSpace(os.Getenv("QUANT_DATA_POLICY_PATH"))
	if policyPath == "" {
		policyPath = discoverPolicyPath()
	}
	if policyPath == "" {
		return DefaultPolicy(), nil
	}
	return LoadPolicyFile(policyPath)
}

func LoadPolicyFile(path string) (Policy, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultPolicy(), nil
		}
		return Policy{}, fmt.Errorf("read provider policy: %w", err)
	}

	var document policyDocument
	if err := json.Unmarshal(contents, &document); err != nil {
		return Policy{}, fmt.Errorf("parse provider policy: %w", err)
	}
	policy, err := policyFromDocument(document)
	if err != nil {
		return Policy{}, err
	}
	return policy, nil
}

func discoverPolicyPath() string {
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidates := []string{
			filepath.Join(dir, "contracts", "market-data-policy.json"),
			filepath.Join(dir, "tools", "data", "quant-data", "contracts", "market-data-policy.json"),
		}
		for _, candidate := range candidates {
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}

func policyFromDocument(document policyDocument) (Policy, error) {
	searchOrder, err := normalizeProviderOrder(document.SearchProviderOrder, []string{"default", "US", "HK", "A", "BOND", "COMMODITY"}, false)
	if err != nil {
		return Policy{}, fmt.Errorf("invalid searchProviderOrder: %w", err)
	}
	priceOrder, err := normalizeProviderOrder(document.PriceProviderOrder, []string{"default", "digitSymbolFallback", "US", "HK", "A", "BOND", "COMMODITY"}, false)
	if err != nil {
		return Policy{}, fmt.Errorf("invalid priceProviderOrder: %w", err)
	}
	fxOrder, err := validateProviderList(document.FxProviderOrder, true)
	if err != nil {
		return Policy{}, fmt.Errorf("invalid fxProviderOrder: %w", err)
	}
	priceWeights, err := normalizePriceWeights(document.SourcePriorityWeight.Price)
	if err != nil {
		return Policy{}, fmt.Errorf("invalid sourcePriorityWeights.price: %w", err)
	}
	fxWeights, err := validateFxWeights(document.SourcePriorityWeight.Fx)
	if err != nil {
		return Policy{}, fmt.Errorf("invalid sourcePriorityWeights.fx: %w", err)
	}
	return Policy{
		SearchProviderOrder: searchOrder,
		PriceProviderOrder:  priceOrder,
		FxProviderOrder:     fxOrder,
		PriceWeights:        priceWeights,
		FxWeights:           fxWeights,
		DerivedPenalty:      document.DerivedPenalty,
	}, nil
}

func (policy Policy) SearchOrder(market string) []string {
	return policy.order(policy.SearchProviderOrder, market, false)
}

func (policy Policy) PriceOrder(symbol string, market string) []string {
	if strings.TrimSpace(market) == "" && isSixDigitSymbol(symbol) {
		return copyStrings(policy.PriceProviderOrder["DIGIT_SYMBOL_FALLBACK"])
	}
	return policy.order(policy.PriceProviderOrder, market, false)
}

func (policy Policy) priceWeight(providerID string, market string, source string) int {
	marketKey := normalizeMarket(market)
	weights := policy.PriceWeights[marketKey]
	if weights == nil {
		weights = policy.PriceWeights["DEFAULT"]
	}
	weight := weights[providerID]
	if strings.Contains(source, "-derived") {
		weight -= policy.DerivedPenalty
	}
	return weight
}

func (policy Policy) fxWeight(providerID string, source string) int {
	weight := policy.FxWeights[providerID]
	if strings.Contains(source, "-derived") {
		weight -= policy.DerivedPenalty
	}
	return weight
}

func (policy Policy) order(orders map[string][]string, market string, _ bool) []string {
	marketKey := normalizeMarket(market)
	if order, ok := orders[marketKey]; ok {
		return copyStrings(order)
	}
	return copyStrings(orders["DEFAULT"])
}

func normalizeMarket(market string) string {
	market = strings.ToUpper(strings.TrimSpace(market))
	if market == "" {
		return "DEFAULT"
	}
	return market
}

func normalizeProviderOrder(values map[string][]string, required []string, allowFx bool) (map[string][]string, error) {
	if values == nil {
		return nil, fmt.Errorf("missing order")
	}
	allowedMarkets := allowedPolicyMarkets(required)
	for key := range values {
		if _, ok := allowedMarkets[key]; !ok {
			return nil, fmt.Errorf("unsupported market %q", key)
		}
	}
	orders := map[string][]string{}
	for _, key := range required {
		order, ok := values[key]
		if !ok {
			return nil, fmt.Errorf("missing market %q", key)
		}
		validated, err := validateProviderList(order, allowFx)
		if err != nil {
			return nil, fmt.Errorf("market %q: %w", key, err)
		}
		orders[allowedMarkets[key]] = validated
	}
	return orders, nil
}

func normalizePriceWeights(values map[string]map[string]int) (map[string]map[string]int, error) {
	required := []string{"default", "US", "HK", "A", "BOND", "COMMODITY"}
	if values == nil {
		return nil, fmt.Errorf("missing price weights")
	}
	allowedMarkets := allowedPolicyMarkets(required)
	for key := range values {
		if _, ok := allowedMarkets[key]; !ok {
			return nil, fmt.Errorf("unsupported market %q", key)
		}
	}
	weights := map[string]map[string]int{}
	for _, key := range required {
		marketWeights, ok := values[key]
		if !ok {
			return nil, fmt.Errorf("missing market %q", key)
		}
		validated, err := validatePriceWeights(marketWeights)
		if err != nil {
			return nil, fmt.Errorf("market %q: %w", key, err)
		}
		weights[allowedMarkets[key]] = validated
	}
	return weights, nil
}

func allowedPolicyMarkets(keys []string) map[string]string {
	allowed := map[string]string{}
	for _, key := range keys {
		value := strings.ToUpper(key)
		if key == "default" {
			value = "DEFAULT"
		}
		if key == "digitSymbolFallback" {
			value = "DIGIT_SYMBOL_FALLBACK"
		}
		allowed[key] = value
	}
	return allowed
}

func validateProviderList(values []string, allowFx bool) ([]string, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("provider order must not be empty")
	}
	validated := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		providerID := strings.ToLower(strings.TrimSpace(value))
		if !isKnownPolicyProvider(providerID, allowFx) {
			return nil, fmt.Errorf("unknown provider %q", value)
		}
		if _, exists := seen[providerID]; exists {
			return nil, fmt.Errorf("duplicate provider %q", providerID)
		}
		seen[providerID] = struct{}{}
		validated = append(validated, providerID)
	}
	return validated, nil
}

func validatePriceWeights(values map[string]int) (map[string]int, error) {
	if values == nil {
		return nil, fmt.Errorf("missing weights")
	}
	weights := map[string]int{}
	for providerID, weight := range values {
		providerID = strings.ToLower(strings.TrimSpace(providerID))
		if !isKnownPolicyProvider(providerID, false) {
			return nil, fmt.Errorf("unknown provider %q", providerID)
		}
		weights[providerID] = weight
	}
	for _, providerID := range []string{akshareSource, tushareSource, yfinanceSource} {
		if _, ok := weights[providerID]; !ok {
			return nil, fmt.Errorf("missing provider %q", providerID)
		}
	}
	return weights, nil
}

func validateFxWeights(values map[string]int) (map[string]int, error) {
	if values == nil {
		return nil, fmt.Errorf("missing weights")
	}
	weights := map[string]int{}
	for providerID, weight := range values {
		providerID = strings.ToLower(strings.TrimSpace(providerID))
		if !isKnownPolicyProvider(providerID, true) {
			return nil, fmt.Errorf("unknown provider %q", providerID)
		}
		weights[providerID] = weight
	}
	for _, providerID := range []string{akshareSource, yfinanceSource, "frankfurter"} {
		if _, ok := weights[providerID]; !ok {
			return nil, fmt.Errorf("missing provider %q", providerID)
		}
	}
	return weights, nil
}

func isKnownPolicyProvider(providerID string, allowFx bool) bool {
	switch providerID {
	case akshareSource, tushareSource, yfinanceSource:
		return true
	case "frankfurter":
		return allowFx
	default:
		return false
	}
}

func copyStrings(values []string) []string {
	copyValue := make([]string, len(values))
	copy(copyValue, values)
	return copyValue
}
