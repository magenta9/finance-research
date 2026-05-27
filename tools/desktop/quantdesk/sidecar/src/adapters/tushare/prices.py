from __future__ import annotations

from typing import Any

from .candidates import TuShareCandidate
from .runtime import _get_tushare_runtime
from .ts_codes import (
    _infer_pro_bar_asset,
    _is_futures_metadata,
    _metadata_string,
    _metadata_ts_code,
    _metadata_ts_code_asset,
    _resolve_ts_code,
)
from .utils import _compact_date, _format_trade_date, _safe_float


class PriceMixin:
    def fetch_prices(
        self,
        symbol: str,
        start: str,
        end: str,
        market: str | None = None,
        asset_metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        warnings: list[str] = []
        try:
            client = self._get_client()
        except Exception as error:
            return {"symbol": symbol, "prices": [], "warnings": [str(error)]}

        metadata_ts_code = _metadata_ts_code(asset_metadata) or (
            _metadata_string(asset_metadata, "sourceSymbol")
            if _is_futures_metadata(asset_metadata)
            else None
        )
        metadata_price_asset = _metadata_ts_code_asset(asset_metadata)
        catalog_candidate = (
            None
            if metadata_ts_code is not None
            else self._resolve_candidate_from_catalog(client, symbol, market)
        )
        if (
            market in ("A", "HK")
            and metadata_ts_code is None
            and catalog_candidate is None
        ):
            return {
                "symbol": symbol,
                "prices": [],
                "warnings": [
                    f"TuShare could not resolve canonical tsCode for {symbol}; run asset lookup or metadata backfill first."
                ],
            }

        ts_code = (
            metadata_ts_code
            or (catalog_candidate.ts_code if catalog_candidate is not None else None)
            or _resolve_ts_code(symbol, market)
        )
        price_asset = (
            metadata_price_asset
            or (
                catalog_candidate.price_asset if catalog_candidate is not None else None
            )
            or _infer_pro_bar_asset(ts_code)
        )
        if price_asset == "FT" or _is_futures_metadata(asset_metadata):
            return self._fetch_futures_prices(
                client,
                symbol,
                start,
                end,
                ts_code,
                asset_metadata,
                warnings,
            )
        if ts_code.endswith(".HK"):
            warnings.append(
                "TuShare hk_daily is unadjusted; HK calculation series is unavailable until an adjusted source is configured."
            )
        try:
            frame = self._fetch_price_frame(client, ts_code, start, end, price_asset)
        except Exception as error:
            return {
                "symbol": symbol,
                "prices": [],
                "warnings": [f"TuShare price request failed for {symbol}: {error}"],
            }

        if frame is None or getattr(frame, "empty", True):
            warnings.append(f"TuShare returned no price rows for {symbol}.")
            return {"symbol": symbol, "prices": [], "warnings": warnings}

        rows: list[dict[str, object]] = []
        for row in frame.to_dict("records"):
            trade_date = _format_trade_date(row.get("trade_date"))
            if trade_date is None:
                continue
            close = _safe_float(row.get("close"))
            source = "tushare-hk-daily" if ts_code.endswith(".HK") else "tushare-qfq"
            adjusted_close = (
                None
                if source == "tushare-hk-daily"
                else (
                    _safe_float(row.get("adj_close"))
                    if row.get("adj_close") is not None
                    else close
                )
            )
            rows.append(
                {
                    "date": trade_date,
                    "open": _safe_float(row.get("open")),
                    "high": _safe_float(row.get("high")),
                    "low": _safe_float(row.get("low")),
                    "close": close,
                    "volume": _safe_float(
                        row.get("vol")
                        if row.get("vol") is not None
                        else row.get("volume")
                    ),
                    "adjusted_close": adjusted_close,
                    "source": source,
                }
            )

        rows.sort(key=lambda item: item["date"])
        return {"symbol": symbol, "prices": rows, "warnings": warnings}

    def _fetch_futures_prices(
        self,
        client: Any,
        symbol: str,
        start: str,
        end: str,
        ts_code: str,
        asset_metadata: dict[str, object] | None,
        warnings: list[str],
    ) -> dict[str, object]:
        contract_type = _metadata_string(asset_metadata, "contractType")
        if contract_type == "fixed_contract":
            try:
                frame = self._fetch_futures_daily_frame(client, ts_code, start, end)
            except Exception as error:
                return {
                    "symbol": symbol,
                    "prices": [],
                    "warnings": [
                        f"TuShare futures daily request failed for {symbol}: {error}"
                    ],
                }

            rows = self._futures_rows_from_frame(frame, "tushare-futures-daily")
            if not rows:
                warnings.append(f"TuShare returned no futures daily rows for {symbol}.")
            return {"symbol": symbol, "prices": rows, "warnings": warnings}

        try:
            rows = self._fetch_dominant_futures_rows(client, ts_code, start, end)
        except Exception as error:
            return {
                "symbol": symbol,
                "prices": [],
                "warnings": [
                    f"TuShare futures dominant request failed for {symbol}: {error}"
                ],
            }

        if rows:
            warnings.append(
                f"TuShare futures main contract series for {symbol} is raw continuous and not back-adjusted; returns and volatility may include roll jumps."
            )
            return {"symbol": symbol, "prices": rows, "warnings": warnings}

        warnings.append(
            f"TuShare returned no main-contract mapping rows for {symbol}; futures price series was not synthesized."
        )
        return {"symbol": symbol, "prices": [], "warnings": warnings}

    def _fetch_dominant_futures_rows(
        self, client: Any, ts_code: str, start: str, end: str
    ) -> list[dict[str, object]]:
        compact_start = _compact_date(start)
        compact_end = _compact_date(end)
        mapping_frame = client.fut_mapping(
            ts_code=ts_code,
            start_date=compact_start,
            end_date=compact_end,
        )
        if mapping_frame is None or getattr(mapping_frame, "empty", True):
            return []

        mapped_contracts: dict[str, str] = {}
        for row in mapping_frame.to_dict("records"):
            trade_date = _format_trade_date(row.get("trade_date"))
            mapped_code = self._mapped_futures_contract(row)
            if trade_date is None or mapped_code is None:
                continue
            mapped_contracts[trade_date] = mapped_code

        if not mapped_contracts:
            return []

        daily_by_contract_date: dict[tuple[str, str], dict[str, object]] = {}
        for mapped_code in sorted(set(mapped_contracts.values())):
            frame = self._fetch_futures_daily_frame(client, mapped_code, start, end)
            for row in self._futures_rows_from_frame(frame, "tushare-futures-main"):
                daily_by_contract_date[(mapped_code, str(row["date"]))] = row

        rows = [
            daily_by_contract_date[(mapped_contracts[trade_date], trade_date)]
            for trade_date in sorted(mapped_contracts)
            if (mapped_contracts[trade_date], trade_date) in daily_by_contract_date
        ]
        return rows

    def _mapped_futures_contract(self, row: dict[str, Any]) -> str | None:
        for key in (
            "mapping_ts_code",
            "mapping_tscode",
            "mapping_code",
            "contract_code",
            "main_contract",
        ):
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip().upper()
        value = row.get("ts_code")
        if (
            isinstance(value, str)
            and value.strip()
            and any(char.isdigit() for char in value)
        ):
            return value.strip().upper()
        return None

    def _fetch_futures_daily_frame(
        self, client: Any, ts_code: str, start: str, end: str
    ) -> Any:
        return client.fut_daily(
            ts_code=ts_code,
            start_date=_compact_date(start),
            end_date=_compact_date(end),
        )

    def _futures_rows_from_frame(
        self, frame: Any, source: str
    ) -> list[dict[str, object]]:
        if frame is None or getattr(frame, "empty", True):
            return []

        rows: list[dict[str, object]] = []
        for row in frame.to_dict("records"):
            trade_date = _format_trade_date(row.get("trade_date"))
            if trade_date is None:
                continue
            rows.append(
                {
                    "date": trade_date,
                    "open": _safe_float(row.get("open")),
                    "high": _safe_float(row.get("high")),
                    "low": _safe_float(row.get("low")),
                    "close": _safe_float(row.get("close")),
                    "volume": _safe_float(
                        row.get("vol")
                        if row.get("vol") is not None
                        else row.get("volume")
                    ),
                    "adjusted_close": None,
                    "source": source,
                }
            )

        rows.sort(key=lambda item: item["date"])
        return rows

    def _resolve_candidate_from_catalog(
        self, client: Any, symbol: str, market: str | None
    ) -> TuShareCandidate | None:
        if market not in ("A", "HK"):
            return None

        normalized_symbol = symbol.strip().upper()
        for candidate in self._load_candidates(client, market):
            if (
                candidate.symbol.upper() == normalized_symbol
                or candidate.ts_code.upper() == normalized_symbol
            ):
                return candidate

        return None

    def _fetch_price_frame(
        self, client: Any, ts_code: str, start: str, end: str, price_asset: str
    ) -> Any:
        compact_start = _compact_date(start)
        compact_end = _compact_date(end)
        if ts_code.endswith(".HK"):
            return client.hk_daily(
                ts_code=ts_code,
                start_date=compact_start,
                end_date=compact_end,
            )

        runtime = _get_tushare_runtime()
        return runtime.ts.pro_bar(
            ts_code=ts_code,
            start_date=compact_start,
            end_date=compact_end,
            asset=price_asset,
            adj="qfq",
            api=client,
        )
