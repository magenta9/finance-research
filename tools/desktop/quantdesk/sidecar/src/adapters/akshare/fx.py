from __future__ import annotations

from datetime import date
from typing import Any

try:
    import akshare as ak  # type: ignore
except Exception:
    ak = None

from .proxy import _bypass_proxy_for_domestic
from .utils import _find_column, _normalize_date, _safe_float, _sort_by_date


class FxMixin:
    def _fetch_boc_fx_rates(
        self,
        pair: str,
        start: str,
        end: str,
        warnings: list[str],
    ) -> list[dict[str, object]]:
        if ak is None:
            return []

        column_map: dict[str, tuple[tuple[str, ...], bool]] = {
            "USD/CNY": (("美元", "usd"), False),
            "HKD/CNY": (("港币", "hkd"), False),
            "CNY/USD": (("美元", "usd"), True),
            "CNY/HKD": (("港币", "hkd"), True),
        }
        config = column_map.get(pair)

        if not config:
            return []

        fetch = getattr(ak, "currency_boc_safe", None)
        if fetch is None:
            warnings.append("AKShare currency_boc_safe is unavailable.")
            return []

        try:
            with _bypass_proxy_for_domestic():
                frame = fetch()
        except Exception as error:
            warnings.append(f"AKShare currency_boc_safe failed for {pair}: {error}")
            return []

        if frame is None or frame.empty:
            warnings.append(f"AKShare currency_boc_safe returned no rows for {pair}.")
            return []

        columns = [str(column) for column in frame.columns]
        date_column = _find_column(columns, ("日期", "交易日期", "date", "time"))
        value_column = _find_column(columns, config[0])

        if value_column is None:
            warnings.append(f"AKShare currency_boc_safe does not expose {pair} columns.")
            return []

        source = "akshare-derived" if config[1] else "akshare"
        rows: list[dict[str, object]] = []

        for _, row in frame.iterrows():
            row_date = _normalize_date(row[date_column]) if date_column is not None else date.today().isoformat()
            if row_date < start or row_date > end:
                continue

            rate = _safe_float(row.get(value_column))
            if rate is None or rate <= 0:
                continue

            normalized_rate = rate / 100
            if normalized_rate <= 0:
                continue

            rows.append(
                {
                    "date": row_date,
                    "rate": round(1 / normalized_rate, 8) if config[1] else round(normalized_rate, 8),
                    "source": source,
                }
            )

        if rows and config[1]:
            warnings.append(f"Derived {pair} from AKShare direct CNY reference rates.")

        return _sort_by_date(rows)

    def _fetch_forex_hist_rates(
        self,
        pair: str,
        start: str,
        end: str,
        warnings: list[str],
    ) -> list[dict[str, object]]:
        if ak is None:
            return []

        ticker_map: dict[str, tuple[str, bool]] = {
            "USD/CNY": ("USDCNY", False),
            "HKD/CNY": ("HKDCNY", False),
            "CNY/USD": ("USDCNY", True),
            "CNY/HKD": ("HKDCNY", True),
        }
        config = ticker_map.get(pair)

        if not config:
            return []

        fetch = getattr(ak, "forex_hist_em", None)
        if fetch is None:
            warnings.append("AKShare forex_hist_em is unavailable.")
            return []

        try:
            with _bypass_proxy_for_domestic():
                frame = fetch(
                    symbol=config[0],
                    start_date=start.replace("-", ""),
                    end_date=end.replace("-", ""),
                )
        except TypeError:
            try:
                with _bypass_proxy_for_domestic():
                    frame = fetch(symbol=config[0])
            except Exception as error:
                warnings.append(f"AKShare forex_hist_em failed for {pair}: {error}")
                return []
        except Exception as error:
            warnings.append(f"AKShare forex_hist_em failed for {pair}: {error}")
            return []

        if frame is None or frame.empty:
            warnings.append(f"AKShare forex_hist_em returned no rows for {pair}.")
            return []

        columns = [str(column) for column in frame.columns]
        date_column = _find_column(columns, ("日期", "date", "时间"))
        rate_column = _find_column(columns, ("收盘", "close", "最新价", "rate"))

        if date_column is None or rate_column is None:
            warnings.append(f"AKShare forex_hist_em schema is unsupported for {pair}.")
            return []

        source = "akshare-derived" if config[1] else "akshare"
        rows: list[dict[str, object]] = []

        for _, row in frame.iterrows():
            row_date = _normalize_date(row[date_column])
            if row_date < start or row_date > end:
                continue

            rate = _safe_float(row.get(rate_column))
            if rate is None or rate <= 0:
                continue

            rows.append(
                {
                    "date": row_date,
                    "rate": round(1 / rate, 8) if config[1] else round(rate, 8),
                    "source": source,
                }
            )

        if rows and config[1]:
            warnings.append(f"Derived {pair} from AKShare inverse forex history.")

        return _sort_by_date(rows)