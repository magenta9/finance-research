package provider

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

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

const FixtureSource = "quant-data-fixture"

type FixtureProvider struct{}

func NewFixtureProvider() FixtureProvider {
	return FixtureProvider{}
}

func (FixtureProvider) Source() string {
	return FixtureSource
}

func (FixtureProvider) Mode() string {
	return "fixture"
}

var fixtureAssets = []Asset{
	{Symbol: "SPY", Name: "SPDR S&P 500 ETF Trust", Market: "US", AssetClass: "equity", Currency: "USD", Exchange: "NYSEARCA", Source: FixtureSource, Metadata: map[string]any{"provider": FixtureSource}},
	{Symbol: "QQQ", Name: "Invesco QQQ Trust", Market: "US", AssetClass: "equity", Currency: "USD", Exchange: "NASDAQ", Source: FixtureSource, Metadata: map[string]any{"provider": FixtureSource}},
	{Symbol: "AGG", Name: "iShares Core U.S. Aggregate Bond ETF", Market: "US", AssetClass: "fixed_income", Currency: "USD", Exchange: "NYSEARCA", Source: FixtureSource, Metadata: map[string]any{"provider": FixtureSource}},
	{Symbol: "GLD", Name: "SPDR Gold Shares", Market: "US", AssetClass: "commodity", Currency: "USD", Exchange: "NYSEARCA", Source: FixtureSource, Metadata: map[string]any{"provider": FixtureSource}},
	{Symbol: "510300", Name: "沪深300ETF", Market: "A", AssetClass: "equity", Currency: "CNY", Exchange: "SSE", Source: FixtureSource, Metadata: map[string]any{"provider": FixtureSource, "tsCode": "510300.SH"}},
	{Symbol: "159919", Name: "嘉实沪深300ETF", Market: "A", AssetClass: "equity", Currency: "CNY", Exchange: "SZSE", Source: FixtureSource, Metadata: map[string]any{"provider": FixtureSource, "tsCode": "159919.SZ"}},
	{Symbol: "001717", Name: "工银前沿医疗股票A", Market: "A", AssetClass: "equity", Currency: "CNY", Exchange: "基金", Source: FixtureSource, Metadata: map[string]any{"provider": FixtureSource, "instrumentType": "fund", "issueDate": "2016-02-03", "issueDateSource": FixtureSource, "tsCode": "001717.OF"}},
}

func SearchAssets(query string, market string) []Asset {
	return NewFixtureProvider().SearchAssets(query, market)
}

func (FixtureProvider) SearchAssets(query string, market string) []Asset {
	query = strings.ToLower(strings.TrimSpace(query))
	market = strings.ToUpper(strings.TrimSpace(market))
	matches := make([]Asset, 0, len(fixtureAssets))

	for _, asset := range fixtureAssets {
		if market != "" && market != "ALL" && strings.ToUpper(asset.Market) != market {
			continue
		}
		if query == "" || strings.Contains(strings.ToLower(asset.Symbol), query) || strings.Contains(strings.ToLower(asset.Name), query) || strings.Contains(strings.ToLower(fmt.Sprint(asset.Metadata["tsCode"])), query) {
			matches = append(matches, asset)
		}
	}

	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].Market == matches[j].Market {
			return matches[i].Symbol < matches[j].Symbol
		}
		return matches[i].Market < matches[j].Market
	})
	return matches
}

func GetPriceSeries(symbol string, market string, start string, end string) PriceSeriesResult {
	return NewFixtureProvider().GetPriceSeries(symbol, market, start, end)
}

func (FixtureProvider) GetPriceSeries(symbol string, market string, start string, end string) PriceSeriesResult {
	if start == "" {
		start = shiftDate(endOrToday(end), -430)
	}
	if end == "" {
		end = endOrToday(end)
	}

	dates := dateRange(start, end)
	rows := make([]PriceRow, 0, len(dates))
	seed := symbolSeed(symbol + market)
	base := 20.0 + float64(seed%120)

	for index, date := range dates {
		trend := 1 + float64(index)*0.0017
		seasonality := 1 + math.Sin(float64(index)/13)*0.026 + math.Cos(float64(index)/23)*0.014
		closeValue := round4(base * trend * seasonality)
		openValue := round4(closeValue * 0.997)
		highValue := round4(closeValue * 1.011)
		lowValue := round4(closeValue * 0.989)
		volumeValue := float64(700000 + index*3500 + int(seed%1000))
		adjusted := closeValue
		rows = append(rows, PriceRow{
			AdjustedClose: &adjusted,
			Close:         &closeValue,
			Date:          date,
			High:          &highValue,
			Low:           &lowValue,
			Open:          &openValue,
			Source:        FixtureSource,
			Volume:        &volumeValue,
		})
	}

	return PriceSeriesResult{
		AttemptedSources: []string{FixtureSource},
		Prices:           rows,
		Symbol:           symbol,
		Warnings:         []string{},
	}
}

func GetFxRates(pair string, start string, end string) FxRatesResult {
	return NewFixtureProvider().GetFxRates(pair, start, end)
}

func (FixtureProvider) GetFxRates(pair string, start string, end string) FxRatesResult {
	if start == "" {
		start = shiftDate(endOrToday(end), -430)
	}
	if end == "" {
		end = endOrToday(end)
	}

	base := map[string]float64{"USD/CNY": 7.18, "HKD/CNY": 0.918}[strings.ToUpper(pair)]
	if base == 0 {
		base = 1
	}

	dates := dateRange(start, end)
	rates := make([]FxRateRow, 0, len(dates))
	for index, date := range dates {
		rates = append(rates, FxRateRow{
			Date:   date,
			Rate:   round6(base + math.Sin(float64(index)/17)*0.012),
			Source: FixtureSource,
		})
	}

	return FxRatesResult{
		AttemptedSources: []string{FixtureSource},
		Pair:             pair,
		Rates:            rates,
		Warnings:         []string{},
	}
}

func EmptyFundamentals(symbol string, market string) map[string]any {
	return NewFixtureProvider().EmptyFundamentals(symbol, market)
}

func (FixtureProvider) EmptyFundamentals(symbol string, market string) map[string]any {
	return map[string]any{
		"asOf":             nil,
		"attemptedSources": []string{FixtureSource},
		"dataAgeDays":      nil,
		"dataProvenance":   []map[string]any{{"fetchedAt": nil, "providerIds": []string{FixtureSource}, "qualityStatus": "warn", "rowsUsed": 0, "sourceId": FixtureSource, "warnings": []string{"fixture provider has no fundamentals"}}},
		"market":           market,
		"metrics":          map[string]any{"period": map[string]any{"fiscalPeriod": nil, "reportDate": nil}},
		"providerErrors":   []map[string]any{},
		"qualityStatus":    "degraded",
		"symbol":           symbol,
		"warnings":         []string{"fixture provider has no fundamentals"},
	}
}

func EmptyFlowSentiment(symbol string, market string) map[string]any {
	return NewFixtureProvider().EmptyFlowSentiment(symbol, market)
}

func (FixtureProvider) EmptyFlowSentiment(symbol string, market string) map[string]any {
	return map[string]any{
		"asOf":             nil,
		"attemptedSources": []string{FixtureSource},
		"dataProvenance":   []map[string]any{{"fetchedAt": nil, "providerIds": []string{FixtureSource}, "qualityStatus": "warn", "rowsUsed": 0, "sourceId": FixtureSource, "warnings": []string{"fixture provider has no flow sentiment"}}},
		"market":           market,
		"providerErrors":   []map[string]any{},
		"qualityStatus":    "degraded",
		"signals":          map[string]any{},
		"symbol":           symbol,
		"warnings":         []string{"fixture provider has no flow sentiment"},
	}
}

func EmptyNewsCatalysts(symbol string, market string) map[string]any {
	return NewFixtureProvider().EmptyNewsCatalysts(symbol, market)
}

func (FixtureProvider) EmptyNewsCatalysts(symbol string, market string) map[string]any {
	today := endOrToday("")
	return map[string]any{
		"attemptedSources": []string{FixtureSource},
		"coverageNotes":    []string{"fixture provider has no catalyst events"},
		"events":           []map[string]any{},
		"inCatalystWindow": "unknown",
		"market":           market,
		"providerErrors":   []map[string]any{},
		"qualityStatus":    "degraded",
		"symbol":           symbol,
		"warnings":         []string{"fixture provider has no catalyst events"},
		"window":           map[string]any{"startDate": shiftDate(today, -30), "endDate": shiftDate(today, 30), "lookbackDays": 30, "lookaheadDays": 30, "referenceDate": today},
	}
}

func EmptyMarketSource(sourceID string, url string) map[string]any {
	return NewFixtureProvider().EmptyMarketSource(sourceID, url)
}

func (FixtureProvider) EmptyMarketSource(sourceID string, url string) map[string]any {
	if sourceID == "" {
		sourceID = "fixture:market-source"
	}
	return map[string]any{
		"contentHash":      hashString(sourceID + url),
		"evidenceEligible": true,
		"fetchedAt":        time.Now().UTC().Format(time.RFC3339),
		"provenance":       []map[string]any{{"fetchedAt": nil, "providerIds": []string{FixtureSource}, "qualityStatus": "warn", "rowsUsed": 0, "sourceId": FixtureSource, "warnings": []string{"fixture provider returned placeholder source"}}},
		"sourceId":         sourceID,
		"summary":          "Fixture market source placeholder.",
		"textPreview":      "Fixture market source placeholder.",
		"title":            "Fixture market source",
		"url":              url,
	}
}

func dateRange(start string, end string) []string {
	startDate, startErr := time.Parse("2006-01-02", start)
	endDate, endErr := time.Parse("2006-01-02", end)
	if startErr != nil || endErr != nil || startDate.After(endDate) {
		return []string{}
	}

	dates := []string{}
	for date := startDate; !date.After(endDate); date = date.AddDate(0, 0, 1) {
		dates = append(dates, date.Format("2006-01-02"))
	}
	return dates
}

func endOrToday(end string) string {
	if strings.TrimSpace(end) != "" {
		return end
	}
	return time.Now().UTC().Format("2006-01-02")
}

func shiftDate(date string, days int) string {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		parsed = time.Now().UTC()
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02")
}

func symbolSeed(symbol string) uint32 {
	sum := sha256.Sum256([]byte(symbol))
	return uint32(sum[0])<<24 | uint32(sum[1])<<16 | uint32(sum[2])<<8 | uint32(sum[3])
}

func round4(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func round6(value float64) float64 {
	return math.Round(value*1000000) / 1000000
}

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
