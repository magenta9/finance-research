from __future__ import annotations

import unicodedata

from .types import AssetSearchResult


ASSET_SEARCH_RESULT_LIMIT = 50


def normalize_market(market: str | None) -> str | None:
    if market == "ALL":
        return None
    return market


def _normalize_query(value: object) -> str:
    return unicodedata.normalize("NFKC", str(value)).strip().lower()


def _metadata(row: dict[str, object]) -> dict[str, object]:
    value = row.get("metadata")
    return value if isinstance(value, dict) else {}


def _search_tokens(row: dict[str, object]) -> list[str]:
    metadata = _metadata(row)
    aliases = metadata.get("searchAliases")
    tokens = [str(row.get("symbol", "")), str(row.get("name", ""))]
    if isinstance(aliases, list):
        tokens.extend(str(alias) for alias in aliases)
    return tokens


def _query_match_rank(row: dict[str, object], query: str) -> int:
    normalized_tokens = [_normalize_query(token) for token in _search_tokens(row)]
    if any(query == token for token in normalized_tokens):
        return 0
    if any(token.startswith(query) for token in normalized_tokens):
        return 1
    if any(query in token for token in normalized_tokens):
        return 2
    return 3


def _asset_type_rank(row: dict[str, object]) -> int:
    metadata = _metadata(row)
    symbol = str(row.get("symbol", ""))
    name = str(row.get("name", ""))
    if (
        symbol.startswith("^")
        or metadata.get("instrumentType") == "index"
        or metadata.get("tsCodeAsset") == "I"
        or "指数" in name
        or name.lower().endswith("index")
    ):
        return 0
    return 1


def _sort_asset_results(
    rows: list[AssetSearchResult], query: str | None
) -> list[AssetSearchResult]:
    if query is None:
        return rows

    normalized_query = _normalize_query(query)
    if not normalized_query:
        return rows

    ranked = sorted(
        enumerate(rows),
        key=lambda item: (
            _query_match_rank(item[1], normalized_query),
            _asset_type_rank(item[1]),
            str(item[1].get("market", "")) != "HK",
            item[0],
        ),
    )
    return [row for _, row in ranked]


def dedupe_asset_results(
    rows: list[dict[str, object]], query: str | None = None
) -> list[AssetSearchResult]:
    seen: set[tuple[str, str]] = set()
    deduped: list[AssetSearchResult] = []

    for row in rows:
        key = (str(row["symbol"]), str(row["market"]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    return _sort_asset_results(deduped, query)
