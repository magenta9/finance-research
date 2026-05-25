package provider

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	liveSource      = "quant-data-live"
	tushareSource   = "tushare"
	akshareSource   = "akshare"
	yfinanceSource  = "yfinance"
	frankfurterHTTP = "https://api.frankfurter.app"
	tushareHTTP     = "https://api.tushare.pro"
)

type LiveConfig struct {
	TushareToken string
}

type LiveProvider struct {
	backends map[string]marketBackend
	client   *http.Client
	policy   Policy
}

type marketBackend interface {
	ID() string
	SearchAssets(query string, market string) ([]Asset, []string)
	GetPriceSeries(symbol string, market string, start string, end string) (PriceSeriesResult, []string)
	GetFxRates(pair string, start string, end string) (FxRatesResult, []string)
}

func NewLiveProvider(config LiveConfig) LiveProvider {
	return NewLiveProviderWithPolicy(config, DefaultPolicy())
}

func NewLiveProviderWithPolicy(config LiveConfig, policy Policy) LiveProvider {
	client := &http.Client{Timeout: 12 * time.Second}
	return LiveProvider{
		backends: map[string]marketBackend{
			tushareSource:  TushareProvider{client: client, token: config.TushareToken},
			akshareSource:  EastmoneyProvider{client: client},
			yfinanceSource: YFinanceProvider{client: client},
		},
		client: client,
		policy: policy,
	}
}

func (LiveProvider) Source() string {
	return liveSource
}

func (LiveProvider) Mode() string {
	return "live"
}

func (provider LiveProvider) SearchAssets(query string, market string) []Asset {
	assetsByKey := map[string]Asset{}
	for _, providerID := range provider.policy.SearchOrder(market) {
		backend := provider.backends[providerID]
		if backend == nil {
			continue
		}
		assets, _ := backend.SearchAssets(query, market)
		for _, asset := range assets {
			key := strings.ToUpper(asset.Symbol + "|" + asset.Market)
			if _, exists := assetsByKey[key]; !exists {
				assetsByKey[key] = asset
			}
		}
	}

	assets := make([]Asset, 0, len(assetsByKey))
	for _, asset := range assetsByKey {
		assets = append(assets, asset)
	}
	sort.SliceStable(assets, func(i, j int) bool {
		if assets[i].Market == assets[j].Market {
			return assets[i].Symbol < assets[j].Symbol
		}
		return assets[i].Market < assets[j].Market
	})
	return assets
}

func (provider LiveProvider) GetPriceSeries(symbol string, market string, start string, end string) PriceSeriesResult {
	return aggregatePriceSeries(symbol, market, provider.policy.PriceOrder(symbol, market), provider.backends, provider.policy, start, end)
}

func (provider LiveProvider) GetFxRates(pair string, start string, end string) FxRatesResult {
	ratesByDate := map[string]FxRateRow{}
	providerByDate := map[string]string{}
	attempted := []string{}
	warnings := []string{}

	for _, providerID := range provider.policy.FxProviderOrder {
		var result FxRatesResult
		var providerWarnings []string
		switch providerID {
		case yfinanceSource:
			result, providerWarnings = provider.backends[yfinanceSource].GetFxRates(pair, start, end)
		case "frankfurter":
			result, providerWarnings = provider.getFrankfurterRates(pair, start, end)
		default:
			backend := provider.backends[providerID]
			if backend == nil {
				continue
			}
			result, providerWarnings = backend.GetFxRates(pair, start, end)
		}
		attempted = append(attempted, providerID)
		warnings = append(warnings, providerWarnings...)
		warnings = append(warnings, result.Warnings...)
		for _, row := range result.Rates {
			existing, exists := ratesByDate[row.Date]
			if !exists || provider.policy.fxWeight(providerID, row.Source) >= provider.policy.fxWeight(providerByDate[row.Date], existing.Source) {
				ratesByDate[row.Date] = row
				providerByDate[row.Date] = providerID
			}
		}
		if len(result.Rates) > 0 {
			break
		}
	}

	rates := make([]FxRateRow, 0, len(ratesByDate))
	for _, row := range ratesByDate {
		rates = append(rates, row)
	}
	sort.SliceStable(rates, func(i, j int) bool { return rates[i].Date < rates[j].Date })

	return FxRatesResult{AttemptedSources: attempted, Pair: pair, Rates: rates, Warnings: dedupeStrings(warnings)}
}

type TushareProvider struct {
	client *http.Client
	token  string
}

func (TushareProvider) ID() string { return tushareSource }

func (provider TushareProvider) SearchAssets(query string, market string) ([]Asset, []string) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []Asset{}, []string{}
	}
	assets := []Asset{}
	inferredAssets := []Asset{}
	warnings := []string{}
	if asset, ok := inferTushareGlobalIndex(query); ok && marketMatches(asset.Market, market) {
		inferredAssets = append(inferredAssets, asset)
	}
	if asset, ok := inferTushareOpenFund(query, market); ok && marketMatches(asset.Market, market) {
		inferredAssets = append(inferredAssets, asset)
	}
	if asset, ok := inferTushareAsset(query); ok && marketMatches(asset.Market, market) {
		inferredAssets = append(inferredAssets, asset)
	}
	if len(inferredAssets) > 0 && normalizeMarket(market) != "A" && normalizeMarket(market) != "DEFAULT" {
		return dedupeAssets(inferredAssets), warnings
	}

	fundRows, err := provider.call("fund_basic", map[string]any{"market": "E", "status": "L"}, "ts_code,name,market,exchange,type,list_date")
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("tushare fund_basic failed: %v", err))
	} else {
		assets = append(assets, filterTushareAssets(fundRows, query, market, "fund")...)
	}

	stockRows, err := provider.call("stock_basic", map[string]any{"list_status": "L"}, "ts_code,name,market,exchange,list_date")
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("tushare stock_basic failed: %v", err))
	} else {
		assets = append(assets, filterTushareAssets(stockRows, query, market, "equity")...)
	}

	indexRows, err := provider.call("index_basic", map[string]any{"market": "CSI"}, "ts_code,name,market,publisher,category")
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("tushare index_basic failed: %v", err))
	} else {
		assets = append(assets, filterTushareAssets(indexRows, query, market, "index")...)
	}

	assets = append(assets, inferredAssets...)

	return dedupeAssets(assets), warnings
}

func (provider TushareProvider) GetPriceSeries(symbol string, market string, start string, end string) (PriceSeriesResult, []string) {
	if normalizeMarket(market) == "COMMODITY" || isFuturesMainSymbol(symbol) {
		return provider.getFuturesMainContinuous(symbol, start, end)
	}
	if globalIndexCode := normalizeTushareGlobalIndexCode(symbol); globalIndexCode != "" {
		return provider.getGlobalIndexPrices(globalIndexCode, start, end)
	}
	if normalizeMarket(market) == "HK" {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: symbol}, []string{}
	}
	if openFundCode := normalizeOpenFundCode(symbol, market); openFundCode != "" {
		return provider.getOpenFundNav(openFundCode, start, end)
	}

	tsCode := normalizeTushareCode(symbol)
	if tsCode == "" {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: symbol}, []string{"tushare requires a SH/SZ ts_code or six digit A-market symbol"}
	}
	apiName := "daily"
	params := map[string]any{"ts_code": tsCode, "start_date": compactDate(start), "end_date": compactDate(end)}
	if inferTushareAssetType(tsCode) == "FD" {
		apiName = "fund_daily"
	} else if inferTushareAssetType(tsCode) == "I" {
		apiName = "index_daily"
	}
	rows, err := provider.call(apiName, params, "ts_code,trade_date,open,high,low,close,vol")
	if err != nil {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: symbol}, []string{fmt.Sprintf("tushare %s failed: %v", apiName, err)}
	}
	if len(rows) == 0 && apiName == "daily" {
		if fundCode := normalizeSixDigit(tsCode); fundCode != "" {
			fundResult, fundWarnings := provider.getOpenFundNav(fundCode+".OF", start, end)
			if len(fundResult.Prices) > 0 || len(fundWarnings) > 0 {
				return fundResult, fundWarnings
			}
		}
	}

	prices := make([]PriceRow, 0, len(rows))
	for _, row := range rows {
		closeValue := row.float("close")
		prices = append(prices, PriceRow{
			AdjustedClose: closeValue,
			Close:         closeValue,
			Date:          dashedDate(row.string("trade_date")),
			High:          row.float("high"),
			Low:           row.float("low"),
			Open:          row.float("open"),
			Source:        tushareSource,
			Volume:        row.float("vol"),
		})
	}
	sort.SliceStable(prices, func(i, j int) bool { return prices[i].Date < prices[j].Date })
	return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Prices: prices, Symbol: tsCode, Warnings: []string{}}, []string{}
}

func (provider TushareProvider) getOpenFundNav(tsCode string, start string, end string) (PriceSeriesResult, []string) {
	params := map[string]any{"ts_code": tsCode, "start_date": compactDate(start), "end_date": compactDate(end)}
	rows, err := provider.call("fund_nav", params, "ts_code,nav_date,unit_nav,accum_nav,adj_nav")
	if err != nil {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: tsCode}, []string{fmt.Sprintf("tushare fund_nav failed: %v", err)}
	}

	prices := make([]PriceRow, 0, len(rows))
	for _, row := range rows {
		unitNav := row.float("unit_nav")
		adjustedNav := row.float("adj_nav")
		if adjustedNav == nil {
			adjustedNav = unitNav
		}
		prices = append(prices, PriceRow{
			AdjustedClose:    adjustedNav,
			CalculationClose: adjustedNav,
			Close:            unitNav,
			Date:             dashedDate(row.string("nav_date")),
			Source:           tushareSource + "-fund-nav",
		})
	}
	sort.SliceStable(prices, func(i, j int) bool { return prices[i].Date < prices[j].Date })
	return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Prices: prices, Symbol: tsCode, Warnings: []string{}}, []string{}
}

func (provider TushareProvider) getGlobalIndexPrices(tsCode string, start string, end string) (PriceSeriesResult, []string) {
	params := map[string]any{"ts_code": tsCode, "start_date": compactDate(start), "end_date": compactDate(end)}
	rows, err := provider.call("index_global", params, "ts_code,trade_date,open,high,low,close,vol")
	if err != nil {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: tsCode}, []string{fmt.Sprintf("tushare index_global failed: %v", err)}
	}

	prices := make([]PriceRow, 0, len(rows))
	for _, row := range rows {
		closeValue := row.float("close")
		prices = append(prices, PriceRow{
			AdjustedClose: closeValue,
			Close:         closeValue,
			Date:          dashedDate(row.string("trade_date")),
			High:          row.float("high"),
			Low:           row.float("low"),
			Open:          row.float("open"),
			Source:        tushareSource + "-index-global",
			Volume:        row.float("vol"),
		})
	}
	sort.SliceStable(prices, func(i, j int) bool { return prices[i].Date < prices[j].Date })
	return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Prices: prices, Symbol: tsCode, Warnings: []string{}}, []string{}
}

func (provider TushareProvider) getFuturesMainContinuous(symbol string, start string, end string) (PriceSeriesResult, []string) {
	mappingCode := normalizeFuturesMappingCode(symbol)
	if mappingCode == "" {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: symbol}, []string{"tushare futures provider requires a supported main-continuous symbol such as RB9999 or RB.SHF"}
	}

	params := map[string]any{"ts_code": mappingCode, "start_date": compactDate(start), "end_date": compactDate(end)}
	mappingRows, err := provider.call("fut_mapping", params, "ts_code,mapping_ts_code,trade_date")
	if err != nil {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: symbol}, []string{fmt.Sprintf("tushare fut_mapping failed: %v", err)}
	}

	mappingByDate := map[string]string{}
	contractSet := map[string]struct{}{}
	for _, row := range mappingRows {
		date := dashedDate(row.string("trade_date"))
		contract := row.string("mapping_ts_code")
		if date == "" || contract == "" {
			continue
		}
		mappingByDate[date] = contract
		contractSet[contract] = struct{}{}
	}
	if len(contractSet) == 0 {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: mappingCode}, []string{fmt.Sprintf("tushare fut_mapping returned no rows for %s", mappingCode)}
	}

	pricesByDate := map[string]PriceRow{}
	for contract := range contractSet {
		rows, err := provider.call("fut_daily", map[string]any{"ts_code": contract, "start_date": compactDate(start), "end_date": compactDate(end)}, "ts_code,trade_date,open,high,low,close,vol")
		if err != nil {
			return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: mappingCode}, []string{fmt.Sprintf("tushare fut_daily failed: %v", err)}
		}
		for _, row := range rows {
			date := dashedDate(row.string("trade_date"))
			if mappingByDate[date] != row.string("ts_code") {
				continue
			}
			closeValue := row.float("close")
			pricesByDate[date] = PriceRow{
				AdjustedClose:    closeValue,
				CalculationClose: closeValue,
				Close:            closeValue,
				Date:             date,
				High:             row.float("high"),
				Low:              row.float("low"),
				Open:             row.float("open"),
				Source:           tushareSource + "-futures-main-raw",
				Volume:           row.float("vol"),
			}
		}
	}

	prices := make([]PriceRow, 0, len(pricesByDate))
	for _, row := range pricesByDate {
		prices = append(prices, row)
	}
	sort.SliceStable(prices, func(i, j int) bool { return prices[i].Date < prices[j].Date })
	if len(prices) == 0 {
		return PriceSeriesResult{AttemptedSources: []string{tushareSource}, Symbol: mappingCode}, []string{fmt.Sprintf("tushare fut_daily returned no mapped rows for %s", mappingCode)}
	}

	return PriceSeriesResult{
		AttemptedSources: []string{tushareSource},
		Prices:           prices,
		Symbol:           mappingCode,
		Warnings:         []string{"raw continuous and not back-adjusted futures main series from tushare fut_mapping/fut_daily"},
	}, []string{}
}

func (TushareProvider) GetFxRates(pair string, start string, end string) (FxRatesResult, []string) {
	return FxRatesResult{AttemptedSources: []string{tushareSource}, Pair: pair, Rates: []FxRateRow{}, Warnings: []string{}}, []string{"tushare FX provider is not implemented"}
}

func (provider TushareProvider) call(apiName string, params map[string]any, fields string) ([]tushareRow, error) {
	if provider.token == "" {
		return nil, fmt.Errorf("TUSHARE_TOKEN is missing")
	}
	payload := map[string]any{"api_name": apiName, "token": provider.token, "params": params, "fields": fields}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, tushareHTTP, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := provider.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	var parsed struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			Fields []string `json:"fields"`
			Items  [][]any  `json:"items"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	if parsed.Code != 0 {
		return nil, fmt.Errorf("code %d: %s", parsed.Code, parsed.Msg)
	}
	rows := make([]tushareRow, 0, len(parsed.Data.Items))
	for _, item := range parsed.Data.Items {
		row := tushareRow{}
		for index, field := range parsed.Data.Fields {
			if index < len(item) {
				row[field] = item[index]
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

type tushareRow map[string]any

func (row tushareRow) string(key string) string {
	value := row[key]
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func (row tushareRow) float(key string) *float64 {
	value := row[key]
	if value == nil {
		return nil
	}
	switch typed := value.(type) {
	case float64:
		return &typed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err == nil {
			return &parsed
		}
	}
	return nil
}

type EastmoneyProvider struct{ client *http.Client }

func (EastmoneyProvider) ID() string { return akshareSource }

func (EastmoneyProvider) SearchAssets(query string, market string) ([]Asset, []string) {
	if asset, ok := inferTushareAsset(query); ok && marketMatches(asset.Market, market) {
		asset.Source = akshareSource
		asset.Metadata["provider"] = akshareSource
		return []Asset{asset}, []string{}
	}
	return []Asset{}, []string{"akshare search currently supports exact A-market symbols only"}
}

func (provider EastmoneyProvider) GetPriceSeries(symbol string, market string, start string, end string) (PriceSeriesResult, []string) {
	code := normalizeSixDigit(symbol)
	if code == "" {
		return PriceSeriesResult{AttemptedSources: []string{akshareSource}, Symbol: symbol}, []string{"akshare price requires a six digit A-market symbol"}
	}
	secid := eastmoneySecID(code, symbol)
	endpoint := "https://push2his.eastmoney.com/api/qt/stock/kline/get"
	query := url.Values{}
	query.Set("fields1", "f1,f2,f3,f4,f5,f6")
	query.Set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61")
	query.Set("klt", "101")
	query.Set("fqt", "1")
	query.Set("beg", compactDate(start))
	query.Set("end", compactDate(end))
	query.Set("secid", secid)
	requestURL := endpoint + "?" + query.Encode()
	response, err := provider.client.Get(requestURL)
	if err != nil {
		return PriceSeriesResult{AttemptedSources: []string{akshareSource}, Symbol: symbol}, []string{fmt.Sprintf("akshare/eastmoney price failed: %v", err)}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return PriceSeriesResult{AttemptedSources: []string{akshareSource}, Symbol: symbol}, []string{fmt.Sprintf("akshare/eastmoney price HTTP %d", response.StatusCode)}
	}
	var parsed struct {
		Data struct {
			Klines []string `json:"klines"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8*1024*1024)).Decode(&parsed); err != nil {
		return PriceSeriesResult{AttemptedSources: []string{akshareSource}, Symbol: symbol}, []string{fmt.Sprintf("akshare/eastmoney price parse failed: %v", err)}
	}
	prices := make([]PriceRow, 0, len(parsed.Data.Klines))
	for _, line := range parsed.Data.Klines {
		parts := strings.Split(line, ",")
		if len(parts) < 7 {
			continue
		}
		openValue := parseFloatPtr(parts[1])
		closeValue := parseFloatPtr(parts[2])
		prices = append(prices, PriceRow{AdjustedClose: closeValue, Close: closeValue, Date: parts[0], High: parseFloatPtr(parts[3]), Low: parseFloatPtr(parts[4]), Open: openValue, Source: akshareSource, Volume: parseFloatPtr(parts[5])})
	}
	return PriceSeriesResult{AttemptedSources: []string{akshareSource}, Prices: prices, Symbol: code, Warnings: []string{}}, []string{}
}

func (EastmoneyProvider) GetFxRates(pair string, start string, end string) (FxRatesResult, []string) {
	return FxRatesResult{AttemptedSources: []string{akshareSource}, Pair: pair, Rates: []FxRateRow{}, Warnings: []string{}}, []string{"akshare FX provider is not implemented"}
}

type YFinanceProvider struct{ client *http.Client }

func (YFinanceProvider) ID() string { return yfinanceSource }

func (provider YFinanceProvider) SearchAssets(query string, market string) ([]Asset, []string) {
	requestURL := "https://query2.finance.yahoo.com/v1/finance/search?q=" + url.QueryEscape(query) + "&quotesCount=10&newsCount=0"
	response, err := provider.client.Get(requestURL)
	if err != nil {
		return []Asset{}, []string{fmt.Sprintf("yfinance search failed: %v", err)}
	}
	defer response.Body.Close()
	var parsed struct {
		Quotes []struct {
			Symbol    string `json:"symbol"`
			ShortName string `json:"shortname"`
			LongName  string `json:"longname"`
			Exchange  string `json:"exchange"`
			QuoteType string `json:"quoteType"`
		} `json:"quotes"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2*1024*1024)).Decode(&parsed); err != nil {
		return []Asset{}, []string{fmt.Sprintf("yfinance search parse failed: %v", err)}
	}
	assets := []Asset{}
	for _, quote := range parsed.Quotes {
		assetMarket := marketFromYahooSymbol(quote.Symbol)
		if !marketMatches(assetMarket, market) {
			continue
		}
		name := quote.LongName
		if name == "" {
			name = quote.ShortName
		}
		assets = append(assets, Asset{Symbol: quote.Symbol, Name: name, Market: assetMarket, AssetClass: strings.ToLower(quote.QuoteType), Currency: currencyForMarket(assetMarket), Exchange: quote.Exchange, Source: yfinanceSource, Metadata: map[string]any{"provider": yfinanceSource}})
	}
	return assets, []string{}
}

func (provider YFinanceProvider) GetPriceSeries(symbol string, market string, start string, end string) (PriceSeriesResult, []string) {
	yahooSymbol := normalizeYahooSymbol(symbol, market)
	period1 := unixDate(start, -430)
	period2 := unixDate(end, 1)
	requestURL := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&events=history&includeAdjustedClose=true", url.PathEscape(yahooSymbol), period1, period2)
	response, err := provider.client.Get(requestURL)
	if err != nil {
		return PriceSeriesResult{AttemptedSources: []string{yfinanceSource}, Symbol: symbol}, []string{fmt.Sprintf("yfinance price failed: %v", err)}
	}
	defer response.Body.Close()
	var parsed yahooChartResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 8*1024*1024)).Decode(&parsed); err != nil {
		return PriceSeriesResult{AttemptedSources: []string{yfinanceSource}, Symbol: symbol}, []string{fmt.Sprintf("yfinance price parse failed: %v", err)}
	}
	prices := yahooPrices(parsed, yfinanceSource)
	return PriceSeriesResult{AttemptedSources: []string{yfinanceSource}, Prices: prices, Symbol: yahooSymbol, Warnings: []string{}}, []string{}
}

func (provider YFinanceProvider) GetFxRates(pair string, start string, end string) (FxRatesResult, []string) {
	base, quote := splitPair(pair)
	if base == "" || quote == "" {
		return FxRatesResult{AttemptedSources: []string{yfinanceSource}, Pair: pair}, []string{"FX pair must be BASE/QUOTE"}
	}
	result, warnings := provider.GetPriceSeries(base+quote+"=X", "FX", start, end)
	rates := make([]FxRateRow, 0, len(result.Prices))
	for _, row := range result.Prices {
		if row.Close != nil {
			rates = append(rates, FxRateRow{Date: row.Date, Rate: *row.Close, Source: yfinanceSource})
		}
	}
	return FxRatesResult{AttemptedSources: []string{yfinanceSource}, Pair: pair, Rates: rates, Warnings: result.Warnings}, warnings
}

type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []*float64 `json:"open"`
					High   []*float64 `json:"high"`
					Low    []*float64 `json:"low"`
					Close  []*float64 `json:"close"`
					Volume []*float64 `json:"volume"`
				} `json:"quote"`
				AdjClose []struct {
					AdjClose []*float64 `json:"adjclose"`
				} `json:"adjclose"`
			} `json:"indicators"`
		} `json:"result"`
	} `json:"chart"`
}

func yahooPrices(parsed yahooChartResponse, source string) []PriceRow {
	if len(parsed.Chart.Result) == 0 || len(parsed.Chart.Result[0].Indicators.Quote) == 0 {
		return []PriceRow{}
	}
	result := parsed.Chart.Result[0]
	quote := result.Indicators.Quote[0]
	var adj []*float64
	if len(result.Indicators.AdjClose) > 0 {
		adj = result.Indicators.AdjClose[0].AdjClose
	}
	prices := make([]PriceRow, 0, len(result.Timestamp))
	for index, timestamp := range result.Timestamp {
		row := PriceRow{Date: time.Unix(timestamp, 0).UTC().Format("2006-01-02"), Source: source}
		row.Open = ptrAt(quote.Open, index)
		row.High = ptrAt(quote.High, index)
		row.Low = ptrAt(quote.Low, index)
		row.Close = ptrAt(quote.Close, index)
		row.Volume = ptrAt(quote.Volume, index)
		row.AdjustedClose = ptrAt(adj, index)
		if row.AdjustedClose == nil {
			row.AdjustedClose = row.Close
		}
		prices = append(prices, row)
	}
	return prices
}

func (provider LiveProvider) getFrankfurterRates(pair string, start string, end string) (FxRatesResult, []string) {
	base, quote := splitPair(pair)
	if base == "" || quote == "" {
		return FxRatesResult{AttemptedSources: []string{"frankfurter"}, Pair: pair}, []string{"FX pair must be BASE/QUOTE"}
	}
	start = dashedOrDefault(start, -430)
	end = dashedOrDefault(end, 0)
	requestURL := fmt.Sprintf("%s/%s..%s?from=%s&to=%s", frankfurterHTTP, start, end, url.QueryEscape(base), url.QueryEscape(quote))
	response, err := provider.client.Get(requestURL)
	if err != nil {
		return FxRatesResult{AttemptedSources: []string{"frankfurter"}, Pair: pair}, []string{fmt.Sprintf("frankfurter FX failed: %v", err)}
	}
	defer response.Body.Close()
	var parsed struct {
		Rates map[string]map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4*1024*1024)).Decode(&parsed); err != nil {
		return FxRatesResult{AttemptedSources: []string{"frankfurter"}, Pair: pair}, []string{fmt.Sprintf("frankfurter FX parse failed: %v", err)}
	}
	rates := make([]FxRateRow, 0, len(parsed.Rates))
	for date, values := range parsed.Rates {
		if rate, ok := values[quote]; ok {
			rates = append(rates, FxRateRow{Date: date, Rate: rate, Source: "frankfurter"})
		}
	}
	return FxRatesResult{AttemptedSources: []string{"frankfurter"}, Pair: pair, Rates: rates, Warnings: []string{}}, []string{}
}

func dedupeAssets(assets []Asset) []Asset {
	seen := map[string]Asset{}
	for _, asset := range assets {
		key := strings.ToUpper(asset.Symbol + "|" + asset.Market)
		if _, exists := seen[key]; !exists {
			seen[key] = asset
		}
	}
	result := make([]Asset, 0, len(seen))
	for _, asset := range seen {
		result = append(result, asset)
	}
	return result
}

func compactDate(date string) string {
	if strings.TrimSpace(date) == "" {
		return time.Now().UTC().Format("20060102")
	}
	return strings.ReplaceAll(date, "-", "")
}

func dashedDate(date string) string {
	date = strings.TrimSpace(date)
	if len(date) == 8 {
		return date[0:4] + "-" + date[4:6] + "-" + date[6:8]
	}
	return date
}

func dashedOrDefault(date string, offsetDays int) string {
	if strings.TrimSpace(date) != "" {
		return dashedDate(strings.ReplaceAll(date, "-", ""))
	}
	return time.Now().UTC().AddDate(0, 0, offsetDays).Format("2006-01-02")
}

func unixDate(date string, defaultOffsetDays int) int64 {
	date = dashedOrDefault(date, defaultOffsetDays)
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		parsed = time.Now().UTC().AddDate(0, 0, defaultOffsetDays)
	}
	return parsed.Unix()
}

func shiftDateLocal(date string, days int) string {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		parsed = time.Now().UTC()
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02")
}

func splitPair(pair string) (string, string) {
	parts := strings.Split(strings.ToUpper(strings.TrimSpace(pair)), "/")
	if len(parts) != 2 {
		return "", ""
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
}

func ptrAt(values []*float64, index int) *float64 {
	if index >= len(values) {
		return nil
	}
	return values[index]
}

func parseFloatPtr(value string) *float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return nil
	}
	return &parsed
}

func dedupeStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func hashLocal(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
