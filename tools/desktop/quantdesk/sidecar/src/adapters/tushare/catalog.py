from __future__ import annotations

import time
from typing import Any

from .candidates import (
    TuShareCandidate,
    _asset_rank,
    _build_asset_result,
    _candidate_from_row,
    _futures_candidate_from_row,
    _score_candidate,
)
from .constants import (
    TUSHARE_CATALOG_CACHE_TTL_SECONDS,
    TUSHARE_SEARCH_RESULT_LIMIT,
)
from .utils import _normalize_query


TUSHARE_INDEX_MARKETS = ("SSE", "SZSE", "CSI", "CNI", "SW", "MSCI", "OTH", "HK")
TUSHARE_COMMODITY_FUTURES_EXCHANGES = ("SHFE", "DCE", "CZCE", "INE", "GFEX")


class CatalogMixin:
    _catalog_cache: dict[str, tuple[float, list[TuShareCandidate]]]

    def search_assets(
        self, query: str, market: str | None = None
    ) -> list[dict[str, object]]:
        normalized_query = _normalize_query(query)
        normalized_market = None if market in (None, "ALL") else market
        if not normalized_query:
            return []

        client = self._get_client()
        candidates = self._load_candidates(client, normalized_market)

        scored: list[tuple[int, TuShareCandidate]] = []
        for candidate in candidates:
            if normalized_market and candidate.market != normalized_market:
                continue
            score = _score_candidate(normalized_query, candidate)
            if score >= 0:
                scored.append((score, candidate))

        scored.sort(
            key=lambda item: (
                -item[0],
                _asset_rank(item[1]),
                item[1].source_rank,
                item[1].symbol,
            )
        )
        seen: set[tuple[str, str]] = set()
        results: list[dict[str, object]] = []

        for _, candidate in scored:
            key = (candidate.symbol, candidate.market)
            if key in seen:
                continue
            seen.add(key)
            results.append(_build_asset_result(candidate))

        return results[:TUSHARE_SEARCH_RESULT_LIMIT]

    def _load_catalog(
        self, label: str, fetch: Any, client: Any, source_rank: int
    ) -> list[TuShareCandidate]:
        now = time.monotonic()
        cached = self._catalog_cache.get(label)
        if cached is not None:
            fetched_at, candidates = cached
            if now - fetched_at < TUSHARE_CATALOG_CACHE_TTL_SECONDS:
                return candidates

        candidates = fetch(client, source_rank)
        self._catalog_cache[label] = (now, candidates)
        return candidates

    def _load_candidates(
        self, client: Any, market: str | None = None
    ) -> list[TuShareCandidate]:
        catalog_sources = (
            ("stock_basic", {"A"}, self._fetch_stock_candidates),
            ("index_basic", {"A", "HK"}, self._fetch_index_candidates),
            ("fund_basic", {"A"}, self._fetch_fund_candidates),
            ("hk_basic", {"HK"}, self._fetch_hk_candidates),
            ("fut_basic", {"COMMODITY"}, self._fetch_futures_candidates),
        )
        selected_sources = [
            source
            for source in catalog_sources
            if market is None or market in source[1]
        ]

        candidates: list[TuShareCandidate] = []
        failures: list[tuple[str, str]] = []

        for source_rank, (label, _markets, fetch) in enumerate(selected_sources):
            try:
                candidates.extend(self._load_catalog(label, fetch, client, source_rank))
            except Exception as error:
                failures.append((label, str(error)))

        if failures and not candidates:
            details = "; ".join(f"{label}: {error}" for label, error in failures)
            raise RuntimeError(f"TuShare catalog requests failed: {details}")

        return candidates

    def _fetch_stock_candidates(
        self, client: Any, source_rank: int
    ) -> list[TuShareCandidate]:
        frame = client.stock_basic(
            exchange="",
            list_status="L",
            fields="ts_code,symbol,name,exchange,market,list_date",
        )
        return self._candidates_from_frame(frame, source_rank, "E")

    def _fetch_fund_candidates(
        self, client: Any, source_rank: int
    ) -> list[TuShareCandidate]:
        frame = client.fund_basic(
            market="E",
            fields="ts_code,name,management,custodian,fund_type,found_date,list_status",
        )
        return self._candidates_from_frame(frame, source_rank, "FD")

    def _fetch_index_candidates(
        self, client: Any, source_rank: int
    ) -> list[TuShareCandidate]:
        candidates: list[TuShareCandidate] = []
        failures: list[tuple[str, str]] = []
        for market in TUSHARE_INDEX_MARKETS:
            try:
                frame = client.index_basic(
                    market=market,
                    fields="ts_code,name,market,publisher,category,list_date",
                )
            except Exception as error:
                failures.append((market, str(error)))
                continue

            candidates.extend(self._candidates_from_frame(frame, source_rank, "I"))

        if failures and not candidates:
            details = "; ".join(f"{market}: {error}" for market, error in failures)
            raise RuntimeError(f"index_basic requests failed: {details}")

        return candidates

    def _fetch_hk_candidates(
        self, client: Any, source_rank: int
    ) -> list[TuShareCandidate]:
        frame = client.hk_basic(fields="ts_code,name,fullname,enname,list_status")
        return self._candidates_from_frame(frame, source_rank, "H")

    def _fetch_futures_candidates(
        self, client: Any, source_rank: int
    ) -> list[TuShareCandidate]:
        candidates: list[TuShareCandidate] = []
        failures: list[tuple[str, str]] = []
        fields = "ts_code,symbol,name,exchange,fut_code,list_date,delist_date"

        for exchange in TUSHARE_COMMODITY_FUTURES_EXCHANGES:
            try:
                frame = client.fut_basic(exchange=exchange, fields=fields)
            except Exception as error:
                failures.append((exchange, str(error)))
                continue

            if frame is None or getattr(frame, "empty", True):
                continue

            for row in frame.to_dict("records"):
                candidate = _futures_candidate_from_row(row, source_rank)
                if candidate is not None:
                    candidates.append(candidate)

        if failures and not candidates:
            details = "; ".join(f"{exchange}: {error}" for exchange, error in failures)
            raise RuntimeError(f"fut_basic requests failed: {details}")

        return candidates

    def _candidates_from_frame(
        self, frame: Any, source_rank: int, price_asset: str
    ) -> list[TuShareCandidate]:
        if frame is None or getattr(frame, "empty", True):
            return []
        candidates: list[TuShareCandidate] = []
        for row in frame.to_dict("records"):
            candidate = _candidate_from_row(row, source_rank, price_asset)
            if candidate is not None:
                candidates.append(candidate)
        return candidates
