package app

import (
	"fmt"
	"io"

	"quant-data/internal/provider"
	"quant-data/internal/store"
)

type commandExecutor struct {
	method            string
	input             map[string]any
	dataStore         *store.Store
	maintenanceStatus map[string]any
	stdout            io.Writer
	dataProvider      provider.Adapter
}

type commandResult struct {
	data          any
	qualityStatus string
	implemented   bool
	storeErr      error
}

func runProviderMethod(method string, input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer, dataProvider provider.Adapter) int {
	executor := commandExecutor{
		method:            method,
		input:             input,
		dataStore:         dataStore,
		maintenanceStatus: maintenanceStatus,
		stdout:            stdout,
		dataProvider:      dataProvider,
	}
	return executor.Run()
}

func (executor commandExecutor) Run() int {
	if validationError := validateCommandInput(executor.method, executor.input); validationError != nil {
		return writeEnvelope(executor.stdout, Envelope{OK: false, MaintenanceError: validationError, MaintenanceStatus: executor.maintenanceStatus})
	}

	result := executor.invoke()
	if !result.implemented {
		return writeEnvelope(executor.stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    "PROVIDER_UNAVAILABLE",
				Message: fmt.Sprintf("Provider method is not implemented: %s", executor.method),
			},
			MaintenanceStatus: executor.maintenanceStatus,
		})
	}
	if result.storeErr != nil {
		return writeStoreError(executor.stdout, result.storeErr)
	}

	return writeEnvelope(executor.stdout, Envelope{
		OK:                true,
		Data:              result.data,
		DataQualityStatus: result.qualityStatus,
		MaintenanceStatus: executor.maintenanceStatus,
		ProviderStatus: map[string]any{
			"provider": executor.dataProvider.Source(),
			"mode":     executor.dataProvider.Mode(),
		},
		ResultProvenance: map[string]any{
			"sourceId": executor.dataProvider.Source(),
		},
	})
}

func (executor commandExecutor) invoke() commandResult {
	switch executor.method {
	case "search-assets":
		return commandResult{data: executor.dataProvider.SearchAssets(
			readString(executor.input, "query"),
			readString(executor.input, "market"),
			readString(executor.input, "assetClass"),
			readBool(executor.input, "exactMatch"),
		), qualityStatus: "available", implemented: true}
	case "get-price-series":
		result := executor.dataProvider.GetPriceSeries(readString(executor.input, "symbol"), readString(executor.input, "market"), readString(executor.input, "start"), readString(executor.input, "end"))
		if assetID := readString(executor.input, "assetId"); assetID != "" {
			if err := executor.savePrices(assetID, result.Prices); err != nil {
				return commandResult{implemented: true, storeErr: err}
			}
		}
		return commandResult{data: result, qualityStatus: "available", implemented: true}
	case "get-fx-rates":
		result := executor.dataProvider.GetFxRates(readString(executor.input, "pair"), readString(executor.input, "start"), readString(executor.input, "end"))
		if err := executor.saveFxRates(result.Pair, result.Rates); err != nil {
			return commandResult{implemented: true, storeErr: err}
		}
		return commandResult{data: result, qualityStatus: "available", implemented: true}
	case "get-fundamentals":
		return commandResult{data: executor.dataProvider.EmptyFundamentals(readString(executor.input, "symbol"), readString(executor.input, "market")), qualityStatus: "degraded", implemented: true}
	case "get-flow-sentiment":
		return commandResult{data: executor.dataProvider.EmptyFlowSentiment(readString(executor.input, "symbol"), readString(executor.input, "market")), qualityStatus: "degraded", implemented: true}
	case "search-news-catalysts":
		return commandResult{data: executor.dataProvider.EmptyNewsCatalysts(readString(executor.input, "symbol"), readString(executor.input, "market")), qualityStatus: "degraded", implemented: true}
	case "search-announcements":
		return commandResult{data: []map[string]any{}, qualityStatus: "degraded", implemented: true}
	case "fetch-market-source":
		return commandResult{data: executor.dataProvider.EmptyMarketSource(readString(executor.input, "sourceId"), readString(executor.input, "url")), qualityStatus: "degraded", implemented: true}
	default:
		return commandResult{}
	}
}

func (executor commandExecutor) savePrices(assetID string, prices []provider.PriceRow) error {
	rows := make([]store.PriceInput, 0, len(prices))
	for _, row := range prices {
		rows = append(rows, store.PriceInput{
			AdjustedClose: row.AdjustedClose,
			AssetID:       assetID,
			Close:         row.Close,
			Date:          row.Date,
			High:          row.High,
			Low:           row.Low,
			Open:          row.Open,
			Source:        row.Source,
			Volume:        row.Volume,
		})
	}
	return executor.dataStore.SavePrices(rows)
}

func (executor commandExecutor) saveFxRates(pair string, rates []provider.FxRateRow) error {
	rows := make([]store.FxRateInput, 0, len(rates))
	for _, row := range rates {
		rows = append(rows, store.FxRateInput{
			Date:   row.Date,
			Pair:   pair,
			Rate:   row.Rate,
			Source: row.Source,
		})
	}
	return executor.dataStore.SaveFxRates(rows)
}
