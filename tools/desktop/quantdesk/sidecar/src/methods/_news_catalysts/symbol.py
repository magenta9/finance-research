from __future__ import annotations

import re
from typing import Any

MARKETS = {"A", "HK", "US"}


def _normalize_market(value: Any) -> str | None:
    return value if isinstance(value, str) and value in MARKETS else None


def _strip_market_suffix(symbol: str) -> str:
    return re.sub(r"\.(SZ|SH|HK|US)$", "", symbol)


def resolve_symbol_market(
    symbol: str,
    market: str | None = None,
    asset_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_symbol = symbol.strip().upper()
    explicit_market = _normalize_market(market)
    metadata_market = _normalize_market((asset_metadata or {}).get("market"))
    resolved_context_market = explicit_market or metadata_market

    if resolved_context_market:
        return {
            "market": resolved_context_market,
            "reasonCode": None,
            "symbol": _strip_market_suffix(normalized_symbol),
            "warnings": [],
        }

    if re.search(r"\.(SZ|SH)$", normalized_symbol):
        return {
            "market": "A",
            "reasonCode": None,
            "symbol": _strip_market_suffix(normalized_symbol),
            "warnings": [],
        }

    if re.search(r"\.HK$", normalized_symbol) or re.fullmatch(
        r"\d{5}", normalized_symbol
    ):
        return {
            "market": "HK",
            "reasonCode": None,
            "symbol": _strip_market_suffix(normalized_symbol),
            "warnings": [],
        }

    if re.search(r"\.US$", normalized_symbol) or re.fullmatch(
        r"[A-Z.]+", normalized_symbol
    ):
        return {
            "market": "US",
            "reasonCode": None,
            "symbol": _strip_market_suffix(normalized_symbol),
            "warnings": [],
        }

    return {
        "market": None,
        "reasonCode": "market_unresolved",
        "symbol": _strip_market_suffix(normalized_symbol),
        "warnings": [
            f"Unable to resolve announcement market for {symbol}; pass explicit market or asset metadata."
        ],
    }
