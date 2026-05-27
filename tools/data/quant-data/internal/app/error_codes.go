package app

const (
	MaintenanceCodeConfigInsecure                  = "CONFIG_INSECURE"
	MaintenanceCodeConfigRequired                  = "CONFIG_REQUIRED"
	MaintenanceCodeInsufficientCalculationCoverage = "INSUFFICIENT_CALCULATION_COVERAGE"
	MaintenanceCodeInstrumentNotFound              = "INSTRUMENT_NOT_FOUND"
	MaintenanceCodeInvalidCommandInput             = "INVALID_COMMAND_INPUT"
	MaintenanceCodeNetworkUnavailable              = "NETWORK_UNAVAILABLE"
	MaintenanceCodeProviderLimited                 = "PROVIDER_LIMITED"
	MaintenanceCodeProviderUnavailable             = "PROVIDER_UNAVAILABLE"
	MaintenanceCodeStoreRepairRequired             = "STORE_REPAIR_REQUIRED"
	MaintenanceCodeTimeout                         = "TIMEOUT"
)

var MaintenanceErrorCodes = []string{
	MaintenanceCodeConfigRequired,
	MaintenanceCodeConfigInsecure,
	MaintenanceCodeProviderLimited,
	MaintenanceCodeProviderUnavailable,
	MaintenanceCodeNetworkUnavailable,
	MaintenanceCodeInstrumentNotFound,
	MaintenanceCodeInvalidCommandInput,
	MaintenanceCodeInsufficientCalculationCoverage,
	MaintenanceCodeTimeout,
	MaintenanceCodeStoreRepairRequired,
}
