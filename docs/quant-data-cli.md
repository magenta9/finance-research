# Quant Data CLI Setup

finance-research uses a user-installed `quant-data` CLI for external data access. Tools should check that `quant-data` is present and contract-compatible before depending on live external data.

The CLI is implemented in Go and exposes a language-agnostic JSON command contract to finance-research tools.

## Install

Install `quant-data` so it is available on `PATH`, or pass an explicit executable path to the tool that invokes it.

From this repository, install the Go CLI with:

```sh
cd tools/data/quant-data
go install ./cmd/quant-data
```

For a local one-off binary, build with:

```sh
cd tools/data/quant-data
go build -o quant-data ./cmd/quant-data
```

Check compatibility with:

```sh
quant-data help --json
```

The JSON output must include a compatible `contractVersion`, `storeVersion`, and all required method names.

## Local Data Directory

`quant-data` owns external data and maintenance state under:

```sh
~/.quant_data
```

For local development or tests, override this location with:

```sh
QUANT_DATA_HOME=/tmp/quant-data-dev quant-data status
```

The current Go store creates `quant-data.sqlite3` plus a `config` directory under this home.

finance-research fetches and reads go through JSON commands. Tools must not open `QUANT_DATA_HOME/quant-data.sqlite3` directly for External Data reads; use CLI-backed read/status commands instead of recreating host-owned external-data caches.

## Provider Configuration

Provider configuration lives under:

```sh
~/.quant_data/config
```

Provider credentials are user-editable plaintext config files. The CLI validates file permissions before using them and attempts to harden owner-owned regular config files to `0600`. If credential files are missing or still unsafe, commands return maintenance errors instead of silently falling back.

Credential files should be readable only by the current user, for example:

```sh
chmod 600 ~/.quant_data/config/provider.json
```

The current top-level config shape remains supported:

```json
{
	"TUSHARE_TOKEN": "..."
}
```

The structured provider-keyed shape is also supported:

```json
{
	"providers": {
		"tushare": {
			"token": "..."
		}
	}
}
```

Unknown provider sections are rejected so a misspelled credential block does not silently disable a provider.

Expected maintenance errors:

- `CONFIG_REQUIRED`: required provider configuration is missing.
- `CONFIG_INSECURE`: provider configuration exists but has unsafe permissions.
- `INVALID_COMMAND_INPUT`: command JSON is missing required fields or has invalid date / pair format.

## Provider Policy

Provider routing and source priority weights are described by:

```sh
tools/data/quant-data/contracts/market-data-policy.json
```

When running from this repository, the CLI discovers that file by walking upward from the current working directory. If no policy file is found, it uses the compiled `DefaultPolicy`. For development or tests, override the policy path with:

```sh
QUANT_DATA_POLICY_PATH=/path/to/market-data-policy.json quant-data get-price-series
```

Malformed policy files, unsupported markets, and unknown provider ids return a `PROVIDER_UNAVAILABLE` maintenance error instead of silently changing provider fallback behavior.

## Command Contract

Tools call methods with:

```sh
quant-data <method>
```

Input is JSON on stdin. Output is a single JSON envelope on stdout. Logs and diagnostics must go to stderr.

Method names use kebab-case. JSON fields use camelCase.

Supported read and maintenance methods:

- `search-assets`
- `get-price-series`
- `read-prices`
- `read-price-bounds`
- `read-price-freshness`
- `get-fx-rates`
- `read-fx-rates`
- `read-fx-latest`
- `read-fx-bounds`
- `delete-prices`
- `get-fundamentals`
- `get-flow-sentiment`
- `search-news-catalysts`
- `search-announcements`
- `fetch-market-source`
- `status`
- `rebuild`
- `repair`

## Envelope Semantics

Exit code `0` means the CLI produced a valid JSON envelope. Maintenance failures are reported inside the envelope, not through nonzero exits.

Nonzero exits are reserved for process, protocol, or stdout failures.

Maintenance errors used by finance-research tools:

- `CONFIG_REQUIRED`
- `CONFIG_INSECURE`
- `INVALID_COMMAND_INPUT`
- `PROVIDER_LIMITED`
- `PROVIDER_UNAVAILABLE`
- `NETWORK_UNAVAILABLE`
- `INSTRUMENT_NOT_FOUND`
- `INSUFFICIENT_CALCULATION_COVERAGE`
- `TIMEOUT`
- `STORE_REPAIR_REQUIRED`

Tool setup errors:

- `DATA_CLI_NOT_FOUND`: `quant-data` could not be executed.
- `DATA_CLI_INCOMPATIBLE`: `help --json` reports an unsupported contract or missing methods.

## Deadlines

Tools pass a deadline in command JSON. The default deadline is 10 seconds. The CLI should block on store locks only within the active deadline and return a `TIMEOUT` maintenance error when work cannot finish in time.

## Price Series

`get-price-series` requires `symbol`, `start`, and `end`. Dates must use `YYYY-MM-DD`, and `end` must be on or after `start`.

Price results distinguish display and calculation semantics:

- Display price series is used for charts and inspection.
- Calculation price series is used for returns, volatility, correlation, drawdown, and portfolio inputs.

Calculation coverage is judged across the whole requested window. The CLI must not synthesize a pointwise mixed calculation series when coverage is insufficient; return `INSUFFICIENT_CALCULATION_COVERAGE` instead.

## Maintenance Commands

`repair` fixes store schema, indexes, queue state, or maintenance state without intentionally clearing data.

`rebuild` performs a hard rebuild of external data and re-fetches provider-backed caches.

`delete-prices` deletes persisted rows from `daily_prices` for one `assetId` and a required `start` / `end` date range in `YYYY-MM-DD` format.

`get-fx-rates` requires `pair`, `start`, and `end`. The FX pair must use `BASE/QUOTE` format.

finance-research does not rely on a separate `clear-cache` command.

Current implementation status: the Go CLI initializes the SQLite store, reports status, validates and hardens provider config permissions, records `repair` / `rebuild` maintenance state, supports targeted `delete-prices`, and provides live search/price/FX adapters for Tushare, AKShare-compatible Eastmoney endpoints, YFinance, and Frankfurter FX. The `status` output is the home for CLI-owned External Data Status, including row counts and latest fetch time. Fundamentals, flow, news, announcements, and market-source fetches return structured degraded results until their live research adapters are implemented. Deterministic fixture data is available only for tests by setting `QUANT_DATA_FIXTURE_PROVIDER=1`.