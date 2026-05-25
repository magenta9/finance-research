package provider

import "time"

func (provider LiveProvider) EmptyFundamentals(symbol string, market string) map[string]any {
	attempted := provider.policy.SearchOrder(market)
	return degradedProviderResult(symbol, market, attempted, "live fundamentals are not implemented yet")
}

func (provider LiveProvider) EmptyFlowSentiment(symbol string, market string) map[string]any {
	attempted := provider.policy.SearchOrder(market)
	result := degradedProviderResult(symbol, market, attempted, "live flow sentiment is not implemented yet")
	result["signals"] = map[string]any{}
	return result
}

func (provider LiveProvider) EmptyNewsCatalysts(symbol string, market string) map[string]any {
	today := time.Now().UTC().Format("2006-01-02")
	attempted := provider.policy.SearchOrder(market)
	return map[string]any{
		"attemptedSources": attempted,
		"coverageNotes":    []string{"live news catalysts are not implemented yet"},
		"events":           []map[string]any{},
		"inCatalystWindow": "unknown",
		"market":           market,
		"providerErrors":   []map[string]any{},
		"qualityStatus":    "degraded",
		"symbol":           symbol,
		"warnings":         []string{"live news catalysts are not implemented yet"},
		"window":           map[string]any{"startDate": shiftDateLocal(today, -30), "endDate": shiftDateLocal(today, 30), "lookbackDays": 30, "lookaheadDays": 30, "referenceDate": today},
	}
}

func (LiveProvider) EmptyMarketSource(sourceID string, url string) map[string]any {
	if sourceID == "" {
		sourceID = "live:market-source"
	}
	return map[string]any{
		"contentHash":      hashLocal(sourceID + url),
		"evidenceEligible": false,
		"fetchedAt":        time.Now().UTC().Format(time.RFC3339),
		"provenance":       []map[string]any{{"fetchedAt": nil, "providerIds": []string{liveSource}, "qualityStatus": "warn", "rowsUsed": 0, "sourceId": liveSource, "warnings": []string{"live market source fetch is not implemented yet"}}},
		"sourceId":         sourceID,
		"statusCode":       nil,
		"summary":          "Live market source fetch is not implemented yet.",
		"textPreview":      "",
		"title":            "",
		"url":              url,
	}
}

func degradedProviderResult(symbol string, market string, attempted []string, warning string) map[string]any {
	return map[string]any{
		"asOf":             nil,
		"attemptedSources": attempted,
		"dataAgeDays":      nil,
		"dataProvenance":   []map[string]any{{"fetchedAt": nil, "providerIds": attempted, "qualityStatus": "warn", "rowsUsed": 0, "sourceId": liveSource, "warnings": []string{warning}}},
		"market":           market,
		"metrics":          map[string]any{"period": map[string]any{"fiscalPeriod": nil, "reportDate": nil}},
		"providerErrors":   []map[string]any{},
		"qualityStatus":    "degraded",
		"symbol":           symbol,
		"warnings":         []string{warning},
	}
}
