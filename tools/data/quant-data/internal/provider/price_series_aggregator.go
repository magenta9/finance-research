package provider

import (
	"sort"
	"strings"
)

func aggregatePriceSeries(symbol string, market string, order []string, backends map[string]marketBackend, policy Policy, start string, end string) PriceSeriesResult {
	rowsByDate := map[string]PriceRow{}
	attempted := []string{}
	warnings := []string{}

	for _, providerID := range order {
		backend := backends[providerID]
		if backend == nil {
			continue
		}
		attempted = append(attempted, providerID)
		result, providerWarnings := backend.GetPriceSeries(symbol, market, start, end)
		warnings = append(warnings, providerWarnings...)
		warnings = append(warnings, result.Warnings...)
		for _, row := range result.Prices {
			existing, exists := rowsByDate[row.Date]
			if !exists || shouldReplacePrice(policy, existing, row, market) {
				rowsByDate[row.Date] = row
				continue
			}
			rowsByDate[row.Date] = fillPriceGaps(existing, row)
		}
		if len(result.Prices) > 0 {
			break
		}
	}

	rows := make([]PriceRow, 0, len(rowsByDate))
	for _, row := range rowsByDate {
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Date < rows[j].Date })

	return PriceSeriesResult{
		AttemptedSources: attempted,
		Prices:           rows,
		Symbol:           symbol,
		Warnings:         dedupeStrings(warnings),
	}
}

func shouldReplacePrice(policy Policy, existing PriceRow, incoming PriceRow, market string) bool {
	existingProvider := providerIDFromSource(existing.Source)
	incomingProvider := providerIDFromSource(incoming.Source)
	existingWeight := policy.priceWeight(existingProvider, market, existing.Source)
	incomingWeight := policy.priceWeight(incomingProvider, market, incoming.Source)
	if incomingWeight != existingWeight {
		return incomingWeight > existingWeight
	}
	return priceCompleteness(incoming) > priceCompleteness(existing)
}

func fillPriceGaps(existing PriceRow, incoming PriceRow) PriceRow {
	if existing.Open == nil {
		existing.Open = incoming.Open
	}
	if existing.High == nil {
		existing.High = incoming.High
	}
	if existing.Low == nil {
		existing.Low = incoming.Low
	}
	if existing.Close == nil {
		existing.Close = incoming.Close
	}
	if existing.AdjustedClose == nil {
		existing.AdjustedClose = incoming.AdjustedClose
	}
	if existing.CalculationClose == nil {
		existing.CalculationClose = incoming.CalculationClose
	}
	if existing.Volume == nil {
		existing.Volume = incoming.Volume
	}
	return existing
}

func priceCompleteness(row PriceRow) int {
	count := 0
	if row.Open != nil {
		count++
	}
	if row.High != nil {
		count++
	}
	if row.Low != nil {
		count++
	}
	if row.Close != nil {
		count++
	}
	if row.AdjustedClose != nil {
		count++
	}
	return count
}

func providerIDFromSource(source string) string {
	source = strings.ToLower(source)
	for _, providerID := range []string{tushareSource, akshareSource, yfinanceSource, "frankfurter"} {
		if strings.HasPrefix(source, providerID) {
			return providerID
		}
	}
	return source
}
