from __future__ import annotations

import json
import re
from datetime import datetime
from functools import lru_cache
from typing import Any
from urllib import parse, request


HSI_DOWNLOADS = ("press-releases", "notices")
HSI_HOST = "https://www.hsi.com.hk"
BROAD_INDEX_REVIEW_PATTERNS = (
    "hang seng indexes company announces index review results",
    "hang seng indexes announces index review results",
    "恒生指数公司宣布指数检讨结果",
    "恒生指數公司宣佈指數檢討結果",
)
INDEX_REVIEW_QUERY_PATTERNS = (
    "index review",
    "constituent",
    "review results",
    "指数调整",
    "指數調整",
    "指数检讨",
    "指數檢討",
    "成分",
    "调整",
    "調整",
    "检讨",
    "檢討",
)
HSTECH_PATTERNS = ("hstech", "hang seng tech", "恒生科技")


class HsiIndexNoticesAdapter:
    provider_id = "hsi_index_notices"
    credibility_status = "official"
    structure_version = "hsi-media-room-download-v1"

    def search_announcements(
        self,
        symbol: str,
        query: str,
        market: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        if market != "HK" or not _is_supported_index_symbol(symbol):
            return []

        normalized_query = query.strip().lower()
        results: list[dict[str, Any]] = []

        for download_name in HSI_DOWNLOADS:
            for item in _load_download_items(download_name):
                title = str(item.get("title") or "").strip()
                if not title or not _matches_index_notice(
                    symbol, normalized_query, title
                ):
                    continue

                url = parse.urljoin(HSI_HOST, str(item.get("url") or ""))
                published_at = _hsi_date_to_iso(str(item.get("lastUpdate") or ""))
                source_id = f"hsi_index_notices:{parse.quote(url, safe='')}"
                results.append(
                    {
                        "credibilityStatus": self.credibility_status,
                        "evidenceEligible": False,
                        "providerId": self.provider_id,
                        "publishedAt": published_at,
                        "snippet": title,
                        "sourceId": source_id,
                        "structureVersion": self.structure_version,
                        "title": title,
                        "url": url,
                    }
                )

                if len(results) >= limit:
                    return results

        return results


@lru_cache(maxsize=None)
def _load_download_items(download_name: str) -> list[dict[str, Any]]:
    req = request.Request(
        f"{HSI_HOST}/data/eng/download/{download_name}.json",
        headers={"User-Agent": "QuantDesk/0.1 disclosure-fetch"},
    )

    with request.urlopen(req, timeout=12) as response:
        data = json.loads(response.read().decode("utf-8", errors="replace"))

    content_list = data.get("contentList")
    if not isinstance(content_list, list):
        raise RuntimeError(
            "HSI media room response structure mismatch: contentList missing."
        )

    items: list[dict[str, Any]] = []
    for section in content_list:
        if not isinstance(section, dict):
            continue
        resources = section.get("resourcesList")
        if not isinstance(resources, list):
            continue
        items.extend(item for item in resources if isinstance(item, dict))

    return items


def _is_supported_index_symbol(symbol: str) -> bool:
    normalized = symbol.strip().upper().removeprefix("^")
    normalized = normalized.removesuffix(".HK").replace(" ", "")
    return normalized in {"HSTECH", "HANGSENGTECH"} or "恒生科技" in symbol


def _matches_index_notice(symbol: str, query: str, title: str) -> bool:
    title_key = title.lower()
    symbol_key = symbol.strip().lower()
    if symbol_key in title_key:
        return not _query_requests_index_review(query) or _title_is_index_review(
            title_key
        )

    if _is_supported_index_symbol(symbol) and any(
        pattern in title_key for pattern in HSTECH_PATTERNS
    ):
        return not _query_requests_index_review(query) or _title_is_index_review(
            title_key
        )

    if _title_is_index_review(title_key):
        return True

    if query and query not in title_key:
        query_tokens = [token for token in re.split(r"\s+", query) if token]
        return any(token in title_key for token in query_tokens)

    return False


def _query_requests_index_review(query: str) -> bool:
    return any(pattern in query for pattern in INDEX_REVIEW_QUERY_PATTERNS)


def _title_is_index_review(title_key: str) -> bool:
    return any(pattern in title_key for pattern in BROAD_INDEX_REVIEW_PATTERNS)


def _hsi_date_to_iso(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value[:19])
    except ValueError:
        return value if "T" in value else f"{value[:10]}T00:00:00.000Z"
    return parsed.isoformat(timespec="milliseconds") + "Z"
