package provider

type Adapter interface {
	EmptyFlowSentiment(symbol string, market string) map[string]any
	EmptyFundamentals(symbol string, market string) map[string]any
	EmptyMarketSource(sourceID string, url string) map[string]any
	EmptyNewsCatalysts(symbol string, market string) map[string]any
	GetFxRates(pair string, start string, end string) FxRatesResult
	GetPriceSeries(symbol string, market string, start string, end string) PriceSeriesResult
	Mode() string
	SearchAssets(query string, market string, assetClass string, exactMatch bool) []Asset
	Source() string
}
