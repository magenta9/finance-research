from __future__ import annotations

import json
from functools import lru_cache
from datetime import datetime, timezone
from typing import Any
from urllib import parse, request


CNINFO_STOCK_DATASETS = (
    ("szse", "szse_stock.json"),
    ("fund", "fund_stock.json"),
)


class CninfoAnnouncementsAdapter:
    provider_id = "cninfo"
    credibility_status = "official"
    structure_version = "cninfo-hisAnnouncement-query-v1"

    def _post_json(self, url: str, data: dict[str, str]) -> dict[str, Any]:
        payload = parse.urlencode(data).encode("utf-8")
        req = request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Referer": "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch",
                "User-Agent": "QuantDesk/0.1 disclosure-fetch",
            },
            method="POST",
        )

        with request.urlopen(req, timeout=12) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))

    def search_announcements(
        self,
        symbol: str,
        query: str,
        market: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        del market
        normalized_symbol = symbol.strip().upper()
        stock_query = _resolve_cninfo_stock_query(normalized_symbol)
        if stock_query is None:
            return []

        data = self._post_json(
            "https://www.cninfo.com.cn/new/hisAnnouncement/query",
            {
                "pageNum": "1",
                "pageSize": str(limit),
                "column": stock_query["column"],
                "tabName": "fulltext",
                "plate": "",
                "stock": stock_query["stock"],
                "searchkey": query,
                "secid": "",
                "category": "",
                "trade": "",
                "seDate": "",
                "sortName": "",
                "sortType": "",
                "isHLtitle": "true",
            },
        )

        announcements = data.get("announcements")
        if announcements is None and _is_zero_record_response(data):
            return []
        if not isinstance(announcements, list):
            raise RuntimeError(
                "CNINFO response structure mismatch: announcements missing."
            )

        results: list[dict[str, Any]] = []
        for item in announcements[:limit]:
            if not isinstance(item, dict):
                continue
            if str(item.get("secCode") or "").strip().upper() != normalized_symbol:
                continue

            announcement_id = str(item.get("announcementId") or item.get("id") or "")
            title = _strip_highlight_tags(str(item.get("announcementTitle") or ""))
            adjunct_url = str(item.get("adjunctUrl") or "")
            published_at = _cninfo_time_to_iso(item.get("announcementTime"))
            url = (
                f"https://static.cninfo.com.cn/{adjunct_url}"
                if adjunct_url
                else f"https://www.cninfo.com.cn/new/disclosure/detail?announcementId={announcement_id}"
            )
            source_id = f"cninfo:{announcement_id or parse.quote(url, safe='')}"

            results.append(
                {
                    "credibilityStatus": self.credibility_status,
                    "evidenceEligible": False,
                    "providerId": self.provider_id,
                    "publishedAt": published_at,
                    "snippet": title,
                    "sourceId": source_id,
                    "structureVersion": self.structure_version,
                    "title": title or "CNINFO announcement",
                    "url": url,
                }
            )

        return results


@lru_cache(maxsize=None)
def _load_stock_list(dataset_name: str) -> list[dict[str, Any]]:
    req = request.Request(
        f"https://www.cninfo.com.cn/new/data/{dataset_name}",
        headers={"User-Agent": "QuantDesk/0.1 disclosure-fetch"},
    )

    with request.urlopen(req, timeout=12) as response:
        data = json.loads(response.read().decode("utf-8", errors="replace"))

    stock_list = data.get("stockList")
    if not isinstance(stock_list, list):
        raise RuntimeError("CNINFO stock list structure mismatch: stockList missing.")

    return [item for item in stock_list if isinstance(item, dict)]


def _resolve_cninfo_stock_query(symbol: str) -> dict[str, str] | None:
    for column, dataset_name in CNINFO_STOCK_DATASETS:
        for item in _load_stock_list(dataset_name):
            if str(item.get("code") or "").strip().upper() != symbol:
                continue

            org_id = str(item.get("orgId") or "").strip()
            if not org_id:
                return None

            return {"column": column, "stock": f"{symbol},{org_id}"}

    return None


def _is_zero_record_response(data: dict[str, Any]) -> bool:
    total_record_num = data.get("totalRecordNum")
    total_announcement = data.get("totalAnnouncement")
    return total_record_num in (0, "0") or total_announcement in (0, "0")


def _strip_highlight_tags(value: str) -> str:
    return value.replace("<em>", "").replace("</em>", "")


def _cninfo_time_to_iso(value: Any) -> str | None:
    if isinstance(value, (int, float)):
        return (
            datetime.fromtimestamp(value / 1000, tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
    if isinstance(value, str) and value:
        return value if "T" in value else f"{value[:10]}T00:00:00.000Z"
    return None
