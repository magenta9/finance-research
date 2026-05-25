# finance-research

finance-research is a local tool repository for maintaining investable asset data, preparing research inputs, and supporting portfolio decisions.

## Language

**Data Domain**:
Investable asset facts, market observations, research signals, and source material used to analyze assets and portfolios.
_Avoid_: Portfolio optimization, solver, allocation calculation

**Data Maintenance**:
The practice of keeping the **Data Domain** complete, fresh, attributable, and reusable across finance-research workflows.
_Avoid_: Portfolio optimization, allocation engine

**External Data Reconciliation**:
The CLI-owned Data Maintenance rule for merging incoming provider rows with persisted **External Data** without losing better existing fields.
_Avoid_: Host cache merge, presentation fallback, portfolio preparation rule

**Data Access Interface**:
The tool-facing contract for retrieving assets, market observations, research signals, and source material from the **Data Domain**.
_Avoid_: Price API, sidecar API, market-data-only interface

**External Data**:
Provider-sourced asset facts, market observations, research signals, and source material maintained for reuse.
_Avoid_: User workspace data, saved portfolio data

**External Instrument**:
A provider-identifiable investment object for which **External Data** can be maintained.
_Avoid_: User asset record, portfolio holding

**User Workspace Data**:
User-authored research records such as asset pools, positions, allocation plans, conversations, and preferences.
_Avoid_: External data, provider cache

**Provider Status**:
The reported state of external provider attempts for a data request.
_Avoid_: Business data, data quality, portfolio diagnostic

**Provider Configuration**:
The local user configuration required for external data providers, including credentials and provider-specific settings.
_Avoid_: Host preference, portfolio setting

**Provider Routing**:
The CLI-owned decision about which external providers to attempt and how their rows are prioritized for a data request.
_Avoid_: Host preference filtering, presentation source selection, portfolio strategy

**Maintenance Status**:
The visible state of data refresh work, including queued, running, skipped, failed, and completed maintenance.
_Avoid_: Provider status, portfolio diagnostic

**External Data Status**:
The CLI-owned store status and summary statistics returned through `quant-data status`, including row counts and latest fetch time.
_Avoid_: Host cache summary, dashboard state, direct SQLite count

**Maintenance Error**:
A structured maintenance failure or blocker expressed as an error code and message.
_Avoid_: Data quality status, portfolio diagnostic

**Data Quality Status**:
The availability judgment for returned **External Data**, expressed as available, degraded, or unavailable.
_Avoid_: Provider limit, maintenance error, exception

**Result Provenance**:
The request-level source record for returned **External Data**, including attempted providers, selected source, warnings, and fetch time.
_Avoid_: Row-level provenance, debug log

**Read-Through Data Request**:
A data request that may refresh missing or stale **External Data** before returning the best available result and status.
_Avoid_: Cache-only read, forced remote fetch

**External Data Read Model**:
The CLI-backed read shape used by tools to consume **External Data** without opening the CLI-owned store directly.
_Avoid_: Host SQLite cache, repository mirror, direct quant-data DB reader

**Compatibility Write Adapter**:
A temporary app-side adapter that supports migration-era write-through behavior until CLI-owned persistence is the only writer.
_Avoid_: Long-term external data repository, host-owned cache writer

**Display Price Series**:
The price series shown to users in charts and inspection views.
_Avoid_: Calculation series, risk input

**Calculation Price Series**:
The price series used for returns, volatility, correlation, drawdown, and portfolio inputs.
_Avoid_: Display series, chart-only price

**Trend Observation Setup**:
A non-execution market state where a higher-timeframe **Calculation Price Series** is suitable for user observation before any lower-timeframe entry decision.
_Avoid_: Entry signal, buy signal, trade trigger

**Portfolio Preparation**:
The step that turns selected assets, base currency, requested window, and **Calculation Price Series** into aligned portfolio inputs.
_Avoid_: Data maintenance, portfolio optimization, display chart preparation

**Portfolio Optimization**:
The portfolio decision step that turns prepared asset inputs and constraints into target weights.
_Avoid_: Data maintenance, market-data fetch

## Relationships

- **Data Maintenance** maintains the **Data Domain**.
- **External Data Reconciliation** belongs to **Data Maintenance** and is implemented by the CLI store persistence path.
- The **Data Access Interface** exposes the **Data Domain** to finance-research workflows.
- **External Data** is maintained outside **User Workspace Data**.
- **External Data** belongs to an **External Instrument**.
- **User Workspace Data** may reference **External Data** but does not own it.
- A user asset record may reference one **External Instrument**.
- **Provider Status** and **Maintenance Status** describe data availability and refresh progress, not portfolio quality.
- **External Data Status** is reported by the CLI and may be combined with **User Workspace Data** counts for display.
- **Provider Configuration** enables provider access for **Data Maintenance**.
- **Provider Routing** is interpreted by the CLI from **Provider Configuration** and provider policy contracts.
- A **Maintenance Error** describes limit, quota, provider unavailability, and other maintenance blockers.
- **Data Quality Status** summarizes whether returned **External Data** is fit for use; it does not encode provider limits.
- **Result Provenance** explains the source and freshness of returned **External Data** at request level.
- A **Read-Through Data Request** may update **External Data** and reports both **Provider Status** and **Maintenance Status**.
- Tools consume **External Data** through the **External Data Read Model**, not by opening the CLI-owned SQLite store.
- A **Compatibility Write Adapter** is transitional and must not become the long-term owner of **External Data**.
- **Display Price Series** and **Calculation Price Series** belong to the same **External Instrument** but serve different workflows.
- Tool caller-facing interfaces for **Display Price Series** and **Calculation Price Series** are separate, even when both are backed by `quant-data get-price-series`.
- A **Trend Observation Setup** consumes **Calculation Price Series** and does not create an order, position, or execution instruction.
- **Portfolio Preparation** consumes base-currency **Calculation Price Series** and applies coverage, alignment, and exclusion rules.
- **Portfolio Optimization** consumes **Calculation Price Series**, not **Display Price Series**.
- **Calculation Price Series** coverage is judged across the whole requested window.
- **Portfolio Optimization** consumes prepared data from **Portfolio Preparation** but is not part of **Data Maintenance**.

## Example Dialogue

> **Dev:** "Should the data-maintenance migration include portfolio optimization?"
> **Domain expert:** "No. Data maintenance owns the data domain; portfolio optimization is a separate decision step."

## Flagged Ambiguities

- "sidecar responsibilities" could mean both **Data Maintenance** and **Portfolio Optimization**. Resolved: **Data Maintenance** moves to the CLI, while **Portfolio Optimization** remains app-owned and is not provided by the CLI.
- "data interface" could mean prices only or the full **Data Access Interface**. Resolved: the CLI migration covers the full **Data Access Interface**.
- "SQLite access" could mean all local research records or only provider-backed data. Resolved: the CLI owns **External Data** and maintenance state; user workflows own **User Workspace Data**.
- "limit" could mean a data quality problem or a maintenance blocker. Resolved: limits are represented as **Maintenance Error**, not **Data Quality Status**.
- "asset" could mean a user asset record or an **External Instrument**. Resolved: CLI data is keyed by **External Instrument**, while user workspace records keep their own identity.
- "fallback" could mean whole-window source fallback or pointwise synthetic filling. Resolved: **Calculation Price Series** does not use pointwise fallback.
- "price history" could mean display rows, calculation rows, or provider rows. Resolved: callers must choose **Display Price Series** or **Calculation Price Series** explicitly; provider row fields are translated behind the **Data Access Interface**.
- "read model" could mean an app-owned SQLite mirror or a CLI-backed **External Data Read Model**. Resolved: app read paths must use the CLI-backed **External Data Read Model** and must not open the CLI-owned store directly.
- "cache summary" could mean app-owned cache counts or CLI-owned **External Data Status**. Resolved: external row counts and latest fetch time come from `quant-data status`; the app may add **User Workspace Data** counts for display.
- "row merge" could mean app-side cache reconciliation or CLI-owned **External Data Reconciliation**. Resolved: persisted provider row reconciliation belongs in quant-data, with app-side logic treated as transitional.
- "provider settings" could mean app preferences or CLI-owned **Provider Configuration**. Resolved: provider enablement and routing belong to the CLI; app code may read summaries for setup and display but must not be the production routing authority.
- "entry signal" could mean either a **Trend Observation Setup** or an executable trade trigger. Resolved: tools may identify observation setups, while lower-timeframe entry decisions remain user-owned unless a separate execution contract is defined.