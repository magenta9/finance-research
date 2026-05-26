package provider

type Asset struct {
	Symbol     string         `json:"symbol"`
	Name       string         `json:"name"`
	Market     string         `json:"market"`
	AssetClass string         `json:"assetClass"`
	Currency   string         `json:"currency"`
	Exchange   string         `json:"exchange,omitempty"`
	Source     string         `json:"source"`
	Metadata   map[string]any `json:"metadata"`
}

type AssetSearchResult struct {
	Assets           []Asset  `json:"assets"`
	AttemptedSources []string `json:"attemptedSources"`
	Warnings         []string `json:"warnings"`
}

type PriceRow struct {
	AdjustedClose    *float64 `json:"adjustedClose"`
	CalculationClose *float64 `json:"calculationClose,omitempty"`
	Close            *float64 `json:"close"`
	Date             string   `json:"date"`
	High             *float64 `json:"high"`
	Low              *float64 `json:"low"`
	Open             *float64 `json:"open"`
	Source           string   `json:"source"`
	Volume           *float64 `json:"volume"`
}

type FxRateRow struct {
	Date   string  `json:"date"`
	Rate   float64 `json:"rate"`
	Source string  `json:"source"`
}

type PriceSeriesResult struct {
	AttemptedSources []string   `json:"attemptedSources"`
	Prices           []PriceRow `json:"prices"`
	Symbol           string     `json:"symbol"`
	Warnings         []string   `json:"warnings"`
}

type FxRatesResult struct {
	AttemptedSources []string    `json:"attemptedSources"`
	Pair             string      `json:"pair"`
	Rates            []FxRateRow `json:"rates"`
	Warnings         []string    `json:"warnings"`
}
