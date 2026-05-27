from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .ts_codes import _classify_asset, _symbol_from_ts_code
from .utils import _normalize_query


@dataclass(frozen=True)
class TuShareCandidate:
    symbol: str
    name: str
    market: str
    asset_class: str
    currency: str
    exchange: str | None
    ts_code: str
    price_asset: str
    source_rank: int = 0
    contract_type: str | None = None
    underlying_symbol: str | None = None
    source_symbol: str | None = None


def _candidate_from_row(
    row: dict[str, Any], source_rank: int, price_asset: str
) -> TuShareCandidate | None:
    ts_code = str(row.get("ts_code") or row.get("TS_CODE") or "").strip().upper()
    name = str(row.get("name") or row.get("NAME") or row.get("fullname") or "").strip()
    list_status = (
        str(row.get("list_status") or row.get("LIST_STATUS") or "").strip().upper()
    )
    if not ts_code or not name:
        return None
    if "退市" in name or (list_status and list_status != "L"):
        return None

    symbol, market, exchange, currency = _symbol_from_ts_code(ts_code)
    return TuShareCandidate(
        symbol=symbol,
        name=name,
        market=market,
        asset_class=_classify_asset(name, ts_code),
        currency=currency,
        exchange=exchange,
        ts_code=ts_code,
        price_asset=price_asset,
        source_rank=source_rank,
    )


def _futures_exchange_suffix(exchange: str) -> str:
    return {
        "SHFE": "SHF",
        "DCE": "DCE",
        "CZCE": "ZCE",
        "INE": "INE",
        "GFEX": "GFE",
    }.get(exchange.upper(), exchange.upper())


def _futures_underlying_symbol(raw_symbol: str) -> str:
    normalized = raw_symbol.partition(".")[0].strip().upper()
    if normalized.endswith("9999"):
        return normalized[:-4]
    if normalized.endswith("_MC"):
        return normalized[:-3]
    for index, char in enumerate(normalized):
        if char.isdigit():
            return normalized[:index]
    return normalized


def _futures_candidate_from_row(
    row: dict[str, Any], source_rank: int
) -> TuShareCandidate | None:
    raw_symbol = (
        str(
            row.get("fut_code")
            or row.get("FUT_CODE")
            or row.get("symbol")
            or row.get("SYMBOL")
            or row.get("ts_code")
            or row.get("TS_CODE")
            or ""
        )
        .strip()
        .upper()
    )
    name = str(row.get("name") or row.get("NAME") or "").strip()
    exchange = str(row.get("exchange") or row.get("EXCHANGE") or "").strip().upper()
    if not raw_symbol or not name or not exchange:
        return None

    underlying_symbol = _futures_underlying_symbol(raw_symbol)
    if not underlying_symbol:
        return None
    ts_code = f"{underlying_symbol}.{_futures_exchange_suffix(exchange)}"

    return TuShareCandidate(
        symbol=f"{underlying_symbol}9999",
        name=f"{name}主连",
        market="COMMODITY",
        asset_class="commodity",
        currency="CNY",
        exchange=exchange,
        ts_code=ts_code,
        price_asset="FT",
        source_rank=source_rank,
        contract_type="dominant_continuous",
        underlying_symbol=underlying_symbol,
        source_symbol=ts_code,
    )


def _score_candidate(query: str, candidate: TuShareCandidate) -> int:
    name = _normalize_query(candidate.name)
    symbol = _normalize_query(candidate.symbol)
    ts_code = _normalize_query(candidate.ts_code)
    underlying_symbol = _normalize_query(candidate.underlying_symbol or "")

    if query == symbol or query == ts_code:
        return 1000
    if query == name:
        return 950
    if candidate.price_asset == "FT" and query == underlying_symbol:
        return 930
    if name.startswith(query):
        return 860
    if query in name:
        return 760
    if query in symbol or query in ts_code:
        return 700
    return -1


def _asset_rank(candidate: TuShareCandidate) -> int:
    if candidate.price_asset == "I":
        return 0
    if candidate.price_asset == "FD":
        return 1
    if candidate.price_asset == "FT":
        return 2
    return 3


def _build_asset_result(candidate: TuShareCandidate) -> dict[str, object]:
    metadata: dict[str, object] = {
        "tsCode": candidate.ts_code,
        "tsCodeAsset": candidate.price_asset,
    }
    if candidate.exchange is not None:
        metadata["exchange"] = candidate.exchange
    if candidate.price_asset == "FT":
        metadata.update(
            {
                "contractType": candidate.contract_type or "dominant_continuous",
                "instrumentType": "futures",
                "priceSeriesSource": "tushare-futures",
                "seriesAdjustment": "raw_main_continuous",
            }
        )
        if candidate.underlying_symbol is not None:
            metadata["underlyingSymbol"] = candidate.underlying_symbol
        if candidate.source_symbol is not None:
            metadata["sourceSymbol"] = candidate.source_symbol

    return {
        "symbol": candidate.symbol,
        "name": candidate.name,
        "market": candidate.market,
        "assetClass": candidate.asset_class,
        "currency": candidate.currency,
        "exchange": candidate.exchange,
        "source": "tushare",
        "metadata": metadata,
    }
