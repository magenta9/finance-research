from __future__ import annotations

from dataclasses import dataclass
import unicodedata
from typing import Any

try:
    import yfinance as yf  # type: ignore
except Exception:
    yf = None


@dataclass(frozen=True)
class AssetCandidate:
    symbol: str
    name: str
    market: str
    asset_class: str
    currency: str
    source: str
    aliases: tuple[str, ...] = ()


SEED_US_ASSETS = [
    AssetCandidate(
        "SPY",
        "SPDR S&P 500 ETF Trust",
        "US",
        "equity",
        "USD",
        "yfinance-seed",
        ("标普500", "标普", "s&p500", "sp500"),
    ),
    AssetCandidate(
        "QQQ",
        "Invesco QQQ Trust",
        "US",
        "equity",
        "USD",
        "yfinance-seed",
        ("纳斯达克", "纳指", "nasdaq", "nasdaq100"),
    ),
    AssetCandidate(
        "AGG",
        "iShares Core U.S. Aggregate Bond ETF",
        "US",
        "fixed_income",
        "USD",
        "yfinance-seed",
        ("债券", "美债", "bond"),
    ),
    AssetCandidate(
        "GLD",
        "SPDR Gold Shares",
        "US",
        "commodity",
        "USD",
        "yfinance-seed",
        ("黄金", "gold"),
    ),
    AssetCandidate(
        "^HSI",
        "Hang Seng Index",
        "HK",
        "equity",
        "HKD",
        "yfinance-seed",
        ("恒生指数", "恒生", "hang seng", "hang seng index", "hsi"),
    ),
    AssetCandidate(
        "^HSTECH",
        "Hang Seng TECH Index",
        "HK",
        "equity",
        "HKD",
        "yfinance-seed",
        ("恒生科技", "恒生科技指数", "hang seng tech", "hstech"),
    ),
    AssetCandidate(
        "2800.HK",
        "Tracker Fund of Hong Kong",
        "HK",
        "equity",
        "HKD",
        "yfinance-seed",
        ("恒生", "hang seng", "hsi"),
    ),
]


def _normalize_query(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().lower()


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


def _resolve_fx_ticker(pair: str) -> tuple[str, bool] | None:
    explicit = {
        "USD/CNY": ("CNY=X", False),
        "HKD/CNY": ("HKDCNY=X", False),
        "CNY/USD": ("CNY=X", True),
        "CNY/HKD": ("HKDCNY=X", True),
    }
    if pair in explicit:
        return explicit[pair]

    if "/" not in pair:
        return None

    base, quote = pair.split("/", 1)
    return (f"{base}{quote}=X", False)


def _resolve_cn_symbol(symbol: str) -> str | None:
    """Map a 6-digit Chinese A-market code to a Yahoo Finance ticker.

    Shanghai (.SS): codes starting with 5, 6, 9, 11
    Shenzhen (.SZ): codes starting with 0, 1, 3
    """
    if not symbol.isdigit() or len(symbol) != 6:
        return None

    first = symbol[0]
    if first in ("5", "6", "9"):
        return f"{symbol}.SS"
    if first in ("0", "1", "3"):
        return f"{symbol}.SZ"
    if symbol.startswith("11"):
        return f"{symbol}.SS"
    return None


class YFinanceAdapter:
    def search_assets(
        self, query: str, market: str | None = None
    ) -> list[dict[str, object]]:
        normalized_query = _normalize_query(query)
        normalized_market = None if market in (None, "ALL") else market

        if not normalized_query:
            return []

        candidates = [
            candidate
            for candidate in SEED_US_ASSETS
            if any(
                normalized_query in _normalize_query(token)
                for token in (candidate.symbol, candidate.name, *candidate.aliases)
            )
        ]

        if normalized_market:
            candidates = [
                candidate
                for candidate in candidates
                if candidate.market == normalized_market
            ]

        results: list[dict[str, object]] = []
        for candidate in candidates:
            metadata: dict[str, object] = {
                "searchAliases": list(candidate.aliases),
            }
            if candidate.symbol.startswith("^"):
                metadata["instrumentType"] = "index"

            results.append(
                {
                    "symbol": candidate.symbol,
                    "name": candidate.name,
                    "market": candidate.market,
                    "assetClass": candidate.asset_class,
                    "currency": candidate.currency,
                    "source": candidate.source,
                    "metadata": metadata,
                }
            )

        return results

    def fetch_prices(
        self,
        symbol: str,
        start: str,
        end: str,
        market: str | None = None,
        asset_metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        warnings: list[str] = []

        if yf is None:
            warnings.append("yfinance is not available for price requests.")
            return {"symbol": symbol, "prices": [], "warnings": warnings}

        # For Chinese A-market symbols, resolve to Yahoo Finance ticker format
        yf_symbol = _resolve_cn_symbol(symbol) or symbol

        try:
            frame = yf.download(
                yf_symbol,
                start=start,
                end=end,
                auto_adjust=False,
                progress=False,
            )
            # yfinance >=0.2 returns MultiIndex columns (Price, Ticker).
            if hasattr(frame.columns, "nlevels") and frame.columns.nlevels > 1:
                frame.columns = frame.columns.droplevel("Ticker")
            if not frame.empty:
                rows = [
                    {
                        "date": index.date().isoformat(),
                        "open": _safe_float(row.get("Open")),
                        "high": _safe_float(row.get("High")),
                        "low": _safe_float(row.get("Low")),
                        "close": _safe_float(row.get("Close")),
                        "volume": _safe_float(row.get("Volume")),
                        "adjusted_close": _safe_float(
                            row.get("Adj Close", row.get("Close"))
                        ),
                        "source": "yfinance",
                    }
                    for index, row in frame.iterrows()
                ]
                return {"symbol": symbol, "prices": rows, "warnings": warnings}
            warnings.append(f"Yahoo Finance returned no price rows for {yf_symbol}.")
        except Exception as error:
            warnings.append(f"Yahoo Finance price request failed for {symbol}: {error}")

        return {"symbol": symbol, "prices": [], "warnings": warnings}

    def fetch_fx_rates(self, pair: str, start: str, end: str) -> dict[str, object]:
        warnings: list[str] = []
        resolved = _resolve_fx_ticker(pair)

        if resolved is None:
            warnings.append(f"Yahoo Finance does not support FX pair {pair}.")
            return {"pair": pair, "rates": [], "warnings": warnings}

        if yf is None:
            warnings.append("yfinance is not available for FX requests.")
            return {"pair": pair, "rates": [], "warnings": warnings}

        ticker, invert = resolved

        try:
            frame = yf.download(
                ticker,
                start=start,
                end=end,
                auto_adjust=False,
                progress=False,
            )
            # yfinance >=0.2 returns MultiIndex columns (Price, Ticker).
            if hasattr(frame.columns, "nlevels") and frame.columns.nlevels > 1:
                frame.columns = frame.columns.droplevel("Ticker")
            if not frame.empty:
                rows = []
                for index, row in frame.iterrows():
                    rate = _safe_float(row.get("Close"))
                    if rate is None or rate <= 0:
                        continue
                    rows.append(
                        {
                            "date": index.date().isoformat(),
                            "rate": round(1 / rate, 8) if invert else round(rate, 8),
                            "source": "yfinance-derived" if invert else "yfinance",
                        }
                    )
                if rows:
                    if invert:
                        warnings.append(
                            f"Derived {pair} from Yahoo Finance inverse FX ticker {ticker}."
                        )
                    return {"pair": pair, "rates": rows, "warnings": warnings}
            warnings.append(f"Yahoo Finance returned no FX rows for {pair}.")
        except Exception as error:
            warnings.append(f"Yahoo Finance FX request failed for {pair}: {error}")

        return {"pair": pair, "rates": [], "warnings": warnings}
