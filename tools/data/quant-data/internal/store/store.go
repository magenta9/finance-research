package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

const databaseFileName = "quant-data.sqlite3"
const sqliteBusyTimeoutMS = 5000

type Store struct {
	db           *sql.DB
	home         string
	path         string
	configDir    string
	storeVersion int
}

type PriceInput struct {
	AdjustedClose *float64
	AssetID       string
	Close         *float64
	Date          string
	High          *float64
	Low           *float64
	Open          *float64
	Source        string
	Volume        *float64
}

type FxRateInput struct {
	Date   string
	Pair   string
	Rate   float64
	Source string
}

type DateBounds struct {
	EarliestDate *string `json:"earliestDate"`
	LatestDate   *string `json:"latestDate"`
}

type PriceRow struct {
	AdjustedClose *float64 `json:"adjustedClose"`
	AssetID       string   `json:"assetId"`
	Close         *float64 `json:"close"`
	Date          string   `json:"date"`
	FetchedAt     string   `json:"fetchedAt"`
	High          *float64 `json:"high"`
	Low           *float64 `json:"low"`
	Open          *float64 `json:"open"`
	Source        string   `json:"source"`
	Volume        *float64 `json:"volume"`
}

type FxRateRow struct {
	Date   string  `json:"date"`
	Pair   string  `json:"pair"`
	Rate   float64 `json:"rate"`
	Source string  `json:"source"`
}

type ExternalDataStats struct {
	PriceRowCount      int64   `json:"priceRowCount"`
	FxRateRowCount     int64   `json:"fxRateRowCount"`
	LatestPriceFetchAt *string `json:"latestPriceFetchAt"`
}

func ResolveHome(override string) (string, error) {
	if override != "" {
		return override, nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(home, ".quant_data"), nil
}

func Open(home string, storeVersion int) (*Store, error) {
	if err := os.MkdirAll(home, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(home, 0o700); err != nil {
		return nil, err
	}

	configDir := filepath.Join(home, "config")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(configDir, 0o700); err != nil {
		return nil, err
	}

	path := filepath.Join(home, databaseFileName)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	store := &Store{
		db:           db,
		home:         home,
		path:         path,
		configDir:    configDir,
		storeVersion: storeVersion,
	}

	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}

	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) ConfigDir() string {
	return s.configDir
}

func (s *Store) MaintenanceStatus() (map[string]any, error) {
	return s.readMaintenanceStatus()
}

func (s *Store) ExternalDataStats() (ExternalDataStats, error) {
	var stats ExternalDataStats
	var latestPriceFetchAt sql.NullString

	if err := s.db.QueryRow(`SELECT COUNT(*) FROM daily_prices`).Scan(&stats.PriceRowCount); err != nil {
		return ExternalDataStats{}, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM fx_rates`).Scan(&stats.FxRateRowCount); err != nil {
		return ExternalDataStats{}, err
	}
	if err := s.db.QueryRow(`SELECT MAX(fetched_at) FROM daily_prices`).Scan(&latestPriceFetchAt); err != nil {
		return ExternalDataStats{}, err
	}
	if latestPriceFetchAt.Valid {
		stats.LatestPriceFetchAt = &latestPriceFetchAt.String
	}

	return stats, nil
}

func (s *Store) Repair() (map[string]any, error) {
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s.updateMaintenanceStatus("repair")
}

func (s *Store) Rebuild() (map[string]any, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM market_source_cache`); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`DELETE FROM daily_prices`); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`DELETE FROM fx_rates`); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`DELETE FROM maintenance_queue`); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`
		INSERT INTO maintenance_status (id, running, queued_tasks, last_action, updated_at)
		VALUES (1, 0, 0, 'hard-rebuild', ?)
		ON CONFLICT(id) DO UPDATE SET
			running = excluded.running,
			queued_tasks = excluded.queued_tasks,
			last_action = excluded.last_action,
			updated_at = excluded.updated_at
	`, now()); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return s.readMaintenanceStatus()
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(fmt.Sprintf(`PRAGMA busy_timeout = %d`, sqliteBusyTimeoutMS)); err != nil {
		return err
	}
	if _, err := s.db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		return err
	}

	statements := []string{
		`CREATE TABLE IF NOT EXISTS metadata (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS maintenance_status (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			running INTEGER NOT NULL DEFAULT 0,
			queued_tasks INTEGER NOT NULL DEFAULT 0,
			last_action TEXT,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS maintenance_queue (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			task_type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS market_source_cache (
			source TEXT PRIMARY KEY,
			payload_json TEXT NOT NULL,
			fetched_at TEXT NOT NULL,
			expires_at TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS provider_limits (
			provider TEXT PRIMARY KEY,
			limited_until TEXT,
			reason TEXT,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS daily_prices (
			asset_id TEXT NOT NULL,
			date TEXT NOT NULL,
			open REAL,
			high REAL,
			low REAL,
			close REAL,
			volume REAL,
			adjusted_close REAL,
			source TEXT NOT NULL,
			fetched_at TEXT NOT NULL,
			PRIMARY KEY (asset_id, date)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_daily_prices_asset_date ON daily_prices(asset_id, date)`,
		`CREATE TABLE IF NOT EXISTS fx_rates (
			pair TEXT NOT NULL,
			date TEXT NOT NULL,
			rate REAL NOT NULL,
			source TEXT NOT NULL,
			PRIMARY KEY (pair, date)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_date ON fx_rates(pair, date)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}

	if _, err := s.db.Exec(`
		INSERT INTO metadata (key, value)
		VALUES ('store_version', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, fmt.Sprintf("%d", s.storeVersion)); err != nil {
		return err
	}
	if _, err := s.db.Exec(fmt.Sprintf("PRAGMA user_version = %d", s.storeVersion)); err != nil {
		return err
	}

	_, err := s.db.Exec(`
		INSERT INTO maintenance_status (id, running, queued_tasks, updated_at)
		VALUES (1, 0, 0, ?)
		ON CONFLICT(id) DO NOTHING
	`, now())
	return err
}

func (s *Store) SavePrices(rows []PriceInput) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	statement, err := tx.Prepare(`
		INSERT INTO daily_prices (asset_id, date, open, high, low, close, volume, adjusted_close, source, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(asset_id, date) DO UPDATE SET
			open = excluded.open,
			high = excluded.high,
			low = excluded.low,
			close = excluded.close,
			volume = excluded.volume,
			adjusted_close = excluded.adjusted_close,
			source = excluded.source,
			fetched_at = excluded.fetched_at
	`)
	if err != nil {
		return err
	}
	defer statement.Close()

	fetchedAt := now()
	for _, row := range rows {
		merged, err := readMergedPriceInput(tx, row)
		if err != nil {
			return err
		}
		row = merged
		if _, err := statement.Exec(row.AssetID, row.Date, row.Open, row.High, row.Low, row.Close, row.Volume, row.AdjustedClose, row.Source, fetchedAt); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) ListPricesByAsset(assetID string) ([]PriceRow, error) {
	rows, err := s.db.Query(`
		SELECT asset_id, date, open, high, low, close, volume, adjusted_close, source, fetched_at
		FROM daily_prices
		WHERE asset_id = ?
		ORDER BY date ASC
	`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanPriceRows(rows)
}

func (s *Store) GetPriceRange(assetID string, startDate string, endDate string) ([]PriceRow, error) {
	rows, err := s.db.Query(`
		SELECT asset_id, date, open, high, low, close, volume, adjusted_close, source, fetched_at
		FROM daily_prices
		WHERE asset_id = ?
			AND date >= ?
			AND date <= ?
		ORDER BY date ASC
	`, assetID, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanPriceRows(rows)
}

func (s *Store) GetPriceDateBounds(assetID string) (DateBounds, error) {
	var earliestDate sql.NullString
	var latestDate sql.NullString
	if err := s.db.QueryRow(`
		SELECT MIN(date), MAX(date)
		FROM daily_prices
		WHERE asset_id = ?
	`, assetID).Scan(&earliestDate, &latestDate); err != nil {
		return DateBounds{}, err
	}

	return dateBoundsFromNullable(earliestDate, latestDate), nil
}

func (s *Store) IsPriceFresh(assetID string, maxAgeHours float64, referenceTime time.Time) (bool, error) {
	fetchedAt, err := s.getLatestPriceFetchedAtByAsset(assetID)
	if err != nil || fetchedAt == nil {
		return false, err
	}

	parsedFetchedAt, err := time.Parse(time.RFC3339, *fetchedAt)
	if err != nil {
		return false, err
	}

	return referenceTime.Sub(parsedFetchedAt) <= time.Duration(maxAgeHours*float64(time.Hour)), nil
}

func scanPriceRows(rows *sql.Rows) ([]PriceRow, error) {
	result := []PriceRow{}
	for rows.Next() {
		var row PriceRow
		if err := rows.Scan(
			&row.AssetID,
			&row.Date,
			&row.Open,
			&row.High,
			&row.Low,
			&row.Close,
			&row.Volume,
			&row.AdjustedClose,
			&row.Source,
			&row.FetchedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Store) getLatestPriceFetchedAtByAsset(assetID string) (*string, error) {
	var fetchedAt sql.NullString
	if err := s.db.QueryRow(`
		SELECT MAX(fetched_at)
		FROM daily_prices
		WHERE asset_id = ?
	`, assetID).Scan(&fetchedAt); err != nil {
		return nil, err
	}
	if !fetchedAt.Valid {
		return nil, nil
	}
	return &fetchedAt.String, nil
}

func readMergedPriceInput(tx *sql.Tx, incoming PriceInput) (PriceInput, error) {
	var existing PriceInput
	err := tx.QueryRow(`
		SELECT asset_id, date, open, high, low, close, volume, adjusted_close, source
		FROM daily_prices
		WHERE asset_id = ? AND date = ?
	`, incoming.AssetID, incoming.Date).Scan(
		&existing.AssetID,
		&existing.Date,
		&existing.Open,
		&existing.High,
		&existing.Low,
		&existing.Close,
		&existing.Volume,
		&existing.AdjustedClose,
		&existing.Source,
	)
	if err == sql.ErrNoRows {
		return incoming, nil
	}
	if err != nil {
		return PriceInput{}, err
	}

	return mergePriceInput(existing, incoming), nil
}

func mergePriceInput(existing PriceInput, incoming PriceInput) PriceInput {
	if existing.Source == incoming.Source {
		return overlayPriceInput(existing, incoming)
	}

	if priceInputCompleteness(incoming) > priceInputCompleteness(existing) {
		return fillPriceInputGaps(incoming, existing)
	}

	return fillPriceInputGaps(existing, incoming)
}

func overlayPriceInput(base PriceInput, incoming PriceInput) PriceInput {
	base.AssetID = incoming.AssetID
	base.Date = incoming.Date
	base.Source = incoming.Source
	if incoming.Open != nil {
		base.Open = incoming.Open
	}
	if incoming.High != nil {
		base.High = incoming.High
	}
	if incoming.Low != nil {
		base.Low = incoming.Low
	}
	if incoming.Close != nil {
		base.Close = incoming.Close
	}
	if incoming.Volume != nil {
		base.Volume = incoming.Volume
	}
	if incoming.AdjustedClose != nil {
		base.AdjustedClose = incoming.AdjustedClose
	}
	return base
}

func fillPriceInputGaps(base PriceInput, incoming PriceInput) PriceInput {
	if base.Open == nil {
		base.Open = incoming.Open
	}
	if base.High == nil {
		base.High = incoming.High
	}
	if base.Low == nil {
		base.Low = incoming.Low
	}
	if base.Close == nil {
		base.Close = incoming.Close
	}
	if base.Volume == nil {
		base.Volume = incoming.Volume
	}
	if base.AdjustedClose == nil {
		base.AdjustedClose = incoming.AdjustedClose
	}
	return base
}

func priceInputCompleteness(row PriceInput) int {
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

func (s *Store) DeletePrices(assetID string, start string, end string) (int64, error) {
	if assetID == "" {
		return 0, fmt.Errorf("assetId is required")
	}
	if start == "" || end == "" {
		return 0, fmt.Errorf("start and end are required for delete-prices")
	}
	startDate, err := time.Parse("2006-01-02", start)
	if err != nil {
		return 0, fmt.Errorf("start must use YYYY-MM-DD format")
	}
	endDate, err := time.Parse("2006-01-02", end)
	if err != nil {
		return 0, fmt.Errorf("end must use YYYY-MM-DD format")
	}
	if startDate.After(endDate) {
		return 0, fmt.Errorf("start must be on or before end")
	}

	result, err := s.db.Exec(`
		DELETE FROM daily_prices
		WHERE asset_id = ? AND date >= ? AND date <= ?
	`, assetID, start, end)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) SaveFxRates(rows []FxRateInput) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	statement, err := tx.Prepare(`
		INSERT INTO fx_rates (pair, date, rate, source)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(pair, date) DO UPDATE SET
			rate = excluded.rate,
			source = excluded.source
	`)
	if err != nil {
		return err
	}
	defer statement.Close()

	for _, row := range rows {
		if _, err := statement.Exec(row.Pair, row.Date, row.Rate, row.Source); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) GetLatestFxRate(pair string, onOrBeforeDate string) (*FxRateRow, error) {
	var row FxRateRow
	err := s.db.QueryRow(`
		SELECT pair, date, rate, source
		FROM fx_rates
		WHERE pair = ?
			AND date <= ?
		ORDER BY date DESC
		LIMIT 1
	`, pair, onOrBeforeDate).Scan(&row.Pair, &row.Date, &row.Rate, &row.Source)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *Store) GetFxDateBounds(pair string) (DateBounds, error) {
	var earliestDate sql.NullString
	var latestDate sql.NullString
	if err := s.db.QueryRow(`
		SELECT MIN(date), MAX(date)
		FROM fx_rates
		WHERE pair = ?
	`, pair).Scan(&earliestDate, &latestDate); err != nil {
		return DateBounds{}, err
	}

	return dateBoundsFromNullable(earliestDate, latestDate), nil
}

func (s *Store) GetFxRange(pair string, startDate string, endDate string) ([]FxRateRow, error) {
	rows, err := s.db.Query(`
		SELECT pair, date, rate, source
		FROM fx_rates
		WHERE pair = ?
			AND date >= ?
			AND date <= ?
		ORDER BY date ASC
	`, pair, startDate, endDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []FxRateRow{}
	for rows.Next() {
		var row FxRateRow
		if err := rows.Scan(&row.Pair, &row.Date, &row.Rate, &row.Source); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func dateBoundsFromNullable(earliestDate sql.NullString, latestDate sql.NullString) DateBounds {
	bounds := DateBounds{}
	if earliestDate.Valid {
		bounds.EarliestDate = &earliestDate.String
	}
	if latestDate.Valid {
		bounds.LatestDate = &latestDate.String
	}
	return bounds
}

func (s *Store) readMaintenanceStatus() (map[string]any, error) {
	var running int
	var queuedTasks int
	var lastAction sql.NullString
	var updatedAt string

	if err := s.db.QueryRow(`
		SELECT running, queued_tasks, last_action, updated_at
		FROM maintenance_status
		WHERE id = 1
	`).Scan(&running, &queuedTasks, &lastAction, &updatedAt); err != nil {
		return nil, err
	}

	status := map[string]any{
		"running":     running != 0,
		"queuedTasks": queuedTasks,
		"updatedAt":   updatedAt,
	}
	if lastAction.Valid {
		status["lastAction"] = lastAction.String
	}

	return status, nil
}

func (s *Store) updateMaintenanceStatus(lastAction string) (map[string]any, error) {
	_, err := s.db.Exec(`
		UPDATE maintenance_status
		SET running = 0, queued_tasks = 0, last_action = ?, updated_at = ?
		WHERE id = 1
	`, lastAction, now())
	if err != nil {
		return nil, err
	}

	return s.readMaintenanceStatus()
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}
