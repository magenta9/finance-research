from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
import logging
import time
from typing import Any

import requests

try:
    import akshare as ak  # type: ignore
except Exception:
    ak = None

from .candidates import (
    AssetCandidate,
    _build_candidate,
    _dedupe_asset_candidates,
    _extract_issue_date_from_xq_payload,
)
from .proxy import _bypass_proxy_for_domestic
from .utils import _clean_text, _find_column, _normalize_issue_date, _normalize_query

logger = logging.getLogger(__name__)

ETF_SPOT_CACHE_TTL_SECONDS = 300
FUND_NAME_CACHE_TTL_SECONDS = 300
ETF_EXCHANGE_LOOKBACK_DAYS = 10
ASSET_METADATA_CACHE_TTL_SECONDS = 3600
XQ_ISSUE_DATE_URL = "https://danjuanfunds.com/djapi/fund/{symbol}"


class CatalogMixin:
    def _build_catalog_from_frame(
        self,
        frame: Any,
        *,
        symbol_columns: tuple[str, ...],
        name_columns: tuple[str, ...],
        source: str,
        source_rank: int = 0,
        fund_type_columns: tuple[str, ...] = (),
        alias_columns: tuple[str, ...] = (),
        issue_date_columns: tuple[str, ...] = (),
        include_candidate: Any | None = None,
    ) -> list[AssetCandidate]:
        if frame is None or frame.empty:
            return []

        columns = [str(column) for column in frame.columns]
        symbol_column = _find_column(columns, symbol_columns)
        name_column = _find_column(columns, name_columns)
        fund_type_column = (
            _find_column(columns, fund_type_columns) if fund_type_columns else None
        )
        issue_date_column = (
            _find_column(columns, issue_date_columns) if issue_date_columns else None
        )

        if symbol_column is None or name_column is None:
            return []

        candidates: list[AssetCandidate] = []
        for _, row in frame.iterrows():
            if include_candidate is not None and not include_candidate(row):
                continue

            aliases: tuple[str, ...] = ()
            if alias_columns:
                alias_values: list[str] = []
                for alias_column in alias_columns:
                    if alias_column not in frame.columns:
                        continue
                    raw_alias = row.get(alias_column)
                    if raw_alias is None:
                        continue
                    for value in (
                        str(raw_alias).replace("；", ";").replace("，", ";").split(";")
                    ):
                        cleaned_alias = _clean_text(value)
                        if cleaned_alias:
                            alias_values.append(cleaned_alias)
                aliases = tuple(dict.fromkeys(alias_values))

            candidate = _build_candidate(
                row.get(symbol_column),
                row.get(name_column),
                source,
                fund_type=row.get(fund_type_column) if fund_type_column else None,
                aliases=aliases,
                issue_date=row.get(issue_date_column) if issue_date_column else None,
                issue_date_source=source if issue_date_column else None,
                source_rank=source_rank,
            )
            if candidate is not None:
                candidates.append(candidate)

        return candidates

    def _should_include_fund_candidate(self, row: Any) -> bool:
        type_value = _normalize_query(row.get("类型") or row.get("基金类型") or "")
        name_value = _normalize_query(
            row.get("基金简称") or row.get("基金名称") or row.get("名称") or ""
        )

        blocked_keywords = ("封闭", "定期开放", "联接", "分级", "场内")
        if any(keyword in type_value for keyword in blocked_keywords):
            return False
        if any(keyword in name_value for keyword in blocked_keywords):
            return False

        return True

    def _load_em_daily_catalog(self) -> list[AssetCandidate]:
        if ak is None:
            return []

        with _bypass_proxy_for_domestic():
            frame = ak.fund_etf_fund_daily_em()

        return self._build_catalog_from_frame(
            frame,
            symbol_columns=("基金代码", "代码"),
            name_columns=("基金简称", "基金名称", "名称"),
            source="akshare-em-fund-daily",
            fund_type_columns=("类型", "基金类型"),
            issue_date_columns=("成立日期", "成立时间", "发行日期", "上市日期"),
            source_rank=0,
        )

    def _load_ths_catalog(self) -> list[AssetCandidate]:
        if ak is None:
            return []

        with _bypass_proxy_for_domestic():
            frame = ak.fund_etf_spot_ths()

        return self._build_catalog_from_frame(
            frame,
            symbol_columns=("基金代码", "代码"),
            name_columns=("基金名称", "基金简称", "名称"),
            source="akshare-ths",
            fund_type_columns=("基金类型", "类型"),
            issue_date_columns=("成立日期", "成立时间", "发行日期", "上市日期"),
            source_rank=1,
        )

    def _load_sina_catalog(self) -> list[AssetCandidate]:
        if ak is None:
            return []

        with _bypass_proxy_for_domestic():
            frame = ak.fund_etf_category_sina(symbol="ETF基金")

        return self._build_catalog_from_frame(
            frame,
            symbol_columns=("代码", "基金代码"),
            name_columns=("名称", "基金名称", "基金简称"),
            source="akshare-sina",
            issue_date_columns=("成立日期", "成立时间", "发行日期", "上市日期"),
            source_rank=2,
        )

    def _load_fund_name_catalog(self) -> list[AssetCandidate]:
        if ak is None:
            return []

        fetch = getattr(ak, "fund_name_em", None)
        if fetch is None:
            return []

        with _bypass_proxy_for_domestic():
            frame = fetch()

        return self._build_catalog_from_frame(
            frame,
            symbol_columns=("基金代码", "代码", "symbol"),
            name_columns=("基金简称", "基金名称", "名称", "name"),
            source="akshare-fund-name",
            source_rank=10,
            fund_type_columns=("类型", "基金类型", "基金类别"),
            alias_columns=("拼音", "拼音简写", "简称拼音", "英文名称"),
            issue_date_columns=("成立日期", "成立时间", "发行日期", "上市日期"),
            include_candidate=self._should_include_fund_candidate,
        )

    def _recent_exchange_dates(self) -> list[str]:
        return [
            (date.today() - timedelta(days=offset)).strftime("%Y%m%d")
            for offset in range(ETF_EXCHANGE_LOOKBACK_DAYS)
        ]

    def _load_exchange_catalog(self) -> list[AssetCandidate]:
        if ak is None:
            return []

        last_error: Exception | None = None

        for trade_date in self._recent_exchange_dates():
            sse_frame = None
            szse_frame = None

            try:
                with _bypass_proxy_for_domestic():
                    sse_frame = ak.fund_etf_scale_sse(date=trade_date)
            except Exception as error:
                last_error = error

            try:
                with _bypass_proxy_for_domestic():
                    szse_frame = ak.fund_scale_daily_szse(
                        start_date=trade_date, end_date=trade_date, symbol="ETF"
                    )
            except Exception as error:
                last_error = error

            merged = _dedupe_asset_candidates(
                self._build_catalog_from_frame(
                    sse_frame,
                    symbol_columns=("基金代码", "代码"),
                    name_columns=("基金简称", "基金名称", "名称"),
                    source="akshare-sse",
                    issue_date_columns=("成立日期", "成立时间", "发行日期", "上市日期"),
                    source_rank=3,
                ),
                self._build_catalog_from_frame(
                    szse_frame,
                    symbol_columns=("基金代码", "代码"),
                    name_columns=("基金简称", "基金名称", "名称"),
                    source="akshare-szse",
                    issue_date_columns=("成立日期", "成立时间", "发行日期", "上市日期"),
                    source_rank=3,
                ),
            )
            if merged:
                return merged

        if last_error is not None:
            raise last_error

        return []

    def _refresh_etf_catalog(self) -> tuple[AssetCandidate, ...]:
        loaders = (
            ("akshare-em-fund-daily", self._load_em_daily_catalog),
            ("akshare-ths", self._load_ths_catalog),
            ("akshare-sina", self._load_sina_catalog),
            ("akshare-exchange", self._load_exchange_catalog),
        )

        merged: list[AssetCandidate] = []
        successful_sources: list[str] = []

        for source_name, loader in loaders:
            try:
                batch = loader()
            except Exception:
                logger.warning(
                    "etf_catalog_source_failed",
                    extra={"source": source_name},
                    exc_info=True,
                )
                continue

            if not batch:
                continue

            successful_sources.append(source_name)
            merged = _dedupe_asset_candidates(merged, batch)

        if merged:
            logger.info(
                "etf_catalog_refreshed",
                extra={
                    "rowCount": len(merged),
                    "sourceCount": len(successful_sources),
                    "sources": successful_sources,
                },
            )
            return tuple(merged)

        raise RuntimeError("All remote ETF catalog sources returned no rows.")

    def _refresh_fund_catalog(self) -> tuple[AssetCandidate, ...]:
        try:
            batch = self._load_fund_name_catalog()
        except Exception:
            logger.warning(
                "fund_catalog_source_failed",
                extra={"source": "akshare-fund-name"},
                exc_info=True,
            )
            return tuple()

        if batch:
            logger.info(
                "fund_catalog_refreshed",
                extra={
                    "rowCount": len(batch),
                    "sourceCount": 1,
                    "sources": ["akshare-fund-name"],
                },
            )
            return tuple(batch)

        return tuple()

    def _get_etf_catalog(self) -> list[AssetCandidate]:
        if (
            self._etf_catalog_cache is not None
            and self._etf_catalog_cache_fetched_at is not None
            and time.monotonic() - self._etf_catalog_cache_fetched_at
            < ETF_SPOT_CACHE_TTL_SECONDS
        ):
            return list(self._etf_catalog_cache)

        if ak is None:
            return []

        with self._etf_catalog_lock:
            if (
                self._etf_catalog_cache is not None
                and self._etf_catalog_cache_fetched_at is not None
                and time.monotonic() - self._etf_catalog_cache_fetched_at
                < ETF_SPOT_CACHE_TTL_SECONDS
            ):
                return list(self._etf_catalog_cache)

            try:
                self._etf_catalog_cache = self._refresh_etf_catalog()
                self._etf_catalog_cache_fetched_at = time.monotonic()
                return list(self._etf_catalog_cache)
            except Exception:
                logger.warning("etf_catalog_refresh_failed", exc_info=True)
                return list(self._etf_catalog_cache or ())

    def _get_fund_catalog(self) -> list[AssetCandidate]:
        if (
            self._fund_catalog_cache is not None
            and self._fund_catalog_cache_fetched_at is not None
            and time.monotonic() - self._fund_catalog_cache_fetched_at
            < FUND_NAME_CACHE_TTL_SECONDS
        ):
            return list(self._fund_catalog_cache)

        if ak is None:
            return []

        with self._fund_catalog_lock:
            if (
                self._fund_catalog_cache is not None
                and self._fund_catalog_cache_fetched_at is not None
                and time.monotonic() - self._fund_catalog_cache_fetched_at
                < FUND_NAME_CACHE_TTL_SECONDS
            ):
                return list(self._fund_catalog_cache)

            try:
                self._fund_catalog_cache = self._refresh_fund_catalog()
                self._fund_catalog_cache_fetched_at = time.monotonic()
                return list(self._fund_catalog_cache)
            except Exception:
                logger.warning("fund_catalog_refresh_failed", exc_info=True)
                return list(self._fund_catalog_cache or ())

    def _get_cached_issue_date(
        self, symbol: str
    ) -> tuple[str | None, str | None] | None:
        with self._asset_metadata_lock:
            cached = self._asset_metadata_cache.get(symbol)
            if cached is None:
                return None

            issue_date, issue_date_source, fetched_at = cached
            if time.monotonic() - fetched_at >= ASSET_METADATA_CACHE_TTL_SECONDS:
                self._asset_metadata_cache.pop(symbol, None)
                return None

            return (issue_date, issue_date_source)

    def _set_cached_issue_date(
        self, symbol: str, issue_date: str | None, issue_date_source: str | None
    ) -> None:
        with self._asset_metadata_lock:
            self._asset_metadata_cache[symbol] = (
                issue_date,
                issue_date_source,
                time.monotonic(),
            )

    def _extract_issue_date_from_detail_frame(self, frame: Any) -> str | None:
        if frame is None or getattr(frame, "empty", True):
            return None

        columns = [str(column) for column in frame.columns]
        item_column = _find_column(columns, ("item", "项目", "字段"))
        value_column = _find_column(columns, ("value", "值", "内容"))

        if item_column is not None and value_column is not None:
            for _, row in frame.iterrows():
                item = _normalize_query(row.get(item_column))
                if item not in {"成立时间", "成立日期", "发行日期", "上市日期"}:
                    continue

                return _normalize_issue_date(row.get(value_column))

        for column in ("成立时间", "成立日期", "发行日期", "上市日期"):
            if column in frame.columns and not frame.empty:
                return _normalize_issue_date(frame.iloc[0].get(column))

        return None

    def _fetch_issue_date_from_detail(
        self, symbol: str
    ) -> tuple[str | None, str | None]:
        cached = self._get_cached_issue_date(symbol)
        if cached is not None:
            return cached

        if ak is None:
            return (None, None)

        try:
            with _bypass_proxy_for_domestic():
                response = requests.get(
                    XQ_ISSUE_DATE_URL.format(symbol=symbol),
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36"
                    },
                    timeout=10,
                )
                response.raise_for_status()
                payload = response.json()
        except (requests.RequestException, ValueError):
            logger.warning(
                "asset_detail_issue_date_fetch_failed",
                extra={"symbol": symbol},
                exc_info=True,
            )
            self._set_cached_issue_date(symbol, None, None)
            return (None, None)

        issue_date = _extract_issue_date_from_xq_payload(payload)
        issue_date_source = "akshare-xq" if issue_date is not None else None
        self._set_cached_issue_date(symbol, issue_date, issue_date_source)
        return (issue_date, issue_date_source)

    def _enrich_candidates(
        self, candidates: list[AssetCandidate]
    ) -> list[AssetCandidate]:
        enriched: list[AssetCandidate] = []

        for candidate in candidates:
            if candidate.issue_date is not None:
                enriched.append(candidate)
                continue

            issue_date, issue_date_source = self._fetch_issue_date_from_detail(
                candidate.symbol
            )
            if issue_date is None:
                enriched.append(candidate)
                continue

            enriched.append(
                replace(
                    candidate,
                    issue_date=issue_date,
                    issue_date_source=issue_date_source,
                )
            )

        return enriched
