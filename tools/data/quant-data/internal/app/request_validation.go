package app

import (
	"fmt"
	"strings"
	"time"
)

func validateCommandInput(method string, input map[string]any) *MaintenanceError {
	switch method {
	case "search-assets":
		return requireFields(input, method, "query")
	case "get-price-series":
		if err := requireFields(input, method, "symbol", "start", "end"); err != nil {
			return err
		}
		return requireDateRange(input, method)
	case "get-fx-rates":
		if err := requireFields(input, method, "pair", "start", "end"); err != nil {
			return err
		}
		if !strings.Contains(readString(input, "pair"), "/") {
			return invalidInput(method, "pair", "pair must use BASE/QUOTE format")
		}
		return requireDateRange(input, method)
	case "get-fundamentals", "get-flow-sentiment", "search-news-catalysts", "search-announcements":
		return requireFields(input, method, "symbol")
	case "fetch-market-source":
		return requireFields(input, method, "url")
	default:
		return nil
	}
}

func validateDeletePricesInput(input map[string]any) *MaintenanceError {
	if err := requireFields(input, "delete-prices", "assetId", "start", "end"); err != nil {
		return err
	}
	return requireDateRange(input, "delete-prices")
}

func validateReadCommandInput(method string, input map[string]any) *MaintenanceError {
	switch method {
	case "read-prices":
		if err := requireFields(input, method, "assetId"); err != nil {
			return err
		}
		if readString(input, "start") == "" && readString(input, "end") == "" {
			return nil
		}
		if err := requireFields(input, method, "start", "end"); err != nil {
			return err
		}
		return requireDateRange(input, method)
	case "read-price-bounds":
		return requireFields(input, method, "assetId")
	case "read-price-freshness":
		if err := requireFields(input, method, "assetId", "maxAgeHours"); err != nil {
			return err
		}
		if readNumber(input, "maxAgeHours") <= 0 {
			return invalidInput(method, "maxAgeHours", "maxAgeHours must be greater than 0")
		}
		return nil
	case "read-fx-rates":
		if err := requireFields(input, method, "pair", "start", "end"); err != nil {
			return err
		}
		if !strings.Contains(readString(input, "pair"), "/") {
			return invalidInput(method, "pair", "pair must use BASE/QUOTE format")
		}
		return requireDateRange(input, method)
	case "read-fx-latest":
		if err := requireFields(input, method, "pair", "onOrBeforeDate"); err != nil {
			return err
		}
		if !strings.Contains(readString(input, "pair"), "/") {
			return invalidInput(method, "pair", "pair must use BASE/QUOTE format")
		}
		if _, err := parseCommandDate(readString(input, "onOrBeforeDate")); err != nil {
			return invalidInput(method, "onOrBeforeDate", "onOrBeforeDate must be YYYY-MM-DD")
		}
		return nil
	case "read-fx-bounds":
		if err := requireFields(input, method, "pair"); err != nil {
			return err
		}
		if !strings.Contains(readString(input, "pair"), "/") {
			return invalidInput(method, "pair", "pair must use BASE/QUOTE format")
		}
		return nil
	default:
		return nil
	}
}

func requireFields(input map[string]any, method string, fields ...string) *MaintenanceError {
	for _, field := range fields {
		if readString(input, field) == "" {
			return invalidInput(method, field, fmt.Sprintf("%s is required", field))
		}
	}
	return nil
}

func requireDateRange(input map[string]any, method string) *MaintenanceError {
	start, err := parseCommandDate(readString(input, "start"))
	if err != nil {
		return invalidInput(method, "start", "start must be YYYY-MM-DD")
	}
	end, err := parseCommandDate(readString(input, "end"))
	if err != nil {
		return invalidInput(method, "end", "end must be YYYY-MM-DD")
	}
	if end.Before(start) {
		return invalidInput(method, "end", "end must be on or after start")
	}
	return nil
}

func parseCommandDate(value string) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed, nil
}

func invalidInput(method string, field string, message string) *MaintenanceError {
	return &MaintenanceError{
		Code:    MaintenanceCodeInvalidCommandInput,
		Message: message,
		Details: map[string]any{
			"field":  field,
			"method": method,
		},
	}
}
