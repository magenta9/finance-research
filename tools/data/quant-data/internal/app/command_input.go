package app

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

type commandFieldKind int

const (
	commandStringField commandFieldKind = iota
	commandBoolField
	commandNumberField
	commandFxPairField
)

type commandFieldSpec struct {
	name string
	kind commandFieldKind
}

var commandInputSpecs = map[string][]commandFieldSpec{
	"delete-prices":         stringFields("assetId", "start", "end"),
	"fetch-market-source":   stringFields("sourceId", "url"),
	"get-flow-sentiment":    stringFields("symbol", "market"),
	"get-fundamentals":      stringFields("symbol", "market"),
	"get-fx-rates":          append(fxPairFields("pair"), stringFields("start", "end")...),
	"get-price-series":      stringFields("symbol", "market", "start", "end", "assetId"),
	"read-fx-bounds":        fxPairFields("pair"),
	"read-fx-latest":        append(fxPairFields("pair"), stringFields("onOrBeforeDate")...),
	"read-fx-rates":         append(fxPairFields("pair"), stringFields("start", "end")...),
	"read-price-bounds":     stringFields("assetId"),
	"read-price-freshness":  append(stringFields("assetId", "now"), commandFieldSpec{name: "maxAgeHours", kind: commandNumberField}),
	"read-prices":           stringFields("assetId", "start", "end"),
	"search-announcements":  stringFields("symbol", "market"),
	"search-assets":         append(stringFields("query", "market", "assetClass"), commandFieldSpec{name: "exactMatch", kind: commandBoolField}),
	"search-news-catalysts": stringFields("symbol", "market"),
}

func stringFields(names ...string) []commandFieldSpec {
	fields := make([]commandFieldSpec, 0, len(names))
	for _, name := range names {
		fields = append(fields, commandFieldSpec{name: name, kind: commandStringField})
	}
	return fields
}

func fxPairFields(names ...string) []commandFieldSpec {
	fields := make([]commandFieldSpec, 0, len(names))
	for _, name := range names {
		fields = append(fields, commandFieldSpec{name: name, kind: commandFxPairField})
	}
	return fields
}

func normalizeCommandInput(method string, input map[string]any) (map[string]any, *MaintenanceError) {
	specs, ok := commandInputSpecs[method]
	if !ok {
		return input, nil
	}
	if input == nil {
		input = map[string]any{}
	}
	normalized := make(map[string]any, len(input))
	for key, value := range input {
		normalized[key] = value
	}
	for _, spec := range specs {
		value, exists := input[spec.name]
		if !exists || value == nil {
			continue
		}
		normalizedValue, err := normalizeCommandField(value, spec.kind)
		if err != nil {
			return nil, invalidInput(method, spec.name, err.Error())
		}
		normalized[spec.name] = normalizedValue
	}
	return normalized, nil
}

func normalizeCommandField(value any, kind commandFieldKind) (any, error) {
	switch kind {
	case commandStringField:
		return normalizeCommandString(value)
	case commandBoolField:
		if value, ok := value.(bool); ok {
			return value, nil
		}
		return nil, fmt.Errorf("must be a boolean")
	case commandFxPairField:
		text, err := normalizeCommandString(value)
		if err != nil {
			return nil, err
		}
		parts := strings.Split(text, "/")
		if len(parts) != 2 {
			return text, nil
		}
		return strings.ToUpper(strings.TrimSpace(parts[0])) + "/" + strings.ToUpper(strings.TrimSpace(parts[1])), nil
	case commandNumberField:
		switch value := value.(type) {
		case float64:
			return finiteCommandNumber(value)
		case float32:
			return finiteCommandNumber(float64(value))
		case int:
			return finiteCommandNumber(float64(value))
		case int64:
			return finiteCommandNumber(float64(value))
		case json.Number:
			parsed, err := strconv.ParseFloat(value.String(), 64)
			if err != nil {
				return nil, fmt.Errorf("must be a number")
			}
			return finiteCommandNumber(parsed)
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil {
				return nil, fmt.Errorf("must be a number")
			}
			return finiteCommandNumber(parsed)
		default:
			return nil, fmt.Errorf("must be a number")
		}
	default:
		return value, nil
	}
}

func normalizeCommandString(value any) (string, error) {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text), nil
	}
	switch value.(type) {
	case bool, []any, map[string]any:
		return "", fmt.Errorf("must be a string")
	}
	return strings.TrimSpace(fmt.Sprint(value)), nil
}

func finiteCommandNumber(value float64) (float64, error) {
	if !math.IsInf(value, 0) && !math.IsNaN(value) {
		return value, nil
	}
	return 0, fmt.Errorf("must be a finite number")
}
