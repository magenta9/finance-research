from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .utils import (
    _classify_fund,
    _clean_text,
    _infer_underlying_market,
    _normalize_issue_date,
    _normalize_query,
    _normalize_symbol,
)


@dataclass(frozen=True)
class AssetCandidate:
    symbol: str
    name: str
    market: str
    asset_class: str
    currency: str
    source: str
    aliases: tuple[str, ...] = ()
    fund_type: str | None = None
    source_rank: int = 0
    issue_date: str | None = None
    issue_date_source: str | None = None


def _extract_issue_date_from_xq_payload(payload: Any) -> str | None:
    issue_date_keys = (
        "found_date",
        "foundDate",
        "成立时间",
        "成立日期",
        "发行日期",
        "上市日期",
    )

    def walk(value: Any) -> str | None:
        if isinstance(value, dict):
            for key in issue_date_keys:
                if key in value:
                    normalized = _normalize_issue_date(value.get(key))
                    if normalized is not None:
                        return normalized

            for nested_value in value.values():
                normalized = walk(nested_value)
                if normalized is not None:
                    return normalized
        elif isinstance(value, list):
            for nested_value in value:
                normalized = walk(nested_value)
                if normalized is not None:
                    return normalized

        return None

    return walk(payload)


def _build_candidate(
    symbol: Any,
    name: Any,
    source: str,
    *,
    fund_type: Any = None,
    aliases: tuple[str, ...] = (),
    issue_date: Any = None,
    issue_date_source: str | None = None,
    source_rank: int = 0,
) -> AssetCandidate | None:
    normalized_symbol = _normalize_symbol(symbol)
    cleaned_name = _clean_text(name)

    if not normalized_symbol or not cleaned_name:
        return None

    market, asset_class = _classify_fund(
        cleaned_name,
        None if fund_type is None else str(fund_type),
    )
    return AssetCandidate(
        symbol=normalized_symbol,
        name=cleaned_name,
        market=market,
        asset_class=asset_class,
        currency="CNY",
        source=source,
        aliases=aliases,
        fund_type=None if fund_type is None else str(fund_type).strip() or None,
        issue_date=_normalize_issue_date(issue_date),
        issue_date_source=issue_date_source,
        source_rank=source_rank,
    )


def _dedupe_asset_candidates(
    *batches: list[AssetCandidate],
) -> list[AssetCandidate]:
    merged: dict[tuple[str, str], AssetCandidate] = {}

    for batch in batches:
        for candidate in batch:
            key = (candidate.symbol, candidate.market)
            existing = merged.get(key)
            if existing is not None and existing.source_rank <= candidate.source_rank:
                continue
            merged[key] = candidate

    return list(merged.values())


def _match_candidate_score(query: str, candidate: AssetCandidate) -> int:
    symbol = _normalize_query(candidate.symbol)
    name = _normalize_query(candidate.name)
    aliases = [_normalize_query(alias) for alias in candidate.aliases]

    if not query:
        return -1
    if symbol == query:
        return 1000
    if name == query:
        return 950
    if query in aliases:
        return 940

    score = -1
    if name.startswith(f"{query}etf"):
        score = 900
    elif name.startswith(query):
        score = 860
    elif f"{query}etf" in name:
        score = 820
    elif query in name:
        score = 760
    elif query in symbol:
        score = 700
    elif any(query in alias for alias in aliases):
        score = 680

    if score < 0:
        return score

    return score - min(120, max(0, len(name) - len(query)))


def _build_asset_result(candidate: AssetCandidate) -> dict[str, object]:
    metadata: dict[str, object] = _infer_underlying_market(candidate.name)
    if candidate.issue_date is not None:
        metadata["issueDate"] = candidate.issue_date
    if candidate.issue_date_source is not None:
        metadata["issueDateSource"] = candidate.issue_date_source

    return {
        "symbol": candidate.symbol,
        "name": candidate.name,
        "market": candidate.market,
        "assetClass": candidate.asset_class,
        "currency": candidate.currency,
        "source": "akshare",
        "metadata": metadata,
    }