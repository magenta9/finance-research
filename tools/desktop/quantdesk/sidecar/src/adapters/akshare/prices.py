from __future__ import annotations

from datetime import date

try:
    import akshare as ak  # type: ignore
except Exception:
    ak = None

from .proxy import _bypass_proxy_for_domestic
from .utils import _normalize_date, _safe_float, _sort_by_date


OPEN_FUND_NAV_LOOKBACK_DAYS = 7
HK_INDEX_SYMBOLS = {"HSI", "HSTECH"}


class PriceMixin:
    def _resolve_hk_index_symbol(
        self,
        symbol: str,
        market: str | None,
        asset_metadata: dict[str, object] | None,
    ) -> str | None:
        normalized = symbol.strip().upper()
        if normalized.startswith("^"):
            normalized = normalized[1:]
        if normalized.endswith(".HK"):
            normalized = normalized[:-3]

        if normalized not in HK_INDEX_SYMBOLS:
            return None
        if market == "HK":
            return normalized
        if (
            asset_metadata is not None
            and asset_metadata.get("instrumentType") == "index"
        ):
            return normalized
        return None

    def _fetch_hk_index_prices(
        self,
        symbol: str,
        start: str,
        end: str,
    ) -> list[dict[str, float | str | None]]:
        if ak is None:
            raise RuntimeError("AKShare is not available.")

        with _bypass_proxy_for_domestic():
            frame = ak.stock_hk_index_daily_em(symbol=symbol)
        if frame.empty:
            return []

        rows: list[dict[str, float | str | None]] = []
        for _, row in frame.iterrows():
            row_date = _normalize_date(row.get("date"))
            if row_date < start or row_date > end:
                continue

            close = _safe_float(
                row.get("latest") if row.get("latest") is not None else row.get("close")
            )
            rows.append(
                {
                    "date": row_date,
                    "open": _safe_float(row.get("open")),
                    "high": _safe_float(row.get("high")),
                    "low": _safe_float(row.get("low")),
                    "close": close,
                    "volume": None,
                    "adjusted_close": close,
                    "source": "akshare-hk-index-em",
                }
            )

        return _sort_by_date(rows)

    def _is_main_continuous_symbol(self, symbol: str) -> bool:
        normalized = symbol.strip().upper()
        return normalized.endswith("_MC") or (
            normalized.endswith("9999") and normalized[:-4].isalpha()
        )

    def _underlying_from_futures_symbol(self, symbol: str) -> str:
        normalized = symbol.strip().upper().partition(".")[0]
        if normalized.endswith("_MC"):
            return normalized[:-3]
        if normalized.endswith("9999"):
            return normalized[:-4]
        return normalized

    def _is_futures_request(
        self,
        symbol: str,
        market: str | None,
        asset_metadata: dict[str, object] | None,
    ) -> bool:
        if asset_metadata is not None:
            instrument_type = asset_metadata.get("instrumentType")
            ts_code_asset = asset_metadata.get("tsCodeAsset")
            if instrument_type == "futures" or ts_code_asset == "FT":
                return True
        return market == "COMMODITY" and self._is_main_continuous_symbol(symbol)

    def _fetch_futures_main_prices(
        self,
        symbol: str,
        start: str,
        end: str,
        asset_metadata: dict[str, object] | None,
    ) -> list[dict[str, float | str | None]]:
        if ak is None:
            raise RuntimeError("AKShare is not available.")

        source_symbol = self._resolve_akshare_futures_symbol(symbol, asset_metadata)
        with _bypass_proxy_for_domestic():
            frame = ak.futures_main_sina(
                symbol=source_symbol,
                start_date=start.replace("-", ""),
                end_date=end.replace("-", ""),
            )
        if frame.empty:
            return []

        rows: list[dict[str, float | str | None]] = []
        for _, row in frame.iterrows():
            raw_date = (
                row.get("日期") if row.get("日期") is not None else row.get("date")
            )
            rows.append(
                {
                    "date": _normalize_date(raw_date),
                    "open": _safe_float(
                        row.get("开盘")
                        if row.get("开盘") is not None
                        else row.get("open")
                    ),
                    "high": _safe_float(
                        row.get("最高")
                        if row.get("最高") is not None
                        else row.get("high")
                    ),
                    "low": _safe_float(
                        row.get("最低")
                        if row.get("最低") is not None
                        else row.get("low")
                    ),
                    "close": _safe_float(
                        row.get("收盘")
                        if row.get("收盘") is not None
                        else row.get("close")
                    ),
                    "volume": _safe_float(
                        row.get("成交量")
                        if row.get("成交量") is not None
                        else row.get("volume")
                    ),
                    "adjusted_close": None,
                    "source": "akshare-futures-main-sina",
                }
            )

        return _sort_by_date(rows)

    def _resolve_akshare_futures_symbol(
        self, symbol: str, asset_metadata: dict[str, object] | None
    ) -> str:
        if asset_metadata is not None:
            value = asset_metadata.get("underlyingSymbol") or asset_metadata.get(
                "sourceSymbol"
            )
            if isinstance(value, str) and value.strip():
                return self._underlying_from_futures_symbol(value) + "0"
        return self._underlying_from_futures_symbol(symbol) + "0"

    def _fetch_etf_prices(
        self,
        symbol: str,
        start: str,
        end: str,
    ) -> list[dict[str, float | str | None]]:
        if ak is None:
            raise RuntimeError("AKShare is not available.")

        with _bypass_proxy_for_domestic():
            frame = ak.fund_etf_hist_em(
                symbol=symbol,
                period="daily",
                start_date=start.replace("-", ""),
                end_date=end.replace("-", ""),
                adjust="qfq",
            )
        if frame.empty:
            return []

        return _sort_by_date(
            [
                {
                    "date": _normalize_date(row["日期"]),
                    "open": _safe_float(row.get("开盘")),
                    "high": _safe_float(row.get("最高")),
                    "low": _safe_float(row.get("最低")),
                    "close": _safe_float(row.get("收盘")),
                    "volume": _safe_float(row.get("成交量")),
                    "adjusted_close": _safe_float(row.get("收盘")),
                    "source": "akshare",
                }
                for _, row in frame.iterrows()
            ]
        )

    def _fetch_open_fund_prices(
        self,
        symbol: str,
        start: str,
        end: str,
    ) -> list[dict[str, float | str | None]]:
        if ak is None:
            raise RuntimeError("AKShare is not available.")

        with _bypass_proxy_for_domestic():
            frame = ak.fund_open_fund_info_em(
                symbol=symbol,
                indicator="单位净值走势",
            )

        if frame.empty:
            return []

        start_date = date.fromisoformat(start)
        rows: list[dict[str, float | str | None]] = []
        latest_prior_row: dict[str, float | str | None] | None = None
        latest_prior_date: str | None = None
        for _, row in frame.iterrows():
            row_date = _normalize_date(row["净值日期"])
            if row_date > end:
                continue

            net_value = _safe_float(row.get("单位净值"))
            if net_value is None or net_value <= 0:
                continue

            price_row = {
                "date": row_date,
                "open": None,
                "high": None,
                "low": None,
                "close": net_value,
                "volume": None,
                "adjusted_close": net_value,
                "source": "akshare-nav",
            }
            if row_date >= start:
                rows.append(price_row)
                continue

            row_day = date.fromisoformat(row_date)
            if (start_date - row_day).days <= OPEN_FUND_NAV_LOOKBACK_DAYS and (
                latest_prior_date is None or row_date > latest_prior_date
            ):
                latest_prior_row = price_row
                latest_prior_date = row_date

        if rows:
            return _sort_by_date(rows)
        if latest_prior_row is not None:
            return [latest_prior_row]
        return []
