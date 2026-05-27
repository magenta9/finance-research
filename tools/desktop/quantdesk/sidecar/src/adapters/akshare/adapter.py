from __future__ import annotations

import threading

from .candidates import (
    AssetCandidate,
    _build_asset_result,
    _dedupe_asset_candidates,
    _match_candidate_score,
)
from .catalog import CatalogMixin
from .fx import FxMixin
from .prices import PriceMixin
from .utils import _normalize_query


class AKShareAdapter(CatalogMixin, PriceMixin, FxMixin):
    def __init__(self) -> None:
        self._etf_catalog_cache: tuple[AssetCandidate, ...] | None = None
        self._etf_catalog_cache_fetched_at: float | None = None
        self._etf_catalog_lock = threading.Lock()
        self._fund_catalog_cache: tuple[AssetCandidate, ...] | None = None
        self._fund_catalog_cache_fetched_at: float | None = None
        self._fund_catalog_lock = threading.Lock()
        self._asset_metadata_cache: dict[str, tuple[str | None, str | None, float]] = {}
        self._asset_metadata_lock = threading.Lock()

    def search_assets(
        self, query: str, market: str | None = None
    ) -> list[dict[str, object]]:
        normalized_query = _normalize_query(query)
        normalized_market = None if market in (None, "ALL") else market

        if not normalized_query:
            return []

        catalog = _dedupe_asset_candidates(
            self._get_etf_catalog(),
            self._get_fund_catalog(),
        )
        if not catalog:
            return []

        matches: list[tuple[int, AssetCandidate]] = []
        for candidate in catalog:
            if normalized_market and candidate.market != normalized_market:
                continue

            score = _match_candidate_score(normalized_query, candidate)
            if score < 0:
                continue

            matches.append((score, candidate))

        matches.sort(
            key=lambda item: (
                -item[0],
                item[1].source_rank,
                len(_normalize_query(item[1].name)),
                item[1].symbol,
            )
        )
        top_candidates = self._enrich_candidates(
            [candidate for _, candidate in matches[:12]]
        )
        return [_build_asset_result(candidate) for candidate in top_candidates]

    def fetch_prices(
        self,
        symbol: str,
        start: str,
        end: str,
        market: str | None = None,
        asset_metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        warnings: list[str] = []

        if self._is_futures_request(symbol, market, asset_metadata):
            try:
                rows = self._fetch_futures_main_prices(
                    symbol, start, end, asset_metadata
                )
                if rows:
                    warnings.append(
                        f"AKShare used Sina futures main-contract fallback for {symbol}; series is raw continuous and not back-adjusted."
                    )
                    return {"symbol": symbol, "prices": rows, "warnings": warnings}
                warnings.append(
                    f"AKShare futures fallback returned no price rows for {symbol}."
                )
            except Exception as error:
                warnings.append(
                    f"AKShare futures fallback failed for {symbol}: {error}"
                )
            return {"symbol": symbol, "prices": [], "warnings": warnings}

        hk_index_symbol = self._resolve_hk_index_symbol(symbol, market, asset_metadata)
        if hk_index_symbol is not None:
            try:
                rows = self._fetch_hk_index_prices(hk_index_symbol, start, end)
                if rows:
                    warnings.append(
                        f"AKShare used Eastmoney HK index history for {symbol}."
                    )
                    return {"symbol": symbol, "prices": rows, "warnings": warnings}
                warnings.append(
                    f"AKShare HK index history returned no price rows for {symbol}."
                )
            except Exception as error:
                warnings.append(
                    f"AKShare HK index history request failed for {symbol}: {error}"
                )
            return {"symbol": symbol, "prices": [], "warnings": warnings}

        etf_warning: str | None = None
        try:
            rows = self._fetch_etf_prices(symbol, start, end)
            if rows:
                return {"symbol": symbol, "prices": rows, "warnings": warnings}
            etf_warning = f"AKShare ETF history returned no price rows for {symbol}."
        except Exception as error:
            etf_warning = f"AKShare ETF history request failed for {symbol}: {error}"

        if etf_warning:
            warnings.append(etf_warning)

        try:
            rows = self._fetch_open_fund_prices(symbol, start, end)
            if rows:
                warnings.append(
                    f"AKShare used NAV fallback for {symbol}; OHLC and volume are unavailable."
                )
                return {"symbol": symbol, "prices": rows, "warnings": warnings}
            warnings.append(
                f"AKShare NAV fallback returned no price rows for {symbol}."
            )
        except Exception as error:
            warnings.append(f"AKShare NAV fallback failed for {symbol}: {error}")

        return {"symbol": symbol, "prices": [], "warnings": warnings}

    def fetch_fx_rates(self, pair: str, start: str, end: str) -> dict[str, object]:
        warnings: list[str] = []

        rows = self._fetch_boc_fx_rates(pair, start, end, warnings)
        if rows:
            return {"pair": pair, "rates": rows, "warnings": warnings}

        rows = self._fetch_forex_hist_rates(pair, start, end, warnings)
        if rows:
            return {"pair": pair, "rates": rows, "warnings": warnings}

        if not warnings:
            warnings.append(f"AKShare could not resolve FX pair {pair}.")

        return {"pair": pair, "rates": [], "warnings": warnings}
