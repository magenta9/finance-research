from __future__ import annotations

from datetime import date
from typing import Any

try:
    import akshare as ak  # type: ignore
except Exception:
    ak = None

try:
    import yfinance as yf  # type: ignore
except Exception:
    yf = None

from adapters.tushare.adapter import TuShareAdapter
from methods._research_providers.common import (
    NORTHBOUND_CAVEAT,
    data_age_days,
    fund_facts_result,
    is_a_market_fund_or_etf,
    parse_date,
    today_iso,
)


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if value != value:
            return None
    except Exception:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _first_present(row: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        if name in row and row[name] not in (None, ""):
            return row[name]
    return None


def _strip_market_suffix(symbol: str) -> str:
    return (
        symbol.strip()
        .upper()
        .replace(".SZ", "")
        .replace(".SH", "")
        .replace(".HK", "")
        .replace(".US", "")
    )


def _a_share_suffix(symbol: str, asset_metadata: dict[str, object] | None) -> str:
    metadata_code = str((asset_metadata or {}).get("tsCode") or "").strip().upper()
    if metadata_code.endswith((".SH", ".SZ", ".BJ")):
        return metadata_code
    normalized = _strip_market_suffix(symbol)
    if normalized.startswith(("5", "6", "9")):
        return f"{normalized}.SH"
    if normalized.startswith(("0", "1", "2", "3")):
        return f"{normalized}.SZ"
    return normalized


def _akshare_a_market(
    symbol: str, asset_metadata: dict[str, object] | None
) -> str | None:
    ts_code = _a_share_suffix(symbol, asset_metadata)
    if ts_code.endswith(".SH"):
        return "sh"
    if ts_code.endswith(".SZ"):
        return "sz"
    if ts_code.endswith(".BJ"):
        return "bj"
    return None


CSINDEX_METADATA_KEYS = (
    "csindexCode",
    "underlyingIndexCode",
    "trackingIndexCode",
    "indexCode",
)

CSINDEX_NAME_MAP = (
    ("沪深300", "000300"),
    ("中证500", "000905"),
    ("中证1000", "000852"),
    ("中证红利", "000922"),
)


def _resolve_csindex_code(asset_metadata: dict[str, object] | None) -> str | None:
    metadata = asset_metadata or {}
    for key in CSINDEX_METADATA_KEYS:
        value = metadata.get(key)
        if value is None:
            continue
        code = str(value).strip().upper()
        if code:
            return code

    name = " ".join(
        str(value)
        for value in (metadata.get("name"), metadata.get("assetName"))
        if value is not None
    )
    for keyword, code in CSINDEX_NAME_MAP:
        if keyword in name:
            return code
    return None


def _underlying_market(asset_metadata: dict[str, object] | None) -> str | None:
    value = (asset_metadata or {}).get("underlyingMarket")
    if value is None:
        return None
    text = str(value).strip().upper()
    return text or None


def _latest_record(frame: Any) -> dict[str, Any] | None:
    if frame is None or getattr(frame, "empty", True):
        return None
    records = frame.to_dict("records")
    if not records:
        return None

    def sort_key(row: dict[str, Any]) -> date:
        return (
            parse_date(
                _first_present(row, ("报告期", "日期", "end_date", "report_date"))
            )
            or date.min
        )

    return sorted(records, key=sort_key)[-1]


def _percent(value: Any) -> float | None:
    number = _safe_float(value)
    if number is None:
        return None
    return number / 100 if abs(number) > 1 else number


def _fundamental_metrics_from_row(row: dict[str, Any]) -> dict[str, Any]:
    report_date = _first_present(row, ("报告期", "日期", "end_date", "report_date"))
    fiscal_period = None if report_date is None else str(report_date)
    return {
        "period": {
            "fiscalPeriod": fiscal_period,
            "reportDate": None if report_date is None else str(report_date),
        },
        "profitability": {
            "roe": _percent(_first_present(row, ("净资产收益率(%)", "roe", "ROE"))),
            "grossMargin": _percent(
                _first_present(row, ("销售毛利率(%)", "gross_margin", "grossMargin"))
            ),
            "netMargin": _percent(
                _first_present(row, ("销售净利率(%)", "net_margin", "netMargin"))
            ),
        },
        "valuation": {
            "peTtm": _safe_float(
                _first_present(row, ("市盈率TTM", "pe_ttm", "peTtm", "PE_TTM"))
            ),
            "pb": _safe_float(_first_present(row, ("市净率", "pb", "PB"))),
            "psTtm": _safe_float(_first_present(row, ("市销率TTM", "ps_ttm", "psTtm"))),
            "dividendYield": _percent(
                _first_present(row, ("股息率", "dividend_yield", "dividendYield"))
            ),
        },
        "growth": {
            "revenueGrowthYoY": _percent(
                _first_present(
                    row,
                    (
                        "营业总收入同比增长率(%)",
                        "revenue_growth_yoy",
                        "revenueGrowthYoY",
                    ),
                )
            ),
            "netIncomeGrowthYoY": _percent(
                _first_present(
                    row,
                    (
                        "净利润同比增长率(%)",
                        "net_income_growth_yoy",
                        "netIncomeGrowthYoY",
                    ),
                )
            ),
        },
        "balanceSheet": {
            "debtToAssets": _percent(
                _first_present(row, ("资产负债率(%)", "debt_to_assets", "debtToAssets"))
            ),
            "currentRatio": _safe_float(
                _first_present(row, ("流动比率", "current_ratio", "currentRatio"))
            ),
        },
        "cashFlow": {
            "operatingCashFlow": _safe_float(
                _first_present(
                    row,
                    ("经营现金流量净额", "operating_cash_flow", "operatingCashFlow"),
                )
            ),
            "freeCashFlow": _safe_float(
                _first_present(row, ("free_cash_flow", "freeCashFlow"))
            ),
        },
    }


def _has_metric_value(metrics: dict[str, Any]) -> bool:
    for group_name, group_value in metrics.items():
        if group_name == "period" or not isinstance(group_value, dict):
            continue
        if any(value is not None for value in group_value.values()):
            return True
    return False


def _fundamental_result(
    provider_id: str, symbol: str, market: str, row: dict[str, Any]
) -> dict[str, Any]:
    metrics = _fundamental_metrics_from_row(row)
    report_date = metrics["period"]["reportDate"]
    age = data_age_days(report_date)
    warnings: list[str] = []
    if report_date is None or metrics["period"]["fiscalPeriod"] is None:
        warnings.append(
            "Fundamental reportDate/fiscalPeriod is missing; snapshot is degraded."
        )
    if age is not None and age > 180:
        warnings.append("Fundamental report data is older than 180 days.")

    quality_status = (
        "available" if _has_metric_value(metrics) and not warnings else "degraded"
    )
    if not _has_metric_value(metrics):
        quality_status = "unavailable"

    return {
        "asOf": today_iso(),
        "dataAgeDays": age,
        "market": market,
        "metrics": metrics,
        "qualityStatus": quality_status,
        "rowsUsed": 1,
        "symbol": symbol,
        "warnings": warnings,
    }


class AKShareResearchProvider:
    provider_id = "akshare"

    def fetch_fundamentals(
        self, symbol: str, market: str, asset_metadata: dict[str, object] | None = None
    ) -> dict[str, Any]:
        if ak is None:
            raise RuntimeError("akshare package is not available.")

        if market == "A":
            if is_a_market_fund_or_etf(symbol, asset_metadata):
                return fund_facts_result(
                    self.provider_id, symbol, market, asset_metadata
                )
            frame = ak.stock_financial_analysis_indicator_em(
                symbol=_a_share_suffix(symbol, asset_metadata), indicator="按报告期"
            )
        elif market == "HK":
            frame = ak.stock_financial_hk_analysis_indicator_em(
                symbol=_strip_market_suffix(symbol).zfill(5), indicator="报告期"
            )
        elif market == "US":
            frame = ak.stock_financial_us_analysis_indicator_em(
                symbol=_strip_market_suffix(symbol), indicator="年报"
            )
        else:
            return _unsupported_fundamentals(symbol, market)

        row = _latest_record(frame)
        if row is None:
            return _unsupported_fundamentals(symbol, market)
        return _fundamental_result(self.provider_id, symbol, market, row)

    def fetch_underlying_index_valuation(
        self, symbol: str, market: str, asset_metadata: dict[str, object] | None = None
    ) -> dict[str, Any]:
        del symbol, market
        if ak is None:
            raise RuntimeError("akshare package is not available.")

        index_code = _resolve_csindex_code(asset_metadata)
        if index_code is None:
            underlying_market = _underlying_market(asset_metadata)
            status = (
                "not_covered" if underlying_market in {"HK", "US"} else "not_configured"
            )
            return {
                "providerAttempted": False,
                "rowsUsed": 0,
                "underlyingValuation": {
                    "providerId": self.provider_id,
                    "status": status,
                },
                "warnings": [
                    "AkShare CSIndex valuation requires a CSIndex underlying index code; no code is configured for this ETF/fund."
                ],
            }

        frame = ak.stock_zh_index_value_csindex(symbol=index_code)
        row = _latest_record(frame)
        if row is None:
            return {
                "providerAttempted": True,
                "rowsUsed": 0,
                "underlyingValuation": {
                    "indexCode": index_code,
                    "providerId": self.provider_id,
                    "sourceId": f"index_valuation:akshare:csindex:{index_code}",
                    "status": "unavailable",
                },
                "warnings": [
                    f"AKShare CSIndex valuation returned no rows for {index_code}."
                ],
            }

        as_of = _first_present(row, ("日期", "date", "trade_date"))
        pe_ttm = _safe_float(_first_present(row, ("市盈率2", "市盈率1", "pe_ttm")))
        dividend_yield = _percent(
            _first_present(row, ("股息率2", "股息率1", "dividend_yield"))
        )
        valuation = {
            "asOf": None if as_of is None else str(as_of),
            "dividendYield": dividend_yield,
            "indexCode": index_code,
            "indexName": _first_present(
                row, ("指数中文简称", "指数中文全称", "index_name")
            ),
            "peTtm": pe_ttm,
            "providerId": self.provider_id,
            "sourceId": f"index_valuation:akshare:csindex:{index_code}",
            "status": "available"
            if pe_ttm is not None or dividend_yield is not None
            else "unavailable",
        }
        warnings = (
            []
            if valuation["status"] == "available"
            else [
                f"AKShare CSIndex valuation returned no PE/dividend fields for {index_code}."
            ]
        )
        return {
            "providerAttempted": True,
            "rowsUsed": 1,
            "underlyingValuation": valuation,
            "warnings": warnings,
        }

    def fetch_flow_sentiment(
        self,
        symbol: str | None,
        market: str,
        asset_metadata: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        if ak is None:
            raise RuntimeError("akshare package is not available.")
        if not symbol:
            return _unsupported_flow(
                symbol, market, ["Flow/sentiment snapshot requires a symbol."]
            )

        if market == "A":
            ak_market = _akshare_a_market(symbol, asset_metadata)
            if ak_market is None:
                return _unsupported_flow(
                    symbol,
                    market,
                    ["A-share flow requires SH/SZ/BJ market resolution."],
                )
            frame = ak.stock_individual_fund_flow(
                stock=_strip_market_suffix(symbol), market=ak_market
            )
            row = _latest_record(frame)
            if row is None:
                return _unsupported_flow(
                    symbol, market, ["AKShare returned no individual fund-flow rows."]
                )
            main_net = _safe_float(
                _first_present(
                    row, ("主力净流入-净额", "主力净流入净额", "main_net_inflow")
                )
            )
            large_net = _safe_float(
                _first_present(
                    row,
                    ("大单净流入-净额", "超大单净流入-净额", "large_order_net_inflow"),
                )
            )
            as_of = _first_present(row, ("日期", "trade_date", "report_date"))
            warnings = [
                "northboundNetInflow is best-effort after 2024 disclosure changes."
            ]
            return {
                "asOf": None if as_of is None else str(as_of),
                "market": market,
                "qualityStatus": "available" if main_net is not None else "degraded",
                "rowsUsed": 1,
                "signals": {
                    "flow": {
                        "largeOrderNetInflow": large_net,
                        "mainNetInflow": main_net,
                        "northboundAvailabilityCaveat": NORTHBOUND_CAVEAT,
                        "northboundNetInflow": None,
                        "sourceWindow": "recent",
                    }
                },
                "symbol": symbol,
                "warnings": warnings,
            }

        if market == "HK":
            return _unsupported_flow(
                symbol,
                market,
                [
                    "HK hot-rank adapter is planned; flow data is unavailable in this slice."
                ],
            )

        return _unsupported_flow(symbol, market)


class TuShareResearchProvider:
    provider_id = "tushare"

    def __init__(self) -> None:
        self.adapter = TuShareAdapter()

    def fetch_fundamentals(
        self, symbol: str, market: str, asset_metadata: dict[str, object] | None = None
    ) -> dict[str, Any]:
        if market != "A":
            return _unsupported_fundamentals(symbol, market)
        if is_a_market_fund_or_etf(symbol, asset_metadata):
            return _unsupported_fundamentals(
                symbol,
                market,
                ["Fund/ETF fundamentals are not covered by TuShare fina_indicator."],
            )
        client = self.adapter._get_client()
        ts_code = str(
            (asset_metadata or {}).get("tsCode")
            or _a_share_suffix(symbol, asset_metadata)
        )
        frame = client.fina_indicator(
            ts_code=ts_code,
            fields="ts_code,end_date,roe,grossprofit_margin,netprofit_margin,debt_to_assets,current_ratio,or_yoy,netprofit_yoy,update_flag",
        )
        row = _latest_tushare_fina_indicator_row(frame)
        if row is None:
            return _unsupported_fundamentals(symbol, market)
        mapped = {
            "report_date": row.get("end_date"),
            "roe": row.get("roe"),
            "gross_margin": row.get("grossprofit_margin"),
            "net_margin": row.get("netprofit_margin"),
            "debt_to_assets": row.get("debt_to_assets"),
            "current_ratio": row.get("current_ratio"),
            "revenue_growth_yoy": row.get("or_yoy"),
            "net_income_growth_yoy": row.get("netprofit_yoy"),
        }
        return _fundamental_result(self.provider_id, symbol, market, mapped)

    def fetch_flow_sentiment(
        self,
        symbol: str | None,
        market: str,
        asset_metadata: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        if market != "A" or not symbol:
            return _unsupported_flow(symbol, market)
        client = self.adapter._get_client()
        ts_code = str(
            (asset_metadata or {}).get("tsCode")
            or _a_share_suffix(symbol, asset_metadata)
        )
        frame = client.moneyflow(ts_code=ts_code)
        row = _latest_record(frame)
        if row is None:
            return _unsupported_flow(symbol, market)
        main_net = _safe_float(
            _first_present(row, ("net_mf_amount", "main_net_inflow"))
        )
        as_of = _first_present(row, ("trade_date", "日期"))
        return {
            "asOf": None if as_of is None else str(as_of),
            "market": market,
            "qualityStatus": "available" if main_net is not None else "degraded",
            "rowsUsed": 1,
            "signals": {
                "flow": {
                    "mainNetInflow": main_net,
                    "northboundAvailabilityCaveat": NORTHBOUND_CAVEAT,
                    "northboundNetInflow": None,
                    "sourceWindow": "recent",
                }
            },
            "symbol": symbol,
            "warnings": [
                "northboundNetInflow is best-effort after 2024 disclosure changes."
            ],
        }


class YFinanceResearchProvider:
    provider_id = "yfinance"

    def fetch_fundamentals(
        self, symbol: str, market: str, asset_metadata: dict[str, object] | None = None
    ) -> dict[str, Any]:
        del asset_metadata
        if market != "US":
            return _unsupported_fundamentals(symbol, market)
        if yf is None:
            raise RuntimeError("yfinance package is not available.")
        ticker = yf.Ticker(_strip_market_suffix(symbol))
        info = getattr(ticker, "info", None) or {}
        if not info:
            raise RuntimeError("yfinance returned empty fundamentals info.")
        row = {
            "report_date": info.get("mostRecentQuarter"),
            "pe_ttm": info.get("trailingPE"),
            "pb": info.get("priceToBook"),
            "roe": info.get("returnOnEquity"),
            "gross_margin": info.get("grossMargins"),
            "net_margin": info.get("profitMargins"),
            "dividend_yield": info.get("dividendYield"),
        }
        return _fundamental_result(self.provider_id, symbol, market, row)

    def fetch_flow_sentiment(
        self,
        symbol: str | None,
        market: str,
        asset_metadata: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        del asset_metadata
        if market != "US" or not symbol:
            return _unsupported_flow(symbol, market)
        if yf is None:
            raise RuntimeError("yfinance package is not available.")
        frame = yf.Ticker(_strip_market_suffix(symbol)).history(period="1mo")
        if frame is None or getattr(frame, "empty", True):
            raise RuntimeError("yfinance returned empty volume history.")
        volumes = [_safe_float(row.get("Volume")) for _, row in frame.iterrows()]
        volumes = [value for value in volumes if value is not None]
        latest_volume = volumes[-1] if volumes else None
        average_volume = (
            sum(volumes[:-1]) / len(volumes[:-1]) if len(volumes) > 1 else None
        )
        volume_ratio = (
            latest_volume / average_volume
            if latest_volume is not None and average_volume
            else None
        )
        return {
            "asOf": today_iso(),
            "market": market,
            "qualityStatus": "degraded",
            "rowsUsed": len(volumes),
            "signals": {
                "liquidity": {
                    "latestVolume": latest_volume,
                    "volumeRatio20d": volume_ratio,
                }
            },
            "symbol": symbol,
            "warnings": [
                "US flow/sentiment is a yfinance volume proxy, not provider flow data."
            ],
        }


def _unsupported_fundamentals(
    symbol: str, market: str, warnings: list[str] | None = None
) -> dict[str, Any]:
    return {
        "asOf": None,
        "dataAgeDays": None,
        "market": market,
        "metrics": {"period": {"fiscalPeriod": None, "reportDate": None}},
        "qualityStatus": "unavailable",
        "rowsUsed": 0,
        "symbol": symbol,
        "warnings": warnings
        or [f"Fundamentals are not covered for market {market} in this provider."],
    }


def _unsupported_flow(
    symbol: str | None, market: str, warnings: list[str] | None = None
) -> dict[str, Any]:
    return {
        "asOf": None,
        "market": market,
        "qualityStatus": "unavailable",
        "rowsUsed": 0,
        "signals": {},
        "symbol": symbol,
        "warnings": warnings
        or [f"Flow/sentiment is not covered for market {market} in this provider."],
    }


def _latest_tushare_fina_indicator_row(frame: Any) -> dict[str, Any] | None:
    if frame is None or getattr(frame, "empty", True):
        return None
    records = frame.to_dict("records")
    if not records:
        return None

    by_period: dict[tuple[str, str], dict[str, Any]] = {}
    for row in records:
        key = (str(row.get("ts_code") or ""), str(row.get("end_date") or ""))
        existing = by_period.get(key)
        if existing is None:
            by_period[key] = row
            continue
        if (
            str(row.get("update_flag") or "0") == "1"
            and str(existing.get("update_flag") or "0") != "1"
        ):
            by_period[key] = row

    return sorted(
        by_period.values(),
        key=lambda row: parse_date(row.get("end_date")) or date.min,
    )[-1]
