from __future__ import annotations

import sys
from typing import Any

from eval_core.io import call_quant_data, validate_eval_runtime


def fetch_price_series(
    *,
    asset: dict[str, Any],
    end_date: str,
    quant_data_bin: str,
    start_date: str,
    bond_market_fallback: bool,
) -> tuple[dict[str, Any] | None, str | None]:
    symbol = str(asset["symbol"])
    original_market = str(asset.get("market") or "")
    markets = [original_market]
    if bond_market_fallback and original_market == "BOND":
        markets.extend(["A", "FUND"])

    for market in markets:
        envelope = call_quant_data(
            quant_data_bin,
            "get-price-series",
            {
                "assetId": asset.get("id"),
                "symbol": symbol,
                "market": market,
                "start": start_date,
                "end": end_date,
            },
        )
        data = envelope.get("data") or {}
        prices = data.get("prices") or []
        if envelope.get("ok") and len(prices) >= 61:
            return envelope, market

    return None, None


def load_quant_data_price_cache(
    *,
    assets: list[dict[str, Any]],
    end_date: str,
    quant_data_bin: str,
    start_date: str,
    min_bars: int = 61,
    bond_market_fallback: bool = False,
    ts_runner_path: Any = None,
    quantdesk_dir: Any = None,
) -> dict[str, Any]:
    if ts_runner_path is not None and quantdesk_dir is not None:
        validate_eval_runtime(quant_data_bin, ts_runner_path, quantdesk_dir)
    prices_by_symbol: dict[str, Any] = {}
    for index, asset in enumerate(assets, start=1):
        symbol = str(asset["symbol"])
        sys.stderr.write(f"fetching price series {index}/{len(assets)} {symbol}\n")
        if bond_market_fallback:
            envelope, request_market = fetch_price_series(
                asset=asset,
                end_date=end_date,
                quant_data_bin=quant_data_bin,
                start_date=start_date,
                bond_market_fallback=True,
            )
        else:
            envelope = call_quant_data(
                quant_data_bin,
                "get-price-series",
                {
                    "symbol": symbol,
                    "market": asset.get("market"),
                    "start": start_date,
                    "end": end_date,
                },
            )
            request_market = str(asset.get("market") or "")
        if envelope is None or not envelope.get("ok"):
            continue
        data = envelope.get("data") or {}
        prices = data.get("prices") or []
        if len(prices) >= min_bars:
            prices_by_symbol[symbol] = {
                "providerSymbol": data.get("symbol") or symbol,
                "prices": prices,
                "warnings": data.get("warnings") or [],
                "provenance": envelope.get("resultProvenance") or {},
                **(
                    {"requestMarket": request_market}
                    if bond_market_fallback and request_market
                    else {}
                ),
            }
    return prices_by_symbol
