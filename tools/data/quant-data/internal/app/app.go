package app

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"quant-data/internal/provider"
	"quant-data/internal/store"
)

const (
	CLIVersion      = "0.1.0"
	ContractVersion = "quant-data-cli.v1"
	StoreVersion    = 1
)

var RequiredMethods = []string{
	"search-assets",
	"get-price-series",
	"read-prices",
	"read-price-bounds",
	"read-price-freshness",
	"get-fx-rates",
	"read-fx-rates",
	"read-fx-latest",
	"read-fx-bounds",
	"delete-prices",
	"get-fundamentals",
	"get-flow-sentiment",
	"search-news-catalysts",
	"search-announcements",
	"fetch-market-source",
	"status",
	"rebuild",
	"repair",
}

type HelpDocument struct {
	CLIVersion      string       `json:"cliVersion"`
	ContractVersion string       `json:"contractVersion"`
	StoreVersion    int          `json:"storeVersion"`
	Methods         []HelpMethod `json:"methods"`
}

type HelpMethod struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type Envelope struct {
	OK                bool              `json:"ok"`
	Data              any               `json:"data,omitempty"`
	ProviderStatus    map[string]any    `json:"providerStatus,omitempty"`
	MaintenanceStatus map[string]any    `json:"maintenanceStatus,omitempty"`
	MaintenanceError  *MaintenanceError `json:"maintenanceError,omitempty"`
	ResultProvenance  map[string]any    `json:"resultProvenance,omitempty"`
	DataQualityStatus string            `json:"dataQualityStatus,omitempty"`
}

type MaintenanceError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func Run(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	if len(args) == 0 {
		_, _ = fmt.Fprintln(stderr, "missing method; run quant-data help")
		return 2
	}

	switch args[0] {
	case "help":
		return runHelp(args[1:], stdout, stderr)
	case "status":
		return runStatus(stdout)
	case "repair":
		return runRepair(stdout)
	case "rebuild":
		return runRebuild(stdout)
	default:
		if !isRequiredMethod(args[0]) {
			return writeEnvelope(stdout, Envelope{
				OK: false,
				MaintenanceError: &MaintenanceError{
					Code:    MaintenanceCodeStoreRepairRequired,
					Message: fmt.Sprintf("Unknown quant-data method: %s", args[0]),
				},
				MaintenanceStatus: emptyMaintenanceStatus(),
			})
		}

		return runDataMethod(args[0], stdin, stdout)
	}
}

func runStatus(stdout io.Writer) int {
	dataStore, err := openStore()
	if err != nil {
		return writeStoreError(stdout, err)
	}
	defer dataStore.Close()

	maintenanceStatus, err := dataStore.MaintenanceStatus()
	if err != nil {
		return writeStoreError(stdout, err)
	}
	stats, err := dataStore.ExternalDataStats()
	if err != nil {
		return writeStoreError(stdout, err)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"storeVersion": StoreVersion,
			"storePath":    dataStore.Path(),
			"stats":        stats,
		},
		MaintenanceStatus: maintenanceStatus,
		DataQualityStatus: "available",
	})
}

func runRepair(stdout io.Writer) int {
	dataStore, err := openStore()
	if err != nil {
		return writeStoreError(stdout, err)
	}
	defer dataStore.Close()

	maintenanceStatus, err := dataStore.Repair()
	if err != nil {
		return writeStoreError(stdout, err)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"repaired": true,
		},
		MaintenanceStatus: maintenanceStatus,
		DataQualityStatus: "available",
	})
}

func runRebuild(stdout io.Writer) int {
	dataStore, err := openStore()
	if err != nil {
		return writeStoreError(stdout, err)
	}
	defer dataStore.Close()

	maintenanceStatus, err := dataStore.Rebuild()
	if err != nil {
		return writeStoreError(stdout, err)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"rebuildStarted": true,
		},
		MaintenanceStatus: maintenanceStatus,
		DataQualityStatus: "available",
	})
}

func runHelp(args []string, stdout io.Writer, stderr io.Writer) int {
	if len(args) > 0 && args[0] == "--json" {
		return writeJSON(stdout, buildHelp())
	}

	if len(args) > 0 {
		method := args[0]
		if !isRequiredMethod(method) {
			_, _ = fmt.Fprintf(stderr, "unknown method: %s\n", method)
			return 2
		}

		_, _ = fmt.Fprintf(stdout, "%s\n\nInput: JSON on stdin. Output: JSON envelope on stdout.\n", method)
		return 0
	}

	_, _ = fmt.Fprintln(stdout, "quant-data methods:")
	for _, method := range RequiredMethods {
		_, _ = fmt.Fprintf(stdout, "  %s\n", method)
	}
	_, _ = fmt.Fprintln(stdout, "\nRun quant-data help --json for machine-readable contract metadata.")
	return 0
}

func runDataMethod(method string, stdin io.Reader, stdout io.Writer) int {
	var input map[string]any
	decoder := json.NewDecoder(stdin)
	if err := decoder.Decode(&input); err != nil && err != io.EOF {
		return writeEnvelope(stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    MaintenanceCodeStoreRepairRequired,
				Message: fmt.Sprintf("Invalid JSON input: %v", err),
			},
			MaintenanceStatus: emptyMaintenanceStatus(),
		})
	}

	dataStore, err := openStore()
	if err != nil {
		return writeStoreError(stdout, err)
	}
	defer dataStore.Close()

	maintenanceStatus, err := dataStore.MaintenanceStatus()
	if err != nil {
		return writeStoreError(stdout, err)
	}

	normalizedInput, normalizationError := normalizeCommandInput(method, input)
	if normalizationError != nil {
		return writeEnvelope(stdout, Envelope{OK: false, MaintenanceError: normalizationError, MaintenanceStatus: maintenanceStatus})
	}
	input = normalizedInput

	if isStoreOnlyMethod(method) {
		return runStoreOnlyMethod(method, input, dataStore, maintenanceStatus, stdout)
	}
	if validationError := validateCommandInput(method, input); validationError != nil {
		return writeEnvelope(stdout, Envelope{OK: false, MaintenanceError: validationError, MaintenanceStatus: maintenanceStatus})
	}
	if os.Getenv("QUANT_DATA_FIXTURE_PROVIDER") == "1" {
		return runProviderMethod(method, input, dataStore, maintenanceStatus, stdout, provider.NewFixtureProvider())
	}

	configStatus, err := store.CheckProviderConfig(dataStore.ConfigDir())
	if err != nil {
		return writeStoreError(stdout, err)
	}
	if !configStatus.Exists {
		return writeEnvelope(stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    MaintenanceCodeConfigRequired,
				Message: "Configure provider credentials under ~/.quant_data/config before using data methods.",
				Details: map[string]any{
					"method":    method,
					"configDir": dataStore.ConfigDir(),
				},
			},
			MaintenanceStatus: maintenanceStatus,
		})
	}
	if !configStatus.Secure {
		return writeEnvelope(stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    MaintenanceCodeConfigInsecure,
				Message: "Provider config files must not be readable or writable by group/other users.",
				Details: map[string]any{
					"method": method,
					"paths":  configStatus.InsecurePaths,
				},
			},
			MaintenanceStatus: maintenanceStatus,
		})
	}

	providerConfig, err := store.LoadProviderConfig(dataStore.ConfigDir())
	if err != nil {
		return writeEnvelope(stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    MaintenanceCodeConfigRequired,
				Message: err.Error(),
				Details: map[string]any{
					"method":    method,
					"configDir": dataStore.ConfigDir(),
				},
			},
			MaintenanceStatus: maintenanceStatus,
		})
	}

	policy, err := provider.LoadPolicy()
	if err != nil {
		return writeEnvelope(stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    MaintenanceCodeProviderUnavailable,
				Message: fmt.Sprintf("Provider policy is invalid: %v", err),
				Details: map[string]any{"method": method},
			},
			MaintenanceStatus: maintenanceStatus,
		})
	}

	tushareConfig := providerConfig.Provider("tushare")
	return runProviderMethod(method, input, dataStore, maintenanceStatus, stdout, provider.NewLiveProviderWithPolicy(provider.LiveConfig{TushareToken: tushareConfig.Token}, policy))
}

func runStoreOnlyMethod(method string, input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	if method == "delete-prices" {
		return runDeletePrices(input, dataStore, maintenanceStatus, stdout)
	}

	if validationError := validateReadCommandInput(method, input); validationError != nil {
		return writeEnvelope(stdout, Envelope{OK: false, MaintenanceError: validationError, MaintenanceStatus: maintenanceStatus})
	}

	switch method {
	case "read-prices":
		return runReadPrices(input, dataStore, maintenanceStatus, stdout)
	case "read-price-bounds":
		return runReadPriceBounds(input, dataStore, maintenanceStatus, stdout)
	case "read-price-freshness":
		return runReadPriceFreshness(input, dataStore, maintenanceStatus, stdout)
	case "read-fx-rates":
		return runReadFxRates(input, dataStore, maintenanceStatus, stdout)
	case "read-fx-latest":
		return runReadFxLatest(input, dataStore, maintenanceStatus, stdout)
	case "read-fx-bounds":
		return runReadFxBounds(input, dataStore, maintenanceStatus, stdout)
	default:
		return writeEnvelope(stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    MaintenanceCodeStoreRepairRequired,
				Message: fmt.Sprintf("Unknown store-only method: %s", method),
			},
			MaintenanceStatus: maintenanceStatus,
		})
	}
}

func runDeletePrices(input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	if validationError := validateDeletePricesInput(input); validationError != nil {
		return writeEnvelope(stdout, Envelope{OK: false, MaintenanceError: validationError, MaintenanceStatus: maintenanceStatus})
	}

	assetID := readString(input, "assetId")
	deletedRows, err := dataStore.DeletePrices(assetID, readString(input, "start"), readString(input, "end"))
	if err != nil {
		return writeEnvelope(stdout, Envelope{
			OK: false,
			MaintenanceError: &MaintenanceError{
				Code:    MaintenanceCodeStoreRepairRequired,
				Message: err.Error(),
			},
			MaintenanceStatus: maintenanceStatus,
		})
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"assetId":     assetID,
			"deletedRows": deletedRows,
		},
		DataQualityStatus: "available",
		MaintenanceStatus: maintenanceStatus,
	})
}

func runReadPrices(input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	assetID := readString(input, "assetId")
	start := readString(input, "start")
	end := readString(input, "end")

	var prices []store.PriceRow
	var err error
	if start == "" && end == "" {
		prices, err = dataStore.ListPricesByAsset(assetID)
	} else {
		prices, err = dataStore.GetPriceRange(assetID, start, end)
	}
	if err != nil {
		return writeStoreReadError(stdout, err, maintenanceStatus)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"assetId": assetID,
			"prices":  prices,
		},
		DataQualityStatus: "available",
		MaintenanceStatus: maintenanceStatus,
	})
}

func runReadPriceBounds(input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	assetID := readString(input, "assetId")
	bounds, err := dataStore.GetPriceDateBounds(assetID)
	if err != nil {
		return writeStoreReadError(stdout, err, maintenanceStatus)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"assetId": assetID,
			"bounds":  bounds,
		},
		DataQualityStatus: "available",
		MaintenanceStatus: maintenanceStatus,
	})
}

func runReadPriceFreshness(input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	assetID := readString(input, "assetId")
	referenceTime := time.Now().UTC()
	if nowValue := readString(input, "now"); nowValue != "" {
		parsedNow, err := time.Parse(time.RFC3339, nowValue)
		if err != nil {
			return writeEnvelope(stdout, Envelope{OK: false, MaintenanceError: invalidInput("read-price-freshness", "now", "now must be RFC3339"), MaintenanceStatus: maintenanceStatus})
		}
		referenceTime = parsedNow
	}

	fresh, err := dataStore.IsPriceFresh(assetID, readNumber(input, "maxAgeHours"), referenceTime)
	if err != nil {
		return writeStoreReadError(stdout, err, maintenanceStatus)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"assetId": assetID,
			"fresh":   fresh,
		},
		DataQualityStatus: "available",
		MaintenanceStatus: maintenanceStatus,
	})
}

func runReadFxRates(input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	pair := readString(input, "pair")
	rates, err := dataStore.GetFxRange(pair, readString(input, "start"), readString(input, "end"))
	if err != nil {
		return writeStoreReadError(stdout, err, maintenanceStatus)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"pair":  pair,
			"rates": rates,
		},
		DataQualityStatus: "available",
		MaintenanceStatus: maintenanceStatus,
	})
}

func runReadFxLatest(input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	pair := readString(input, "pair")
	rate, err := dataStore.GetLatestFxRate(pair, readString(input, "onOrBeforeDate"))
	if err != nil {
		return writeStoreReadError(stdout, err, maintenanceStatus)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"pair": pair,
			"rate": rate,
		},
		DataQualityStatus: "available",
		MaintenanceStatus: maintenanceStatus,
	})
}

func runReadFxBounds(input map[string]any, dataStore *store.Store, maintenanceStatus map[string]any, stdout io.Writer) int {
	pair := readString(input, "pair")
	bounds, err := dataStore.GetFxDateBounds(pair)
	if err != nil {
		return writeStoreReadError(stdout, err, maintenanceStatus)
	}

	return writeEnvelope(stdout, Envelope{
		OK: true,
		Data: map[string]any{
			"pair":   pair,
			"bounds": bounds,
		},
		DataQualityStatus: "available",
		MaintenanceStatus: maintenanceStatus,
	})
}

func readString(input map[string]any, key string) string {
	value, ok := input[key]
	if !ok || value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func readBool(input map[string]any, key string) bool {
	value, ok := input[key]
	if !ok || value == nil {
		return false
	}
	if b, ok := value.(bool); ok {
		return b
	}
	return false
}

func readNumber(input map[string]any, key string) float64 {
	value, ok := input[key]
	if !ok || value == nil {
		return 0
	}
	if number, ok := value.(float64); ok {
		return number
	}
	parsed, err := strconv.ParseFloat(readString(input, key), 64)
	if err != nil {
		return 0
	}
	return parsed
}

func writeStoreReadError(stdout io.Writer, err error, maintenanceStatus map[string]any) int {
	return writeEnvelope(stdout, Envelope{
		OK: false,
		MaintenanceError: &MaintenanceError{
			Code:    MaintenanceCodeStoreRepairRequired,
			Message: err.Error(),
		},
		MaintenanceStatus: maintenanceStatus,
	})
}

func openStore() (*store.Store, error) {
	home, err := store.ResolveHome(os.Getenv("QUANT_DATA_HOME"))
	if err != nil {
		return nil, err
	}

	return store.Open(home, StoreVersion)
}

func writeStoreError(stdout io.Writer, err error) int {
	return writeEnvelope(stdout, Envelope{
		OK: false,
		MaintenanceError: &MaintenanceError{
			Code:    MaintenanceCodeStoreRepairRequired,
			Message: err.Error(),
		},
		MaintenanceStatus: emptyMaintenanceStatus(),
	})
}

func buildHelp() HelpDocument {
	methods := make([]HelpMethod, 0, len(RequiredMethods))
	for _, method := range RequiredMethods {
		methods = append(methods, HelpMethod{Name: method})
	}

	return HelpDocument{
		CLIVersion:      CLIVersion,
		ContractVersion: ContractVersion,
		StoreVersion:    StoreVersion,
		Methods:         methods,
	}
}

func isRequiredMethod(method string) bool {
	for _, candidate := range RequiredMethods {
		if candidate == method {
			return true
		}
	}

	return false
}

func isStoreOnlyMethod(method string) bool {
	switch method {
	case "delete-prices", "read-prices", "read-price-bounds", "read-price-freshness", "read-fx-rates", "read-fx-latest", "read-fx-bounds":
		return true
	default:
		return false
	}
}

func emptyMaintenanceStatus() map[string]any {
	return map[string]any{
		"running":     false,
		"queuedTasks": 0,
	}
}

func writeEnvelope(stdout io.Writer, envelope Envelope) int {
	return writeJSON(stdout, envelope)
}

func writeJSON(stdout io.Writer, value any) int {
	encoded, err := json.Marshal(value)
	if err != nil {
		return 1
	}

	_, err = io.Copy(stdout, strings.NewReader(string(encoded)+"\n"))
	if err != nil {
		return 1
	}

	return 0
}
